from __future__ import annotations

import asyncio
import math
from decimal import Decimal
from datetime import datetime, timezone
from typing import Any, Mapping, Protocol, Sequence, cast

from py_backend.types import (
    ArticleSearchResult,
    BulkImportResult,
    BulkImportRow,
    CreateCustomerInput,
    CreateOrderInput,
    CreateOrderReturnInput,
    DeliveryPayer,
    InsertMovement,
    Movement,
    OrderDetails,
    OrderSummary,
    Reason,
    ReasonCode,
    ShipmentStatus,
    ShippingMethod,
    REASONS,
    REASON_CODES,
)


class SmartCacheProtocol(Protocol):
    size: int

    def getBySmart(self, smart: str) -> Mapping[str, Any] | Any | None:
        ...

    def search(self, normalizedQuery: str, limit: int = 50) -> Sequence[Mapping[str, Any] | Any]:
        ...


class DbConnectionProtocol(Protocol):
    async def fetch(self, query: str, *args: Any) -> Sequence[Mapping[str, Any]]:
        ...

    async def fetchrow(self, query: str, *args: Any) -> Mapping[str, Any] | None:
        ...

    async def execute(self, query: str, *args: Any) -> str:
        ...


class InventoryPoolProtocol(DbConnectionProtocol, Protocol):
    async def acquire(self) -> DbConnectionProtocol:
        ...

    async def release(self, connection: DbConnectionProtocol) -> None:
        ...


def isSerializationError(err: Exception) -> bool:
    code = getattr(err, "code", None)
    sqlstate = getattr(err, "sqlstate", None)
    message = str(err)
    return code == "40001" or sqlstate == "40001" or "could not serialize access" in message


def toInt(value: Any) -> int:
    if isinstance(value, bool):
        return 0
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return math.trunc(float(value))
    if isinstance(value, str) and value.strip():
        try:
            n = float(value)
        except ValueError:
            return 0
        if math.isfinite(n):
            return math.trunc(n)
    return 0


def toDateIso(value: Any) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None:
            # Match Node.js Date behavior for timestamp-without-timezone values from pg:
            # treat naive datetime as local time, then convert to UTC ISO string.
            local_tz = datetime.now().astimezone().tzinfo or timezone.utc
            dt = value.replace(tzinfo=local_tz)
        else:
            dt = value
        return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, str):
        return value
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def toFloat(value: Any) -> float:
    if isinstance(value, bool):
        return 0.0
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    if isinstance(value, str) and value.strip():
        try:
            n = float(value)
        except ValueError:
            return 0.0
        if math.isfinite(n):
            return n
    return 0.0


def toNumberString(value: Any) -> str:
    return f"{toFloat(value):.2f}"


def toDbNumericString(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, Decimal):
        # Keep exact textual representation for NUMERIC columns, like node-postgres.
        return format(value, "f")
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and math.isfinite(value):
        text = f"{value:.15f}".rstrip("0").rstrip(".")
        return text if text else "0"
    return str(value)


