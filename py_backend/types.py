from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, model_validator


ReasonCode = Literal["purchase", "sale", "return", "writeoff", "adjust", "transfer"]
SaleStatus = Literal["awaiting_shipment", "shipped"]
ShipmentStatus = Literal["pending", "shipped", "delivered"]
DeliveryPayer = Literal["seller", "buyer"]
ReturnKind = Literal["return", "correction"]

REASON_CODES: tuple[ReasonCode, ...] = (
    "purchase",
    "sale",
    "return",
    "writeoff",
    "adjust",
    "transfer",
)


class Smart(BaseModel):
    smart: str
    articles: list[str]
    name: str | None = None
    brand: list[str] | None = None
    description: list[str] | None = None


class Reason(BaseModel):
    code: ReasonCode
    title: str


REASONS: list[Reason] = [
    Reason(code="purchase", title="Покупка"),
    Reason(code="sale", title="Продажа"),
    Reason(code="return", title="Возврат"),
    Reason(code="writeoff", title="Списание"),
    Reason(code="adjust", title="Корректировка"),
    Reason(code="transfer", title="Перемещение"),
]


class ShippingMethod(BaseModel):
    id: int
    name: str
    isPickup: bool
    createdAt: str


class Movement(BaseModel):
    id: int
    smart: str
    qtyDelta: int
    reason: ReasonCode
    note: str | None

    purchasePrice: str | None
    salePrice: str | None
    deliveryPrice: str | None

    boxNumber: str | None

    trackNumber: str | None
    shippingMethodId: int | None
    saleStatus: SaleStatus | None
    orderId: int | None
    orderItemId: int | None
    shipmentId: int | None
    returnId: int | None

    linkedMovementId: int | None = None

    createdAt: str

    articles: list[str] | None = None
    name: str | None = None
    brand: list[str] | None = None
    description: list[str] | None = None


class InsertMovement(BaseModel):
    smart: str
    qtyDelta: int
    reason: ReasonCode
    note: str | None = None

    purchasePrice: str | None = None
    salePrice: str | None = None
    deliveryPrice: str | None = None

    boxNumber: str | None = None
    trackNumber: str | None = None
    shippingMethodId: int | None = None
    saleStatus: SaleStatus | None = None


class StockLevel(BaseModel):
    smart: str
    totalQty: int
    name: str | None = None
    brand: list[str] | None = None
    description: list[str] | None = None
    articles: list[str] | None = None


class ArticleSearchResult(BaseModel):
    smart: str
    articles: list[str]
    name: str | None = None
    brand: list[str] | None = None
    description: list[str] | None = None
    currentStock: int


class BulkImportRow(BaseModel):
    smart: str
    qtyDelta: int
    reason: str
    note: str | None = None

    purchasePrice: str | None = None
    salePrice: str | None = None
    deliveryPrice: str | None = None
    boxNumber: str | None = None
    trackNumber: str | None = None
    shippingMethodId: int | None = None


class BulkImportError(BaseModel):
    row: int
    error: str
    data: BulkImportRow


class BulkImportResult(BaseModel):
    totalRows: int
    imported: int
    errors: list[BulkImportError]


class SoldOutItem(BaseModel):
    smart: str
    name: str | None = None
    avgSalePrice: float
    lastSaleDate: str
    totalSales: int


class TopPart(BaseModel):
    smart: str
    name: str | None = None
    avgProfit: float
    totalSales: int
    profitMargin: float
    currentStock: int
    combinedScore: float | None = None


class Customer(BaseModel):
    id: int
    name: str
    phone: str | None
    note: str | None
    archivedAt: str | None
    createdAt: str
    updatedAt: str


class CreateCustomerInput(BaseModel):
    name: str
    phone: str | None = None
    note: str | None = None


