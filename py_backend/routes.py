from __future__ import annotations

import io
from typing import Any

from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import JSONResponse, Response
from openpyxl import Workbook, load_workbook

from py_backend.normalization import normalize_article
from py_backend.storage import DatabaseStorage, InsufficientStockError, InvalidRequestError
from py_backend.types import SaleStatus

MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024


def parse_csv_text(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    row: list[str] = []
    field = ""
    in_quotes = False

    def push_field() -> None:
        nonlocal field
        row.append(field)
        field = ""

    def push_row() -> None:
        nonlocal row
        if len(row) == 1 and row[0] == "" and len(rows) > 0:
            row = []
            return
        rows.append(row)
        row = []

    i = 0
    while i < len(text):
        ch = text[i]

        if in_quotes:
            if ch == '"':
                nxt = text[i + 1] if i + 1 < len(text) else None
                if nxt == '"':
                    field += '"'
                    i += 1
                else:
                    in_quotes = False
            else:
                field += ch
            i += 1
            continue

        if ch == '"':
            in_quotes = True
            i += 1
            continue

        if ch == ",":
            push_field()
            i += 1
            continue

        if ch == "\n":
            push_field()
            push_row()
            i += 1
            continue

        if ch == "\r":
            nxt = text[i + 1] if i + 1 < len(text) else None
            if nxt == "\n":
                i += 1
            else:
                push_field()
                push_row()
            i += 1
            continue

        field += ch
        i += 1

    push_field()
    if len(row) > 0:
        push_row()

    while len(rows) > 0 and all(cell == "" for cell in rows[-1]):
        rows.pop()
    return rows


def pick_row_value(obj: dict[str, Any], keys: list[str]) -> Any:
    for key in keys:
        if key in obj and obj[key] is not None:
            return obj[key]
    return None


def to_string_or_empty(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float, bool)):
        return str(value)
    return ""


def to_int_or_zero(value: Any) -> int:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            return int(value)
        except Exception:
            return 0
    raw = to_string_or_empty(value)
    try:
        return int(float(raw))
    except Exception:
        return 0


def to_opt_string(value: Any) -> str | None:
    text = to_string_or_empty(value).strip()
    return text or None


