"""Inventory schema bootstrap (idempotent) ported from server/inventory-schema.ts."""

from __future__ import annotations

import asyncpg

DEFAULT_SHIPPING_METHODS: tuple[tuple[str, bool], ...] = (
    ("Почта России", False),
    ("Яндекс", False),
    ("СДЭК", False),
    ("Авито доставка", False),
    ("Самовывоз", True),
)

_MOVEMENTS_EXTENDED_COLUMNS: tuple[tuple[str, str], ...] = (
    ("purchase_price", "NUMERIC(10, 2)"),
    ("sale_price", "NUMERIC(10, 2)"),
    ("delivery_price", "NUMERIC(10, 2)"),
    ("box_number", "VARCHAR(50)"),
    ("track_number", "TEXT"),
    ("shipping_method_id", "INTEGER"),
    ("sale_status", "VARCHAR(50)"),
    ("order_id", "INTEGER"),
    ("order_item_id", "INTEGER"),
    ("shipment_id", "INTEGER"),
    ("return_id", "INTEGER"),
)


async def ensure_inventory_schema(inventory_pool: asyncpg.Pool) -> None:
    conn = await inventory_pool.acquire()
    tx = conn.transaction()
    await tx.start()
    try:
        await conn.execute("CREATE SCHEMA IF NOT EXISTS inventory")

        # Reasons are now constants in shared/schema.ts (REASONS), no DB table needed.
        await conn.execute("DROP TABLE IF EXISTS inventory.reasons")

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.shipping_methods (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              is_pickup BOOLEAN NOT NULL DEFAULT FALSE,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL
            )
            """
        )

        await conn.execute(
            """
            ALTER TABLE inventory.shipping_methods
            ADD COLUMN IF NOT EXISTS is_pickup BOOLEAN NOT NULL DEFAULT FALSE
            """
        )

        await conn.execute(
            """
            DELETE FROM inventory.shipping_methods a
            USING inventory.shipping_methods b
            WHERE a.id > b.id AND a.name = b.name
            """
        )

        await conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS shipping_methods_name_uidx
            ON inventory.shipping_methods (name)
            """
        )

        for method_name, is_pickup in DEFAULT_SHIPPING_METHODS:
            await conn.execute(
                """
                INSERT INTO inventory.shipping_methods (name, is_pickup)
                VALUES ($1, $2)
                ON CONFLICT (name)
                DO UPDATE SET is_pickup = EXCLUDED.is_pickup
                """,
                method_name,
                is_pickup,
            )

        # Base table (older installations may already have it with different columns).
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.movements (
              id SERIAL PRIMARY KEY,
              smart VARCHAR NOT NULL,
              qty_delta INTEGER NOT NULL,
              reason VARCHAR NOT NULL,
              note TEXT,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL
            )
            """
        )

        # Hard requirement from specification: no `article` column in movements.
        await conn.execute("ALTER TABLE inventory.movements DROP COLUMN IF EXISTS article")

        # Ensure extended columns exist (idempotent).
        for column_name, column_type in _MOVEMENTS_EXTENDED_COLUMNS:
            await conn.execute(
                f"""
                ALTER TABLE inventory.movements
                ADD COLUMN IF NOT EXISTS {column_name} {column_type}
                """
            )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.customers (
              id SERIAL PRIMARY KEY,
              name TEXT NOT NULL,
              phone TEXT,
              note TEXT,
              archived_at TIMESTAMP,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              updated_at TIMESTAMP DEFAULT NOW() NOT NULL
            )
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.orders (
              id SERIAL PRIMARY KEY,
              customer_id INTEGER NOT NULL REFERENCES inventory.customers(id),
              note TEXT,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              updated_at TIMESTAMP DEFAULT NOW() NOT NULL
            )
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.order_items (
              id SERIAL PRIMARY KEY,
              order_id INTEGER NOT NULL REFERENCES inventory.orders(id) ON DELETE CASCADE,
              smart VARCHAR NOT NULL,
              qty INTEGER NOT NULL CHECK (qty > 0),
              sale_price NUMERIC(10, 2) NOT NULL,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL
            )
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.shipments (
              id SERIAL PRIMARY KEY,
              order_id INTEGER NOT NULL REFERENCES inventory.orders(id) ON DELETE CASCADE,
              shipping_method_id INTEGER NOT NULL REFERENCES inventory.shipping_methods(id),
              track_number TEXT,
              delivery_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
              delivery_payer VARCHAR(20),
              status VARCHAR(20) NOT NULL DEFAULT 'pending',
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
              CONSTRAINT shipments_status_chk CHECK (status IN ('pending', 'shipped', 'delivered')),
              CONSTRAINT shipments_delivery_payer_chk CHECK (delivery_payer IN ('seller', 'buyer') OR delivery_payer IS NULL)
            )
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.shipment_items (
              id SERIAL PRIMARY KEY,
              shipment_id INTEGER NOT NULL REFERENCES inventory.shipments(id) ON DELETE CASCADE,
              order_item_id INTEGER NOT NULL REFERENCES inventory.order_items(id) ON DELETE CASCADE,
              qty INTEGER NOT NULL CHECK (qty > 0),
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              UNIQUE (shipment_id, order_item_id)
            )
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.returns (
              id SERIAL PRIMARY KEY,
              order_id INTEGER NOT NULL REFERENCES inventory.orders(id) ON DELETE CASCADE,
              kind VARCHAR(20) NOT NULL DEFAULT 'return',
              note TEXT,
              return_price NUMERIC(10, 2) NOT NULL DEFAULT 0,
              return_payer VARCHAR(20),
              shipping_method_id INTEGER REFERENCES inventory.shipping_methods(id),
              track_number TEXT,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              CONSTRAINT returns_kind_chk CHECK (kind IN ('return', 'correction')),
              CONSTRAINT returns_return_payer_chk CHECK (return_payer IN ('seller', 'buyer') OR return_payer IS NULL)
            )
            """
        )

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.return_items (
              id SERIAL PRIMARY KEY,
              return_id INTEGER NOT NULL REFERENCES inventory.returns(id) ON DELETE CASCADE,
              order_item_id INTEGER NOT NULL REFERENCES inventory.order_items(id) ON DELETE CASCADE,
              qty INTEGER NOT NULL CHECK (qty > 0),
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              UNIQUE (return_id, order_item_id)
            )
            """
        )

        await conn.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'order_items_sale_price_non_negative_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.order_items
                  ADD CONSTRAINT order_items_sale_price_non_negative_chk
                  CHECK (sale_price >= 0) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'shipments_delivery_price_non_negative_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.shipments
                  ADD CONSTRAINT shipments_delivery_price_non_negative_chk
                  CHECK (delivery_price >= 0) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'returns_return_price_non_negative_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.returns
                  ADD CONSTRAINT returns_return_price_non_negative_chk
                  CHECK (return_price >= 0) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'movements_purchase_price_non_negative_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.movements
                  ADD CONSTRAINT movements_purchase_price_non_negative_chk
                  CHECK (purchase_price IS NULL OR purchase_price >= 0) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'movements_sale_price_non_negative_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.movements
                  ADD CONSTRAINT movements_sale_price_non_negative_chk
                  CHECK (sale_price IS NULL OR sale_price >= 0) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'movements_delivery_price_non_negative_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.movements
                  ADD CONSTRAINT movements_delivery_price_non_negative_chk
                  CHECK (delivery_price IS NULL OR delivery_price >= 0) NOT VALID;
              END IF;
            END
            $$;
            """
        )

        await conn.execute(
            """
            UPDATE inventory.movements m
            SET shipment_id = src.shipment_id
            FROM (
              SELECT order_item_id, MIN(shipment_id) AS shipment_id
              FROM inventory.shipment_items
              GROUP BY order_item_id
            ) src
            WHERE m.reason = 'sale'
              AND m.order_item_id = src.order_item_id
              AND m.shipment_id IS NULL
              AND (m.purchase_price IS NULL OR m.purchase_price >= 0)
              AND (m.sale_price IS NULL OR m.sale_price >= 0)
              AND (m.delivery_price IS NULL OR m.delivery_price >= 0)
            """
        )

        # VIEW that hides zero stock by design.
        await conn.execute(
            """
            CREATE OR REPLACE VIEW inventory.stock AS
            SELECT
              smart,
              SUM(qty_delta) as total_qty
            FROM inventory.movements
            GROUP BY smart
            HAVING SUM(qty_delta) > 0
            """
        )

        # Helpful indexes for common filters.
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_smart_idx ON inventory.movements (smart)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_reason_idx ON inventory.movements (reason)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_created_at_idx ON inventory.movements (created_at DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_sale_status_idx ON inventory.movements (sale_status)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_order_id_idx ON inventory.movements (order_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_order_item_id_idx ON inventory.movements (order_item_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_shipment_id_idx ON inventory.movements (shipment_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_return_id_idx ON inventory.movements (return_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS customers_name_idx ON inventory.customers (name)")
        await conn.execute("CREATE INDEX IF NOT EXISTS customers_phone_idx ON inventory.customers (phone)")
        await conn.execute("CREATE INDEX IF NOT EXISTS orders_customer_idx ON inventory.orders (customer_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS orders_created_at_idx ON inventory.orders (created_at DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS order_items_order_idx ON inventory.order_items (order_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS order_items_smart_idx ON inventory.order_items (smart)")
        await conn.execute("CREATE INDEX IF NOT EXISTS shipments_order_idx ON inventory.shipments (order_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS shipments_status_idx ON inventory.shipments (status)")
        await conn.execute("CREATE INDEX IF NOT EXISTS shipment_items_shipment_idx ON inventory.shipment_items (shipment_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS shipment_items_order_item_idx ON inventory.shipment_items (order_item_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS returns_order_idx ON inventory.returns (order_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS return_items_return_idx ON inventory.return_items (return_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS return_items_order_item_idx ON inventory.return_items (order_item_id)")

        await tx.commit()
    except Exception:
        try:
            await tx.rollback()
        except Exception:
            # Ignore rollback errors.
            pass
        raise
    finally:
        await inventory_pool.release(conn)


# TypeScript-compatible alias.
ensureInventorySchema = ensure_inventory_schema