class UpdateCustomerInput(BaseModel):
    name: str | None = None
    phone: str | None = None
    note: str | None = None
    archived: bool | None = None

    @model_validator(mode="after")
    def _validate_at_least_one_field(self) -> "UpdateCustomerInput":
        if (
            self.name is None
            and self.phone is None
            and self.note is None
            and self.archived is None
        ):
            raise ValueError("Нет полей для обновления")
        return self


class OrderItemInput(BaseModel):
    smart: str
    qty: int
    salePrice: str
    boxNumber: str


class ShipmentInput(BaseModel):
    shippingMethodId: int
    trackNumber: str | None = None
    deliveryPrice: str
    deliveryPayer: DeliveryPayer | None = None


class CreateOrderInput(BaseModel):
    customerId: int | None = None
    customer: CreateCustomerInput | None = None
    note: str | None = None
    items: list[OrderItemInput]
    shipment: ShipmentInput

    @model_validator(mode="after")
    def _validate_customer_input(self) -> "CreateOrderInput":
        if not self.customerId and not self.customer:
            raise ValueError("Выберите клиента или создайте нового")
        if self.customerId and self.customer:
            raise ValueError("Передайте либо customerId, либо customer")
        return self


class OrderItem(BaseModel):
    id: int
    orderId: int
    smart: str
    qty: int
    salePrice: str
    boxNumber: str | None = None
    returnedQty: int
    shippedQty: int
    createdAt: str
    articles: list[str] | None = None
    name: str | None = None
    brand: list[str] | None = None
    description: list[str] | None = None


class ShipmentItem(BaseModel):
    id: int
    shipmentId: int
    orderItemId: int
    qty: int
    createdAt: str


class OrderShipment(BaseModel):
    id: int
    orderId: int
    shippingMethodId: int
    shippingMethodName: str
    isPickup: bool
    trackNumber: str | None
    deliveryPrice: str
    deliveryPayer: DeliveryPayer | None
    status: ShipmentStatus
    createdAt: str
    updatedAt: str
    items: list[ShipmentItem]


class ReturnItem(BaseModel):
    id: int
    returnId: int
    orderItemId: int
    qty: int
    createdAt: str


class OrderReturn(BaseModel):
    id: int
    orderId: int
    kind: ReturnKind
    note: str | None
    returnPrice: str
    returnPayer: DeliveryPayer | None
    shippingMethodId: int | None
    shippingMethodName: str | None
    trackNumber: str | None
    createdAt: str
    items: list[ReturnItem]


class OrderFinancialSummary(BaseModel):
    revenue: float
    cost: float
    deliveryCost: float
    returnCost: float
    profit: float


class OrderSummary(BaseModel):
    id: int
    customerId: int
    customerName: str
    customerPhone: str | None
    customerArchivedAt: str | None
    note: str | None
    createdAt: str
    positionsCount: int
    totalQty: int
    itemsTotal: float
    shipmentsPending: int
    shipmentsShipped: int
    shipmentsDelivered: int
    returnsCount: int


class OrderDetails(BaseModel):
    id: int
    customer: Customer
    note: str | None
    createdAt: str
    items: list[OrderItem]
    shipments: list[OrderShipment]
    returns: list[OrderReturn]
    financial: OrderFinancialSummary


class UpdateShipmentStatusInput(BaseModel):
    status: ShipmentStatus


class CreateOrderReturnItem(BaseModel):
    orderItemId: int
    qty: int
    boxNumber: str


class CreateOrderReturnInput(BaseModel):
    kind: ReturnKind | None = None
    note: str | None = None
    returnPrice: str
    returnPayer: DeliveryPayer | None = None
    shippingMethodId: int | None = None
    trackNumber: str | None = None
    items: list[CreateOrderReturnItem]

    @model_validator(mode="after")
    def _validate_return_payer(self) -> "CreateOrderReturnInput":
        try:
            has_shipping_price = float(self.returnPrice) > 0
        except (TypeError, ValueError):
            has_shipping_price = False
        if has_shipping_price and not self.returnPayer:
            raise ValueError("Укажите, кто платит за обратную доставку")
        return self