def parse_bulk_import_rows_from_objects(raw_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for idx, obj in enumerate(raw_rows):
        smart = to_string_or_empty(pick_row_value(obj, ["smart", "SMART"])).strip()
        qty_delta = to_int_or_zero(pick_row_value(obj, ["qty_delta", "qtyDelta", "qty"]))
        reason = to_string_or_empty(pick_row_value(obj, ["reason", "type"])).strip()

        row: dict[str, Any] = {"smart": smart, "qtyDelta": qty_delta, "reason": reason}

        note = to_opt_string(pick_row_value(obj, ["note", "comment", "примечание"]))
        if note:
            row["note"] = note

        purchase_price = to_opt_string(pick_row_value(obj, ["purchase_price", "purchasePrice"]))
        if purchase_price:
            row["purchasePrice"] = purchase_price

        sale_price = to_opt_string(pick_row_value(obj, ["sale_price", "salePrice"]))
        if sale_price:
            row["salePrice"] = sale_price

        delivery_price = to_opt_string(pick_row_value(obj, ["delivery_price", "deliveryPrice"]))
        if delivery_price:
            row["deliveryPrice"] = delivery_price

        box_number = to_opt_string(pick_row_value(obj, ["box_number", "boxNumber"]))
        if box_number:
            row["boxNumber"] = box_number

        track_number = to_opt_string(pick_row_value(obj, ["track_number", "trackNumber"]))
        if track_number:
            row["trackNumber"] = track_number

        shipping_method_id_raw = pick_row_value(obj, ["shipping_method_id", "shippingMethodId"])
        shipping_method_id_num = to_int_or_zero(shipping_method_id_raw)
        if shipping_method_id_raw is not None and shipping_method_id_num > 0:
            row["shippingMethodId"] = shipping_method_id_num

        row["__row"] = obj.get("__row", idx + 2)
        result.append(row)

    return result


def _storage_from_request(request: Request) -> DatabaseStorage:
    return request.app.state.ctx.storage


def register_routes(app: FastAPI) -> None:
    @app.get("/api/articles/search")
    async def search_articles(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            query = request.query_params.get("query")
            if not query:
                return JSONResponse(status_code=400, content={"error": "Query parameter is required"})

            normalized = normalize_article(query)
            if not normalized or len(normalized) < 2:
                return JSONResponse(status_code=400, content={"error": "Query parameter is too short"})

            matches = storage.searchSmart(normalized)
            smart_codes = [m["smart"] for m in matches]
            stock_map = await storage.getTotalStockBySmartBatch(smart_codes)
            payload = [{**m, "currentStock": stock_map.get(m["smart"], 0)} for m in matches]
            return JSONResponse(content=payload)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to search"})

    @app.get("/api/smart/{code}")
    async def get_smart(request: Request, code: str) -> Response:
        storage = _storage_from_request(request)
        smart = storage.getSmartByCode(code)
        if not smart:
            return JSONResponse(status_code=404, content={"error": "SMART code not found"})
        if hasattr(smart, "model_dump"):
            return JSONResponse(content=smart.model_dump())
        return JSONResponse(content=smart)

    @app.get("/api/customers")
    async def get_customers(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            query = request.query_params.get("query")
            include_archived = request.query_params.get("includeArchived") in {"1", "true"}
            customers = await storage.getCustomers(query, include_archived)
            return JSONResponse(content=customers)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get customers"})

    @app.get("/api/customers/{customer_id}")
    async def get_customer_by_id(request: Request, customer_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            cid = int(customer_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})

        try:
            customer = await storage.getCustomerById(cid)
            if not customer:
                return JSONResponse(status_code=404, content={"error": "Customer not found"})

            orders = await storage.getOrders({"customerId": cid, "includeArchivedCustomers": True})
            stats = {
                "ordersCount": len(orders),
                "totalAmount": round(sum(float(o.get("itemsTotal", 0)) for o in orders), 2),
                "returnsCount": sum(int(o.get("returnsCount", 0)) for o in orders),
            }
            return JSONResponse(content={"customer": customer, "orders": orders, "stats": stats})
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get customer"})

    @app.post("/api/customers")
    async def create_customer(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            body = await request.json()
            customer = await storage.createCustomer(body)
            return JSONResponse(status_code=201, content=customer)
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception as err:
            return JSONResponse(status_code=500, content={"error": str(err) if str(err) else "Failed to create customer"})

    @app.patch("/api/customers/{customer_id}")
    async def update_customer(request: Request, customer_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            cid = int(customer_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})

        try:
            body = await request.json()
            customer = await storage.updateCustomer(cid, body)
            return JSONResponse(content=customer)
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception as err:
            if str(err) == "Customer not found":
                return JSONResponse(status_code=404, content={"error": str(err)})
            return JSONResponse(status_code=500, content={"error": str(err) if str(err) else "Failed to update customer"})

    @app.post("/api/orders")
    async def create_order(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            body = await request.json()
            order = await storage.createOrder(body)
            return JSONResponse(status_code=201, content=order)
        except InsufficientStockError as err:
            return JSONResponse(
                status_code=409,
                content={
                    "error": str(err),
                    "details": {"smart": err.smart, "currentStock": err.currentStock, "requestedQty": err.requestedQty},
                },
            )
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception as err:
            return JSONResponse(status_code=500, content={"error": str(err) if str(err) else "Failed to create order"})

    @app.get("/api/orders")
    async def get_orders(request: Request) -> Response:
        storage = _storage_from_request(request)
        customer_id_raw = request.query_params.get("customerId")
        customer_id: int | None = None
        if customer_id_raw and customer_id_raw.strip():
            try:
                customer_id = int(customer_id_raw)
            except Exception:
                return JSONResponse(status_code=400, content={"error": "Invalid customerId"})

        try:
            include_archived = request.query_params.get("includeArchived") in {"1", "true"}
            orders = await storage.getOrders(
                {
                    "customerId": customer_id,
                    "includeArchivedCustomers": include_archived,
                }
            )
            return JSONResponse(content=orders)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get orders"})

    @app.get("/api/orders/{order_id}")
    async def get_order_by_id(request: Request, order_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            oid = int(order_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})

        try:
            order = await storage.getOrderById(oid)
            if not order:
                return JSONResponse(status_code=404, content={"error": "Order not found"})
            return JSONResponse(content=order)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get order details"})

    @app.patch("/api/shipments/{shipment_id}/status")
    async def update_shipment_status(request: Request, shipment_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            sid = int(shipment_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})

        try:
            body = await request.json()
            status = body.get("status")
            if status not in ("pending", "shipped", "delivered"):
                return JSONResponse(status_code=400, content={"error": "Input should be 'pending', 'shipped' or 'delivered'"})
            shipment = await storage.updateShipmentStatus(sid, status)
            return JSONResponse(content=shipment)
        except Exception as err:
            if str(err) == "Shipment not found":
                return JSONResponse(status_code=404, content={"error": str(err)})
            return JSONResponse(
                status_code=500,
                content={"error": str(err) if str(err) else "Failed to update shipment status"},
            )

    @app.post("/api/orders/{order_id}/returns")
    async def create_order_return(request: Request, order_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            oid = int(order_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})

        try:
            body = await request.json()
            created = await storage.createOrderReturn(oid, body)
            return JSONResponse(status_code=201, content=created)
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception as err:
            return JSONResponse(status_code=500, content={"error": str(err) if str(err) else "Failed to create order return"})

    @app.post("/api/movements")
    async def create_movement(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            body = await request.json()
            if body.get("reason") == "return":
                return JSONResponse(
                    status_code=400,
                    content={"error": "Возврат создается только через страницу проданных товаров"},
                )
            movement = await storage.createMovement(body)
            return JSONResponse(status_code=201, content=movement)
        except InsufficientStockError as err:
            return JSONResponse(
                status_code=409,
                content={
                    "error": str(err),
                    "details": {"smart": err.smart, "currentStock": err.currentStock, "requestedQty": err.requestedQty},
                },
            )
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception as err:
            return JSONResponse(status_code=500, content={"error": str(err) if str(err) else "Failed to create movement"})

    @app.get("/api/movements")
    async def get_movements(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            movements = await storage.getMovements()
            return JSONResponse(content=movements)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get movements"})

    @app.get("/api/stock")
    async def get_stock(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            stock = await storage.getStockLevels()
            return JSONResponse(content=stock)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get stock levels"})

    @app.get("/api/stock/{smart}/purchases")
    async def get_stock_purchases(request: Request, smart: str) -> Response:
        storage = _storage_from_request(request)
        try:
            purchases = await storage.getPurchasesBySmart(smart)
            return JSONResponse(content=purchases)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get purchases"})

    @app.get("/api/stock/{smart}/sales")
    async def get_stock_sales(request: Request, smart: str) -> Response:
        storage = _storage_from_request(request)
        try:
            data = await storage.getSalesAnalyticsBySmart(smart)
            return JSONResponse(content=data)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get sales analytics"})

    @app.get("/api/stock/{smart}")
    async def get_stock_by_smart(request: Request, smart: str) -> Response:
        storage = _storage_from_request(request)
        try:
            info = await storage.getStockBySmart(smart)
            if not info.get("existed"):
                return JSONResponse(status_code=404, content={"error": "SMART code not found in inventory history"})
            payload = {k: v for k, v in info.items() if k != "existed"}
            return JSONResponse(content=payload)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get stock details"})

    @app.patch("/api/movements/{movement_id}")
    async def update_movement(request: Request, movement_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            mid = int(movement_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})

        try:
            body = await request.json()
            updates: dict[str, Any] = {}
            if "purchasePrice" in body:
                updates["purchasePrice"] = body.get("purchasePrice")
            if "note" in body:
                updates["note"] = body.get("note")
            if "boxNumber" in body:
                updates["boxNumber"] = body.get("boxNumber")
            if "qtyDelta" in body:
                try:
                    n = float(body.get("qtyDelta"))
                    if not (n > 0):
                        raise ValueError
                    updates["qtyDelta"] = int(n)
                except Exception:
                    return JSONResponse(status_code=400, content={"error": "Quantity must be a positive number"})

            movement = await storage.updateMovement(mid, updates)
            return JSONResponse(content=movement)
        except InsufficientStockError as err:
            return JSONResponse(
                status_code=409,
                content={
                    "error": str(err),
                    "details": {"smart": err.smart, "currentStock": err.currentStock, "requestedQty": err.requestedQty},
                },
            )
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception as err:
            if str(err) == "Movement not found":
                return JSONResponse(status_code=404, content={"error": str(err)})
            return JSONResponse(status_code=500, content={"error": str(err) if str(err) else "Failed to update movement"})

    @app.get("/api/reasons")
    async def get_reasons(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            return JSONResponse(content=storage.getReasons())
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get reasons"})

    @app.get("/api/shipping-methods")
    async def get_shipping_methods(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            methods = await storage.getShippingMethods()
            return JSONResponse(content=methods)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get shipping methods"})

    @app.post("/api/shipping-methods")
    async def create_shipping_method(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            body = await request.json()
            name = body.get("name")
            if not name or not isinstance(name, str):
                return JSONResponse(status_code=400, content={"error": "Name is required"})
            method = await storage.createShippingMethod({"name": name, "isPickup": bool(body.get("isPickup"))})
            return JSONResponse(status_code=201, content=method)
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception as err:
            if getattr(err, "sqlstate", None) == "23505" or getattr(err, "code", None) == "23505":
                return JSONResponse(status_code=400, content={"error": "Такой способ доставки уже существует"})
            return JSONResponse(status_code=500, content={"error": "Failed to create shipping method"})

    @app.delete("/api/shipping-methods/{method_id}")
    async def delete_shipping_method(request: Request, method_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            mid = int(method_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})
        try:
            await storage.deleteShippingMethod(mid)
            return Response(status_code=204)
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to delete shipping method"})

    @app.patch("/api/movements/{movement_id}/status")
    async def update_movement_status(request: Request, movement_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            mid = int(movement_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})

        try:
            body = await request.json()
            status = body.get("status")
            if status not in ("awaiting_shipment", "shipped"):
                return JSONResponse(status_code=400, content={"error": "Invalid status"})
            parsed: SaleStatus = status
            movement = await storage.updateMovementSaleStatus(mid, parsed)
            return JSONResponse(content=movement)
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception as err:
            if str(err) == "Movement not found":
                return JSONResponse(status_code=404, content={"error": str(err)})
            return JSONResponse(status_code=500, content={"error": str(err) if str(err) else "Failed to update movement status"})

    @app.patch("/api/movements/{movement_id}/ship")
    async def mark_movement_shipped(request: Request, movement_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            mid = int(movement_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})
        try:
            movement = await storage.updateMovementSaleStatus(mid, "shipped")
            return JSONResponse(content=movement)
        except InvalidRequestError as err:
            return JSONResponse(status_code=400, content={"error": str(err)})
        except Exception as err:
            if str(err) == "Movement not found":
                return JSONResponse(status_code=404, content={"error": str(err)})
            return JSONResponse(status_code=500, content={"error": str(err) if str(err) else "Failed to mark as shipped"})

    @app.get("/api/sold-out")
    async def get_sold_out(request: Request) -> Response:
        storage = _storage_from_request(request)
        try:
            items = await storage.getSoldOutItems()
            return JSONResponse(content=items)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get sold out items"})

    @app.get("/api/top-parts")
    async def get_top_parts(request: Request) -> Response:
        storage = _storage_from_request(request)
        mode = request.query_params.get("mode")
        if mode not in ("profit", "sales", "combined"):
            return JSONResponse(status_code=400, content={"error": "Invalid mode. Must be 'profit', 'sales', or 'combined'"})
        try:
            items = await storage.getTopParts(mode)
            return JSONResponse(content=items)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get top parts"})

    @app.post("/api/movements/{movement_id}/return")
    async def return_movement(request: Request, movement_id: str) -> Response:
        storage = _storage_from_request(request)
        try:
            mid = int(movement_id)
        except Exception:
            return JSONResponse(status_code=400, content={"error": "Invalid ID"})

        try:
            sale_movement = await storage.getMovementById(mid)
            if not sale_movement:
                return JSONResponse(status_code=404, content={"error": "Movement not found"})
            if sale_movement.get("reason") != "sale":
                return JSONResponse(status_code=400, content={"error": "Can only return sales"})

            return_movement = await storage.createMovement(
                {
                    "smart": sale_movement.get("smart"),
                    "qtyDelta": abs(int(sale_movement.get("qtyDelta", 0))),
                    "reason": "return",
                    "note": f"Возврат продажи #{mid}",
                    "purchasePrice": None,
                    "salePrice": None,
                    "deliveryPrice": None,
                    "boxNumber": None,
                    "trackNumber": None,
                    "shippingMethodId": None,
                    "saleStatus": None,
                }
            )
            return JSONResponse(status_code=201, content=return_movement)
        except Exception as err:
            if str(err) == "Товар уже возвращен на склад":
                return JSONResponse(status_code=409, content={"error": str(err)})
            return JSONResponse(status_code=500, content={"error": str(err) if str(err) else "Failed to return to inventory"})

    @app.post("/api/bulk-import")
    async def bulk_import(request: Request, file: UploadFile | None = File(default=None)) -> Response:
        storage = _storage_from_request(request)
        try:
            if file is None:
                return JSONResponse(status_code=400, content={"error": "No file uploaded"})

            content = await file.read()
            if len(content) > MAX_IMPORT_FILE_BYTES:
                return JSONResponse(status_code=413, content={"error": f"File too large. Max {MAX_IMPORT_FILE_BYTES} bytes."})

            filename = (file.filename or "").lower()
            content_type = (file.content_type or "").lower()
            is_excel = "sheet" in content_type or filename.endswith(".xlsx") or filename.endswith(".xls")
            is_csv = "csv" in content_type or filename.endswith(".csv")

            rows: list[dict[str, Any]] = []

            if is_excel:
                if filename.endswith(".xls"):
                    try:
                        import xlrd  # type: ignore
                    except Exception:
                        return JSONResponse(status_code=400, content={"error": "Unsupported file type"})

                    book = xlrd.open_workbook(file_contents=content)
                    if book.nsheets == 0:
                        return JSONResponse(status_code=400, content={"error": "Empty Excel file (no sheets)"})
                    sheet = book.sheet_by_index(0)
                    if sheet.nrows == 0:
                        return JSONResponse(status_code=400, content={"error": "Empty Excel sheet"})
                    headers = [str(sheet.cell_value(0, c)).strip() for c in range(sheet.ncols)]
                    raw_rows: list[dict[str, Any]] = []
                    for r in range(1, sheet.nrows):
                        values = [sheet.cell_value(r, c) for c in range(sheet.ncols)]
                        if all(not str(v).strip() for v in values):
                            continue
                        obj: dict[str, Any] = {"__row": r + 1}
                        for c, h in enumerate(headers):
                            obj[h] = values[c] if c < len(values) else ""
                        raw_rows.append(obj)
                    rows = parse_bulk_import_rows_from_objects(raw_rows)
                else:
                    workbook = load_workbook(filename=io.BytesIO(content), data_only=True)
                    if not workbook.sheetnames:
                        return JSONResponse(status_code=400, content={"error": "Empty Excel file (no sheets)"})
                    worksheet = workbook[workbook.sheetnames[0]]
                    sheet_rows = list(worksheet.iter_rows(values_only=True))
                    if len(sheet_rows) == 0:
                        return JSONResponse(status_code=400, content={"error": "Empty Excel sheet"})

                    headers = [str(v).strip() if v is not None else "" for v in sheet_rows[0]]
                    raw_rows = []
                    for idx, values in enumerate(sheet_rows[1:], start=2):
                        vals = list(values)
                        if all(v is None or str(v).strip() == "" for v in vals):
                            continue
                        obj = {"__row": idx}
                        for col, header in enumerate(headers):
                            obj[header] = vals[col] if col < len(vals) and vals[col] is not None else ""
                        raw_rows.append(obj)
                    if len(raw_rows) == 0:
                        return JSONResponse(status_code=400, content={"error": "Empty Excel sheet"})
                    rows = parse_bulk_import_rows_from_objects(raw_rows)
            elif is_csv:
                csv_text = content.decode("utf-8")
                table = parse_csv_text(csv_text)
                if len(table) == 0:
                    return JSONResponse(status_code=400, content={"error": "Empty CSV file"})

                headers = [h.strip() for h in table[0]]
                raw_objects: list[dict[str, Any]] = []
                for r in range(1, len(table)):
                    values = table[r]
                    if all(not str(v).strip() for v in values):
                        continue
                    obj: dict[str, Any] = {"__row": r + 1}
                    for c, header in enumerate(headers):
                        obj[header] = values[c] if c < len(values) else ""
                    raw_objects.append(obj)
                rows = parse_bulk_import_rows_from_objects(raw_objects)
            else:
                return JSONResponse(status_code=400, content={"error": "Unsupported file type"})

            normalized_rows = []
            for row in rows:
                normalized_rows.append(
                    {
                        **row,
                        "smart": row.get("smart").strip() if isinstance(row.get("smart"), str) else row.get("smart"),
                        "reason": row.get("reason").strip() if isinstance(row.get("reason"), str) else row.get("reason"),
                    }
                )

            result = await storage.processBulkImport(normalized_rows)
            return JSONResponse(content=result)
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to process bulk import"})

    @app.get("/api/import-template")
    async def import_template() -> Response:
        template_data = [
            {"smart": "smart_17713", "qty_delta": 10, "reason": "purchase", "purchase_price": 100.0, "box_number": "K-123", "note": "Example purchase"},
            {"smart": "smart_17713", "qty_delta": -1, "reason": "sale", "sale_price": 250.0, "delivery_price": 0.0, "shipping_method_id": 1, "note": "Example sale"},
            {"smart": "smart_17713", "qty_delta": -1, "reason": "writeoff", "note": "Example writeoff"},
            {"smart": "smart_17713", "qty_delta": 2, "reason": "adjust", "purchase_price": 120.0, "note": "Пересчет склада, нашли лишние"},
        ]

        wb = Workbook()
        ws = wb.active
        ws.title = "Import Template"
        headers = list(template_data[0].keys())
        ws.append(headers)
        for row in template_data:
            ws.append([row.get(h) for h in headers])

        output = io.BytesIO()
        wb.save(output)
        output.seek(0)
        return Response(
            content=output.read(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": 'attachment; filename="inventory-import-template.xlsx"'},
        )

    @app.get("/api/dashboard/stats")
    async def dashboard_stats(request: Request) -> Response:
        ctx = request.app.state.ctx
        try:
            row = await ctx.pools.inventory_pool.fetchrow(
                """
                WITH
                  in_stock AS (
                    SELECT COUNT(*)::text as in_stock
                    FROM inventory.stock
                  ),
                  total_parts AS (
                    SELECT COALESCE(SUM(total_qty::bigint), 0)::text as total_parts
                    FROM inventory.stock
                  ),
                  movements_today AS (
                    SELECT COUNT(*)::text as movements_today
                    FROM inventory.movements
                    WHERE created_at::date = CURRENT_DATE
                  ),
                  sales_today AS (
                    SELECT COUNT(*)::text as sales_today
                    FROM inventory.movements
                    WHERE created_at::date = CURRENT_DATE AND reason = 'sale'
                  )
                SELECT
                  (SELECT in_stock FROM in_stock) as in_stock,
                  (SELECT total_parts FROM total_parts) as total_parts,
                  (SELECT movements_today FROM movements_today) as movements_today,
                  (SELECT sales_today FROM sales_today) as sales_today
                """
            )
            return JSONResponse(
                content={
                    "inStock": int(row["in_stock"] if row else 0),
                    "totalParts": int(row["total_parts"] if row else 0),
                    "movementsToday": int(row["movements_today"] if row else 0),
                    "salesToday": int(row["sales_today"] if row else 0),
                }
            )
        except Exception:
            return JSONResponse(status_code=500, content={"error": "Failed to get dashboard stats"})
