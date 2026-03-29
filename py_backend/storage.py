from __future__ import annotations

import asyncio
import math
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from typing import Any, Mapping, Protocol, Sequence, cast
from zoneinfo import ZoneInfo

from py_backend.normalization import normalize_box_name
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


BUSINESS_TZ = ZoneInfo("Europe/Moscow")


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
            # Business timezone is fixed to Moscow for consistent "today" semantics.
            dt = value.replace(tzinfo=BUSINESS_TZ)
        else:
            dt = value
        return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
    if isinstance(value, str):
        return value
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def toFloat(value: Any) -> float:
    if isinstance(value, Decimal):
        as_float = float(value)
        return as_float if math.isfinite(as_float) else 0.0
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


def _toFiniteNumber(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, Decimal):
        n = float(value)
        return n if math.isfinite(n) else None
    if isinstance(value, (int, float)):
        n = float(value)
        return n if math.isfinite(n) else None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            n = float(text)
        except ValueError:
            return None
        return n if math.isfinite(n) else None
    return None


def requireInteger(value: Any, field: str) -> int:
    n = _toFiniteNumber(value)
    if n is None:
        raise InvalidRequestError(f"{field} должно быть числом")
    if not n.is_integer():
        raise InvalidRequestError(f"{field} должно быть целым числом")
    return int(n)


def requirePositiveInteger(value: Any, field: str) -> int:
    result = requireInteger(value, field)
    if result <= 0:
        raise InvalidRequestError(f"{field} должно быть положительным")
    return result


def requireStrictBool(value: Any, field: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(float(value)):
        if float(value) == 1:
            return True
        if float(value) == 0:
            return False
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"true", "1", "yes", "y"}:
            return True
        if text in {"false", "0", "no", "n"}:
            return False
    raise InvalidRequestError(f"{field} должно быть boolean")


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


def formatItemCode(item_id: int) -> str:
    # Human-readable instance code for labels/search.
    # Uses DB identity `id` so it's unique and never reused.
    return f"EH-{item_id:06d}"


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


def requireBoxName(value: Any, field: str) -> str:
    name = requireNonEmpty(value, field)
    if "/" in name:
        raise InvalidRequestError(f"{field} не должен содержать символ '/'")
    if len(name) > 50:
        raise InvalidRequestError(f"{field} слишком длинный (максимум 50 символов)")
    return name


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


class InsufficientBoxStockError(Exception):
    def __init__(self, smart: str, boxName: str, available: int, requested: int) -> None:
        self.smart = smart
        self.boxName = boxName
        self.available = available
        self.requested = requested
        super().__init__(f"В коробке {boxName} только {available} шт. {smart}. Запрошено: {requested}.")