def requireNonEmpty(value: Any, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise InvalidRequestError(f"{field} обязательно")
    return value.strip()


def requireNumberString(value: Any, field: str) -> str:
    string_value = requireNonEmpty(value, field)
    try:
        n = float(string_value)
    except ValueError:
        raise InvalidRequestError(f"{field} должно быть числом") from None
    if not math.isfinite(n):
        raise InvalidRequestError(f"{field} должно быть числом")
    return string_value


def requireNonNegativeNumberString(value: Any, field: str) -> str:
    string_value = requireNumberString(value, field)
    if float(string_value) < 0:
        raise InvalidRequestError(f"{field} не может быть отрицательным")
    return string_value


def _as_dict(value: Any) -> dict[str, Any]:
    if value is None:
        return {}
    if isinstance(value, Mapping):
        return dict(value)
    items = getattr(value, "items", None)
    if callable(items):
        try:
            return dict(items())
        except Exception:
            pass
    keys = getattr(value, "keys", None)
    if callable(keys):
        try:
            return {str(k): value[k] for k in keys()}
        except Exception:
            pass
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        return cast(dict[str, Any], model_dump(exclude_none=False))
    return dict(getattr(value, "__dict__", {}))


def _obj_get(value: Any, key: str, default: Any = None) -> Any:
    if value is None:
        return default
    if isinstance(value, Mapping):
        return value.get(key, default)
    get_method = getattr(value, "get", None)
    if callable(get_method):
        try:
            return get_method(key, default)
        except Exception:
            pass
    try:
        return value[key]
    except Exception:
        pass
    return getattr(value, key, default)


def _to_epoch_seconds(value: str) -> float:
    text = value.strip()
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        return datetime.fromisoformat(text).timestamp()
    except ValueError:
        return 0.0


class InvalidRequestError(Exception):
    pass


class InsufficientStockError(Exception):
    def __init__(self, smart: str, currentStock: int, requestedQty: int) -> None:
        self.smart = smart
        self.currentStock = currentStock
        self.requestedQty = requestedQty
        super().__init__(
            f"Недостаточно товара на складе. SMART: {smart}. Текущий остаток: {currentStock}, запрошено: {requestedQty}"
        )


class DatabaseStorage:
    def __init__(self, inventoryPool: InventoryPoolProtocol, smartCache: SmartCacheProtocol) -> None:
        self.inventoryPool = inventoryPool
        self.smartCache = smartCache

    def updateSmartCache(self, cache: SmartCacheProtocol) -> None:
        self.smartCache = cache

    def searchSmart(self, query: str) -> list[dict[str, Any]]:
        matches = self.smartCache.search(query)
        return [
            {
                "smart": _obj_get(m, "smart"),
                "articles": _obj_get(m, "articles", []),
                "name": _obj_get(m, "name"),
                "brand": _obj_get(m, "brand"),
                "description": _obj_get(m, "description"),
                "currentStock": 0,
            }
            for m in matches
        ]

    def getSmartByCode(self, smart: str) -> Mapping[str, Any] | Any | None:
        return self.smartCache.getBySmart(smart)

    async def getCurrentStockTx(self, client: DbConnectionProtocol, smart: str) -> int:
        row = await client.fetchrow(
            "SELECT COALESCE(SUM(qty_delta), 0) as total_qty FROM inventory.movements WHERE smart = $1",
            smart,
        )
        return toInt(_obj_get(row, "total_qty"))

    def mapMovementRow(self, row: Mapping[str, Any]) -> dict[str, Any]:
        sale_status = _obj_get(row, "sale_status")
        return {
            "id": _obj_get(row, "id"),
            "smart": _obj_get(row, "smart"),
            "qtyDelta": toInt(_obj_get(row, "qty_delta")),
            "reason": _obj_get(row, "reason"),
            "note": _obj_get(row, "note"),
            "purchasePrice": toDbNumericString(_obj_get(row, "purchase_price")),
            "salePrice": toDbNumericString(_obj_get(row, "sale_price")),
            "deliveryPrice": toDbNumericString(_obj_get(row, "delivery_price")),
            "boxNumber": _obj_get(row, "box_number"),
            "trackNumber": _obj_get(row, "track_number"),
            "shippingMethodId": _obj_get(row, "shipping_method_id"),
            "saleStatus": sale_status if sale_status in ("awaiting_shipment", "shipped") else None,
            "orderId": _obj_get(row, "order_id"),
            "orderItemId": _obj_get(row, "order_item_id"),
            "shipmentId": _obj_get(row, "shipment_id"),
            "returnId": _obj_get(row, "return_id"),
            "createdAt": toDateIso(_obj_get(row, "created_at")),
        }

    def enrichMovement(self, movement: dict[str, Any]) -> dict[str, Any]:
        smart_info = self.smartCache.getBySmart(cast(str, movement.get("smart", "")))
        if not smart_info:
            return movement
        return {
            **movement,
            "articles": _obj_get(smart_info, "articles"),
            "name": _obj_get(smart_info, "name"),
            "brand": _obj_get(smart_info, "brand"),
            "description": _obj_get(smart_info, "description"),
        }

    def validateAndSanitizeForInsert(self, input_data: InsertMovement | Mapping[str, Any]) -> dict[str, Any]:
        data = _as_dict(input_data)
        reason = cast(ReasonCode, data.get("reason"))
        smart = requireNonEmpty(data.get("smart"), "SMART код")
        qty_delta_raw = data.get("qtyDelta")

        is_number = isinstance(qty_delta_raw, (int, float)) and not isinstance(qty_delta_raw, bool)
        if not is_number or not math.isfinite(float(qty_delta_raw)) or float(qty_delta_raw) == 0:
            raise InvalidRequestError("Количество не может быть равно 0")
        if not float(qty_delta_raw).is_integer():
            raise InvalidRequestError("Количество должно быть целым числом")

        qty_delta = int(float(qty_delta_raw))

        note = data.get("note")
        purchase_price = data.get("purchasePrice")
        sale_price = data.get("salePrice")
        delivery_price = data.get("deliveryPrice")
        box_number = data.get("boxNumber")
        track_number = data.get("trackNumber")
        shipping_method_id = data.get("shippingMethodId")

        if not self.smartCache.getBySmart(smart):
            raise InvalidRequestError(f"SMART код не найден в справочнике: {smart}")

        if reason == "purchase":
            if qty_delta <= 0:
                raise InvalidRequestError("Для покупки количество должно быть положительным")
            requireNumberString(purchase_price, "Цена закупки")
            requireNonEmpty(box_number, "Номер коробки")
            return {
                "smart": smart,
                "qtyDelta": qty_delta,
                "reason": reason,
                "note": note,
                "purchasePrice": purchase_price,
                "salePrice": None,
                "deliveryPrice": None,
                "boxNumber": box_number,
                "trackNumber": None,
                "shippingMethodId": None,
                "saleStatus": None,
            }

        if reason == "sale":
            if qty_delta >= 0:
                raise InvalidRequestError("Для продажи количество должно быть отрицательным")
            requireNumberString(sale_price, "Цена продажи")
            requireNumberString(delivery_price, "Стоимость доставки")
            is_shipping_number = isinstance(shipping_method_id, (int, float)) and not isinstance(shipping_method_id, bool)
            if shipping_method_id is None or not is_shipping_number or not math.isfinite(float(shipping_method_id)):
                raise InvalidRequestError("Способ доставки обязателен")
            return {
                "smart": smart,
                "qtyDelta": qty_delta,
                "reason": reason,
                "note": note,
                "purchasePrice": None,
                "salePrice": sale_price,
                "deliveryPrice": delivery_price,
                "boxNumber": None,
                "trackNumber": track_number,
                "shippingMethodId": shipping_method_id,
                "saleStatus": "awaiting_shipment",
            }

        if reason == "return":
            if qty_delta <= 0:
                raise InvalidRequestError("Для возврата количество должно быть положительным")
            requireNonEmpty(note, "Примечание")
            return {
                "smart": smart,
                "qtyDelta": qty_delta,
                "reason": reason,
                "note": note,
                "purchasePrice": None,
                "salePrice": None,
                "deliveryPrice": None,
                "boxNumber": None,
                "trackNumber": None,
                "shippingMethodId": None,
                "saleStatus": None,
            }

        if reason == "writeoff":
            if qty_delta >= 0:
                raise InvalidRequestError("Для списания количество должно быть отрицательным")
            return {
                "smart": smart,
                "qtyDelta": qty_delta,
                "reason": reason,
                "note": note,
                "purchasePrice": None,
                "salePrice": None,
                "deliveryPrice": None,
                "boxNumber": None,
                "trackNumber": None,
                "shippingMethodId": None,
                "saleStatus": None,
            }

        requireNonEmpty(note, "Примечание")
        if purchase_price is not None and str(purchase_price).strip():
            requireNumberString(purchase_price, "Цена за единицу")

        return {
            "smart": smart,
            "qtyDelta": qty_delta,
            "reason": reason,
            "note": note,
            "purchasePrice": purchase_price if purchase_price is not None else None,
            "salePrice": None,
            "deliveryPrice": None,
            "boxNumber": None,
            "trackNumber": None,
            "shippingMethodId": None,
            "saleStatus": None,
        }

    async def createMovement(self, input_data: InsertMovement | Mapping[str, Any]) -> dict[str, Any]:
        max_retries = 3
        last_error: Exception | None = None

        for attempt in range(max_retries):
            try:
                return await self.createMovementAttempt(input_data)
            except Exception as err:  # noqa: PERF203
                last_error = err
                if isSerializationError(err) and attempt < max_retries - 1:
                    delay_ms = min(100 * (2**attempt), 1000)
                    await asyncio.sleep(delay_ms / 1000)
                    continue
                raise

        raise Exception(
            f"Failed to create movement after {max_retries} attempts due to concurrent access: "
            f"{last_error or 'unknown error'}"
        )

    async def createMovementAttempt(self, input_data: InsertMovement | Mapping[str, Any]) -> dict[str, Any]:
        movement = self.validateAndSanitizeForInsert(input_data)

        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                if (
                    movement["reason"] == "return"
                    and movement["note"]
                    and isinstance(movement["note"], str)
                    and "Возврат продажи #" in movement["note"]
                ):
                    dup = await client.fetch(
                        "SELECT id FROM inventory.movements WHERE reason = 'return' AND note = $1 LIMIT 1",
                        movement["note"],
                    )
                    if len(dup) > 0:
                        raise Exception("Товар уже возвращен на склад")

                is_decrease = movement["reason"] in ("sale", "writeoff")
                is_negative_adjust = movement["reason"] == "adjust" and toInt(movement["qtyDelta"]) < 0

                if is_decrease or is_negative_adjust:
                    current_stock = await self.getCurrentStockTx(client, cast(str, movement["smart"]))
                    requested_qty = abs(toInt(movement["qtyDelta"]))
                    if current_stock < requested_qty:
                        raise InsufficientStockError(cast(str, movement["smart"]), current_stock, requested_qty)

                insert_row = await client.fetchrow(
                    """
                    INSERT INTO inventory.movements (
                      smart, qty_delta, reason, note,
                      purchase_price, sale_price, delivery_price,
                      box_number, track_number, shipping_method_id, sale_status,
                      created_at
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
                    RETURNING *
                    """,
                    movement["smart"],
                    movement["qtyDelta"],
                    movement["reason"],
                    movement["note"],
                    movement["purchasePrice"],
                    movement["salePrice"],
                    movement["deliveryPrice"],
                    movement["boxNumber"],
                    movement["trackNumber"],
                    movement["shippingMethodId"],
                    movement["saleStatus"],
                )

                await client.execute("COMMIT")
                if insert_row is None:
                    raise Exception("Movement not found after insert")
                mapped = self.mapMovementRow(insert_row)
                return self.enrichMovement(mapped)
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    async def getMovements(self) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            """
            SELECT *
            FROM inventory.movements
            ORDER BY created_at DESC
            """
        )
        return [self.enrichMovement(self.mapMovementRow(row)) for row in rows]

    async def getMovementById(self, movement_id: int) -> dict[str, Any] | None:
        row = await self.inventoryPool.fetchrow("SELECT * FROM inventory.movements WHERE id = $1", movement_id)
        if row is None:
            return None
        return self.enrichMovement(self.mapMovementRow(row))

    async def getPurchasesBySmart(self, smart: str) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            "SELECT * FROM inventory.movements WHERE smart = $1 AND reason = 'purchase' ORDER BY created_at DESC",
            smart,
        )
        return [self.enrichMovement(self.mapMovementRow(row)) for row in rows]

    async def getSalesBySmart(self, smart: str) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            "SELECT * FROM inventory.movements WHERE smart = $1 AND reason = 'sale' ORDER BY created_at DESC",
            smart,
        )
        return [self.enrichMovement(self.mapMovementRow(row)) for row in rows]

    async def updateMovement(self, movement_id: int, updates: Mapping[str, Any]) -> dict[str, Any]:
        updates_dict = _as_dict(updates)
        has_purchase_price = "purchasePrice" in updates_dict
        has_note = "note" in updates_dict
        has_qty_delta = "qtyDelta" in updates_dict
        has_box_number = "boxNumber" in updates_dict

        if not has_purchase_price and not has_note and not has_qty_delta and not has_box_number:
            raise Exception("No fields to update")

        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                existing = await client.fetchrow(
                    "SELECT id, smart, qty_delta, reason FROM inventory.movements WHERE id = $1 FOR UPDATE",
                    movement_id,
                )
                if existing is None:
                    raise Exception("Movement not found")

                if _obj_get(existing, "reason") != "purchase":
                    raise InvalidRequestError("Редактирование доступно только для покупок")

                set_clauses: list[str] = []
                values: list[Any] = []
                param = 1

                if has_purchase_price:
                    purchase_price = updates_dict.get("purchasePrice")
                    if purchase_price is None:
                        raise InvalidRequestError("Цена закупки обязательна")
                    price = requireNumberString(purchase_price, "Цена закупки")
                    set_clauses.append(f"purchase_price = ${param}")
                    values.append(price)
                    param += 1

                if has_note:
                    set_clauses.append(f"note = ${param}")
                    values.append(updates_dict.get("note"))
                    param += 1

                if has_box_number:
                    box_number = updates_dict.get("boxNumber")
                    if box_number is None:
                        raise InvalidRequestError("Номер коробки обязателен")
                    box = requireNonEmpty(box_number, "Номер коробки")
                    set_clauses.append(f"box_number = ${param}")
                    values.append(box)
                    param += 1

                if has_qty_delta:
                    old_qty_delta = toInt(_obj_get(existing, "qty_delta"))
                    next_qty_delta = abs(cast(float, updates_dict.get("qtyDelta")))

                    current_stock = await self.getCurrentStockTx(client, cast(str, _obj_get(existing, "smart")))
                    next_stock = current_stock - old_qty_delta + next_qty_delta
                    if next_stock < 0:
                        raise InsufficientStockError(
                            cast(str, _obj_get(existing, "smart")),
                            current_stock,
                            current_stock - toInt(next_stock),
                        )

                    set_clauses.append(f"qty_delta = ${param}")
                    values.append(next_qty_delta)
                    param += 1

                if len(set_clauses) == 0:
                    raise Exception("No fields to update")

                values.append(movement_id)
                updated = await client.fetchrow(
                    f"UPDATE inventory.movements SET {', '.join(set_clauses)} WHERE id = ${param} RETURNING *",
                    *values,
                )
                if updated is None:
                    raise Exception("Movement not found")

                await client.execute("COMMIT")
                return self.enrichMovement(self.mapMovementRow(updated))
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    async def updateMovementSaleStatus(self, movement_id: int, status: str) -> dict[str, Any]:
        existing = await self.inventoryPool.fetchrow("SELECT reason FROM inventory.movements WHERE id = $1", movement_id)
        if existing is None:
            raise Exception("Movement not found")
        if _obj_get(existing, "reason") != "sale":
            raise InvalidRequestError("Можно менять статус только у продаж")

        row = await self.inventoryPool.fetchrow(
            "UPDATE inventory.movements SET sale_status = $1 WHERE id = $2 RETURNING *",
            status,
            movement_id,
        )
        if row is None:
            raise Exception("Movement not found")
        return self.enrichMovement(self.mapMovementRow(row))

    async def getStockLevels(self) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            """
            SELECT smart, total_qty
            FROM inventory.stock
            ORDER BY smart
            """
        )

        result: list[dict[str, Any]] = []
        for row in rows:
            smart_info = self.smartCache.getBySmart(cast(str, _obj_get(row, "smart")))
            result.append(
                {
                    "smart": _obj_get(row, "smart"),
                    "totalQty": toInt(_obj_get(row, "total_qty")),
                    "name": _obj_get(smart_info, "name"),
                    "brand": _obj_get(smart_info, "brand"),
                    "description": _obj_get(smart_info, "description"),
                    "articles": _obj_get(smart_info, "articles"),
                }
            )
        return result

    async def getStockBySmart(self, smart: str) -> dict[str, Any]:
        row = await self.inventoryPool.fetchrow(
            """
            SELECT
              COUNT(*)::text as movements_count,
              COALESCE(SUM(qty_delta), 0) as total_qty
            FROM inventory.movements
            WHERE smart = $1
            """,
            smart,
        )

        existed = toInt(_obj_get(row, "movements_count")) > 0
        if not existed:
            return {
                "smart": smart,
                "totalQty": 0,
                "existed": False,
                "name": None,
                "brand": None,
                "description": None,
                "articles": [],
            }

        smart_info = self.smartCache.getBySmart(smart)
        return {
            "smart": smart,
            "totalQty": toInt(_obj_get(row, "total_qty")),
            "existed": True,
            "name": _obj_get(smart_info, "name"),
            "brand": _obj_get(smart_info, "brand"),
            "description": _obj_get(smart_info, "description"),
            "articles": _obj_get(smart_info, "articles", []),
        }

    async def getTotalStockBySmartBatch(self, smartCodes: list[str]) -> dict[str, int]:
        if not smartCodes:
            return {}

        rows = await self.inventoryPool.fetch("SELECT smart, total_qty FROM inventory.stock WHERE smart = ANY($1)", smartCodes)

        result = {cast(str, _obj_get(row, "smart")): toInt(_obj_get(row, "total_qty")) for row in rows}
        for code in smartCodes:
            if code not in result:
                result[code] = 0
        return result

    def getReasons(self) -> list[dict[str, Any]]:
        return [reason.model_dump() if hasattr(reason, "model_dump") else dict(reason) for reason in REASONS]

    async def getShippingMethods(self) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            "SELECT id, name, is_pickup, created_at FROM inventory.shipping_methods ORDER BY is_pickup DESC, name"
        )
        return [
            {
                "id": _obj_get(row, "id"),
                "name": _obj_get(row, "name"),
                "isPickup": bool(_obj_get(row, "is_pickup")),
                "createdAt": toDateIso(_obj_get(row, "created_at")),
            }
            for row in rows
        ]

    async def createShippingMethod(self, method: Mapping[str, Any] | ShippingMethod) -> dict[str, Any]:
        method_dict = _as_dict(method)
        name = requireNonEmpty(method_dict.get("name"), "Название")
        row = await self.inventoryPool.fetchrow(
            "INSERT INTO inventory.shipping_methods (name, is_pickup) VALUES ($1, $2) RETURNING *",
            name,
            bool(method_dict.get("isPickup")),
        )
        if row is None:
            raise Exception("Shipping method not created")
        return {
            "id": _obj_get(row, "id"),
            "name": _obj_get(row, "name"),
            "isPickup": bool(_obj_get(row, "is_pickup")),
            "createdAt": toDateIso(_obj_get(row, "created_at")),
        }

    async def deleteShippingMethod(self, method_id: int) -> None:
        usage = await self.inventoryPool.fetchrow(
            "SELECT COUNT(*)::text AS count FROM inventory.movements WHERE shipping_method_id = $1",
            method_id,
        )
        orders_usage = await self.inventoryPool.fetchrow(
            "SELECT COUNT(*)::text AS count FROM inventory.shipments WHERE shipping_method_id = $1",
            method_id,
        )
        returns_usage = await self.inventoryPool.fetchrow(
            "SELECT COUNT(*)::text AS count FROM inventory.returns WHERE shipping_method_id = $1",
            method_id,
        )

        count = (
            toInt(_obj_get(usage, "count"))
            + toInt(_obj_get(orders_usage, "count"))
            + toInt(_obj_get(returns_usage, "count"))
        )
        if count > 0:
            raise InvalidRequestError(f"Невозможно удалить: способ доставки используется в {count} операциях")

        await self.inventoryPool.execute("DELETE FROM inventory.shipping_methods WHERE id = $1", method_id)

    async def getSoldOutItems(self) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            """
            WITH sales_summary AS (
              SELECT
                smart,
                AVG(CAST(sale_price AS NUMERIC)) as avg_sale_price,
                MAX(created_at) as last_sale_date,
                SUM(ABS(qty_delta))::text as total_sales
              FROM inventory.movements
              WHERE reason = 'sale'
              GROUP BY smart
            ),
            stock_summary AS (
              SELECT smart, SUM(qty_delta) as current_stock
              FROM inventory.movements
              GROUP BY smart
            )
            SELECT
              s.smart,
              s.avg_sale_price,
              s.last_sale_date,
              s.total_sales
            FROM sales_summary s
            JOIN stock_summary st ON st.smart = s.smart
            WHERE st.current_stock = 0
            ORDER BY s.last_sale_date DESC
            """
        )

        result: list[dict[str, Any]] = []
        for row in rows:
            smart_info = self.smartCache.getBySmart(cast(str, _obj_get(row, "smart")))
            result.append(
                {
                    "smart": _obj_get(row, "smart"),
                    "name": _obj_get(smart_info, "name"),
                    "avgSalePrice": float(_obj_get(row, "avg_sale_price") or 0),
                    "lastSaleDate": toDateIso(_obj_get(row, "last_sale_date")),
                    "totalSales": toInt(_obj_get(row, "total_sales")),
                }
            )
        return result

    async def getTopParts(self, mode: str) -> list[dict[str, Any]]:
        (
            avg_purchase_rows,
            stock_rows,
            legacy_sales_rows,
            order_items_rows,
            shipment_cost_rows,
            return_cost_rows,
        ) = await asyncio.gather(
            self.inventoryPool.fetch(
                """
                SELECT
                  smart,
                  (SUM(CAST(purchase_price AS NUMERIC) * qty_delta) / NULLIF(SUM(qty_delta), 0))::text as avg_purchase_price
                FROM inventory.movements
                WHERE reason = 'purchase' AND purchase_price IS NOT NULL AND qty_delta > 0
                GROUP BY smart
                """
            ),
            self.inventoryPool.fetch(
                """
                SELECT smart, COALESCE(SUM(qty_delta), 0) as current_stock
                FROM inventory.movements
                GROUP BY smart
                """
            ),
            self.inventoryPool.fetch(
                """
                SELECT smart, qty_delta, sale_price, delivery_price
                FROM inventory.movements
                WHERE reason = 'sale' AND order_id IS NULL
                """
            ),
            self.inventoryPool.fetch(
                """
                SELECT
                  oi.id,
                  oi.smart,
                  oi.qty,
                  oi.sale_price::text as sale_price,
                  COALESCE(ri.returned_qty, 0)::text as returned_qty
                FROM inventory.order_items oi
                LEFT JOIN (
                  SELECT order_item_id, SUM(qty) as returned_qty
                  FROM inventory.return_items
                  GROUP BY order_item_id
                ) ri ON ri.order_item_id = oi.id
                """
            ),
            self.inventoryPool.fetch(
                """
                SELECT
                  s.id as shipment_id,
                  oi.smart,
                  si.qty,
                  oi.sale_price::text as sale_price,
                  s.delivery_price::text as delivery_price
                FROM inventory.shipments s
                JOIN inventory.shipment_items si ON si.shipment_id = s.id
                JOIN inventory.order_items oi ON oi.id = si.order_item_id
                WHERE s.delivery_payer = 'seller'
                """
            ),
            self.inventoryPool.fetch(
                """
                SELECT
                  r.id as return_id,
                  oi.smart,
                  ri.qty,
                  oi.sale_price::text as sale_price,
                  r.return_price::text as return_price
                FROM inventory.returns r
                JOIN inventory.return_items ri ON ri.return_id = r.id
                JOIN inventory.order_items oi ON oi.id = ri.order_item_id
                WHERE r.return_payer = 'seller'
                """
            ),
        )

        avg_purchase_by_smart = {
            cast(str, _obj_get(row, "smart")): toFloat(_obj_get(row, "avg_purchase_price")) for row in avg_purchase_rows
        }
        current_stock_by_smart = {
            cast(str, _obj_get(row, "smart")): toInt(_obj_get(row, "current_stock")) for row in stock_rows
        }

        acc_by_smart: dict[str, dict[str, float]] = {}

        def ensure_acc(smart: str) -> dict[str, float]:
            if smart in acc_by_smart:
                return acc_by_smart[smart]
            acc_by_smart[smart] = {
                "revenue": 0.0,
                "cost": 0.0,
                "deliveryCost": 0.0,
                "totalSalesQty": 0.0,
            }
            return acc_by_smart[smart]

        for sale in legacy_sales_rows:
            smart = cast(str, _obj_get(sale, "smart"))
            qty = abs(toInt(_obj_get(sale, "qty_delta")))
            if qty <= 0:
                continue
            sale_price = toFloat(_obj_get(sale, "sale_price"))
            delivery_price = toFloat(_obj_get(sale, "delivery_price"))
            avg_purchase = avg_purchase_by_smart.get(smart, 0.0)
            acc = ensure_acc(smart)
            acc["revenue"] += sale_price * qty
            acc["cost"] += avg_purchase * qty
            acc["deliveryCost"] += delivery_price
            acc["totalSalesQty"] += qty

        for row in order_items_rows:
            qty = toInt(_obj_get(row, "qty"))
            returned_qty = max(0, toInt(_obj_get(row, "returned_qty")))
            net_qty = max(0, qty - returned_qty)
            if net_qty <= 0:
                continue
            smart = cast(str, _obj_get(row, "smart"))
            sale_price = toFloat(_obj_get(row, "sale_price"))
            avg_purchase = avg_purchase_by_smart.get(smart, 0.0)
            acc = ensure_acc(smart)
            acc["revenue"] += sale_price * net_qty
            acc["cost"] += avg_purchase * net_qty
            acc["totalSalesQty"] += net_qty

        shipment_rows_by_shipment: dict[int, list[dict[str, float | str]]] = {}
        for row in shipment_cost_rows:
            shipment_id = toInt(_obj_get(row, "shipment_id"))
            value = toFloat(_obj_get(row, "sale_price")) * toInt(_obj_get(row, "qty"))
            if value <= 0:
                continue
            shipment_rows_by_shipment.setdefault(shipment_id, []).append(
                {
                    "smart": cast(str, _obj_get(row, "smart")),
                    "value": value,
                    "deliveryPrice": toFloat(_obj_get(row, "delivery_price")),
                }
            )

        for rows in shipment_rows_by_shipment.values():
            total_value = sum(cast(float, r["value"]) for r in rows)
            delivery_price = toFloat(rows[0].get("deliveryPrice")) if rows else 0.0
            if total_value <= 0 or delivery_price <= 0:
                continue
            for row in rows:
                smart = cast(str, row["smart"])
                share = delivery_price * (cast(float, row["value"]) / total_value)
                ensure_acc(smart)["deliveryCost"] += share

        return_rows_by_return: dict[int, list[dict[str, float | str]]] = {}
        for row in return_cost_rows:
            return_id = toInt(_obj_get(row, "return_id"))
            value = toFloat(_obj_get(row, "sale_price")) * toInt(_obj_get(row, "qty"))
            if value <= 0:
                continue
            return_rows_by_return.setdefault(return_id, []).append(
                {
                    "smart": cast(str, _obj_get(row, "smart")),
                    "value": value,
                    "returnPrice": toFloat(_obj_get(row, "return_price")),
                }
            )

        for rows in return_rows_by_return.values():
            total_value = sum(cast(float, r["value"]) for r in rows)
            return_price = toFloat(rows[0].get("returnPrice")) if rows else 0.0
            if total_value <= 0 or return_price <= 0:
                continue
            for row in rows:
                smart = cast(str, row["smart"])
                share = return_price * (cast(float, row["value"]) / total_value)
                ensure_acc(smart)["deliveryCost"] += share

        items = []
        for smart, acc in acc_by_smart.items():
            if acc["totalSalesQty"] <= 0:
                continue
            total_profit = acc["revenue"] - acc["cost"] - acc["deliveryCost"]
            avg_profit = total_profit / acc["totalSalesQty"]
            avg_purchase = avg_purchase_by_smart.get(smart, 0.0)
            profit_margin = (avg_profit / avg_purchase) * 100 if avg_purchase > 0 else 0.0
            total_sales = int(acc["totalSalesQty"])
            current_stock = current_stock_by_smart.get(smart, 0)

            normalized_sales = min(total_sales / 10, 100)
            normalized_profit = min(max(avg_profit, 0) / 10, 100)
            combined_score = normalized_sales * 0.5 + normalized_profit * 0.5

            smart_info = self.smartCache.getBySmart(smart)
            items.append(
                {
                    "smart": smart,
                    "name": _obj_get(smart_info, "name"),
                    "avgProfit": avg_profit,
                    "totalSales": total_sales,
                    "profitMargin": profit_margin,
                    "currentStock": current_stock,
                    "combinedScore": combined_score,
                }
            )

        if mode == "profit":
            return sorted(items, key=lambda x: cast(float, x.get("avgProfit", 0)), reverse=True)
        if mode == "sales":
            return sorted(items, key=lambda x: cast(int, x.get("totalSales", 0)), reverse=True)
        return sorted(items, key=lambda x: cast(float, x.get("combinedScore", 0) or 0), reverse=True)

    def mapCustomerRow(self, row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "id": _obj_get(row, "id"),
            "name": _obj_get(row, "name"),
            "phone": _obj_get(row, "phone"),
            "note": _obj_get(row, "note"),
            "archivedAt": toDateIso(_obj_get(row, "archived_at")) if _obj_get(row, "archived_at") else None,
            "createdAt": toDateIso(_obj_get(row, "created_at")),
            "updatedAt": toDateIso(_obj_get(row, "updated_at")),
        }

    def mapShipmentStatusToSaleStatus(self, status: ShipmentStatus) -> str:
        return "awaiting_shipment" if status == "pending" else "shipped"

    async def getAvgPurchasePriceBySmartCodes(self, smartCodes: list[str]) -> dict[str, float]:
        if len(smartCodes) == 0:
            return {}
        uniq = list({s.strip() for s in smartCodes if isinstance(s, str) and s.strip()})
        if len(uniq) == 0:
            return {}

        rows = await self.inventoryPool.fetch(
            """
            SELECT
              smart,
              (SUM(CAST(purchase_price AS NUMERIC) * qty_delta) / NULLIF(SUM(qty_delta), 0))::text as avg_purchase_price
            FROM inventory.movements
            WHERE reason = 'purchase'
              AND purchase_price IS NOT NULL
              AND qty_delta > 0
              AND smart = ANY($1)
            GROUP BY smart
            """,
            uniq,
        )

        return {cast(str, _obj_get(r, "smart")): toFloat(_obj_get(r, "avg_purchase_price")) for r in rows}

    async def getCustomers(self, search: str | None = None, includeArchived: bool = False) -> list[dict[str, Any]]:
        query = search.strip() if isinstance(search, str) else ""
        has_query = len(query) > 0
        like = f"%{query.lower()}%"

        rows = await self.inventoryPool.fetch(
            """
            SELECT id, name, phone, note, archived_at, created_at, updated_at
            FROM inventory.customers
            WHERE ($1::boolean OR archived_at IS NULL)
              AND (
                NOT $2::boolean
                OR LOWER(name) LIKE $3
                OR LOWER(COALESCE(phone, '')) LIKE $3
              )
            ORDER BY archived_at IS NOT NULL, name ASC
            """,
            includeArchived,
            has_query,
            like,
        )

        return [self.mapCustomerRow(row) for row in rows]

    async def getCustomerById(self, customer_id: int) -> dict[str, Any] | None:
        row = await self.inventoryPool.fetchrow(
            """
            SELECT id, name, phone, note, archived_at, created_at, updated_at
            FROM inventory.customers
            WHERE id = $1
            """,
            customer_id,
        )
        if row is None:
            return None
        return self.mapCustomerRow(row)

    async def createCustomer(self, input_data: CreateCustomerInput | Mapping[str, Any]) -> dict[str, Any]:
        data = _as_dict(input_data)
        name = requireNonEmpty(data.get("name"), "Имя клиента")
        phone_raw = data.get("phone")
        note_raw = data.get("note")
        phone = phone_raw.strip() if isinstance(phone_raw, str) and phone_raw.strip() else None
        note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None

        row = await self.inventoryPool.fetchrow(
            """
            INSERT INTO inventory.customers (name, phone, note, created_at, updated_at)
            VALUES ($1, $2, $3, NOW(), NOW())
            RETURNING id, name, phone, note, archived_at, created_at, updated_at
            """,
            name,
            phone,
            note,
        )
        if row is None:
            raise Exception("Customer not created")
        return self.mapCustomerRow(row)

    async def updateCustomer(self, customer_id: int, input_data: UpdateCustomerInput | Mapping[str, Any]) -> dict[str, Any]:
        data = _as_dict(input_data)

        set_clauses: list[str] = []
        values: list[Any] = []
        idx = 1

        if "name" in data:
            set_clauses.append(f"name = ${idx}")
            values.append(requireNonEmpty(data.get("name"), "Имя клиента"))
            idx += 1
        if "phone" in data:
            raw = data.get("phone")
            set_clauses.append(f"phone = ${idx}")
            values.append(raw.strip() if isinstance(raw, str) and raw.strip() else None)
            idx += 1
        if "note" in data:
            raw = data.get("note")
            set_clauses.append(f"note = ${idx}")
            values.append(raw.strip() if isinstance(raw, str) and raw.strip() else None)
            idx += 1
        if "archived" in data:
            if bool(data.get("archived")):
                set_clauses.append("archived_at = COALESCE(archived_at, NOW())")
            else:
                set_clauses.append("archived_at = NULL")

        if len(set_clauses) == 0:
            raise InvalidRequestError("Нет полей для обновления")

        set_clauses.append("updated_at = NOW()")
        values.append(customer_id)

        row = await self.inventoryPool.fetchrow(
            f"""
            UPDATE inventory.customers
            SET {", ".join(set_clauses)}
            WHERE id = ${idx}
            RETURNING id, name, phone, note, archived_at, created_at, updated_at
            """,
            *values,
        )

        if row is None:
            raise Exception("Customer not found")
        return self.mapCustomerRow(row)

    async def createOrder(self, input_data: CreateOrderInput | Mapping[str, Any]) -> dict[str, Any]:
        data = _as_dict(input_data)
        note_raw = data.get("note")
        note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None
        items_data = data.get("items")
        if not isinstance(items_data, list) or len(items_data) == 0:
            raise InvalidRequestError("Добавьте хотя бы одну позицию")

        normalized_items: list[dict[str, Any]] = []
        for item in items_data:
            item_dict = _as_dict(item)
            smart = requireNonEmpty(item_dict.get("smart"), "SMART код")
            qty = toInt(item_dict.get("qty"))
            sale_price = requireNonNegativeNumberString(item_dict.get("salePrice"), "Цена продажи")
            normalized_items.append({"smart": smart, "qty": qty, "salePrice": sale_price})

        for item in normalized_items:
            if item["qty"] <= 0:
                raise InvalidRequestError("Количество в позиции должно быть положительным")
            if not self.smartCache.getBySmart(cast(str, item["smart"])):
                raise InvalidRequestError(f"SMART код не найден в справочнике: {item['smart']}")

        dedupe_smart: set[str] = set()
        for item in normalized_items:
            smart = cast(str, item["smart"])
            if smart in dedupe_smart:
                raise InvalidRequestError(f"SMART {smart} дублируется в заказе. Объедините в одну позицию.")
            dedupe_smart.add(smart)

        shipment = _as_dict(data.get("shipment"))
        shipping_method_id = toInt(shipment.get("shippingMethodId"))
        if shipping_method_id <= 0:
            raise InvalidRequestError("Способ доставки обязателен")
        track_raw = shipment.get("trackNumber")
        track_number = track_raw.strip() if isinstance(track_raw, str) and track_raw.strip() else None
        delivery_price = requireNonNegativeNumberString(shipment.get("deliveryPrice"), "Стоимость доставки")
        delivery_price_num = toFloat(delivery_price)

        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                customer_id: int
                customer_id_raw = data.get("customerId")
                customer_data = data.get("customer")
                if customer_id_raw:
                    customer_row = await client.fetchrow(
                        "SELECT id FROM inventory.customers WHERE id = $1",
                        customer_id_raw,
                    )
                    if customer_row is None:
                        raise InvalidRequestError("Клиент не найден")
                    customer_id = toInt(_obj_get(customer_row, "id"))
                elif customer_data:
                    customer = _as_dict(customer_data)
                    created_customer = await client.fetchrow(
                        """
                        INSERT INTO inventory.customers (name, phone, note, created_at, updated_at)
                        VALUES ($1, $2, $3, NOW(), NOW())
                        RETURNING id
                        """,
                        requireNonEmpty(customer.get("name"), "Имя клиента"),
                        customer.get("phone").strip() if isinstance(customer.get("phone"), str) and customer.get("phone").strip() else None,
                        customer.get("note").strip() if isinstance(customer.get("note"), str) and customer.get("note").strip() else None,
                    )
                    if created_customer is None:
                        raise Exception("Customer not created")
                    customer_id = toInt(_obj_get(created_customer, "id"))
                else:
                    raise InvalidRequestError("Нужно выбрать клиента или создать нового")

                shipping_method = await client.fetchrow(
                    "SELECT id, is_pickup FROM inventory.shipping_methods WHERE id = $1",
                    shipping_method_id,
                )
                if shipping_method is None:
                    raise InvalidRequestError("Способ доставки не найден")
                is_pickup = bool(_obj_get(shipping_method, "is_pickup"))

                delivery_payer = shipment.get("deliveryPayer")
                if is_pickup and delivery_price_num == 0:
                    delivery_payer = None
                if delivery_price_num > 0 and not delivery_payer:
                    raise InvalidRequestError("Укажите, кто платит за доставку")

                shipment_status: ShipmentStatus = "delivered" if is_pickup else "pending"
                movement_sale_status = self.mapShipmentStatusToSaleStatus(shipment_status)

                for item in normalized_items:
                    current_stock = await self.getCurrentStockTx(client, cast(str, item["smart"]))
                    if current_stock < item["qty"]:
                        raise InsufficientStockError(cast(str, item["smart"]), current_stock, item["qty"])

                order_row = await client.fetchrow(
                    """
                    INSERT INTO inventory.orders (customer_id, note, created_at, updated_at)
                    VALUES ($1, $2, NOW(), NOW())
                    RETURNING id
                    """,
                    customer_id,
                    note,
                )
                if order_row is None:
                    raise Exception("Order not created")
                order_id = toInt(_obj_get(order_row, "id"))

                order_items: list[dict[str, Any]] = []
                for item in normalized_items:
                    inserted = await client.fetchrow(
                        """
                        INSERT INTO inventory.order_items (order_id, smart, qty, sale_price, created_at)
                        VALUES ($1, $2, $3, $4, NOW())
                        RETURNING id
                        """,
                        order_id,
                        item["smart"],
                        item["qty"],
                        item["salePrice"],
                    )
                    if inserted is None:
                        raise Exception("Order item not created")
                    order_items.append(
                        {
                            "id": toInt(_obj_get(inserted, "id")),
                            "smart": item["smart"],
                            "qty": item["qty"],
                            "salePrice": item["salePrice"],
                        }
                    )

                shipment_row = await client.fetchrow(
                    """
                    INSERT INTO inventory.shipments (
                      order_id, shipping_method_id, track_number, delivery_price, delivery_payer, status, created_at, updated_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
                    RETURNING id
                    """,
                    order_id,
                    shipping_method_id,
                    track_number,
                    delivery_price,
                    delivery_payer,
                    shipment_status,
                )
                if shipment_row is None:
                    raise Exception("Shipment not created")
                shipment_id = toInt(_obj_get(shipment_row, "id"))

                order_total_value = sum(toFloat(item["salePrice"]) * toInt(item["qty"]) for item in order_items)
                should_allocate_delivery = delivery_payer == "seller" and delivery_price_num > 0 and order_total_value > 0

                for item in order_items:
                    await client.execute(
                        """
                        INSERT INTO inventory.shipment_items (shipment_id, order_item_id, qty, created_at)
                        VALUES ($1, $2, $3, NOW())
                        """,
                        shipment_id,
                        item["id"],
                        item["qty"],
                    )

                for item in order_items:
                    item_value = toFloat(item["salePrice"]) * toInt(item["qty"])
                    allocated_delivery = (delivery_price_num * item_value) / order_total_value if should_allocate_delivery else 0
                    await client.execute(
                        """
                        INSERT INTO inventory.movements (
                          smart, qty_delta, reason, note,
                          purchase_price, sale_price, delivery_price,
                          box_number, track_number, shipping_method_id, sale_status,
                          order_id, order_item_id, shipment_id, return_id,
                          created_at
                        )
                        VALUES ($1,$2,'sale',$3,NULL,$4,$5,NULL,$6,$7,$8,$9,$10,$11,NULL,NOW())
                        """,
                        item["smart"],
                        -toInt(item["qty"]),
                        note,
                        item["salePrice"],
                        toNumberString(allocated_delivery) if should_allocate_delivery else None,
                        track_number,
                        shipping_method_id,
                        movement_sale_status,
                        order_id,
                        item["id"],
                        shipment_id,
                    )

                await client.execute("COMMIT")
                details = await self.getOrderById(order_id)
                if details is None:
                    raise Exception("Order not found after creation")
                return details
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    async def getOrders(self, options: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
        options_data = _as_dict(options) if options is not None else {}
        customer_id = options_data.get("customerId")
        include_archived = bool(options_data.get("includeArchivedCustomers"))

        rows = await self.inventoryPool.fetch(
            """
            SELECT
              o.id,
              o.customer_id,
              c.name as customer_name,
              c.phone as customer_phone,
              c.archived_at as customer_archived_at,
              o.note,
              o.created_at,
              (
                SELECT COUNT(*)::text
                FROM inventory.order_items oi
                WHERE oi.order_id = o.id
              ) as positions_count,
              (
                SELECT COALESCE(SUM(oi.qty), 0)::text
                FROM inventory.order_items oi
                WHERE oi.order_id = o.id
              ) as total_qty,
              (
                SELECT COALESCE(SUM(oi.qty * oi.sale_price), 0)::text
                FROM inventory.order_items oi
                WHERE oi.order_id = o.id
              ) as items_total,
              (
                SELECT COUNT(*)::text
                FROM inventory.shipments s
                WHERE s.order_id = o.id AND s.status = 'pending'
              ) as shipments_pending,
              (
                SELECT COUNT(*)::text
                FROM inventory.shipments s
                WHERE s.order_id = o.id AND s.status = 'shipped'
              ) as shipments_shipped,
              (
                SELECT COUNT(*)::text
                FROM inventory.shipments s
                WHERE s.order_id = o.id AND s.status = 'delivered'
              ) as shipments_delivered,
              (
                SELECT COUNT(*)::text
                FROM inventory.returns r
                WHERE r.order_id = o.id
              ) as returns_count
            FROM inventory.orders o
            JOIN inventory.customers c ON c.id = o.customer_id
            WHERE ($1::int IS NULL OR o.customer_id = $1)
              AND ($2::boolean OR c.archived_at IS NULL)
            ORDER BY o.created_at DESC
            """,
            customer_id,
            include_archived,
        )

        return [
            {
                "id": _obj_get(row, "id"),
                "customerId": _obj_get(row, "customer_id"),
                "customerName": _obj_get(row, "customer_name"),
                "customerPhone": _obj_get(row, "customer_phone"),
                "customerArchivedAt": toDateIso(_obj_get(row, "customer_archived_at")) if _obj_get(row, "customer_archived_at") else None,
                "note": _obj_get(row, "note"),
                "createdAt": toDateIso(_obj_get(row, "created_at")),
                "positionsCount": toInt(_obj_get(row, "positions_count")),
                "totalQty": toInt(_obj_get(row, "total_qty")),
                "itemsTotal": toFloat(_obj_get(row, "items_total")),
                "shipmentsPending": toInt(_obj_get(row, "shipments_pending")),
                "shipmentsShipped": toInt(_obj_get(row, "shipments_shipped")),
                "shipmentsDelivered": toInt(_obj_get(row, "shipments_delivered")),
                "returnsCount": toInt(_obj_get(row, "returns_count")),
            }
            for row in rows
        ]

    async def getOrderById(self, order_id: int) -> dict[str, Any] | None:
        base = await self.inventoryPool.fetchrow(
            """
            SELECT
              o.id,
              o.customer_id,
              o.note,
              o.created_at,
              c.name as customer_name,
              c.phone as customer_phone,
              c.note as customer_note,
              c.archived_at as customer_archived_at,
              c.created_at as customer_created_at,
              c.updated_at as customer_updated_at
            FROM inventory.orders o
            JOIN inventory.customers c ON c.id = o.customer_id
            WHERE o.id = $1
            """,
            order_id,
        )
        if base is None:
            return None

        item_rows = await self.inventoryPool.fetch(
            """
            SELECT
              oi.id,
              oi.order_id,
              oi.smart,
              oi.qty,
              oi.sale_price::text as sale_price,
              oi.created_at,
              COALESCE(r.returned_qty, 0)::text as returned_qty,
              COALESCE(s.shipped_qty, 0)::text as shipped_qty
            FROM inventory.order_items oi
            LEFT JOIN (
              SELECT order_item_id, SUM(qty) as returned_qty
              FROM inventory.return_items
              GROUP BY order_item_id
            ) r ON r.order_item_id = oi.id
            LEFT JOIN (
              SELECT si.order_item_id, SUM(si.qty) as shipped_qty
              FROM inventory.shipment_items si
              JOIN inventory.shipments s ON s.id = si.shipment_id
              WHERE s.status IN ('shipped', 'delivered')
              GROUP BY si.order_item_id
            ) s ON s.order_item_id = oi.id
            WHERE oi.order_id = $1
            ORDER BY oi.id
            """,
            order_id,
        )

        shipment_rows = await self.inventoryPool.fetch(
            """
            SELECT
              s.id,
              s.order_id,
              s.shipping_method_id,
              sm.name as shipping_method_name,
              sm.is_pickup,
              s.track_number,
              s.delivery_price::text as delivery_price,
              s.delivery_payer,
              s.status,
              s.created_at,
              s.updated_at
            FROM inventory.shipments s
            JOIN inventory.shipping_methods sm ON sm.id = s.shipping_method_id
            WHERE s.order_id = $1
            ORDER BY s.created_at ASC, s.id ASC
            """,
            order_id,
        )

        shipment_ids = [toInt(_obj_get(s, "id")) for s in shipment_rows]
        if len(shipment_ids) > 0:
            shipment_item_rows = await self.inventoryPool.fetch(
                """
                SELECT id, shipment_id, order_item_id, qty, created_at
                FROM inventory.shipment_items
                WHERE shipment_id = ANY($1)
                ORDER BY id ASC
                """,
                shipment_ids,
            )
        else:
            shipment_item_rows = []

        return_rows = await self.inventoryPool.fetch(
            """
            SELECT
              r.id,
              r.order_id,
              r.kind,
              r.note,
              r.return_price::text as return_price,
              r.return_payer,
              r.shipping_method_id,
              sm.name as shipping_method_name,
              r.track_number,
              r.created_at
            FROM inventory.returns r
            LEFT JOIN inventory.shipping_methods sm ON sm.id = r.shipping_method_id
            WHERE r.order_id = $1
            ORDER BY r.created_at DESC, r.id DESC
            """,
            order_id,
        )

        return_ids = [toInt(_obj_get(r, "id")) for r in return_rows]
        if len(return_ids) > 0:
            return_item_rows = await self.inventoryPool.fetch(
                """
                SELECT id, return_id, order_item_id, qty, created_at
                FROM inventory.return_items
                WHERE return_id = ANY($1)
                ORDER BY id ASC
                """,
                return_ids,
            )
        else:
            return_item_rows = []

        item_by_id: dict[int, dict[str, Any]] = {}
        for row in item_rows:
            smart = cast(str, _obj_get(row, "smart"))
            smart_info = self.smartCache.getBySmart(smart)
            item = {
                "id": _obj_get(row, "id"),
                "orderId": _obj_get(row, "order_id"),
                "smart": smart,
                "qty": toInt(_obj_get(row, "qty")),
                "salePrice": toNumberString(_obj_get(row, "sale_price")),
                "returnedQty": toInt(_obj_get(row, "returned_qty")),
                "shippedQty": toInt(_obj_get(row, "shipped_qty")),
                "createdAt": toDateIso(_obj_get(row, "created_at")),
                "articles": _obj_get(smart_info, "articles"),
                "name": _obj_get(smart_info, "name"),
                "brand": _obj_get(smart_info, "brand"),
                "description": _obj_get(smart_info, "description"),
            }
            item_by_id[toInt(_obj_get(row, "id"))] = item
        items = list(item_by_id.values())

        shipment_items_by_shipment: dict[int, list[dict[str, Any]]] = {}
        for row in shipment_item_rows:
            shipment_id = toInt(_obj_get(row, "shipment_id"))
            shipment_items_by_shipment.setdefault(shipment_id, []).append(
                {
                    "id": _obj_get(row, "id"),
                    "shipmentId": shipment_id,
                    "orderItemId": _obj_get(row, "order_item_id"),
                    "qty": toInt(_obj_get(row, "qty")),
                    "createdAt": toDateIso(_obj_get(row, "created_at")),
                }
            )

        shipments = [
            {
                "id": _obj_get(row, "id"),
                "orderId": _obj_get(row, "order_id"),
                "shippingMethodId": _obj_get(row, "shipping_method_id"),
                "shippingMethodName": _obj_get(row, "shipping_method_name"),
                "isPickup": bool(_obj_get(row, "is_pickup")),
                "trackNumber": _obj_get(row, "track_number"),
                "deliveryPrice": toNumberString(_obj_get(row, "delivery_price")),
                "deliveryPayer": _obj_get(row, "delivery_payer"),
                "status": _obj_get(row, "status"),
                "createdAt": toDateIso(_obj_get(row, "created_at")),
                "updatedAt": toDateIso(_obj_get(row, "updated_at")),
                "items": shipment_items_by_shipment.get(toInt(_obj_get(row, "id")), []),
            }
            for row in shipment_rows
        ]

        return_items_by_return: dict[int, list[dict[str, Any]]] = {}
        for row in return_item_rows:
            return_id = toInt(_obj_get(row, "return_id"))
            return_items_by_return.setdefault(return_id, []).append(
                {
                    "id": _obj_get(row, "id"),
                    "returnId": return_id,
                    "orderItemId": _obj_get(row, "order_item_id"),
                    "qty": toInt(_obj_get(row, "qty")),
                    "createdAt": toDateIso(_obj_get(row, "created_at")),
                }
            )

        returns = [
            {
                "id": _obj_get(row, "id"),
                "orderId": _obj_get(row, "order_id"),
                "kind": _obj_get(row, "kind"),
                "note": _obj_get(row, "note"),
                "returnPrice": toNumberString(_obj_get(row, "return_price")),
                "returnPayer": _obj_get(row, "return_payer"),
                "shippingMethodId": _obj_get(row, "shipping_method_id"),
                "shippingMethodName": _obj_get(row, "shipping_method_name"),
                "trackNumber": _obj_get(row, "track_number"),
                "createdAt": toDateIso(_obj_get(row, "created_at")),
                "items": return_items_by_return.get(toInt(_obj_get(row, "id")), []),
            }
            for row in return_rows
        ]

        avg_purchase_map = await self.getAvgPurchasePriceBySmartCodes([cast(str, i["smart"]) for i in items])
        financial = {"revenue": 0.0, "cost": 0.0, "deliveryCost": 0.0, "returnCost": 0.0, "profit": 0.0}

        for item in items:
            net_qty = max(0, toInt(item["qty"]) - toInt(item["returnedQty"]))
            sale_price = toFloat(item["salePrice"])
            avg_purchase = avg_purchase_map.get(cast(str, item["smart"]), 0.0)
            financial["revenue"] += sale_price * net_qty
            financial["cost"] += avg_purchase * net_qty

        for shipment in shipments:
            if shipment.get("deliveryPayer") == "seller":
                financial["deliveryCost"] += toFloat(shipment.get("deliveryPrice"))
        for ret in returns:
            if ret.get("returnPayer") == "seller":
                value = toFloat(ret.get("returnPrice"))
                financial["deliveryCost"] += value
                financial["returnCost"] += value

        financial["profit"] = financial["revenue"] - financial["cost"] - financial["deliveryCost"]
        financial["revenue"] = round(financial["revenue"], 2)
        financial["cost"] = round(financial["cost"], 2)
        financial["deliveryCost"] = round(financial["deliveryCost"], 2)
        financial["returnCost"] = round(financial["returnCost"], 2)
        financial["profit"] = round(financial["profit"], 2)

        return {
            "id": _obj_get(base, "id"),
            "customer": {
                "id": _obj_get(base, "customer_id"),
                "name": _obj_get(base, "customer_name"),
                "phone": _obj_get(base, "customer_phone"),
                "note": _obj_get(base, "customer_note"),
                "archivedAt": toDateIso(_obj_get(base, "customer_archived_at")) if _obj_get(base, "customer_archived_at") else None,
                "createdAt": toDateIso(_obj_get(base, "customer_created_at")),
                "updatedAt": toDateIso(_obj_get(base, "customer_updated_at")),
            },
            "note": _obj_get(base, "note"),
            "createdAt": toDateIso(_obj_get(base, "created_at")),
            "items": items,
            "shipments": shipments,
            "returns": returns,
            "financial": financial,
        }

    async def updateShipmentStatus(self, shipment_id: int, status: ShipmentStatus) -> dict[str, Any]:
        row = await self.inventoryPool.fetchrow(
            """
            UPDATE inventory.shipments s
            SET status = $1, updated_at = NOW()
            FROM inventory.shipping_methods sm
            WHERE s.shipping_method_id = sm.id
              AND s.id = $2
            RETURNING
              s.id,
              s.order_id,
              s.shipping_method_id,
              sm.name as shipping_method_name,
              sm.is_pickup,
              s.track_number,
              s.delivery_price::text as delivery_price,
              s.delivery_payer,
              s.status,
              s.created_at,
              s.updated_at
            """,
            status,
            shipment_id,
        )
        if row is None:
            raise Exception("Shipment not found")

        item_rows = await self.inventoryPool.fetch(
            """
            SELECT id, order_item_id, qty, created_at
            FROM inventory.shipment_items
            WHERE shipment_id = $1
            ORDER BY id
            """,
            shipment_id,
        )

        await self.inventoryPool.execute(
            """
            UPDATE inventory.movements
            SET sale_status = $1,
                shipment_id = $2
            WHERE reason = 'sale'
              AND order_item_id = ANY(
                SELECT order_item_id
                FROM inventory.shipment_items
                WHERE shipment_id = $2
              )
            """,
            self.mapShipmentStatusToSaleStatus(status),
            shipment_id,
        )

        return {
            "id": _obj_get(row, "id"),
            "orderId": _obj_get(row, "order_id"),
            "shippingMethodId": _obj_get(row, "shipping_method_id"),
            "shippingMethodName": _obj_get(row, "shipping_method_name"),
            "isPickup": bool(_obj_get(row, "is_pickup")),
            "trackNumber": _obj_get(row, "track_number"),
            "deliveryPrice": toNumberString(_obj_get(row, "delivery_price")),
            "deliveryPayer": _obj_get(row, "delivery_payer"),
            "status": _obj_get(row, "status"),
            "createdAt": toDateIso(_obj_get(row, "created_at")),
            "updatedAt": toDateIso(_obj_get(row, "updated_at")),
            "items": [
                {
                    "id": _obj_get(item, "id"),
                    "shipmentId": shipment_id,
                    "orderItemId": _obj_get(item, "order_item_id"),
                    "qty": toInt(_obj_get(item, "qty")),
                    "createdAt": toDateIso(_obj_get(item, "created_at")),
                }
                for item in item_rows
            ],
        }

    async def createOrderReturn(self, order_id: int, input_data: CreateOrderReturnInput | Mapping[str, Any]) -> dict[str, Any]:
        data = _as_dict(input_data)
        return_price = requireNonNegativeNumberString(data.get("returnPrice"), "Стоимость обратной доставки")
        return_price_num = toFloat(return_price)
        kind = cast(str, data.get("kind") or "return")
        note_raw = data.get("note")
        note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None
        track_raw = data.get("trackNumber")
        track_number = track_raw.strip() if isinstance(track_raw, str) and track_raw.strip() else None
        return_payer = data.get("returnPayer")
        shipping_method_id = toInt(data.get("shippingMethodId")) if data.get("shippingMethodId") else None

        items = data.get("items")
        if not isinstance(items, list) or len(items) == 0:
            raise InvalidRequestError("Добавьте хотя бы одну позицию для возврата")
        if return_price_num > 0 and not return_payer:
            raise InvalidRequestError("Укажите, кто платит за обратную доставку")

        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                order_row = await client.fetchrow("SELECT id FROM inventory.orders WHERE id = $1", order_id)
                if order_row is None:
                    raise InvalidRequestError("Заказ не найден")

                if shipping_method_id:
                    method = await client.fetchrow(
                        "SELECT id FROM inventory.shipping_methods WHERE id = $1",
                        shipping_method_id,
                    )
                    if method is None:
                        raise InvalidRequestError("Способ доставки возврата не найден")

                order_item_rows = await client.fetch(
                    """
                    SELECT id, smart, qty
                    FROM inventory.order_items
                    WHERE order_id = $1
                    """,
                    order_id,
                )
                item_by_id = {toInt(_obj_get(row, "id")): row for row in order_item_rows}

                returned_rows = await client.fetch(
                    """
                    SELECT order_item_id, SUM(qty)::text as returned_qty
                    FROM inventory.return_items ri
                    JOIN inventory.returns r ON r.id = ri.return_id
                    WHERE r.order_id = $1
                    GROUP BY order_item_id
                    """,
                    order_id,
                )
                already_returned_map = {toInt(_obj_get(row, "order_item_id")): toInt(_obj_get(row, "returned_qty")) for row in returned_rows}

                for item in items:
                    item_dict = _as_dict(item)
                    order_item_id = toInt(item_dict.get("orderItemId"))
                    qty = toInt(item_dict.get("qty"))
                    if qty <= 0:
                        raise InvalidRequestError("Количество возврата должно быть положительным")
                    order_item = item_by_id.get(order_item_id)
                    if order_item is None:
                        raise InvalidRequestError(f"Позиция заказа #{order_item_id} не найдена")
                    already_returned = already_returned_map.get(order_item_id, 0)
                    max_qty = toInt(_obj_get(order_item, "qty")) - already_returned
                    if already_returned + qty > toInt(_obj_get(order_item, "qty")):
                        raise InvalidRequestError(
                            f"Превышено допустимое количество возврата для {_obj_get(order_item, 'smart')}: "
                            f"можно вернуть максимум {max_qty}"
                        )

                created_return = await client.fetchrow(
                    """
                    INSERT INTO inventory.returns (
                      order_id, kind, note, return_price, return_payer, shipping_method_id, track_number, created_at
                    )
                    VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                    RETURNING id
                    """,
                    order_id,
                    kind,
                    note,
                    return_price,
                    return_payer,
                    shipping_method_id,
                    track_number,
                )
                if created_return is None:
                    raise Exception("Return not created")
                return_id = toInt(_obj_get(created_return, "id"))

                for item in items:
                    item_dict = _as_dict(item)
                    order_item_id = toInt(item_dict.get("orderItemId"))
                    qty = toInt(item_dict.get("qty"))
                    order_item = item_by_id[order_item_id]

                    await client.execute(
                        """
                        INSERT INTO inventory.return_items (return_id, order_item_id, qty, created_at)
                        VALUES ($1, $2, $3, NOW())
                        """,
                        return_id,
                        order_item_id,
                        qty,
                    )

                    await client.execute(
                        """
                        INSERT INTO inventory.movements (
                          smart, qty_delta, reason, note,
                          purchase_price, sale_price, delivery_price,
                          box_number, track_number, shipping_method_id, sale_status,
                          order_id, order_item_id, shipment_id, return_id,
                          created_at
                        )
                        VALUES ($1, $2, $3, $4, NULL, NULL, NULL, NULL, NULL, NULL, NULL, $5, $6, NULL, $7, NOW())
                        """,
                        _obj_get(order_item, "smart"),
                        qty,
                        "adjust" if kind == "correction" else "return",
                        note
                        or (
                            f"Корректировка заказа #{order_id}, позиция #{order_item_id}"
                            if kind == "correction"
                            else f"Возврат заказа #{order_id}, позиция #{order_item_id}"
                        ),
                        order_id,
                        order_item_id,
                        return_id,
                    )

                await client.execute("COMMIT")
                details = await self.getOrderById(order_id)
                created = next((r for r in (details or {}).get("returns", []) if toInt(r.get("id")) == return_id), None)
                if created is None:
                    raise Exception("Return not found after creation")
                return created
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    async def getSalesAnalyticsBySmart(self, smart: str) -> dict[str, Any]:
        (
            purchases,
            legacy_sales,
            order_sales,
            order_delivery_rows,
            return_cost_rows,
        ) = await asyncio.gather(
            self.inventoryPool.fetch(
                """
                SELECT qty_delta, purchase_price, created_at
                FROM inventory.movements
                WHERE smart = $1 AND reason = 'purchase'
                ORDER BY created_at DESC
                """,
                smart,
            ),
            self.inventoryPool.fetch(
                """
                SELECT id, qty_delta, sale_price, delivery_price, created_at
                FROM inventory.movements
                WHERE smart = $1 AND reason = 'sale' AND order_id IS NULL
                ORDER BY created_at DESC
                """,
                smart,
            ),
            self.inventoryPool.fetch(
                """
                SELECT
                  oi.id as order_item_id,
                  o.id as order_id,
                  c.name as customer_name,
                  oi.qty,
                  COALESCE(ri.returned_qty, 0)::text as returned_qty,
                  oi.sale_price::text as sale_price,
                  o.created_at
                FROM inventory.order_items oi
                JOIN inventory.orders o ON o.id = oi.order_id
                JOIN inventory.customers c ON c.id = o.customer_id
                LEFT JOIN (
                  SELECT order_item_id, SUM(qty) as returned_qty
                  FROM inventory.return_items
                  GROUP BY order_item_id
                ) ri ON ri.order_item_id = oi.id
                WHERE oi.smart = $1
                ORDER BY o.created_at DESC, oi.id DESC
                """,
                smart,
            ),
            self.inventoryPool.fetch(
                """
                SELECT
                  target.order_item_id,
                  COALESCE(
                    SUM(
                      CASE
                        WHEN s.delivery_payer = 'seller' AND totals.total_value > 0
                        THEN s.delivery_price * (target.item_value / totals.total_value)
                        ELSE 0
                      END
                    ),
                    0
                  )::text as delivery_share,
                  BOOL_OR(s.delivery_payer = 'seller' AND s.delivery_price > 0) as has_seller_delivery,
                  BOOL_OR(s.delivery_payer = 'buyer' AND s.delivery_price > 0) as has_buyer_delivery
                FROM (
                  SELECT
                    oi.id as order_item_id,
                    si.shipment_id,
                    (oi.sale_price * si.qty)::numeric as item_value
                  FROM inventory.order_items oi
                  JOIN inventory.shipment_items si ON si.order_item_id = oi.id
                  WHERE oi.smart = $1
                ) target
                JOIN inventory.shipments s ON s.id = target.shipment_id
                JOIN (
                  SELECT
                    si.shipment_id,
                    SUM(oi.sale_price * si.qty)::numeric as total_value
                  FROM inventory.shipment_items si
                  JOIN inventory.order_items oi ON oi.id = si.order_item_id
                  GROUP BY si.shipment_id
                ) totals ON totals.shipment_id = target.shipment_id
                GROUP BY target.order_item_id
                """,
                smart,
            ),
            self.inventoryPool.fetch(
                """
                SELECT
                  r.id as return_id,
                  ri.order_item_id,
                  ri.qty,
                  oi.sale_price::text as sale_price,
                  r.return_price::text as return_price
                FROM inventory.returns r
                JOIN inventory.return_items ri ON ri.return_id = r.id
                JOIN inventory.order_items oi ON oi.id = ri.order_item_id
                WHERE oi.smart = $1
                  AND r.return_payer = 'seller'
                """,
                smart,
            ),
        )

        purchase_lines = [
            {
                "qty": abs(toInt(_obj_get(p, "qty_delta"))),
                "price": toFloat(_obj_get(p, "purchase_price")),
                "createdAt": toDateIso(_obj_get(p, "created_at")),
            }
            for p in purchases
        ]
        purchase_lines = [p for p in purchase_lines if p["qty"] > 0 and math.isfinite(p["price"])]
        total_purchase_qty = sum(cast(int, p["qty"]) for p in purchase_lines)
        weighted_purchase_cost = sum(cast(float, p["price"]) * cast(int, p["qty"]) for p in purchase_lines)
        avg_purchase_price = weighted_purchase_cost / total_purchase_qty if total_purchase_qty > 0 else 0.0

        return_rows_by_return: dict[int, list[dict[str, float | int]]] = {}
        for row in return_cost_rows:
            return_id = toInt(_obj_get(row, "return_id"))
            return_rows_by_return.setdefault(return_id, []).append(
                {
                    "orderItemId": toInt(_obj_get(row, "order_item_id")),
                    "value": toFloat(_obj_get(row, "sale_price")) * toInt(_obj_get(row, "qty")),
                    "returnPrice": toFloat(_obj_get(row, "return_price")),
                }
            )

        return_cost_by_order_item: dict[int, float] = {}
        for rows in return_rows_by_return.values():
            total_value = sum(cast(float, r["value"]) for r in rows)
            if total_value <= 0:
                continue
            return_price = toFloat(rows[0].get("returnPrice")) if rows else 0.0
            for row in rows:
                order_item_id = toInt(row["orderItemId"])
                share = return_price * (cast(float, row["value"]) / total_value)
                return_cost_by_order_item[order_item_id] = return_cost_by_order_item.get(order_item_id, 0.0) + share

        order_delivery_by_order_item: dict[int, dict[str, Any]] = {}
        for row in order_delivery_rows:
            has_seller = bool(_obj_get(row, "has_seller_delivery"))
            has_buyer = bool(_obj_get(row, "has_buyer_delivery"))
            if has_seller and has_buyer:
                delivery_payer: str | None = "mixed"
            elif has_seller:
                delivery_payer = "seller"
            elif has_buyer:
                delivery_payer = "buyer"
            else:
                delivery_payer = None
            order_delivery_by_order_item[toInt(_obj_get(row, "order_item_id"))] = {
                "deliveryShare": toFloat(_obj_get(row, "delivery_share")),
                "deliveryPayer": delivery_payer,
            }

        def get_days_from_closest_purchase(sale_date_iso: str) -> int | None:
            sale_time = _to_epoch_seconds(sale_date_iso)
            candidates = [p for p in purchase_lines if _to_epoch_seconds(cast(str, p["createdAt"])) <= sale_time]
            if not candidates:
                return None
            closest = sorted(candidates, key=lambda p: _to_epoch_seconds(cast(str, p["createdAt"])), reverse=True)[0]
            days = round((sale_time - _to_epoch_seconds(cast(str, closest["createdAt"]))) / (60 * 60 * 24))
            return int(days)

        sales: list[dict[str, Any]] = []

        for row in legacy_sales:
            qty = abs(toInt(_obj_get(row, "qty_delta")))
            if qty <= 0:
                continue
            sale_price = toFloat(_obj_get(row, "sale_price"))
            delivery_price = toFloat(_obj_get(row, "delivery_price"))
            gross = (sale_price - avg_purchase_price) * qty
            profit = gross - delivery_price
            profit_per_unit = profit / qty if qty > 0 else 0.0
            created_at = toDateIso(_obj_get(row, "created_at"))
            sales.append(
                {
                    "id": f"legacy-{_obj_get(row, 'id')}",
                    "source": "legacy",
                    "createdAt": created_at,
                    "qty": qty,
                    "salePrice": sale_price,
                    "deliveryPrice": delivery_price,
                    "deliveryPayer": "seller" if delivery_price > 0 else None,
                    "customerName": None,
                    "orderId": None,
                    "profit": profit,
                    "profitMarginPercent": (profit_per_unit / avg_purchase_price) * 100 if avg_purchase_price > 0 else 0.0,
                    "daysFromPurchase": get_days_from_closest_purchase(created_at),
                    "purchasePriceUsed": avg_purchase_price,
                }
            )

        for row in order_sales:
            qty = toInt(_obj_get(row, "qty"))
            returned_qty = max(0, toInt(_obj_get(row, "returned_qty")))
            net_qty = max(0, qty - returned_qty)
            sale_price = toFloat(_obj_get(row, "sale_price"))
            order_item_id = toInt(_obj_get(row, "order_item_id"))
            delivery_info = order_delivery_by_order_item.get(order_item_id, {"deliveryShare": 0.0, "deliveryPayer": None})
            delivery_share = toFloat(delivery_info.get("deliveryShare"))
            return_delivery_share = return_cost_by_order_item.get(order_item_id, 0.0)
            delivery_price = delivery_share + return_delivery_share

            if net_qty <= 0 and abs(delivery_price) < 0.000001:
                continue

            delivery_payer = delivery_info.get("deliveryPayer")
            if return_delivery_share > 0:
                if delivery_payer in ("buyer", "mixed"):
                    delivery_payer = "mixed"
                else:
                    delivery_payer = "seller"

            gross = (sale_price - avg_purchase_price) * net_qty
            profit = gross - delivery_price
            profit_per_unit = profit / net_qty if net_qty > 0 else 0.0
            created_at = toDateIso(_obj_get(row, "created_at"))
            sales.append(
                {
                    "id": f"order-item-{order_item_id}",
                    "source": "order",
                    "createdAt": created_at,
                    "qty": net_qty,
                    "salePrice": sale_price,
                    "deliveryPrice": delivery_price,
                    "deliveryPayer": delivery_payer,
                    "customerName": _obj_get(row, "customer_name"),
                    "orderId": _obj_get(row, "order_id"),
                    "profit": profit,
                    "profitMarginPercent": (profit_per_unit / avg_purchase_price) * 100 if avg_purchase_price > 0 else 0.0,
                    "daysFromPurchase": get_days_from_closest_purchase(created_at),
                    "purchasePriceUsed": avg_purchase_price,
                }
            )

        sales.sort(key=lambda item: _to_epoch_seconds(cast(str, item["createdAt"])), reverse=True)

        sold_quantity = sum(toInt(s.get("qty")) for s in sales)
        total_profit = sum(toFloat(s.get("profit")) for s in sales)
        average_profit_per_unit = total_profit / sold_quantity if sold_quantity > 0 else 0.0
        sell_through_rate = (sold_quantity / total_purchase_qty) * 100 if total_purchase_qty > 0 else 0.0
        sales_with_days = [s for s in sales if s.get("daysFromPurchase") is not None]
        average_days_to_sell = (
            sum(toFloat(s.get("daysFromPurchase")) for s in sales_with_days) / len(sales_with_days)
            if len(sales_with_days) > 0
            else 0.0
        )
        average_profit_margin_percent = (
            (average_profit_per_unit / avg_purchase_price) * 100 if avg_purchase_price > 0 else 0.0
        )

        return {
            "sales": [
                {
                    **s,
                    "profit": round(toFloat(s.get("profit")), 2),
                    "profitMarginPercent": round(toFloat(s.get("profitMarginPercent")), 1),
                    "purchasePriceUsed": round(toFloat(s.get("purchasePriceUsed")), 2),
                    "deliveryPrice": round(toFloat(s.get("deliveryPrice")), 2),
                    "salePrice": round(toFloat(s.get("salePrice")), 2),
                }
                for s in sales
            ],
            "metrics": {
                "averageDaysToSell": round(average_days_to_sell, 1),
                "soldQuantity": sold_quantity,
                "totalPurchased": total_purchase_qty,
                "sellThroughRate": round(sell_through_rate, 1),
                "averageProfitPerUnit": round(average_profit_per_unit, 2),
                "averageProfitMarginPercent": round(average_profit_margin_percent, 1),
            },
        }

    async def processBulkImport(self, rows: list[BulkImportRow | Mapping[str, Any]]) -> dict[str, Any]:
        result = {"totalRows": len(rows), "imported": 0, "errors": []}

        for idx, row in enumerate(rows):
            row_dict = _as_dict(row)
            try:
                smart = requireNonEmpty(row_dict.get("smart"), "SMART код")
                reason_raw = row_dict.get("reason")
                reason_text = reason_raw.strip() if isinstance(reason_raw, str) else str(reason_raw)
                if reason_text not in REASON_CODES:
                    raise Exception(f"Неверный код операции: {reason_text}")
                if reason_text == "return":
                    raise Exception("Операция return создается только через страницу проданных товаров")

                await self.createMovement(
                    {
                        "smart": smart,
                        "qtyDelta": row_dict.get("qtyDelta"),
                        "reason": reason_text,
                        "note": row_dict.get("note"),
                        "purchasePrice": row_dict.get("purchasePrice"),
                        "salePrice": row_dict.get("salePrice"),
                        "deliveryPrice": row_dict.get("deliveryPrice"),
                        "boxNumber": row_dict.get("boxNumber"),
                        "trackNumber": row_dict.get("trackNumber"),
                        "shippingMethodId": row_dict.get("shippingMethodId"),
                        "saleStatus": None,
                    }
                )
                result["imported"] += 1
            except Exception as err:
                clean_data = {k: v for k, v in row_dict.items() if k != "__row"}
                result["errors"].append(
                    {
                        "row": toInt(row_dict.get("__row")) if toInt(row_dict.get("__row")) > 0 else idx + 1,
                        "error": str(err),
                        "data": clean_data,
                    }
                )

        return result
