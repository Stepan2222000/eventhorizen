"""Inventory schema bootstrap (idempotent) ported from server/inventory-schema.ts."""

from __future__ import annotations

import re

import asyncpg

from .normalization import normalize_box_name

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

_ITEM_STATES: tuple[str, ...] = ("in_stock", "sold", "written_off")

MIGRATION_UNKNOWN_BOX = "NO-BOX"


def _as_int(value: object, default: int = 0) -> int:
    if value is None:
        return default
    if isinstance(value, bool):
        return default
    if isinstance(value, int):
        return value
    try:
        return int(value)  # type: ignore[arg-type]
    except Exception:
        return default


def _as_str(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    text = value.strip()
    return text or None


def _sanitize_box_name(value: str | None) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    text = text.replace("/", "-")
    text = re.sub(r"\s+", " ", text).strip()
    if len(text) > 50:
        text = text[:50].strip()
    return text or None


async def _ensure_box_exists_active(conn: asyncpg.Connection, name: str) -> str:
    """Ensure box exists in registry and is active. Returns the canonical name."""
    name = _sanitize_box_name(name) or MIGRATION_UNKNOWN_BOX
    norm = normalize_box_name(name)
    if not norm:
        raise RuntimeError(f"Invalid box name for migration: {name!r}")

    # Insert by norm; preserve existing canonical name if present.
    existing = await conn.fetchrow("SELECT name FROM inventory.boxes WHERE name_norm = $1", norm)
    if existing is None:
        await conn.execute(
            """
            INSERT INTO inventory.boxes (name, name_norm, description, is_active, created_at)
            VALUES ($1, $2, NULL, TRUE, NOW())
            ON CONFLICT (name_norm) DO NOTHING
            """,
            name,
            norm,
        )
        canonical = name
    else:
        canonical = str(existing.get("name") or name)

    await conn.execute("UPDATE inventory.boxes SET is_active = TRUE WHERE name_norm = $1", norm)
    return canonical


async def _migrate_legacy_movements_to_items_if_needed(conn: asyncpg.Connection) -> None:
    """
    One-time migration for legacy DBs where stock was derived from `movements`.

    Legacy datasets may contain movements without `box_number` (old sales/adjustments).
    Such history does not contain enough information to map every delta to a concrete
    instance without making time-travel assumptions.

    Migration strategy:
    - Replay only movements that have a `box_number` into concrete `items` and
      build `movement_items` links for traceability (boxed history).
    - Compute the *net* delta for movements without a box and reconcile the
      resulting item stock via a dedicated MIGRATION adjustment (instance-level),
      preferring to take items from boxes that never participated in explicit
      boxed outflows.

    If `inventory.items` already has rows, we assume migration already happened.
    """

    items_count = await conn.fetchval("SELECT COUNT(*)::bigint FROM inventory.items")
    if _as_int(items_count) > 0:
        return

    movements_count = await conn.fetchval("SELECT COUNT(*)::bigint FROM inventory.movements")
    if _as_int(movements_count) <= 0:
        return

    unknown_box = await _ensure_box_exists_active(conn, MIGRATION_UNKNOWN_BOX)

    movement_rows = await conn.fetch(
        """
        SELECT
          id,
          smart,
          qty_delta,
          reason,
          note,
          created_at,
          box_number,
          linked_movement_id,
          order_item_id
        FROM inventory.movements
        ORDER BY created_at ASC, id ASC
        """
    )

    movements_by_id: dict[int, asyncpg.Record] = {}
    legacy_total_by_smart: dict[str, int] = {}
    unboxed_delta_by_smart: dict[str, int] = {}
    protected_boxes_by_smart: dict[str, set[str]] = {}
    sale_by_order_item_id_boxed: dict[int, int] = {}

    for row in movement_rows:
        movement_id = _as_int(row.get("id"))
        movements_by_id[movement_id] = row

        smart = str(row.get("smart") or "")
        legacy_total_by_smart[smart] = legacy_total_by_smart.get(smart, 0) + _as_int(row.get("qty_delta"))

        box_raw = _as_str(row.get("box_number"))
        if not box_raw:
            unboxed_delta_by_smart[smart] = unboxed_delta_by_smart.get(smart, 0) + _as_int(row.get("qty_delta"))
            continue

        # Track boxes that participate in explicit boxed outflows; prefer preserving them during reconciliation.
        reason = str(row.get("reason") or "")
        qty_delta = _as_int(row.get("qty_delta"))
        if reason in {"sale", "writeoff", "adjust", "transfer"} and qty_delta < 0:
            protected_boxes_by_smart.setdefault(smart, set()).add(box_raw)

        if (reason == "sale") and row.get("order_item_id") is not None:
            order_item_id = _as_int(row.get("order_item_id"))
            # Keep the earliest *boxed* sale movement for each order_item_id (rows are sorted ASC).
            sale_by_order_item_id_boxed.setdefault(order_item_id, movement_id)

    async def _pick_in_stock_ids(smart: str, box: str | None, qty: int) -> list[int]:
        if qty <= 0:
            return []
        if box:
            rows = await conn.fetch(
                """
                SELECT id
                FROM inventory.items
                WHERE smart = $1
                  AND state = 'in_stock'
                  AND box_number = $2
                ORDER BY id ASC
                LIMIT $3
                FOR UPDATE
                """,
                smart,
                box,
                qty,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT id
                FROM inventory.items
                WHERE smart = $1
                  AND state = 'in_stock'
                ORDER BY id ASC
                LIMIT $2
                FOR UPDATE
                """,
                smart,
                qty,
            )
        return [_as_int(r.get("id")) for r in rows]

    async def _pick_sold_ids_for_return_from_sale(sale_movement_id: int, qty: int) -> list[int]:
        if qty <= 0:
            return []
        rows = await conn.fetch(
            """
            SELECT i.id
            FROM inventory.items i
            JOIN inventory.movement_items mi ON mi.item_id = i.id
            WHERE mi.movement_id = $1
              AND i.state = 'sold'
            ORDER BY i.id ASC
            LIMIT $2
            FOR UPDATE
            """,
            sale_movement_id,
            qty,
        )
        return [_as_int(r.get("id")) for r in rows]

    processed_transfer_ids: set[int] = set()
    processed_movement_ids: set[int] = set()
    expected_links_by_movement_id: dict[int, int] = {}

    for row in movement_rows:
        movement_id = _as_int(row.get("id"))
        if movement_id in processed_transfer_ids:
            continue

        smart = str(row.get("smart") or "")
        qty_delta = _as_int(row.get("qty_delta"))
        reason = str(row.get("reason") or "")
        created_at = row.get("created_at")
        box_raw = _as_str(row.get("box_number"))
        order_item_id = _as_int(row.get("order_item_id")) if row.get("order_item_id") is not None else None

        # Only boxed movements can be migrated into concrete instances.
        # Unboxed history is reconciled later by net delta.
        if reason != "transfer" and not box_raw:
            continue

        if reason == "transfer":
            # Process transfers only once (from-movement has negative qty).
            if qty_delta >= 0:
                continue

            to_id = _as_int(row.get("linked_movement_id"))
            if to_id <= 0 or to_id not in movements_by_id:
                raise RuntimeError(f"Cannot migrate transfer movement {movement_id}: missing linked_movement_id")

            to_row = movements_by_id[to_id]
            to_box_raw = _as_str(to_row.get("box_number"))
            if not box_raw or not to_box_raw:
                raise RuntimeError(f"Cannot migrate transfer movement {movement_id}: from/to box is empty")

            qty = abs(qty_delta)
            from_box = await _ensure_box_exists_active(conn, box_raw)
            to_box = await _ensure_box_exists_active(conn, to_box_raw)

            picked_ids = await _pick_in_stock_ids(smart, from_box, qty)
            if len(picked_ids) < qty:
                raise RuntimeError(
                    f"Cannot migrate transfer movement {movement_id}: "
                    f"need {qty} items in {from_box}, found {len(picked_ids)} (SMART={smart})"
                )

            await conn.execute(
                """
                UPDATE inventory.items
                SET box_number = $1,
                    last_movement_id = $2,
                    updated_at = $3
                WHERE id = ANY($4::bigint[])
                """,
                to_box,
                to_id,
                created_at,
                picked_ids,
            )
            await conn.execute(
                """
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $1, UNNEST($2::bigint[])
                """,
                movement_id,
                picked_ids,
            )
            await conn.execute(
                """
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $1, UNNEST($2::bigint[])
                """,
                to_id,
                picked_ids,
            )
            processed_transfer_ids.add(movement_id)
            processed_transfer_ids.add(to_id)
            processed_movement_ids.add(movement_id)
            processed_movement_ids.add(to_id)
            expected_links_by_movement_id[movement_id] = qty
            expected_links_by_movement_id[to_id] = qty
            continue

        if reason == "purchase":
            if qty_delta <= 0:
                raise RuntimeError(f"Cannot migrate purchase movement {movement_id}: qty_delta={qty_delta}")
            # Purchases should always have a box, but keep the migration resilient.
            target_box = await _ensure_box_exists_active(conn, box_raw or unknown_box)
            await conn.execute(
                """
                WITH ins AS (
                  INSERT INTO inventory.items (
                    smart, state, box_number, note,
                    purchase_movement_id,
                    sold_movement_id, written_off_movement_id,
                    last_movement_id,
                    created_at, updated_at
                  )
                  SELECT
                    $2, 'in_stock', $3, NULL,
                    $1,
                    NULL, NULL,
                    $1,
                    $4, $4
                  FROM generate_series(1, $5)
                  RETURNING id
                )
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $1, id FROM ins
                """,
                movement_id,
                smart,
                target_box,
                created_at,
                qty_delta,
            )
            processed_movement_ids.add(movement_id)
            expected_links_by_movement_id[movement_id] = qty_delta
            continue

        if reason == "adjust":
            if qty_delta == 0:
                continue
            if qty_delta > 0:
                target_box = await _ensure_box_exists_active(conn, box_raw or unknown_box)
                await conn.execute(
                    """
                    WITH ins AS (
                      INSERT INTO inventory.items (
                        smart, state, box_number, note,
                        purchase_movement_id,
                        sold_movement_id, written_off_movement_id,
                        last_movement_id,
                        created_at, updated_at
                      )
                      SELECT
                        $2, 'in_stock', $3, NULL,
                        NULL,
                        NULL, NULL,
                        $1,
                        $4, $4
                      FROM generate_series(1, $5)
                      RETURNING id
                    )
                    INSERT INTO inventory.movement_items (movement_id, item_id)
                    SELECT $1, id FROM ins
                    """,
                    movement_id,
                    smart,
                    target_box,
                    created_at,
                    qty_delta,
                )
                processed_movement_ids.add(movement_id)
                expected_links_by_movement_id[movement_id] = qty_delta
            else:
                qty = abs(qty_delta)
                if not box_raw:
                    # Should not happen for boxed migration; reconcile in net-delta phase.
                    continue
                source_box = await _ensure_box_exists_active(conn, box_raw)
                picked_ids = await _pick_in_stock_ids(smart, source_box, qty)
                if len(picked_ids) < qty:
                    raise RuntimeError(
                        f"Cannot migrate adjust(-) movement {movement_id}: "
                        f"need {qty} items, found {len(picked_ids)} (SMART={smart}, box={source_box or 'ANY'})"
                    )
                await conn.execute(
                    """
                    UPDATE inventory.items
                    SET state = 'written_off',
                        box_number = NULL,
                        written_off_movement_id = $1,
                        last_movement_id = $1,
                        updated_at = $2
                    WHERE id = ANY($3::bigint[])
                    """,
                    movement_id,
                    created_at,
                    picked_ids,
                )
                await conn.execute(
                    """
                    INSERT INTO inventory.movement_items (movement_id, item_id)
                    SELECT $1, UNNEST($2::bigint[])
                    """,
                    movement_id,
                    picked_ids,
                )
                processed_movement_ids.add(movement_id)
                expected_links_by_movement_id[movement_id] = qty
            continue

        if reason == "sale":
            if qty_delta >= 0:
                raise RuntimeError(f"Cannot migrate sale movement {movement_id}: qty_delta={qty_delta}")
            if not box_raw:
                # Legacy sales without a box cannot be mapped reliably; handled in net-delta reconciliation.
                continue
            qty = abs(qty_delta)
            source_box = await _ensure_box_exists_active(conn, box_raw)
            picked_ids = await _pick_in_stock_ids(smart, source_box, qty)
            if len(picked_ids) < qty:
                raise RuntimeError(
                    f"Cannot migrate sale movement {movement_id}: "
                    f"need {qty} items, found {len(picked_ids)} (SMART={smart}, box={source_box or 'ANY'})"
                )
            await conn.execute(
                """
                UPDATE inventory.items
                SET state = 'sold',
                    box_number = NULL,
                    sold_movement_id = $1,
                    last_movement_id = $1,
                    updated_at = $2
                WHERE id = ANY($3::bigint[])
                """,
                movement_id,
                created_at,
                picked_ids,
            )
            await conn.execute(
                """
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $1, UNNEST($2::bigint[])
                """,
                movement_id,
                picked_ids,
            )
            processed_movement_ids.add(movement_id)
            expected_links_by_movement_id[movement_id] = qty
            continue

        if reason == "writeoff":
            if qty_delta >= 0:
                raise RuntimeError(f"Cannot migrate writeoff movement {movement_id}: qty_delta={qty_delta}")
            if not box_raw:
                continue
            qty = abs(qty_delta)
            source_box = await _ensure_box_exists_active(conn, box_raw)
            picked_ids = await _pick_in_stock_ids(smart, source_box, qty)
            if len(picked_ids) < qty:
                raise RuntimeError(
                    f"Cannot migrate writeoff movement {movement_id}: "
                    f"need {qty} items, found {len(picked_ids)} (SMART={smart}, box={source_box or 'ANY'})"
                )
            await conn.execute(
                """
                UPDATE inventory.items
                SET state = 'written_off',
                    box_number = NULL,
                    written_off_movement_id = $1,
                    last_movement_id = $1,
                    updated_at = $2
                WHERE id = ANY($3::bigint[])
                """,
                movement_id,
                created_at,
                picked_ids,
            )
            await conn.execute(
                """
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $1, UNNEST($2::bigint[])
                """,
                movement_id,
                picked_ids,
            )
            processed_movement_ids.add(movement_id)
            expected_links_by_movement_id[movement_id] = qty
            continue

        if reason == "return":
            if qty_delta <= 0:
                raise RuntimeError(f"Cannot migrate return movement {movement_id}: qty_delta={qty_delta}")
            if not box_raw:
                continue
            target_box = await _ensure_box_exists_active(conn, box_raw)

            # If we can resolve a boxed sale for this return, return the exact same items.
            picked_ids: list[int] = []
            sale_movement_id = sale_by_order_item_id_boxed.get(order_item_id or 0)
            if sale_movement_id:
                picked_ids = await _pick_sold_ids_for_return_from_sale(sale_movement_id, qty_delta)

            if len(picked_ids) == qty_delta:
                await conn.execute(
                    """
                    UPDATE inventory.items
                    SET state = 'in_stock',
                        box_number = $1,
                        sold_movement_id = NULL,
                        last_movement_id = $2,
                        updated_at = $3
                    WHERE id = ANY($4::bigint[])
                    """,
                    target_box,
                    movement_id,
                    created_at,
                    picked_ids,
                )
                await conn.execute(
                    """
                    INSERT INTO inventory.movement_items (movement_id, item_id)
                    SELECT $1, UNNEST($2::bigint[])
                    """,
                    movement_id,
                    picked_ids,
                )
            else:
                # If we cannot pick ALL expected sold items, fallback to inbound correction.
                # Partial linkage would break sanity checks and startup.
                # Legacy return where the sale cannot be mapped to items (e.g. sale had no box).
                # Treat as an inbound correction into the specified box.
                await conn.execute(
                    """
                    WITH ins AS (
                      INSERT INTO inventory.items (
                        smart, state, box_number, note,
                        purchase_movement_id,
                        sold_movement_id, written_off_movement_id,
                        last_movement_id,
                        created_at, updated_at
                      )
                      SELECT
                        $2, 'in_stock', $3, NULL,
                        NULL,
                        NULL, NULL,
                        $1,
                        $4, $4
                      FROM generate_series(1, $5)
                      RETURNING id
                    )
                    INSERT INTO inventory.movement_items (movement_id, item_id)
                    SELECT $1, id FROM ins
                    """,
                    movement_id,
                    smart,
                    target_box,
                    created_at,
                    qty_delta,
                )
            processed_movement_ids.add(movement_id)
            expected_links_by_movement_id[movement_id] = qty_delta
            continue

        raise RuntimeError(f"Cannot migrate unknown movement reason={reason!r} (id={movement_id})")

    # Reconcile unboxed net delta (legacy movements without a box).
    for smart, unboxed_delta in unboxed_delta_by_smart.items():
        if unboxed_delta == 0:
            continue

        # Anchor movement for item links (does not affect legacy ledger sum).
        reconcile_row = await conn.fetchrow(
            """
            INSERT INTO inventory.movements (
              smart, qty_delta, reason, note,
              purchase_price, sale_price, delivery_price,
              box_number, track_number, shipping_method_id, sale_status,
              linked_movement_id,
              created_at
            )
            VALUES ($1, 0, 'adjust', $2, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NOW())
            RETURNING id
            """,
            smart,
            f"MIGRATION: reconcile legacy movements without box (net qty_delta={unboxed_delta})",
        )
        if reconcile_row is None:
            raise RuntimeError("Could not create migration reconcile movement")
        reconcile_id = _as_int(reconcile_row.get("id"))

        protected_boxes = sorted(protected_boxes_by_smart.get(smart, set()))

        if unboxed_delta < 0:
            qty = abs(unboxed_delta)
            picked_ids = await conn.fetch(
                """
                SELECT id
                FROM inventory.items
                WHERE smart = $1
                  AND state = 'in_stock'
                  AND NOT (box_number = ANY($2::text[]))
                ORDER BY id ASC
                LIMIT $3
                FOR UPDATE
                """,
                smart,
                protected_boxes,
                qty,
            )
            picked = [_as_int(r.get("id")) for r in picked_ids]

            if len(picked) < qty:
                remaining = qty - len(picked)
                more_rows = await conn.fetch(
                    """
                    SELECT id
                    FROM inventory.items
                    WHERE smart = $1
                      AND state = 'in_stock'
                    ORDER BY id ASC
                    LIMIT $2
                    FOR UPDATE
                    """,
                    smart,
                    remaining,
                )
                picked.extend([_as_int(r.get("id")) for r in more_rows])

            if len(picked) < qty:
                raise RuntimeError(
                    f"Cannot reconcile unboxed delta for SMART={smart}: "
                    f"need {qty} in-stock items, found {len(picked)}"
                )

            await conn.execute(
                """
                UPDATE inventory.items
                SET state = 'written_off',
                    box_number = NULL,
                    written_off_movement_id = $1,
                    last_movement_id = $1,
                    updated_at = NOW()
                WHERE id = ANY($2::bigint[])
                """,
                reconcile_id,
                picked,
            )
            await conn.execute(
                """
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $1, UNNEST($2::bigint[])
                """,
                reconcile_id,
                picked,
            )
            processed_movement_ids.add(reconcile_id)
            expected_links_by_movement_id[reconcile_id] = qty

        else:
            qty = unboxed_delta
            target_box = await _ensure_box_exists_active(conn, unknown_box)
            await conn.execute(
                """
                WITH ins AS (
                  INSERT INTO inventory.items (
                    smart, state, box_number, note,
                    purchase_movement_id,
                    sold_movement_id, written_off_movement_id,
                    last_movement_id,
                    created_at, updated_at
                  )
                  SELECT
                    $2, 'in_stock', $3, NULL,
                    NULL,
                    NULL, NULL,
                    $1,
                    NOW(), NOW()
                  FROM generate_series(1, $4)
                  RETURNING id
                )
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $1, id FROM ins
                """,
                reconcile_id,
                smart,
                target_box,
                qty,
            )
            processed_movement_ids.add(reconcile_id)
            expected_links_by_movement_id[reconcile_id] = qty

    # Ensure boxes containing in-stock items are active after migration.
    await conn.execute(
        """
        UPDATE inventory.boxes b
        SET is_active = TRUE
        WHERE b.name IN (
          SELECT DISTINCT box_number
          FROM inventory.items
          WHERE state = 'in_stock'
        )
        """
    )

    # Sanity checks: totals per SMART must match legacy ledger.
    for smart, legacy_total in legacy_total_by_smart.items():
        in_stock = await conn.fetchval(
            "SELECT COUNT(*)::bigint FROM inventory.items WHERE smart = $1 AND state = 'in_stock'",
            smart,
        )
        if _as_int(in_stock) != legacy_total:
            raise RuntimeError(
                f"Item migration sanity check failed for SMART={smart}: "
                f"legacy_total={legacy_total}, items_in_stock={_as_int(in_stock)}"
            )

    # Ensure migrated movements have the expected number of linked items.
    movement_item_counts = await conn.fetch(
        "SELECT movement_id, COUNT(*)::bigint AS cnt FROM inventory.movement_items GROUP BY movement_id"
    )
    count_by_movement_id = {_as_int(r.get("movement_id")): _as_int(r.get("cnt")) for r in movement_item_counts}
    for movement_id, expected in expected_links_by_movement_id.items():
        actual = count_by_movement_id.get(movement_id, 0)
        if actual != expected:
            raise RuntimeError(
                f"Item migration sanity check failed for movement {movement_id}: expected {expected} linked items, got {actual}"
            )


async def ensure_inventory_schema(inventory_pool: asyncpg.Pool) -> None:
    conn = await inventory_pool.acquire()
    tx = conn.transaction()
    await tx.start()
    try:
        # Advisory lock prevents concurrent DDL from parallel workers/processes.
        # Lock is released automatically when the transaction commits/rolls back.
        await conn.execute("SELECT pg_advisory_xact_lock(8675309)")
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
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'inventory'
                  AND table_name = 'movements'
              ) THEN
                WITH dup AS (
                  SELECT id, MIN(id) OVER (PARTITION BY name) AS keep_id
                  FROM inventory.shipping_methods
                )
                UPDATE inventory.movements m
                SET shipping_method_id = d.keep_id
                FROM dup d
                WHERE m.shipping_method_id = d.id
                  AND d.id <> d.keep_id;
              END IF;
            END
            $$;
            """
        )
        await conn.execute(
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'inventory'
                  AND table_name = 'shipments'
              ) THEN
                WITH dup AS (
                  SELECT id, MIN(id) OVER (PARTITION BY name) AS keep_id
                  FROM inventory.shipping_methods
                )
                UPDATE inventory.shipments s
                SET shipping_method_id = d.keep_id
                FROM dup d
                WHERE s.shipping_method_id = d.id
                  AND d.id <> d.keep_id;
              END IF;
            END
            $$;
            """
        )
        await conn.execute(
            """
            DO $$
            BEGIN
              IF EXISTS (
                SELECT 1
                FROM information_schema.tables
                WHERE table_schema = 'inventory'
                  AND table_name = 'returns'
              ) THEN
                WITH dup AS (
                  SELECT id, MIN(id) OVER (PARTITION BY name) AS keep_id
                  FROM inventory.shipping_methods
                )
                UPDATE inventory.returns r
                SET shipping_method_id = d.keep_id
                FROM dup d
                WHERE r.shipping_method_id = d.id
                  AND d.id <> d.keep_id;
              END IF;
            END
            $$;
            """
        )
        await conn.execute(
            """
            WITH dup AS (
              SELECT id, MIN(id) OVER (PARTITION BY name) AS keep_id
              FROM inventory.shipping_methods
            )
            DELETE FROM inventory.shipping_methods sm
            USING dup d
            WHERE sm.id = d.id
              AND d.id <> d.keep_id
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

        # Link paired movements (used for transfers).
        await conn.execute("ALTER TABLE inventory.movements ADD COLUMN IF NOT EXISTS linked_movement_id INTEGER")
        await conn.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'movements_linked_movement_id_fkey'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.movements
                  ADD CONSTRAINT movements_linked_movement_id_fkey
                  FOREIGN KEY (linked_movement_id)
                  REFERENCES inventory.movements(id);
              END IF;
            END
            $$;
            """
        )

        # Boxes registry.
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.boxes (
              id SERIAL PRIMARY KEY,
              name VARCHAR(50) NOT NULL,
              name_norm VARCHAR(64) NOT NULL,
              description TEXT,
              is_active BOOLEAN NOT NULL DEFAULT TRUE,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL
            )
            """
        )

        # Normalize existing movement box values (trim + treat empty as NULL).
        await conn.execute(
            """
            UPDATE inventory.movements
            SET box_number = NULL
            WHERE box_number IS NOT NULL
              AND LENGTH(TRIM(box_number)) = 0
            """
        )
        await conn.execute(
            """
            UPDATE inventory.movements
            SET box_number = TRIM(box_number)
            WHERE box_number IS NOT NULL
              AND box_number <> TRIM(box_number)
            """
        )

        await conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS boxes_name_norm_uidx ON inventory.boxes (name_norm)")
        await conn.execute("CREATE UNIQUE INDEX IF NOT EXISTS boxes_name_uidx ON inventory.boxes (name)")

        # Physical items (instance-level inventory).
        # Source of truth for current stock and box contents.
        await conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS inventory.items (
              id BIGSERIAL PRIMARY KEY,
              smart VARCHAR NOT NULL,
              state VARCHAR(32) NOT NULL DEFAULT 'in_stock',
              box_number VARCHAR(50),
              note TEXT,
              purchase_movement_id INTEGER,
              sold_movement_id INTEGER,
              written_off_movement_id INTEGER,
              last_movement_id INTEGER,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
              CONSTRAINT items_state_chk CHECK (state IN ({", ".join(repr(s) for s in _ITEM_STATES)})),
              CONSTRAINT items_in_stock_box_chk CHECK (
                (state = 'in_stock' AND box_number IS NOT NULL AND LENGTH(TRIM(box_number)) > 0)
                OR
                (state <> 'in_stock' AND (box_number IS NULL OR LENGTH(TRIM(box_number)) = 0))
              ),
              CONSTRAINT items_sold_movement_chk CHECK (
                (state <> 'sold' AND sold_movement_id IS NULL)
                OR
                (state = 'sold' AND sold_movement_id IS NOT NULL)
              ),
              CONSTRAINT items_written_off_movement_chk CHECK (
                (state <> 'written_off' AND written_off_movement_id IS NULL)
                OR
                (state = 'written_off' AND written_off_movement_id IS NOT NULL)
              )
            )
            """
        )

        # Box FK (optional), keep nullable for non-in_stock items.
        await conn.execute(
            """
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'items_box_number_fkey'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.items
                  ADD CONSTRAINT items_box_number_fkey
                  FOREIGN KEY (box_number)
                  REFERENCES inventory.boxes(name)
                  NOT VALID;
              END IF;
            END
            $$;
            """
        )

        # Movement FKs (optional). They allow tracing "why state changed".
        for col, fk_name in (
            ("purchase_movement_id", "items_purchase_movement_id_fkey"),
            ("sold_movement_id", "items_sold_movement_id_fkey"),
            ("written_off_movement_id", "items_written_off_movement_id_fkey"),
            ("last_movement_id", "items_last_movement_id_fkey"),
        ):
            await conn.execute(
                f"""
                DO $$
                BEGIN
                  IF NOT EXISTS (
                    SELECT 1
                    FROM pg_constraint
                    WHERE conname = '{fk_name}'
                      AND connamespace = 'inventory'::regnamespace
                  ) THEN
                    ALTER TABLE inventory.items
                      ADD CONSTRAINT {fk_name}
                      FOREIGN KEY ({col})
                      REFERENCES inventory.movements(id);
                  END IF;
                END
                $$;
                """
            )

        await conn.execute("CREATE INDEX IF NOT EXISTS items_smart_state_idx ON inventory.items (smart, state)")
        await conn.execute("CREATE INDEX IF NOT EXISTS items_box_state_idx ON inventory.items (box_number, state)")
        await conn.execute("CREATE INDEX IF NOT EXISTS items_state_idx ON inventory.items (state)")
        await conn.execute("CREATE INDEX IF NOT EXISTS items_sold_movement_idx ON inventory.items (sold_movement_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS items_last_movement_idx ON inventory.items (last_movement_id)")
        # Hot path: pick N in-stock instances from a specific box (sale/writeoff/transfer).
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS items_in_stock_smart_box_id_idx
            ON inventory.items (smart, box_number, id)
            WHERE state = 'in_stock'
            """
        )

        # Link items to movements (operation -> concrete instances).
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.movement_items (
              movement_id INTEGER NOT NULL
                REFERENCES inventory.movements(id)
                ON DELETE CASCADE,
              item_id BIGINT NOT NULL
                REFERENCES inventory.items(id)
                ON DELETE CASCADE,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              PRIMARY KEY (movement_id, item_id)
            )
            """
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS movement_items_item_idx ON inventory.movement_items (item_id)")

        # Item media (stored in Postgres).
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.item_media (
              id BIGSERIAL PRIMARY KEY,
              item_id BIGINT NOT NULL
                REFERENCES inventory.items(id)
                ON DELETE CASCADE,
              kind VARCHAR(16) NOT NULL,
              filename TEXT,
              mime TEXT NOT NULL,
              size_bytes BIGINT NOT NULL DEFAULT 0,
              sha256 TEXT,
              chunk_size INTEGER NOT NULL DEFAULT 1048576,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              deleted_at TIMESTAMP,
              CONSTRAINT item_media_kind_chk CHECK (kind IN ('photo', 'video')),
              CONSTRAINT item_media_chunk_size_chk CHECK (chunk_size > 0)
            )
            """
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS item_media_item_idx ON inventory.item_media (item_id)")
        await conn.execute("CREATE INDEX IF NOT EXISTS item_media_deleted_idx ON inventory.item_media (deleted_at)")

        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS inventory.item_media_chunks (
              media_id BIGINT NOT NULL
                REFERENCES inventory.item_media(id)
                ON DELETE CASCADE,
              idx INTEGER NOT NULL,
              data BYTEA NOT NULL,
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              PRIMARY KEY (media_id, idx),
              CONSTRAINT item_media_chunks_idx_chk CHECK (idx >= 0)
            )
            """
        )

        # Seed boxes from historical movements/items (idempotent).
        existing_box_rows = await conn.fetch("SELECT name_norm, name FROM inventory.boxes")
        existing_by_norm = {str(r.get("name_norm")): str(r.get("name")) for r in existing_box_rows}

        movement_box_rows = await conn.fetch(
            """
            SELECT box_number, COUNT(*)::bigint AS cnt
            FROM inventory.movements
            WHERE box_number IS NOT NULL
              AND LENGTH(TRIM(box_number)) > 0
            GROUP BY box_number
            """
        )
        item_box_rows = await conn.fetch(
            """
            SELECT box_number, COUNT(*)::bigint AS cnt
            FROM inventory.items
            WHERE box_number IS NOT NULL
              AND LENGTH(TRIM(box_number)) > 0
            GROUP BY box_number
            """
        )

        variants_by_norm: dict[str, list[tuple[str, str, int]]] = {}
        for row in [*movement_box_rows, *item_box_rows]:
            original = str(row.get("box_number") or "").strip()
            if not original:
                continue
            raw = _sanitize_box_name(original)
            if not raw:
                continue
            norm = normalize_box_name(raw)
            if not norm:
                continue
            variants_by_norm.setdefault(norm, []).append((original, raw, int(row.get("cnt") or 0)))

        canonical_by_norm: dict[str, str] = {}
        for norm, variants in variants_by_norm.items():
            existing_name = existing_by_norm.get(norm)
            if existing_name:
                sanitized_existing = _sanitize_box_name(existing_name)
                if sanitized_existing and sanitized_existing != existing_name:
                    try:
                        await conn.execute(
                            "UPDATE inventory.boxes SET name = $1 WHERE name_norm = $2",
                            sanitized_existing,
                            norm,
                        )
                        await conn.execute(
                            "UPDATE inventory.movements SET box_number = $1 WHERE box_number = $2",
                            sanitized_existing,
                            existing_name,
                        )
                        await conn.execute(
                            "UPDATE inventory.items SET box_number = $1 WHERE box_number = $2",
                            sanitized_existing,
                            existing_name,
                        )
                        existing_name = sanitized_existing
                    except Exception:
                        # Keep original name if rename conflicts.
                        pass
                canonical_by_norm[norm] = existing_name
                continue

            # Choose a canonical display name deterministically:
            # most frequent variant first, then lexicographically.
            variants_sorted = sorted(variants, key=lambda v: (-v[2], v[1]))
            canonical = _sanitize_box_name(variants_sorted[0][1]) or MIGRATION_UNKNOWN_BOX
            await conn.execute(
                """
                INSERT INTO inventory.boxes (name, name_norm, description, is_active, created_at)
                VALUES ($1, $2, NULL, TRUE, NOW())
                ON CONFLICT (name_norm) DO NOTHING
                """,
                canonical,
                norm,
            )
            canonical_by_norm[norm] = canonical

        # Canonicalize movements.box_number to the registry name (prevents duplicates like "К-4" vs "K-4").
        for norm, variants in variants_by_norm.items():
            canonical = canonical_by_norm.get(norm)
            if not canonical:
                continue
            for variant, _sanitized, _cnt in variants:
                if variant == canonical:
                    continue
                await conn.execute(
                    "UPDATE inventory.movements SET box_number = $1 WHERE box_number = $2",
                    canonical,
                    variant,
                )
                await conn.execute(
                    "UPDATE inventory.items SET box_number = $1 WHERE box_number = $2",
                    canonical,
                    variant,
                )

        # Legacy -> item-based one-time migration (if needed).
        await _migrate_legacy_movements_to_items_if_needed(conn)

        # Computed view of box contents (non-empty boxes only, non-zero balances only).
        await conn.execute(
            """
            CREATE OR REPLACE VIEW inventory.box_contents AS
            SELECT
              box_number,
              smart,
              COUNT(*)::bigint AS qty
            FROM inventory.items
            WHERE state = 'in_stock'
              AND box_number IS NOT NULL
              AND LENGTH(TRIM(box_number)) > 0
            GROUP BY box_number, smart
            HAVING COUNT(*) <> 0
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
            f"""
            DO $$
            BEGIN
              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'items_state_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.items
                  ADD CONSTRAINT items_state_chk
                  CHECK (state IN ({", ".join(repr(s) for s in _ITEM_STATES)})) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'items_in_stock_box_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.items
                  ADD CONSTRAINT items_in_stock_box_chk
                  CHECK (
                    (state = 'in_stock' AND box_number IS NOT NULL AND LENGTH(TRIM(box_number)) > 0)
                    OR
                    (state <> 'in_stock' AND (box_number IS NULL OR LENGTH(TRIM(box_number)) = 0))
                  ) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'items_sold_movement_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.items
                  ADD CONSTRAINT items_sold_movement_chk
                  CHECK (
                    (state <> 'sold' AND sold_movement_id IS NULL)
                    OR
                    (state = 'sold' AND sold_movement_id IS NOT NULL)
                  ) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'items_written_off_movement_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.items
                  ADD CONSTRAINT items_written_off_movement_chk
                  CHECK (
                    (state <> 'written_off' AND written_off_movement_id IS NULL)
                    OR
                    (state = 'written_off' AND written_off_movement_id IS NOT NULL)
                  ) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'shipments_status_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.shipments
                  ADD CONSTRAINT shipments_status_chk
                  CHECK (status IN ('pending', 'shipped', 'delivered')) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'shipments_delivery_payer_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.shipments
                  ADD CONSTRAINT shipments_delivery_payer_chk
                  CHECK (delivery_payer IN ('seller', 'buyer') OR delivery_payer IS NULL) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'returns_kind_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.returns
                  ADD CONSTRAINT returns_kind_chk
                  CHECK (kind IN ('return', 'correction')) NOT VALID;
              END IF;

              IF NOT EXISTS (
                SELECT 1
                FROM pg_constraint
                WHERE conname = 'returns_return_payer_chk'
                  AND connamespace = 'inventory'::regnamespace
              ) THEN
                ALTER TABLE inventory.returns
                  ADD CONSTRAINT returns_return_payer_chk
                  CHECK (return_payer IN ('seller', 'buyer') OR return_payer IS NULL) NOT VALID;
              END IF;
            END
            $$;
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
              COUNT(*)::bigint as total_qty
            FROM inventory.items
            WHERE state = 'in_stock'
            GROUP BY smart
            HAVING COUNT(*) > 0
            """
        )

        # ── Local SMART reference catalog ──────────────────────────────
        # Column names are Cyrillic to match the existing load_smart_cache()
        # query in smart_cache.py (SELECT "артикул", "наименование", …).
        await conn.execute(
            """
            CREATE TABLE IF NOT EXISTS public.smart (
              smart TEXT PRIMARY KEY,
              "артикул" TEXT[] DEFAULT '{}',
              "наименование" TEXT,
              "бренд" TEXT[] DEFAULT '{}',
              "коннект_бренд" TEXT[] DEFAULT '{}',
              created_at TIMESTAMP DEFAULT NOW() NOT NULL,
              updated_at TIMESTAMP DEFAULT NOW() NOT NULL
            )
            """
        )
        await conn.execute(
            'CREATE INDEX IF NOT EXISTS smart_name_idx ON public.smart ("наименование")'
        )

        # Helpful indexes for common filters.
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_smart_idx ON inventory.movements (smart)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_reason_idx ON inventory.movements (reason)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_created_at_idx ON inventory.movements (created_at DESC)")
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_box_number_idx ON inventory.movements (box_number)")
        # Common history queries: SMART+reason (purchases/sales) and box history.
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS movements_smart_reason_created_at_id_idx
            ON inventory.movements (smart, reason, created_at DESC, id DESC)
            """
        )
        await conn.execute(
            """
            CREATE INDEX IF NOT EXISTS movements_box_number_created_at_id_idx
            ON inventory.movements (box_number, created_at DESC, id DESC)
            WHERE box_number IS NOT NULL
            """
        )
        await conn.execute("CREATE INDEX IF NOT EXISTS movements_linked_movement_id_idx ON inventory.movements (linked_movement_id)")
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