class DatabaseStorage:
    def __init__(self, inventoryPool: InventoryPoolProtocol, smartCache: SmartCacheProtocol) -> None:
        self.inventoryPool = inventoryPool
        self.smartCache = smartCache

    def updateSmartCache(self, cache: SmartCacheProtocol) -> None:
        self.smartCache = cache

    def searchSmart(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        matches = self.smartCache.search(query, limit=limit)
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
            """
            SELECT COUNT(*)::text as total_qty
            FROM inventory.items
            WHERE smart = $1
              AND state = 'in_stock'
            """,
            smart,
        )
        return toInt(_obj_get(row, "total_qty"))

    async def getCurrentBoxStockTx(self, client: DbConnectionProtocol, smart: str, box_number: str) -> int:
        row = await client.fetchrow(
            """
            SELECT COUNT(*)::text as total_qty
            FROM inventory.items
            WHERE smart = $1
              AND box_number = $2
              AND state = 'in_stock'
            """,
            smart,
            box_number,
        )
        return toInt(_obj_get(row, "total_qty"))

    def mapBoxRow(self, row: Mapping[str, Any]) -> dict[str, Any]:
        return {
            "name": _obj_get(row, "name"),
            "description": _obj_get(row, "description"),
            "isActive": bool(_obj_get(row, "is_active")),
            "createdAt": toDateIso(_obj_get(row, "created_at")),
        }

    async def getBoxByNameTx(self, client: DbConnectionProtocol, box_name_input: str) -> dict[str, Any] | None:
        norm = normalize_box_name(box_name_input)
        if not norm:
            return None
        row = await client.fetchrow(
            """
            SELECT name, description, is_active, created_at
            FROM inventory.boxes
            WHERE name_norm = $1
            """,
            norm,
        )
        if row is None:
            return None
        return self.mapBoxRow(row)

    async def requireActiveBoxNameTx(self, client: DbConnectionProtocol, box_name_input: str, field: str) -> str:
        name = requireBoxName(box_name_input, field)
        norm = normalize_box_name(name)
        if not norm:
            raise InvalidRequestError(f"Коробка не найдена: {name}")
        row = await client.fetchrow(
            """
            SELECT name, is_active
            FROM inventory.boxes
            WHERE name_norm = $1
            FOR SHARE
            """,
            norm,
        )
        if row is None:
            raise InvalidRequestError(f"Коробка не найдена: {name}")
        if not bool(_obj_get(row, "is_active")):
            raise InvalidRequestError(f"Коробка закрыта: {_obj_get(row, 'name')}")
        return cast(str, _obj_get(row, "name"))

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
            "linkedMovementId": _obj_get(row, "linked_movement_id"),
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
        if reason not in REASON_CODES:
            raise InvalidRequestError("Неверная причина операции")
        smart = requireNonEmpty(data.get("smart"), "SMART код")
        qty_delta = requireInteger(data.get("qtyDelta"), "Количество")
        if qty_delta == 0:
            raise InvalidRequestError("Количество не может быть равно 0")

        note = data.get("note")
        purchase_price = data.get("purchasePrice")
        sale_price = data.get("salePrice")
        delivery_price = data.get("deliveryPrice")
        box_number = data.get("boxNumber")
        track_number = data.get("trackNumber")
        shipping_method_id = data.get("shippingMethodId")

        if not self.smartCache.getBySmart(smart):
            raise InvalidRequestError(f"SMART код не найден в справочнике: {smart}")

        if reason == "transfer":
            raise InvalidRequestError("Перемещение создается через отдельный эндпоинт")

        if reason == "purchase":
            if qty_delta <= 0:
                raise InvalidRequestError("Для покупки количество должно быть положительным")
            requireNonNegativeNumberString(purchase_price, "Цена закупки")
            box = requireBoxName(box_number, "Номер коробки")
            return {
                "smart": smart,
                "qtyDelta": qty_delta,
                "reason": reason,
                "note": note,
                "purchasePrice": purchase_price,
                "salePrice": None,
                "deliveryPrice": None,
                "boxNumber": box,
                "trackNumber": None,
                "shippingMethodId": None,
                "saleStatus": None,
            }

        if reason == "sale":
            if qty_delta >= 0:
                raise InvalidRequestError("Для продажи количество должно быть отрицательным")
            requireNonNegativeNumberString(sale_price, "Цена продажи")
            requireNonNegativeNumberString(delivery_price, "Стоимость доставки")
            shipping_method_id_value = requirePositiveInteger(shipping_method_id, "Способ доставки")
            box = requireBoxName(box_number, "Номер коробки")
            return {
                "smart": smart,
                "qtyDelta": qty_delta,
                "reason": reason,
                "note": note,
                "purchasePrice": None,
                "salePrice": sale_price,
                "deliveryPrice": delivery_price,
                "boxNumber": box,
                "trackNumber": track_number,
                "shippingMethodId": shipping_method_id_value,
                "saleStatus": "awaiting_shipment",
            }

        if reason == "return":
            raise InvalidRequestError("Возвраты создаются через заказы или возврат продажи")

        if reason == "writeoff":
            if qty_delta >= 0:
                raise InvalidRequestError("Для списания количество должно быть отрицательным")
            box = requireBoxName(box_number, "Номер коробки")
            return {
                "smart": smart,
                "qtyDelta": qty_delta,
                "reason": reason,
                "note": note,
                "purchasePrice": None,
                "salePrice": None,
                "deliveryPrice": None,
                "boxNumber": box,
                "trackNumber": None,
                "shippingMethodId": None,
                "saleStatus": None,
            }

        requireNonEmpty(note, "Примечание")
        if purchase_price is not None and str(purchase_price).strip():
            requireNonNegativeNumberString(purchase_price, "Цена за единицу")
        box = requireBoxName(box_number, "Номер коробки")

        return {
            "smart": smart,
            "qtyDelta": qty_delta,
            "reason": reason,
            "note": note,
            "purchasePrice": purchase_price if purchase_price is not None else None,
            "salePrice": None,
            "deliveryPrice": None,
            "boxNumber": box,
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

    async def _executeMovementInsertTx(self, client: Any, movement: dict[str, Any]) -> dict[str, Any]:
        """Execute a single movement insert within an existing transaction. Returns enriched movement."""
        movement["boxNumber"] = await self.requireActiveBoxNameTx(
            client,
            cast(str, movement.get("boxNumber") or ""),
            "Номер коробки",
        )

        if movement["reason"] == "sale":
            shipping_method = await client.fetchrow(
                "SELECT id FROM inventory.shipping_methods WHERE id = $1",
                movement["shippingMethodId"],
            )
            if shipping_method is None:
                raise InvalidRequestError("Способ доставки не найден")

        is_decrease = movement["reason"] in ("sale", "writeoff")
        qty_delta = int(movement["qtyDelta"])
        is_negative_adjust = movement["reason"] == "adjust" and qty_delta < 0

        if is_decrease or is_negative_adjust:
            current_stock = await self.getCurrentStockTx(client, cast(str, movement["smart"]))
            requested_qty = abs(qty_delta)
            if current_stock < requested_qty:
                raise InsufficientStockError(cast(str, movement["smart"]), current_stock, requested_qty)
            current_box_stock = await self.getCurrentBoxStockTx(
                client,
                cast(str, movement["smart"]),
                cast(str, movement["boxNumber"]),
            )
            if current_box_stock < requested_qty:
                raise InsufficientBoxStockError(
                    cast(str, movement["smart"]),
                    cast(str, movement["boxNumber"]),
                    current_box_stock,
                    requested_qty,
                )

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
        if insert_row is None:
            raise Exception("Movement not found after insert")

        movement_id = toInt(_obj_get(insert_row, "id"))
        smart = cast(str, movement.get("smart") or "")
        reason = cast(str, movement.get("reason") or "")
        qty_delta = int(movement["qtyDelta"])
        box = cast(str, movement.get("boxNumber") or "")
        qty = abs(qty_delta)

        is_increase = reason in ("purchase", "return") or (reason == "adjust" and qty_delta > 0)
        is_decrease = reason in ("sale", "writeoff") or (reason == "adjust" and qty_delta < 0)

        if qty <= 0:
            raise InvalidRequestError("Количество должно быть больше 0")

        if is_increase:
            await client.execute(
                """
                WITH inserted AS (
                  INSERT INTO inventory.items (
                    smart, state, box_number, note,
                    purchase_movement_id, sold_movement_id, written_off_movement_id, last_movement_id,
                    created_at, updated_at
                  )
                  SELECT
                    $1, 'in_stock', $2, NULL,
                    $3, NULL, NULL, $3,
                    NOW(), NOW()
                  FROM generate_series(1, $4::int)
                  RETURNING id
                )
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $3, id
                FROM inserted
                """,
                smart,
                box,
                movement_id,
                qty,
            )

        elif is_decrease:
            picked_rows = await client.fetch(
                """
                SELECT id
                FROM inventory.items
                WHERE smart = $1
                  AND box_number = $2
                  AND state = 'in_stock'
                ORDER BY id ASC
                LIMIT $3
                FOR UPDATE
                """,
                smart,
                box,
                qty,
            )
            picked_ids = [toInt(_obj_get(r, "id")) for r in picked_rows]
            if len(picked_ids) < qty:
                available = await self.getCurrentBoxStockTx(client, smart, box)
                raise InsufficientBoxStockError(smart, box, available, qty)

            next_state: str
            sold_movement_id: int | None = None
            written_off_movement_id: int | None = None
            if reason == "sale":
                next_state = "sold"
                sold_movement_id = movement_id
            else:
                next_state = "written_off"
                written_off_movement_id = movement_id

            await client.execute(
                """
                UPDATE inventory.items
                SET state = $2,
                    box_number = NULL,
                    sold_movement_id = COALESCE($3, sold_movement_id),
                    written_off_movement_id = COALESCE($4, written_off_movement_id),
                    last_movement_id = $5,
                    updated_at = NOW()
                WHERE id = ANY($1::bigint[])
                """,
                picked_ids,
                next_state,
                sold_movement_id,
                written_off_movement_id,
                movement_id,
            )

            await client.execute(
                """
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $1, UNNEST($2::bigint[])
                """,
                movement_id,
                picked_ids,
            )

        else:
            raise InvalidRequestError(f"Unsupported reason for item-based movement: {reason}")

        mapped = self.mapMovementRow(insert_row)
        return self.enrichMovement(mapped)

    async def createMovementAttempt(self, input_data: InsertMovement | Mapping[str, Any]) -> dict[str, Any]:
        movement = self.validateAndSanitizeForInsert(input_data)

        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                result = await self._executeMovementInsertTx(client, movement)
                await client.execute("COMMIT")
                return result
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    async def createMovementsBatch(self, items: list[InsertMovement | Mapping[str, Any]]) -> list[dict[str, Any]]:
        """Create multiple movements atomically in a single transaction."""
        if not items:
            return []
        movements = [self.validateAndSanitizeForInsert(item) for item in items]

        max_retries = 3
        last_error: Exception | None = None
        for attempt in range(max_retries):
            client = await self.inventoryPool.acquire()
            try:
                await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
                try:
                    results: list[dict[str, Any]] = []
                    for movement in movements:
                        result = await self._executeMovementInsertTx(client, movement)
                        results.append(result)
                    await client.execute("COMMIT")
                    return results
                except Exception:
                    await client.execute("ROLLBACK")
                    raise
            except Exception as err:
                last_error = err
                if isSerializationError(err) and attempt < max_retries - 1:
                    delay_ms = min(100 * (2**attempt), 1000)
                    await asyncio.sleep(delay_ms / 1000)
                    continue
                raise
            finally:
                await self.inventoryPool.release(client)

        raise Exception(
            f"Failed to create movements batch after {max_retries} attempts due to concurrent access: "
            f"{last_error or 'unknown error'}"
        )

    async def getMovements(self, options: Mapping[str, Any] | None = None) -> list[dict[str, Any]]:
        options_data = _as_dict(options) if options is not None else {}
        box_filter_raw = options_data.get("boxNumber")
        box_filter: str | None = None

        if isinstance(box_filter_raw, str) and box_filter_raw.strip():
            requested = requireBoxName(box_filter_raw, "Коробка")
            norm = normalize_box_name(requested)
            resolved = await self.inventoryPool.fetchrow(
                "SELECT name FROM inventory.boxes WHERE name_norm = $1",
                norm,
            )
            if resolved is None:
                # Unknown box: return empty set instead of leaking unmatched legacy strings.
                return []
            box_filter = cast(str, _obj_get(resolved, "name"))

        if box_filter is None:
            rows = await self.inventoryPool.fetch(
                """
                SELECT *
                FROM inventory.movements
                ORDER BY created_at DESC, id DESC
                """
            )
        else:
            rows = await self.inventoryPool.fetch(
                """
                SELECT *
                FROM inventory.movements
                WHERE box_number = $1
                ORDER BY created_at DESC, id DESC
                """,
                box_filter,
            )

        return [self.enrichMovement(self.mapMovementRow(row)) for row in rows]

    async def getMovementById(self, movement_id: int) -> dict[str, Any] | None:
        row = await self.inventoryPool.fetchrow("SELECT * FROM inventory.movements WHERE id = $1", movement_id)
        if row is None:
            return None
        return self.enrichMovement(self.mapMovementRow(row))

    async def getMovementItems(self, movement_id: int) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            """
            SELECT
              i.id,
              i.smart,
              i.state,
              i.box_number,
              i.note,
              i.created_at,
              i.updated_at
            FROM inventory.movement_items mi
            JOIN inventory.items i ON i.id = mi.item_id
            WHERE mi.movement_id = $1
            ORDER BY i.id ASC
            """,
            movement_id,
        )
        return [
            {
                "id": toInt(_obj_get(r, "id")),
                "itemCode": formatItemCode(toInt(_obj_get(r, "id"))),
                "smart": _obj_get(r, "smart"),
                "state": _obj_get(r, "state"),
                "boxNumber": _obj_get(r, "box_number"),
                "note": _obj_get(r, "note"),
                "createdAt": toDateIso(_obj_get(r, "created_at")),
                "updatedAt": toDateIso(_obj_get(r, "updated_at")),
            }
            for r in rows
        ]

    async def getPurchasesBySmart(self, smart: str) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            "SELECT * FROM inventory.movements WHERE smart = $1 AND reason = 'purchase' ORDER BY created_at DESC, id DESC",
            smart,
        )
        return [self.enrichMovement(self.mapMovementRow(row)) for row in rows]

    async def getSalesBySmart(self, smart: str) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            "SELECT * FROM inventory.movements WHERE smart = $1 AND reason = 'sale' ORDER BY created_at DESC, id DESC",
            smart,
        )
        return [self.enrichMovement(self.mapMovementRow(row)) for row in rows]

    async def updateMovement(self, movement_id: int, updates: Mapping[str, Any]) -> dict[str, Any]:
        updates_dict = _as_dict(updates)
        allowed_keys = {"purchasePrice", "note"}
        unknown_keys = sorted(set(updates_dict.keys()) - allowed_keys)
        if unknown_keys:
            raise InvalidRequestError(
                "В системе учета экземпляров редактирование количества/коробки через PATCH запрещено. "
                "Используйте перемещение/корректировку."
            )

        has_purchase_price = "purchasePrice" in updates_dict
        has_note = "note" in updates_dict

        if not has_purchase_price and not has_note:
            raise InvalidRequestError("Нет полей для обновления")

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
                    price = requireNonNegativeNumberString(purchase_price, "Цена закупки")
                    set_clauses.append(f"purchase_price = ${param}")
                    values.append(price)
                    param += 1

                if has_note:
                    set_clauses.append(f"note = ${param}")
                    values.append(updates_dict.get("note"))
                    param += 1

                if len(set_clauses) == 0:
                    raise InvalidRequestError("Нет полей для обновления")

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

    async def getBoxes(self, activeOnly: bool = False) -> dict[str, Any]:
        rows = await self.inventoryPool.fetch(
            """
            SELECT
              b.name,
              b.description,
              b.is_active,
              b.created_at,
              COALESCE(c.positions_count, 0)::int as positions_count,
              COALESCE(c.total_qty, 0)::int as total_qty,
              lm.last_movement_at
            FROM inventory.boxes b
            LEFT JOIN (
              SELECT
                box_number,
                COUNT(*)::int as positions_count,
                COALESCE(SUM(qty), 0)::int as total_qty
              FROM inventory.box_contents
              GROUP BY box_number
            ) c ON c.box_number = b.name
            LEFT JOIN (
              SELECT box_number, MAX(created_at) as last_movement_at
              FROM inventory.movements
              WHERE box_number IS NOT NULL AND LENGTH(TRIM(box_number)) > 0
              GROUP BY box_number
            ) lm ON lm.box_number = b.name
            WHERE ($1::boolean = FALSE OR b.is_active = TRUE)
            ORDER BY b.name ASC
            """,
            activeOnly,
        )

        boxes = [
            {
                "name": _obj_get(r, "name"),
                "description": _obj_get(r, "description"),
                "isActive": bool(_obj_get(r, "is_active")),
                "createdAt": toDateIso(_obj_get(r, "created_at")),
                "positionsCount": toInt(_obj_get(r, "positions_count")),
                "totalQty": toInt(_obj_get(r, "total_qty")),
                "lastMovementAt": toDateIso(_obj_get(r, "last_movement_at")) if _obj_get(r, "last_movement_at") else None,
            }
            for r in rows
        ]

        unboxed_row = await self.inventoryPool.fetchrow(
            """
            WITH totals AS (
              SELECT smart, COUNT(*)::int AS total_qty
              FROM inventory.items
              WHERE state = 'in_stock'
              GROUP BY smart
            ),
            boxed AS (
              SELECT smart, COUNT(*)::int AS boxed_qty
              FROM inventory.items
              WHERE state = 'in_stock'
                AND box_number IS NOT NULL
                AND LENGTH(TRIM(box_number)) > 0
              GROUP BY smart
            ),
            diff AS (
              SELECT
                t.smart,
                t.total_qty,
                (t.total_qty - COALESCE(b.boxed_qty, 0))::int AS unboxed_qty
              FROM totals t
              LEFT JOIN boxed b ON b.smart = t.smart
              WHERE t.total_qty > 0
                AND (t.total_qty - COALESCE(b.boxed_qty, 0)) <> 0
            )
            SELECT
              COUNT(*) FILTER (WHERE unboxed_qty > 0)::int AS unboxed_positions_count,
              COALESCE(SUM(unboxed_qty) FILTER (WHERE unboxed_qty > 0), 0)::int AS unboxed_total_qty,
              COUNT(*) FILTER (WHERE unboxed_qty < 0)::int AS overboxed_positions_count,
              COALESCE(SUM(-unboxed_qty) FILTER (WHERE unboxed_qty < 0), 0)::int AS overboxed_total_qty
            FROM diff
            """
        )

        return {
            "boxes": boxes,
            "unboxed": {
                "positionsCount": toInt(_obj_get(unboxed_row, "unboxed_positions_count")),
                "totalQty": toInt(_obj_get(unboxed_row, "unboxed_total_qty")),
            },
            "overboxed": {
                "positionsCount": toInt(_obj_get(unboxed_row, "overboxed_positions_count")),
                "totalQty": toInt(_obj_get(unboxed_row, "overboxed_total_qty")),
            },
        }

    async def getUnboxedItems(self) -> list[dict[str, Any]]:
        rows = await self.inventoryPool.fetch(
            """
            WITH totals AS (
              SELECT smart, COUNT(*)::int AS total_qty
              FROM inventory.items
              WHERE state = 'in_stock'
              GROUP BY smart
            ),
            boxed AS (
              SELECT smart, COUNT(*)::int AS boxed_qty
              FROM inventory.items
              WHERE state = 'in_stock'
                AND box_number IS NOT NULL
                AND LENGTH(TRIM(box_number)) > 0
              GROUP BY smart
            )
            SELECT
              t.smart,
              t.total_qty,
              COALESCE(b.boxed_qty, 0)::int AS boxed_qty,
              (t.total_qty - COALESCE(b.boxed_qty, 0))::int AS unboxed_qty
            FROM totals t
            LEFT JOIN boxed b ON b.smart = t.smart
            WHERE t.total_qty > 0
              AND (t.total_qty - COALESCE(b.boxed_qty, 0)) <> 0
            ORDER BY t.smart ASC
            """
        )

        result: list[dict[str, Any]] = []
        for row in rows:
            smart = cast(str, _obj_get(row, "smart"))
            smart_info = self.smartCache.getBySmart(smart)
            result.append(
                {
                    "smart": smart,
                    "totalQty": toInt(_obj_get(row, "total_qty")),
                    "boxedQty": toInt(_obj_get(row, "boxed_qty")),
                    "unboxedQty": toInt(_obj_get(row, "unboxed_qty")),
                    "name": _obj_get(smart_info, "name"),
                    "brand": _obj_get(smart_info, "brand"),
                    "description": _obj_get(smart_info, "description"),
                    "articles": _obj_get(smart_info, "articles", []),
                }
            )
        return result

    async def getBoxDetails(self, box_name_input: str, historyLimit: int = 50) -> dict[str, Any]:
        box_name = requireBoxName(box_name_input, "Коробка")
        norm = normalize_box_name(box_name)
        row = await self.inventoryPool.fetchrow(
            """
            SELECT name, description, is_active, created_at
            FROM inventory.boxes
            WHERE name_norm = $1
            """,
            norm,
        )
        if row is None:
            raise InvalidRequestError(f"Коробка не найдена: {box_name}")

        box = self.mapBoxRow(row)
        canonical_name = cast(str, box.get("name"))

        stats = await self.inventoryPool.fetchrow(
            """
            SELECT
              COUNT(*)::text as positions_count,
              COALESCE(SUM(qty), 0)::text as total_qty
            FROM inventory.box_contents
            WHERE box_number = $1
            """,
            canonical_name,
        )
        last = await self.inventoryPool.fetchrow(
            "SELECT MAX(created_at) as last_movement_at FROM inventory.movements WHERE box_number = $1",
            canonical_name,
        )

        contents_rows = await self.inventoryPool.fetch(
            """
            SELECT smart, qty
            FROM inventory.box_contents
            WHERE box_number = $1
            ORDER BY smart ASC
            """,
            canonical_name,
        )

        contents: list[dict[str, Any]] = []
        for r in contents_rows:
            smart = cast(str, _obj_get(r, "smart"))
            smart_info = self.smartCache.getBySmart(smart)
            contents.append(
                {
                    "smart": smart,
                    "qty": toInt(_obj_get(r, "qty")),
                    "articles": _obj_get(smart_info, "articles", []),
                    "name": _obj_get(smart_info, "name"),
                    "brand": _obj_get(smart_info, "brand"),
                    "description": _obj_get(smart_info, "description"),
                }
            )

        limit = max(1, min(200, toInt(historyLimit) or 50))
        history_rows = await self.inventoryPool.fetch(
            """
            SELECT *
            FROM inventory.movements
            WHERE box_number = $1
            ORDER BY created_at DESC, id DESC
            LIMIT $2
            """,
            canonical_name,
            limit,
        )
        history = [self.enrichMovement(self.mapMovementRow(r)) for r in history_rows]

        return {
            "box": {
                **box,
                "positionsCount": toInt(_obj_get(stats, "positions_count")),
                "totalQty": toInt(_obj_get(stats, "total_qty")),
                "lastMovementAt": toDateIso(_obj_get(last, "last_movement_at")) if _obj_get(last, "last_movement_at") else None,
            },
            "contents": contents,
            "history": history,
        }

    async def createBox(self, input_data: Mapping[str, Any] | Any) -> dict[str, Any]:
        data = _as_dict(input_data)
        name = requireBoxName(data.get("name"), "Название коробки")
        description_raw = data.get("description")
        description = description_raw.strip() if isinstance(description_raw, str) and description_raw.strip() else None

        norm = normalize_box_name(name)
        if not norm:
            raise InvalidRequestError("Название коробки некорректно")

        row = await self.inventoryPool.fetchrow(
            """
            INSERT INTO inventory.boxes (name, name_norm, description, is_active, created_at)
            VALUES ($1, $2, $3, TRUE, NOW())
            ON CONFLICT (name_norm) DO NOTHING
            RETURNING name, description, is_active, created_at
            """,
            name,
            norm,
            description,
        )
        if row is None:
            existing = await self.inventoryPool.fetchrow(
                "SELECT name FROM inventory.boxes WHERE name_norm = $1 LIMIT 1",
                norm,
            )
            if existing is not None:
                raise InvalidRequestError(f"Коробка уже существует: {_obj_get(existing, 'name')}")
            raise Exception("Box not created")
        return self.mapBoxRow(row)

    async def updateBox(self, box_name_input: str, updates: Mapping[str, Any] | Any) -> dict[str, Any]:
        data = _as_dict(updates)
        box_name = requireBoxName(box_name_input, "Коробка")
        norm = normalize_box_name(box_name)
        if not norm:
            raise InvalidRequestError("Коробка не найдена")
        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                existing = await client.fetchrow(
                    """
                    SELECT name, description, is_active, created_at
                    FROM inventory.boxes
                    WHERE name_norm = $1
                    FOR UPDATE
                    """,
                    norm,
                )
                if existing is None:
                    raise InvalidRequestError("Коробка не найдена")

                canonical = cast(str, _obj_get(existing, "name"))

                set_clauses: list[str] = []
                values: list[Any] = []
                idx = 1

                if "description" in data:
                    raw = data.get("description")
                    desc = raw.strip() if isinstance(raw, str) and raw.strip() else None
                    set_clauses.append(f"description = ${idx}")
                    values.append(desc)
                    idx += 1

                if "isActive" in data:
                    target_is_active = requireStrictBool(data.get("isActive"), "isActive")
                    if target_is_active is False:
                        not_empty = await client.fetchrow(
                            """
                            SELECT id
                            FROM inventory.items
                            WHERE box_number = $1
                              AND state = 'in_stock'
                            LIMIT 1
                            FOR UPDATE
                            """,
                            canonical,
                        )
                        if not_empty is not None:
                            raise InvalidRequestError(f"Нельзя закрыть коробку {canonical}: в ней есть товар")
                    set_clauses.append(f"is_active = ${idx}")
                    values.append(target_is_active)
                    idx += 1

                if len(set_clauses) == 0:
                    await client.execute("COMMIT")
                    return self.mapBoxRow(existing)

                values.append(norm)
                updated = await client.fetchrow(
                    f"""
                    UPDATE inventory.boxes
                    SET {", ".join(set_clauses)}
                    WHERE name_norm = ${idx}
                    RETURNING name, description, is_active, created_at
                    """,
                    *values,
                )
                if updated is None:
                    raise Exception("Box not found")
                await client.execute("COMMIT")
                return self.mapBoxRow(updated)
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    async def transferBetweenBoxes(self, input_data: Mapping[str, Any] | Any) -> dict[str, Any]:
        max_retries = 3
        last_error: Exception | None = None

        for attempt in range(max_retries):
            try:
                return await self.transferBetweenBoxesAttempt(input_data)
            except Exception as err:  # noqa: PERF203
                last_error = err
                if isSerializationError(err) and attempt < max_retries - 1:
                    delay_ms = min(100 * (2**attempt), 1000)
                    await asyncio.sleep(delay_ms / 1000)
                    continue
                raise

        raise Exception(
            f"Failed to transfer after {max_retries} attempts due to concurrent access: {last_error or 'unknown error'}"
        )

    async def transferBetweenBoxesAttempt(self, input_data: Mapping[str, Any] | Any) -> dict[str, Any]:
        data = _as_dict(input_data)
        smart = requireNonEmpty(data.get("smart"), "SMART код")
        qty = requirePositiveInteger(data.get("qty"), "Количество")
        if not self.smartCache.getBySmart(smart):
            raise InvalidRequestError(f"SMART код не найден в справочнике: {smart}")

        from_box_input = requireBoxName(data.get("fromBox"), "Коробка-источник")
        to_box_input = requireBoxName(data.get("toBox"), "Коробка-назначение")
        note_raw = data.get("note")
        note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None

        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                from_box = await self.requireActiveBoxNameTx(client, from_box_input, "Коробка-источник")
                to_box = await self.requireActiveBoxNameTx(client, to_box_input, "Коробка-назначение")
                if from_box == to_box:
                    raise InvalidRequestError("Коробка-источник и коробка-назначение не должны совпадать")

                available = await self.getCurrentBoxStockTx(client, smart, from_box)
                if available < qty:
                    raise InsufficientBoxStockError(smart, from_box, available, qty)

                picked_rows = await client.fetch(
                    """
                    SELECT id
                    FROM inventory.items
                    WHERE smart = $1
                      AND box_number = $2
                      AND state = 'in_stock'
                    ORDER BY id ASC
                    LIMIT $3
                    FOR UPDATE
                    """,
                    smart,
                    from_box,
                    qty,
                )
                picked_ids = [toInt(_obj_get(r, "id")) for r in picked_rows]
                if len(picked_ids) < qty:
                    # Re-check availability for a better error message.
                    available = await self.getCurrentBoxStockTx(client, smart, from_box)
                    raise InsufficientBoxStockError(smart, from_box, available, qty)

                from_note = f"→ {to_box}" + (f" · {note}" if note else "")
                to_note = f"← {from_box}" + (f" · {note}" if note else "")

                from_row = await client.fetchrow(
                    """
                    INSERT INTO inventory.movements (
                      smart, qty_delta, reason, note,
                      purchase_price, sale_price, delivery_price,
                      box_number, track_number, shipping_method_id, sale_status,
                      linked_movement_id,
                      created_at
                    )
                    VALUES ($1,$2,'transfer',$3,NULL,NULL,NULL,$4,NULL,NULL,NULL,NULL,NOW())
                    RETURNING *
                    """,
                    smart,
                    -qty,
                    from_note,
                    from_box,
                )
                if from_row is None:
                    raise Exception("Transfer movement not created")

                from_id = toInt(_obj_get(from_row, "id"))
                to_row = await client.fetchrow(
                    """
                    INSERT INTO inventory.movements (
                      smart, qty_delta, reason, note,
                      purchase_price, sale_price, delivery_price,
                      box_number, track_number, shipping_method_id, sale_status,
                      linked_movement_id,
                      created_at
                    )
                    VALUES ($1,$2,'transfer',$3,NULL,NULL,NULL,$4,NULL,NULL,NULL,$5,NOW())
                    RETURNING *
                    """,
                    smart,
                    qty,
                    to_note,
                    to_box,
                    from_id,
                )
                if to_row is None:
                    raise Exception("Transfer movement not created")

                to_id = toInt(_obj_get(to_row, "id"))
                await client.execute(
                    "UPDATE inventory.movements SET linked_movement_id = $1 WHERE id = $2",
                    to_id,
                    from_id,
                )

                # Apply the transfer to physical items and link them to both movement rows.
                await client.execute(
                    """
                    UPDATE inventory.items
                    SET box_number = $1,
                        last_movement_id = $2,
                        updated_at = NOW()
                    WHERE id = ANY($3::bigint[])
                    """,
                    to_box,
                    to_id,
                    picked_ids,
                )

                await client.execute(
                    """
                    INSERT INTO inventory.movement_items (movement_id, item_id)
                    SELECT $1, UNNEST($2::bigint[])
                    """,
                    from_id,
                    picked_ids,
                )
                await client.execute(
                    """
                    INSERT INTO inventory.movement_items (movement_id, item_id)
                    SELECT $1, UNNEST($2::bigint[])
                    """,
                    to_id,
                    picked_ids,
                )

                await client.execute("COMMIT")
                from_movement = self.enrichMovement(self.mapMovementRow(from_row))
                to_movement = self.enrichMovement(self.mapMovementRow(to_row))
                # We update from_row.linked_movement_id after INSERT; reflect the final linkage in the response.
                from_movement["linkedMovementId"] = to_id
                to_movement["linkedMovementId"] = from_id
                return {"fromMovement": from_movement, "toMovement": to_movement}
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    async def getBoxesForSmart(self, smart: str) -> list[dict[str, Any]]:
        smart_code = requireNonEmpty(smart, "SMART код")
        if not self.smartCache.getBySmart(smart_code):
            raise InvalidRequestError(f"SMART код не найден в справочнике: {smart_code}")

        rows = await self.inventoryPool.fetch(
            """
            SELECT
              bc.box_number,
              bc.qty,
              b.description
            FROM inventory.box_contents bc
            JOIN inventory.boxes b ON b.name = bc.box_number
            WHERE bc.smart = $1
              AND b.is_active = TRUE
              AND bc.qty > 0
            ORDER BY bc.box_number ASC
            """,
            smart_code,
        )

        return [
            {
                "boxNumber": _obj_get(r, "box_number"),
                "qty": toInt(_obj_get(r, "qty")),
                "description": _obj_get(r, "description"),
            }
            for r in rows
        ]

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
            ORDER BY total_qty DESC, smart ASC
            """
        )

        smarts = [cast(str, _obj_get(r, "smart")) for r in rows]
        box_rows = (
            await self.inventoryPool.fetch(
                """
                SELECT smart, box_number, qty
                FROM inventory.box_contents
                WHERE smart = ANY($1)
                ORDER BY smart ASC, box_number ASC
                """,
                smarts,
            )
            if smarts
            else []
        )
        boxes_by_smart: dict[str, list[dict[str, Any]]] = {}
        for r in box_rows:
            smart = cast(str, _obj_get(r, "smart"))
            boxes_by_smart.setdefault(smart, []).append(
                {
                    "boxNumber": _obj_get(r, "box_number"),
                    "qty": toInt(_obj_get(r, "qty")),
                }
            )

        result: list[dict[str, Any]] = []
        for row in rows:
            smart = cast(str, _obj_get(row, "smart"))
            smart_info = self.smartCache.getBySmart(smart)
            result.append(
                {
                    "smart": smart,
                    "totalQty": toInt(_obj_get(row, "total_qty")),
                    "name": _obj_get(smart_info, "name"),
                    "brand": _obj_get(smart_info, "brand"),
                    "description": _obj_get(smart_info, "description"),
                    "articles": _obj_get(smart_info, "articles"),
                    "boxes": boxes_by_smart.get(smart, []),
                }
            )
        return result

    async def getStockBySmart(self, smart: str) -> dict[str, Any]:
        row = await self.inventoryPool.fetchrow(
            """
            SELECT
              (SELECT COUNT(*)::text FROM inventory.movements WHERE smart = $1) as movements_count,
              (SELECT COUNT(*)::text FROM inventory.items WHERE smart = $1 AND state = 'in_stock') as total_qty
            """,
            smart,
        )

        existed = toInt(_obj_get(row, "movements_count")) > 0
        total_qty = toInt(_obj_get(row, "total_qty"))
        box_rows = (
            await self.inventoryPool.fetch(
                """
                SELECT box_number, qty
                FROM inventory.box_contents
                WHERE smart = $1
                ORDER BY box_number ASC
                """,
                smart,
            )
            if existed
            else []
        )
        boxes = [{"boxNumber": _obj_get(r, "box_number"), "qty": toInt(_obj_get(r, "qty"))} for r in box_rows]
        boxed_qty = sum(toInt(_obj_get(r, "qty")) for r in box_rows) if box_rows else 0
        unboxed_qty = total_qty - boxed_qty

        if not existed:
            return {
                "smart": smart,
                "totalQty": 0,
                "boxedQty": 0,
                "unboxedQty": 0,
                "boxes": [],
                "existed": False,
                "name": None,
                "brand": None,
                "description": None,
                "articles": [],
            }

        smart_info = self.smartCache.getBySmart(smart)
        return {
            "smart": smart,
            "totalQty": total_qty,
            "boxedQty": boxed_qty,
            "unboxedQty": unboxed_qty,
            "boxes": boxes,
            "existed": True,
            "name": _obj_get(smart_info, "name"),
            "brand": _obj_get(smart_info, "brand"),
                "description": _obj_get(smart_info, "description"),
                "articles": _obj_get(smart_info, "articles", []),
            }

    async def getItems(self, options: Mapping[str, Any] | None = None) -> dict[str, Any]:
        options_data = _as_dict(options) if options is not None else {}
        smart_raw = options_data.get("smart")
        state_raw = options_data.get("state")
        q_raw = options_data.get("q")
        box_filter_raw = options_data.get("boxNumber")

        smart: str | None = smart_raw.strip() if isinstance(smart_raw, str) and smart_raw.strip() else None
        state: str | None = state_raw.strip() if isinstance(state_raw, str) and state_raw.strip() else None
        q: str | None = q_raw.strip() if isinstance(q_raw, str) and q_raw.strip() else None

        limit = max(1, min(200, toInt(options_data.get("limit") or 50)))
        offset = max(0, toInt(options_data.get("offset") or 0))

        box_filter: str | None = None
        if isinstance(box_filter_raw, str) and box_filter_raw.strip():
            requested = requireBoxName(box_filter_raw, "Коробка")
            norm = normalize_box_name(requested)
            resolved = await self.inventoryPool.fetchrow(
                "SELECT name FROM inventory.boxes WHERE name_norm = $1",
                norm,
            )
            if resolved is None:
                return {"items": [], "total": 0, "limit": limit, "offset": offset}
            box_filter = cast(str, _obj_get(resolved, "name"))

        where: list[str] = []
        args: list[Any] = []
        idx = 1

        if smart is not None:
            if not self.smartCache.getBySmart(smart):
                raise InvalidRequestError(f"SMART код не найден в справочнике: {smart}")
            where.append(f"smart = ${idx}")
            args.append(smart)
            idx += 1

        if state is not None:
            where.append(f"state = ${idx}")
            args.append(state)
            idx += 1

        if box_filter is not None:
            where.append(f"box_number = ${idx}")
            args.append(box_filter)
            idx += 1

        # Lightweight search by item code like "EH-000123" or plain numeric id.
        if q is not None:
            q_up = q.upper()
            parsed_id: int | None = None
            if q_up.startswith("EH-"):
                parsed_id = toInt(q_up[3:])
            elif q.isdigit():
                parsed_id = toInt(q)
            if parsed_id and parsed_id > 0:
                where.append(f"id = ${idx}")
                args.append(parsed_id)
                idx += 1
            else:
                where.append(f"(smart ILIKE ${idx} OR note ILIKE ${idx})")
                args.append(f"%{q}%")
                idx += 1

        where_sql = f"WHERE {' AND '.join(where)}" if where else ""

        total_row = await self.inventoryPool.fetchrow(
            f"SELECT COUNT(*)::text as count FROM inventory.items {where_sql}",
            *args,
        )
        total = toInt(_obj_get(total_row, "count"))

        rows = await self.inventoryPool.fetch(
            f"""
            SELECT id, smart, state, box_number, note, created_at, updated_at
            FROM inventory.items
            {where_sql}
            ORDER BY id DESC
            LIMIT ${idx} OFFSET ${idx + 1}
            """,
            *args,
            limit,
            offset,
        )

        items: list[dict[str, Any]] = []
        for row in rows:
            item_id = toInt(_obj_get(row, "id"))
            smart_code = cast(str, _obj_get(row, "smart"))
            smart_info = self.smartCache.getBySmart(smart_code)
            items.append(
                {
                    "id": item_id,
                    "itemCode": formatItemCode(item_id),
                    "smart": smart_code,
                    "state": _obj_get(row, "state"),
                    "boxNumber": _obj_get(row, "box_number"),
                    "note": _obj_get(row, "note"),
                    "createdAt": toDateIso(_obj_get(row, "created_at")),
                    "updatedAt": toDateIso(_obj_get(row, "updated_at")),
                    "articles": _obj_get(smart_info, "articles") if smart_info else [],
                    "name": _obj_get(smart_info, "name") if smart_info else None,
                    "brand": _obj_get(smart_info, "brand") if smart_info else None,
                    "description": _obj_get(smart_info, "description") if smart_info else None,
                }
            )

        return {"items": items, "total": total, "limit": limit, "offset": offset}

    async def getItemById(self, item_id: int) -> dict[str, Any] | None:
        row = await self.inventoryPool.fetchrow(
            """
            SELECT
              id, smart, state, box_number, note,
              purchase_movement_id, sold_movement_id, written_off_movement_id, last_movement_id,
              created_at, updated_at
            FROM inventory.items
            WHERE id = $1
            """,
            item_id,
        )
        if row is None:
            return None

        smart_code = cast(str, _obj_get(row, "smart"))
        smart_info = self.smartCache.getBySmart(smart_code)

        movement_rows = await self.inventoryPool.fetch(
            """
            SELECT m.*
            FROM inventory.movement_items mi
            JOIN inventory.movements m ON m.id = mi.movement_id
            WHERE mi.item_id = $1
            ORDER BY m.created_at DESC, m.id DESC
            """,
            item_id,
        )
        movements = [self.enrichMovement(self.mapMovementRow(r)) for r in movement_rows]

        media_rows = await self.inventoryPool.fetch(
            """
            SELECT
              id,
              kind,
              filename,
              mime,
              size_bytes,
              sha256,
              chunk_size,
              created_at
            FROM inventory.item_media
            WHERE item_id = $1
              AND deleted_at IS NULL
            ORDER BY created_at DESC, id DESC
            """,
            item_id,
        )
        media = [
            {
                "id": toInt(_obj_get(r, "id")),
                "kind": _obj_get(r, "kind"),
                "filename": _obj_get(r, "filename"),
                "mime": _obj_get(r, "mime"),
                "sizeBytes": int(_obj_get(r, "size_bytes") or 0),
                "sha256": _obj_get(r, "sha256"),
                "chunkSize": toInt(_obj_get(r, "chunk_size")),
                "createdAt": toDateIso(_obj_get(r, "created_at")),
            }
            for r in media_rows
        ]

        return {
            "id": toInt(_obj_get(row, "id")),
            "itemCode": formatItemCode(toInt(_obj_get(row, "id"))),
            "smart": smart_code,
            "state": _obj_get(row, "state"),
            "boxNumber": _obj_get(row, "box_number"),
            "note": _obj_get(row, "note"),
            "purchaseMovementId": _obj_get(row, "purchase_movement_id"),
            "soldMovementId": _obj_get(row, "sold_movement_id"),
            "writtenOffMovementId": _obj_get(row, "written_off_movement_id"),
            "lastMovementId": _obj_get(row, "last_movement_id"),
            "createdAt": toDateIso(_obj_get(row, "created_at")),
            "updatedAt": toDateIso(_obj_get(row, "updated_at")),
            "articles": _obj_get(smart_info, "articles") if smart_info else [],
            "name": _obj_get(smart_info, "name") if smart_info else None,
            "brand": _obj_get(smart_info, "brand") if smart_info else None,
            "description": _obj_get(smart_info, "description") if smart_info else None,
            "movements": movements,
            "media": media,
        }

    async def updateItem(self, item_id: int, updates: Mapping[str, Any] | Any) -> dict[str, Any]:
        data = _as_dict(updates)
        if "note" not in data:
            raise InvalidRequestError("Нет полей для обновления")

        note_raw = data.get("note")
        note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None

        row = await self.inventoryPool.fetchrow(
            """
            UPDATE inventory.items
            SET note = $1,
                updated_at = NOW()
            WHERE id = $2
            RETURNING id, smart, state, box_number, note, created_at, updated_at
            """,
            note,
            item_id,
        )
        if row is None:
            raise InvalidRequestError("Item not found")

        iid = toInt(_obj_get(row, "id"))
        smart_code = cast(str, _obj_get(row, "smart"))
        smart_info = self.smartCache.getBySmart(smart_code)
        return {
            "id": iid,
            "itemCode": formatItemCode(iid),
            "smart": smart_code,
            "state": _obj_get(row, "state"),
            "boxNumber": _obj_get(row, "box_number"),
            "note": _obj_get(row, "note"),
            "createdAt": toDateIso(_obj_get(row, "created_at")),
            "updatedAt": toDateIso(_obj_get(row, "updated_at")),
            "articles": _obj_get(smart_info, "articles") if smart_info else [],
            "name": _obj_get(smart_info, "name") if smart_info else None,
            "brand": _obj_get(smart_info, "brand") if smart_info else None,
            "description": _obj_get(smart_info, "description") if smart_info else None,
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
                (
                  SUM(CAST(COALESCE(sale_price, 0) AS NUMERIC) * ABS(qty_delta))
                  / NULLIF(SUM(ABS(qty_delta)), 0)
                ) as avg_sale_price,
                MAX(created_at) as last_sale_date,
                SUM(ABS(qty_delta))::text as total_sales
              FROM inventory.movements
              WHERE reason = 'sale'
              GROUP BY smart
            ),
            stock_summary AS (
              SELECT smart, COUNT(*)::int as current_stock
              FROM inventory.items
              WHERE state = 'in_stock'
              GROUP BY smart
            )
            SELECT
              s.smart,
              s.avg_sale_price,
              s.last_sale_date,
              s.total_sales
            FROM sales_summary s
            LEFT JOIN stock_summary st ON st.smart = s.smart
            WHERE COALESCE(st.current_stock, 0) = 0
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
            legacy_return_rows,
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
                SELECT smart, COUNT(*)::int as current_stock
                FROM inventory.items
                WHERE state = 'in_stock'
                GROUP BY smart
                """
            ),
            self.inventoryPool.fetch(
                """
                SELECT smart, qty_delta, sale_price::text as sale_price, delivery_price::text as delivery_price
                FROM inventory.movements
                WHERE reason = 'sale' AND order_id IS NULL
                """
            ),
            self.inventoryPool.fetch(
                """
                SELECT
                  r.smart,
                  r.qty_delta,
                  s.qty_delta AS sale_qty_delta,
                  s.sale_price::text as sale_price,
                  s.delivery_price::text as delivery_price
                FROM inventory.movements r
                JOIN inventory.movements s ON s.id = r.linked_movement_id
                WHERE r.reason = 'return'
                  AND r.order_id IS NULL
                  AND s.reason = 'sale'
                  AND s.order_id IS NULL
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

        for ret in legacy_return_rows:
            smart = cast(str, _obj_get(ret, "smart"))
            qty = abs(toInt(_obj_get(ret, "qty_delta")))
            if qty <= 0:
                continue
            sale_price = toFloat(_obj_get(ret, "sale_price"))
            delivery_price = toFloat(_obj_get(ret, "delivery_price"))
            sale_qty = abs(toInt(_obj_get(ret, "sale_qty_delta")))
            avg_purchase = avg_purchase_by_smart.get(smart, 0.0)
            acc = ensure_acc(smart)
            acc["revenue"] -= sale_price * qty
            acc["cost"] -= avg_purchase * qty
            if sale_qty > 0 and delivery_price > 0:
                acc["deliveryCost"] -= delivery_price * (qty / sale_qty)
            acc["totalSalesQty"] = max(0.0, acc["totalSalesQty"] - qty)

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
        digits_query = "".join(ch for ch in query if ch.isdigit())
        has_digits_query = len(digits_query) > 0
        like_digits = f"%{digits_query}%"

        rows = await self.inventoryPool.fetch(
            """
            SELECT id, name, phone, note, archived_at, created_at, updated_at
            FROM inventory.customers
            WHERE ($1::boolean OR archived_at IS NULL)
              AND (
                NOT $2::boolean
                OR LOWER(name) LIKE $3
                OR LOWER(COALESCE(phone, '')) LIKE $3
                OR ($4::boolean AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') LIKE $5)
              )
            ORDER BY archived_at IS NOT NULL, name ASC
            """,
            includeArchived,
            has_query,
            like,
            has_digits_query,
            like_digits,
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
        max_retries = 3
        last_error: Exception | None = None

        for attempt in range(max_retries):
            try:
                return await self.createOrderAttempt(input_data)
            except Exception as err:  # noqa: PERF203
                last_error = err
                if isSerializationError(err) and attempt < max_retries - 1:
                    delay_ms = min(100 * (2**attempt), 1000)
                    await asyncio.sleep(delay_ms / 1000)
                    continue
                raise

        raise Exception(
            f"Failed to create order after {max_retries} attempts due to concurrent access: {last_error or 'unknown error'}"
        )

    async def createOrderAttempt(self, input_data: CreateOrderInput | Mapping[str, Any]) -> dict[str, Any]:
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
            qty = requirePositiveInteger(item_dict.get("qty"), "Количество в позиции")
            sale_price = requireNonNegativeNumberString(item_dict.get("salePrice"), "Цена продажи")
            box_number = requireBoxName(item_dict.get("boxNumber"), "Номер коробки")
            item_ids_raw = item_dict.get("itemIds")
            item_ids: list[int] | None = None
            if isinstance(item_ids_raw, list):
                parsed: list[int] = []
                seen_in_item: set[int] = set()
                for raw in item_ids_raw:
                    val = requirePositiveInteger(raw, "ID экземпляра")
                    if val in seen_in_item:
                        raise InvalidRequestError("Один и тот же экземпляр указан дважды в позиции")
                    seen_in_item.add(val)
                    parsed.append(val)
                if len(parsed) > 0:
                    item_ids = parsed

            normalized_items.append(
                {"smart": smart, "qty": qty, "salePrice": sale_price, "boxNumber": box_number, "itemIds": item_ids}
            )

        used_item_ids: set[int] = set()
        for item in normalized_items:
            if not self.smartCache.getBySmart(cast(str, item["smart"])):
                raise InvalidRequestError(f"SMART код не найден в справочнике: {item['smart']}")
            item_ids = item.get("itemIds")
            if isinstance(item_ids, list):
                if len(item_ids) != toInt(item["qty"]):
                    raise InvalidRequestError("Количество выбранных экземпляров должно совпадать с qty")
                for item_id in item_ids:
                    if item_id in used_item_ids:
                        raise InvalidRequestError("Один и тот же экземпляр выбран в нескольких позициях")
                    used_item_ids.add(item_id)

        shipment = _as_dict(data.get("shipment"))
        shipping_method_id = requirePositiveInteger(shipment.get("shippingMethodId"), "Способ доставки")
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
                        "SELECT id FROM inventory.customers WHERE id = $1 AND archived_at IS NULL",
                        customer_id_raw,
                    )
                    if customer_row is None:
                        raise InvalidRequestError("Клиент не найден или архивирован")
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
                if delivery_payer is not None and delivery_payer not in ("seller", "buyer"):
                    raise InvalidRequestError("Некорректное значение deliveryPayer")
                if is_pickup and delivery_price_num == 0:
                    delivery_payer = None
                if delivery_price_num > 0 and not delivery_payer:
                    raise InvalidRequestError("Укажите, кто платит за доставку")

                shipment_status: ShipmentStatus = "delivered" if is_pickup else "pending"
                movement_sale_status = self.mapShipmentStatusToSaleStatus(shipment_status)

                # Canonicalize and validate boxes first (must exist and be active).
                for item in normalized_items:
                    item["boxNumber"] = await self.requireActiveBoxNameTx(
                        client,
                        cast(str, item.get("boxNumber") or ""),
                        "Номер коробки",
                    )

                requested_by_smart: dict[str, int] = {}
                requested_by_smart_box: dict[tuple[str, str], int] = {}
                for item in normalized_items:
                    smart = cast(str, item["smart"])
                    qty = toInt(item["qty"])
                    box = cast(str, item["boxNumber"])
                    requested_by_smart[smart] = requested_by_smart.get(smart, 0) + qty
                    requested_by_smart_box[(smart, box)] = requested_by_smart_box.get((smart, box), 0) + qty

                for smart, qty in requested_by_smart.items():
                    current_stock = await self.getCurrentStockTx(client, smart)
                    if current_stock < qty:
                        raise InsufficientStockError(smart, current_stock, qty)

                for (smart, box), qty in requested_by_smart_box.items():
                    current_box_stock = await self.getCurrentBoxStockTx(client, smart, box)
                    if current_box_stock < qty:
                        raise InsufficientBoxStockError(smart, box, current_box_stock, qty)

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
                            "boxNumber": item["boxNumber"],
                            "itemIds": item.get("itemIds"),
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
                    sale_row = await client.fetchrow(
                        """
                        INSERT INTO inventory.movements (
                          smart, qty_delta, reason, note,
                          purchase_price, sale_price, delivery_price,
                          box_number, track_number, shipping_method_id, sale_status,
                          order_id, order_item_id, shipment_id, return_id,
                          created_at
                        )
                        VALUES ($1,$2,'sale',$3,NULL,$4,$5,$6,$7,$8,$9,$10,$11,$12,NULL,NOW())
                        RETURNING id
                        """,
                        item["smart"],
                        -toInt(item["qty"]),
                        note,
                        item["salePrice"],
                        toNumberString(allocated_delivery) if should_allocate_delivery else None,
                        item["boxNumber"],
                        track_number,
                        shipping_method_id,
                        movement_sale_status,
                        order_id,
                        item["id"],
                        shipment_id,
                    )
                    if sale_row is None:
                        raise Exception("Sale movement not created")

                    sale_movement_id = toInt(_obj_get(sale_row, "id"))
                    qty = toInt(item["qty"])
                    smart = cast(str, item["smart"])
                    box = cast(str, item["boxNumber"])

                    # Choose concrete instances. If itemIds are provided by frontend, validate and lock them.
                    item_ids: list[int]
                    requested_ids = item.get("itemIds")
                    if isinstance(requested_ids, list) and len(requested_ids) > 0:
                        if len(requested_ids) != qty:
                            raise InvalidRequestError(
                                f"Выбрано неправильное количество экземпляров для {smart} из {box}: "
                                f"нужно {qty}, выбрано {len(requested_ids)}"
                            )
                        locked_rows = await client.fetch(
                            """
                            SELECT id, smart, box_number, state
                            FROM inventory.items
                            WHERE id = ANY($1::bigint[])
                            FOR UPDATE
                            """,
                            requested_ids,
                        )
                        if len(locked_rows) != qty:
                            raise InvalidRequestError("Некоторые выбранные экземпляры не найдены")
                        item_ids = []
                        for r in locked_rows:
                            rid = toInt(_obj_get(r, "id"))
                            rsmart = cast(str, _obj_get(r, "smart"))
                            rbox = cast(str, _obj_get(r, "box_number"))
                            rstate = cast(str, _obj_get(r, "state"))
                            if rsmart != smart:
                                raise InvalidRequestError("Выбранный экземпляр относится к другому SMART")
                            if rbox != box:
                                raise InvalidRequestError("Выбранный экземпляр находится в другой коробке")
                            if rstate != "in_stock":
                                raise InvalidRequestError("Выбранный экземпляр не находится на складе")
                            item_ids.append(rid)
                    else:
                        picked_rows = await client.fetch(
                            """
                            SELECT id
                            FROM inventory.items
                            WHERE smart = $1
                              AND box_number = $2
                              AND state = 'in_stock'
                            ORDER BY id ASC
                            LIMIT $3
                            FOR UPDATE
                            """,
                            smart,
                            box,
                            qty,
                        )
                        item_ids = [toInt(_obj_get(r, "id")) for r in picked_rows]
                        if len(item_ids) < qty:
                            available = await self.getCurrentBoxStockTx(client, smart, box)
                            raise InsufficientBoxStockError(smart, box, available, qty)

                    await client.execute(
                        """
                        UPDATE inventory.items
                        SET state = 'sold',
                            box_number = NULL,
                            sold_movement_id = $1,
                            written_off_movement_id = NULL,
                            last_movement_id = $1,
                            updated_at = NOW()
                        WHERE id = ANY($2::bigint[])
                        """,
                        sale_movement_id,
                        item_ids,
                    )

                    await client.execute(
                        """
                        INSERT INTO inventory.movement_items (movement_id, item_id)
                        SELECT $1, UNNEST($2::bigint[])
                        """,
                        sale_movement_id,
                        item_ids,
                    )

                await client.execute("COMMIT")
                try:
                    details = await self.getOrderById(order_id)
                except Exception:
                    details = None
                if details is None:
                    return {"id": order_id}
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

        sale_box_rows = await self.inventoryPool.fetch(
            """
            SELECT order_item_id, MAX(box_number) AS box_number
            FROM inventory.movements
            WHERE order_id = $1 AND reason = 'sale'
            GROUP BY order_item_id
            """,
            order_id,
        )
        box_by_order_item_id = {toInt(_obj_get(r, "order_item_id")): _obj_get(r, "box_number") for r in sale_box_rows}

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
            item_id = toInt(_obj_get(row, "id"))
            smart = cast(str, _obj_get(row, "smart"))
            smart_info = self.smartCache.getBySmart(smart)
            item = {
                "id": item_id,
                "orderId": _obj_get(row, "order_id"),
                "smart": smart,
                "qty": toInt(_obj_get(row, "qty")),
                "salePrice": toNumberString(_obj_get(row, "sale_price")),
                "boxNumber": box_by_order_item_id.get(item_id),
                "returnedQty": toInt(_obj_get(row, "returned_qty")),
                "shippedQty": toInt(_obj_get(row, "shipped_qty")),
                "createdAt": toDateIso(_obj_get(row, "created_at")),
                "articles": _obj_get(smart_info, "articles"),
                "name": _obj_get(smart_info, "name"),
                "brand": _obj_get(smart_info, "brand"),
                "description": _obj_get(smart_info, "description"),
            }
            item_by_id[toInt(_obj_get(row, "id"))] = item

        # Instance-level traceability for returns: which concrete items were sold in this order.
        sold_items_by_order_item: dict[int, list[dict[str, Any]]] = {}
        order_item_ids = list(item_by_id.keys())
        if order_item_ids:
            sold_rows = await self.inventoryPool.fetch(
                """
                SELECT
                  m.order_item_id,
                  i.id as item_id,
                  i.state,
                  i.box_number,
                  i.note,
                  i.created_at,
                  i.updated_at
                FROM inventory.movements m
                JOIN inventory.movement_items mi ON mi.movement_id = m.id
                JOIN inventory.items i ON i.id = mi.item_id
                WHERE m.order_id = $1
                  AND m.reason = 'sale'
                  AND m.order_item_id = ANY($2::int[])
                ORDER BY m.order_item_id ASC, i.id ASC
                """,
                order_id,
                order_item_ids,
            )
            for row in sold_rows:
                order_item_id = toInt(_obj_get(row, "order_item_id"))
                item_id = toInt(_obj_get(row, "item_id"))
                sold_items_by_order_item.setdefault(order_item_id, []).append(
                    {
                        "id": item_id,
                        "itemCode": formatItemCode(item_id),
                        "smart": _obj_get(item_by_id.get(order_item_id), "smart"),
                        "state": _obj_get(row, "state"),
                        "boxNumber": _obj_get(row, "box_number"),
                        "note": _obj_get(row, "note"),
                        "createdAt": toDateIso(_obj_get(row, "created_at")),
                        "updatedAt": toDateIso(_obj_get(row, "updated_at")),
                    }
                )

        for order_item_id, item in item_by_id.items():
            item["soldItems"] = sold_items_by_order_item.get(order_item_id, [])
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

    async def returnLegacySaleMovement(
        self,
        sale_movement_id: int,
        box_name_input: str,
        note_input: str | None = None,
    ) -> dict[str, Any]:
        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                sale_row = await client.fetchrow(
                    """
                    SELECT *
                    FROM inventory.movements
                    WHERE id = $1
                    FOR UPDATE
                    """,
                    sale_movement_id,
                )
                if sale_row is None:
                    raise InvalidRequestError("Продажа не найдена")
                if _obj_get(sale_row, "reason") != "sale":
                    raise InvalidRequestError("Возврат возможен только для продажи")
                if _obj_get(sale_row, "order_id") is not None:
                    raise InvalidRequestError("Продажи из заказов возвращаются через карточку заказа")

                qty = abs(toInt(_obj_get(sale_row, "qty_delta")))
                if qty <= 0:
                    raise InvalidRequestError("Некорректное количество в продаже")

                box_name = await self.requireActiveBoxNameTx(client, box_name_input, "Номер коробки")

                existing_return = await client.fetchrow(
                    """
                    SELECT id
                    FROM inventory.movements
                    WHERE reason = 'return'
                      AND linked_movement_id = $1
                    LIMIT 1
                    FOR UPDATE
                    """,
                    sale_movement_id,
                )
                if existing_return is not None:
                    raise InvalidRequestError("Товар уже возвращен на склад")

                sold_rows = await client.fetch(
                    """
                    SELECT i.id, i.state, i.sold_movement_id
                    FROM inventory.movement_items mi
                    JOIN inventory.items i ON i.id = mi.item_id
                    WHERE mi.movement_id = $1
                    ORDER BY i.id ASC
                    FOR UPDATE
                    """,
                    sale_movement_id,
                )
                sold_ids = [
                    toInt(_obj_get(r, "id"))
                    for r in sold_rows
                    if _obj_get(r, "state") == "sold" and toInt(_obj_get(r, "sold_movement_id")) == sale_movement_id
                ]
                if len(sold_ids) < qty:
                    raise InvalidRequestError("Товар уже возвращен на склад")

                note = (note_input or "").strip() or f"Возврат продажи #{sale_movement_id}"
                return_row = await client.fetchrow(
                    """
                    INSERT INTO inventory.movements (
                      smart, qty_delta, reason, note,
                      purchase_price, sale_price, delivery_price,
                      box_number, track_number, shipping_method_id, sale_status,
                      order_id, order_item_id, shipment_id, return_id,
                      linked_movement_id,
                      created_at
                    )
                    VALUES ($1,$2,'return',$3,NULL,NULL,NULL,$4,NULL,NULL,NULL,NULL,NULL,NULL,NULL,$5,NOW())
                    RETURNING *
                    """,
                    _obj_get(sale_row, "smart"),
                    qty,
                    note,
                    box_name,
                    sale_movement_id,
                )
                if return_row is None:
                    raise Exception("Return movement not created")

                return_movement_id = toInt(_obj_get(return_row, "id"))
                await client.execute(
                    """
                    UPDATE inventory.items
                    SET state = 'in_stock',
                        box_number = $1,
                        sold_movement_id = NULL,
                        written_off_movement_id = NULL,
                        last_movement_id = $2,
                        updated_at = NOW()
                    WHERE id = ANY($3::bigint[])
                    """,
                    box_name,
                    return_movement_id,
                    sold_ids,
                )
                await client.execute(
                    """
                    INSERT INTO inventory.movement_items (movement_id, item_id)
                    SELECT $1, UNNEST($2::bigint[])
                    """,
                    return_movement_id,
                    sold_ids,
                )
                await client.execute(
                    """
                    UPDATE inventory.movements
                    SET linked_movement_id = $1
                    WHERE id = $2
                      AND linked_movement_id IS NULL
                    """,
                    return_movement_id,
                    sale_movement_id,
                )

                await client.execute("COMMIT")
                return self.enrichMovement(self.mapMovementRow(return_row))
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    # FSM: допустимые переходы статуса отправки (только вперёд).
    _SHIPMENT_TRANSITIONS: dict[str, set[str]] = {
        "pending": {"shipped"},
        "shipped": {"delivered"},
        # delivered — терминальный статус, переходов нет.
    }

    async def updateShipmentStatus(self, shipment_id: int, status: ShipmentStatus) -> dict[str, Any]:
        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                current = await client.fetchrow(
                    "SELECT status FROM inventory.shipments WHERE id = $1 FOR UPDATE",
                    shipment_id,
                )
                if current is None:
                    raise Exception("Shipment not found")

                cur_status = cast(str, _obj_get(current, "status"))
                allowed = self._SHIPMENT_TRANSITIONS.get(cur_status, set())
                if status not in allowed:
                    raise InvalidRequestError(
                        f"Нельзя сменить статус отправки с «{cur_status}» на «{status}»"
                    )

                row = await client.fetchrow(
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

                item_rows = await client.fetch(
                    """
                    SELECT id, order_item_id, qty, created_at
                    FROM inventory.shipment_items
                    WHERE shipment_id = $1
                    ORDER BY id
                    FOR UPDATE
                    """,
                    shipment_id,
                )

                # Update only movements that belong to this shipment.
                await client.execute(
                    """
                    UPDATE inventory.movements
                    SET sale_status = $1,
                        shipment_id = $2
                    WHERE reason = 'sale'
                      AND shipment_id = $2
                    """,
                    self.mapShipmentStatusToSaleStatus(status),
                    shipment_id,
                )

                await client.execute("COMMIT")
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
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    async def _moveSaleMovementQtyBetweenShipments(
        self,
        client: DbConnectionProtocol,
        order_id: int,
        order_item_id: int,
        from_shipment_id: int,
        to_shipment_id: int,
        qty_to_move: int,
        track_number: str | None,
        shipping_method_id: int,
    ) -> None:
        remaining = qty_to_move
        movement_rows = await client.fetch(
            """
            SELECT *
            FROM inventory.movements
            WHERE reason = 'sale'
              AND order_id = $1
              AND order_item_id = $2
              AND shipment_id = $3
            ORDER BY id ASC
            FOR UPDATE
            """,
            order_id,
            order_item_id,
            from_shipment_id,
        )

        for movement in movement_rows:
            if remaining <= 0:
                break
            movement_id = toInt(_obj_get(movement, "id"))
            available_qty = abs(toInt(_obj_get(movement, "qty_delta")))
            if available_qty <= 0:
                continue
            moving_qty = min(available_qty, remaining)
            if moving_qty <= 0:
                continue

            picked_rows = await client.fetch(
                """
                SELECT mi.item_id
                FROM inventory.movement_items mi
                JOIN inventory.items i ON i.id = mi.item_id
                WHERE mi.movement_id = $1
                  AND i.state = 'sold'
                  AND i.sold_movement_id = $1
                ORDER BY mi.item_id ASC
                LIMIT $2
                FOR UPDATE OF mi, i
                """,
                movement_id,
                moving_qty,
            )
            item_ids = [toInt(_obj_get(r, "item_id")) for r in picked_rows]
            if len(item_ids) != moving_qty:
                raise InvalidRequestError(
                    "Недостаточно проданных экземпляров для переразделения отгрузки. "
                    "Возможно, часть товара уже возвращена."
                )

            if moving_qty == available_qty:
                await client.execute(
                    """
                    UPDATE inventory.movements
                    SET shipment_id = $1,
                        shipping_method_id = $2,
                        track_number = $3,
                        sale_status = 'awaiting_shipment',
                        delivery_price = NULL
                    WHERE id = $4
                    """,
                    to_shipment_id,
                    shipping_method_id,
                    track_number,
                    movement_id,
                )
                remaining -= moving_qty
                continue

            remaining_qty = available_qty - moving_qty
            await client.execute(
                """
                UPDATE inventory.movements
                SET qty_delta = $1,
                    delivery_price = NULL
                WHERE id = $2
                """,
                -remaining_qty,
                movement_id,
            )

            moved_row = await client.fetchrow(
                """
                INSERT INTO inventory.movements (
                  smart, qty_delta, reason, note,
                  purchase_price, sale_price, delivery_price,
                  box_number, track_number, shipping_method_id, sale_status,
                  order_id, order_item_id, shipment_id, return_id,
                  linked_movement_id,
                  created_at
                )
                VALUES ($1,$2,'sale',$3,NULL,$4,NULL,$5,$6,$7,'awaiting_shipment',$8,$9,$10,NULL,NULL,NOW())
                RETURNING id
                """,
                _obj_get(movement, "smart"),
                -moving_qty,
                _obj_get(movement, "note"),
                _obj_get(movement, "sale_price"),
                _obj_get(movement, "box_number"),
                track_number,
                shipping_method_id,
                order_id,
                order_item_id,
                to_shipment_id,
            )
            if moved_row is None:
                raise Exception("Failed to split sale movement")
            moved_movement_id = toInt(_obj_get(moved_row, "id"))

            await client.execute(
                """
                DELETE FROM inventory.movement_items
                WHERE movement_id = $1
                  AND item_id = ANY($2::bigint[])
                """,
                movement_id,
                item_ids,
            )
            await client.execute(
                """
                INSERT INTO inventory.movement_items (movement_id, item_id)
                SELECT $1, UNNEST($2::bigint[])
                """,
                moved_movement_id,
                item_ids,
            )
            await client.execute(
                """
                UPDATE inventory.items
                SET sold_movement_id = $1,
                    last_movement_id = $1,
                    updated_at = NOW()
                WHERE id = ANY($2::bigint[])
                """,
                moved_movement_id,
                item_ids,
            )

            remaining -= moving_qty

        if remaining > 0:
            raise InvalidRequestError("Недостаточно pending-количества для выбранной позиции")

    async def createAdditionalShipment(self, order_id: int, input_data: Mapping[str, Any] | Any) -> dict[str, Any]:
        data = _as_dict(input_data)
        shipping_method_id = requirePositiveInteger(data.get("shippingMethodId"), "Способ доставки")
        delivery_price = requireNonNegativeNumberString(data.get("deliveryPrice"), "Стоимость доставки")
        delivery_price_num = toFloat(delivery_price)
        track_raw = data.get("trackNumber")
        track_number = track_raw.strip() if isinstance(track_raw, str) and track_raw.strip() else None
        delivery_payer = data.get("deliveryPayer")
        if delivery_payer is not None and delivery_payer not in ("seller", "buyer"):
            raise InvalidRequestError("Некорректное значение deliveryPayer")

        items_raw = data.get("items")
        if not isinstance(items_raw, list) or len(items_raw) == 0:
            raise InvalidRequestError("Добавьте хотя бы одну позицию в отгрузку")

        requested_by_order_item: dict[int, int] = {}
        for item in items_raw:
            row = _as_dict(item)
            order_item_id = requirePositiveInteger(row.get("orderItemId"), "orderItemId")
            qty = requirePositiveInteger(row.get("qty"), "Количество в отгрузке")
            requested_by_order_item[order_item_id] = requested_by_order_item.get(order_item_id, 0) + qty

        client = await self.inventoryPool.acquire()
        try:
            await client.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")
            try:
                order_row = await client.fetchrow("SELECT id FROM inventory.orders WHERE id = $1", order_id)
                if order_row is None:
                    raise InvalidRequestError("Заказ не найден")

                shipping_method = await client.fetchrow(
                    "SELECT id, is_pickup FROM inventory.shipping_methods WHERE id = $1",
                    shipping_method_id,
                )
                if shipping_method is None:
                    raise InvalidRequestError("Способ доставки не найден")
                is_pickup = bool(_obj_get(shipping_method, "is_pickup"))
                if is_pickup and delivery_price_num == 0:
                    delivery_payer = None
                if delivery_price_num > 0 and not delivery_payer:
                    raise InvalidRequestError("Укажите, кто платит за доставку")

                shipment_status: ShipmentStatus = "delivered" if is_pickup else "pending"

                order_item_rows = await client.fetch(
                    """
                    SELECT id
                    FROM inventory.order_items
                    WHERE order_id = $1
                      AND id = ANY($2::int[])
                    FOR UPDATE
                    """,
                    order_id,
                    list(requested_by_order_item.keys()),
                )
                found_order_item_ids = {toInt(_obj_get(r, "id")) for r in order_item_rows}
                missing = [oid for oid in requested_by_order_item.keys() if oid not in found_order_item_ids]
                if missing:
                    raise InvalidRequestError(f"Позиции заказа не найдены: {', '.join(str(v) for v in missing)}")

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
                new_shipment_id = toInt(_obj_get(shipment_row, "id"))

                for order_item_id, requested_qty in requested_by_order_item.items():
                    donor_rows = await client.fetch(
                        """
                        SELECT
                          si.id,
                          si.shipment_id,
                          si.qty
                        FROM inventory.shipment_items si
                        JOIN inventory.shipments s ON s.id = si.shipment_id
                        WHERE s.order_id = $1
                          AND si.order_item_id = $2
                          AND s.status = 'pending'
                          AND si.shipment_id <> $3
                        ORDER BY s.created_at ASC, s.id ASC, si.id ASC
                        FOR UPDATE
                        """,
                        order_id,
                        order_item_id,
                        new_shipment_id,
                    )

                    remaining = requested_qty
                    for donor in donor_rows:
                        if remaining <= 0:
                            break
                        donor_item_id = toInt(_obj_get(donor, "id"))
                        donor_shipment_id = toInt(_obj_get(donor, "shipment_id"))
                        donor_qty = toInt(_obj_get(donor, "qty"))
                        if donor_qty <= 0:
                            continue
                        move_qty = min(remaining, donor_qty)

                        if donor_qty == move_qty:
                            await client.execute("DELETE FROM inventory.shipment_items WHERE id = $1", donor_item_id)
                        else:
                            await client.execute(
                                "UPDATE inventory.shipment_items SET qty = $1 WHERE id = $2",
                                donor_qty - move_qty,
                                donor_item_id,
                            )

                        existing_target = await client.fetchrow(
                            """
                            SELECT id, qty
                            FROM inventory.shipment_items
                            WHERE shipment_id = $1
                              AND order_item_id = $2
                            FOR UPDATE
                            """,
                            new_shipment_id,
                            order_item_id,
                        )
                        if existing_target is None:
                            await client.execute(
                                """
                                INSERT INTO inventory.shipment_items (shipment_id, order_item_id, qty, created_at)
                                VALUES ($1, $2, $3, NOW())
                                """,
                                new_shipment_id,
                                order_item_id,
                                move_qty,
                            )
                        else:
                            await client.execute(
                                """
                                UPDATE inventory.shipment_items
                                SET qty = $1
                                WHERE id = $2
                                """,
                                toInt(_obj_get(existing_target, "qty")) + move_qty,
                                toInt(_obj_get(existing_target, "id")),
                            )

                        await self._moveSaleMovementQtyBetweenShipments(
                            client=client,
                            order_id=order_id,
                            order_item_id=order_item_id,
                            from_shipment_id=donor_shipment_id,
                            to_shipment_id=new_shipment_id,
                            qty_to_move=move_qty,
                            track_number=track_number,
                            shipping_method_id=shipping_method_id,
                        )
                        remaining -= move_qty

                    if remaining > 0:
                        raise InvalidRequestError(
                            f"Недостаточно pending-количества для позиции #{order_item_id}: требуется {requested_qty}"
                        )

                await client.execute("COMMIT")
                details = await self.getOrderById(order_id)
                if details is None:
                    return {"id": new_shipment_id, "orderId": order_id}
                created = next((s for s in details.get("shipments", []) if toInt(s.get("id")) == new_shipment_id), None)
                if created is None:
                    return {"id": new_shipment_id, "orderId": order_id}
                return created
            except Exception:
                await client.execute("ROLLBACK")
                raise
        finally:
            await self.inventoryPool.release(client)

    async def createOrderReturn(self, order_id: int, input_data: CreateOrderReturnInput | Mapping[str, Any]) -> dict[str, Any]:
        max_retries = 3
        last_error: Exception | None = None

        for attempt in range(max_retries):
            try:
                return await self.createOrderReturnAttempt(order_id, input_data)
            except Exception as err:  # noqa: PERF203
                last_error = err
                if isSerializationError(err) and attempt < max_retries - 1:
                    delay_ms = min(100 * (2**attempt), 1000)
                    await asyncio.sleep(delay_ms / 1000)
                    continue
                raise

        raise Exception(
            f"Failed to create order return after {max_retries} attempts due to concurrent access: "
            f"{last_error or 'unknown error'}"
        )

    async def createOrderReturnAttempt(self, order_id: int, input_data: CreateOrderReturnInput | Mapping[str, Any]) -> dict[str, Any]:
        data = _as_dict(input_data)
        return_price = requireNonNegativeNumberString(data.get("returnPrice"), "Стоимость обратной доставки")
        return_price_num = toFloat(return_price)
        kind = cast(str, data.get("kind") or "return")
        if kind not in ("return", "correction"):
            raise InvalidRequestError("Некорректный тип возврата")
        note_raw = data.get("note")
        note = note_raw.strip() if isinstance(note_raw, str) and note_raw.strip() else None
        track_raw = data.get("trackNumber")
        track_number = track_raw.strip() if isinstance(track_raw, str) and track_raw.strip() else None
        return_payer = data.get("returnPayer")
        if return_payer is not None and return_payer not in ("seller", "buyer"):
            raise InvalidRequestError("Некорректное значение returnPayer")
        shipping_method_id = (
            requirePositiveInteger(data.get("shippingMethodId"), "Способ обратной доставки")
            if data.get("shippingMethodId") is not None
            else None
        )

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

                normalized_items: list[dict[str, Any]] = []
                used_item_ids: set[int] = set()
                for item in items:
                    item_dict = _as_dict(item)
                    order_item_id = requirePositiveInteger(item_dict.get("orderItemId"), "orderItemId")
                    qty = requirePositiveInteger(item_dict.get("qty"), "Количество возврата")
                    box_number = requireBoxName(item_dict.get("boxNumber"), "Номер коробки")
                    box_number = await self.requireActiveBoxNameTx(client, box_number, "Номер коробки")
                    item_ids_raw = item_dict.get("itemIds")
                    if not isinstance(item_ids_raw, list) or len(item_ids_raw) == 0:
                        raise InvalidRequestError(
                            "Для возврата нужно выбрать конкретные экземпляры (itemIds), чтобы вернуть ту же самую запчасть"
                        )
                    item_ids: list[int] = []
                    for raw in item_ids_raw:
                        val = toInt(raw)
                        if val <= 0:
                            continue
                        if val in used_item_ids:
                            raise InvalidRequestError("Один и тот же экземпляр выбран дважды")
                        used_item_ids.add(val)
                        item_ids.append(val)
                    if len(item_ids) != qty:
                        raise InvalidRequestError(
                            f"Выбрано неправильное количество экземпляров для возврата: нужно {qty}, выбрано {len(item_ids)}"
                        )
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
                    normalized_items.append(
                        {"orderItemId": order_item_id, "qty": qty, "boxNumber": box_number, "itemIds": item_ids}
                    )

                sale_rows = await client.fetch(
                    """
                    SELECT id, order_item_id
                    FROM inventory.movements
                    WHERE order_id = $1
                      AND reason = 'sale'
                    """,
                    order_id,
                )
                sale_movement_ids_by_order_item_id: dict[int, set[int]] = {}
                for row in sale_rows:
                    order_item_id = toInt(_obj_get(row, "order_item_id"))
                    movement_id = toInt(_obj_get(row, "id"))
                    if order_item_id <= 0 or movement_id <= 0:
                        continue
                    sale_movement_ids_by_order_item_id.setdefault(order_item_id, set()).add(movement_id)

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

                for item in normalized_items:
                    order_item_id = toInt(item.get("orderItemId"))
                    qty = toInt(item.get("qty"))
                    order_item = item_by_id[order_item_id]
                    item_ids = cast(list[int], item.get("itemIds") or [])
                    if len(item_ids) != qty:
                        raise InvalidRequestError("Внутренняя ошибка: неверный набор экземпляров возврата")

                    sale_movement_ids = sale_movement_ids_by_order_item_id.get(order_item_id)
                    if not sale_movement_ids:
                        raise InvalidRequestError(
                            "Невозможно оформить возврат: продажа была создана до учета по экземплярам (items)"
                        )

                    await client.execute(
                        """
                        INSERT INTO inventory.return_items (return_id, order_item_id, qty, created_at)
                        VALUES ($1, $2, $3, NOW())
                        """,
                        return_id,
                        order_item_id,
                        qty,
                    )

                    movement_row = await client.fetchrow(
                        """
                        INSERT INTO inventory.movements (
                          smart, qty_delta, reason, note,
                          purchase_price, sale_price, delivery_price,
                          box_number, track_number, shipping_method_id, sale_status,
                          order_id, order_item_id, shipment_id, return_id,
                          created_at
                        )
                        VALUES ($1, $2, 'return', $3, NULL, NULL, NULL, $4, NULL, NULL, NULL, $5, $6, NULL, $7, NOW())
                        RETURNING id
                        """,
                        _obj_get(order_item, "smart"),
                        qty,
                        note
                        or (
                            f"Корректировка заказа #{order_id}, позиция #{order_item_id}"
                            if kind == "correction"
                            else f"Возврат заказа #{order_id}, позиция #{order_item_id}"
                        ),
                        item.get("boxNumber"),
                        order_id,
                        order_item_id,
                        return_id,
                    )
                    if movement_row is None:
                        raise Exception("Return movement not created")
                    return_movement_id = toInt(_obj_get(movement_row, "id"))

                    locked_rows = await client.fetch(
                        """
                        SELECT id, smart, state, sold_movement_id
                        FROM inventory.items
                        WHERE id = ANY($1::bigint[])
                        FOR UPDATE
                        """,
                        item_ids,
                    )
                    if len(locked_rows) != len(item_ids):
                        raise InvalidRequestError("Некоторые выбранные экземпляры не найдены")

                    for row in locked_rows:
                        iid = toInt(_obj_get(row, "id"))
                        rsmart = cast(str, _obj_get(row, "smart"))
                        rstate = cast(str, _obj_get(row, "state"))
                        rsold_movement_id = toInt(_obj_get(row, "sold_movement_id"))
                        if rsmart != cast(str, _obj_get(order_item, "smart")):
                            raise InvalidRequestError("Выбранный экземпляр относится к другому SMART")
                        if rstate != "sold":
                            raise InvalidRequestError(f"Экземпляр {formatItemCode(iid)} не находится в статусе sold")
                        if rsold_movement_id not in sale_movement_ids:
                            raise InvalidRequestError(
                                f"Экземпляр {formatItemCode(iid)} не относится к этой позиции заказа"
                            )

                    await client.execute(
                        """
                        UPDATE inventory.items
                        SET state = 'in_stock',
                            box_number = $1,
                            sold_movement_id = NULL,
                            written_off_movement_id = NULL,
                            last_movement_id = $2,
                            updated_at = NOW()
                        WHERE id = ANY($3::bigint[])
                        """,
                        item.get("boxNumber"),
                        return_movement_id,
                        item_ids,
                    )

                    await client.execute(
                        """
                        INSERT INTO inventory.movement_items (movement_id, item_id)
                        SELECT $1, UNNEST($2::bigint[])
                        """,
                        return_movement_id,
                        item_ids,
                    )

                await client.execute("COMMIT")
                try:
                    details = await self.getOrderById(order_id)
                except Exception:
                    details = None
                created = next((r for r in (details or {}).get("returns", []) if toInt(r.get("id")) == return_id), None)
                if created is None:
                    return {"id": return_id, "orderId": order_id}
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
                if reason_text == "transfer":
                    raise Exception("Операция transfer создается через отдельный интерфейс перемещения")

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
