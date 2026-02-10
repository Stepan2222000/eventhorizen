import { z } from "zod";

// Core enums
export const reasonCodeSchema = z.enum([
  "purchase",
  "sale",
  "return",
  "writeoff",
  "adjust",
  "transfer",
]);
export type ReasonCode = z.infer<typeof reasonCodeSchema>;

export const saleStatusSchema = z.enum(["awaiting_shipment", "shipped"]);
export type SaleStatus = z.infer<typeof saleStatusSchema>;
export const shipmentStatusSchema = z.enum(["pending", "shipped", "delivered"]);
export type ShipmentStatus = z.infer<typeof shipmentStatusSchema>;
export const deliveryPayerSchema = z.enum(["seller", "buyer"]);
export type DeliveryPayer = z.infer<typeof deliveryPayerSchema>;
export const returnKindSchema = z.enum(["return", "correction"]);
export type ReturnKind = z.infer<typeof returnKindSchema>;

// SMART reference record (cached on server, read-only from parts DB)
export type Smart = {
  smart: string;
  articles: string[];
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
};

export type Reason = {
  code: ReasonCode;
  title: string;
};

export const REASONS: Reason[] = [
  { code: "purchase", title: "Покупка" },
  { code: "sale", title: "Продажа" },
  { code: "return", title: "Возврат" },
  { code: "writeoff", title: "Списание" },
  { code: "adjust", title: "Корректировка" },
  { code: "transfer", title: "Перемещение" },
];

export type ShippingMethod = {
  id: number;
  name: string;
  isPickup: boolean;
  createdAt: string;
};

// Movement stored in inventory DB (no `article` column by specification).
export type Movement = {
  id: number;
  smart: string;
  qtyDelta: number;
  reason: ReasonCode;
  note: string | null;

  // Financial fields (numeric from Postgres are serialized as strings)
  purchasePrice: string | null;
  salePrice: string | null;
  deliveryPrice: string | null;

  // Warehouse tracking
  boxNumber: string | null;

  // Shipping tracking (only for sales)
  trackNumber: string | null;
  shippingMethodId: number | null;
  saleStatus: SaleStatus | null;
  orderId: number | null;
  orderItemId: number | null;
  shipmentId: number | null;
  returnId: number | null;

  linkedMovementId?: number | null;

  createdAt: string;

  // Derived fields (from SMART cache; not stored in inventory.movements)
  articles?: string[];
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
};

export const insertMovementSchema = z.object({
  smart: z.string().min(1, "SMART код обязателен"),
  qtyDelta: z
    .number()
    .int()
    .refine((val) => val !== 0, { message: "Количество не может быть равно 0" }),
  reason: reasonCodeSchema,
  note: z.string().optional().nullable(),

  purchasePrice: z.string().optional().nullable(),
  salePrice: z.string().optional().nullable(),
  deliveryPrice: z.string().optional().nullable(),

  boxNumber: z.string().optional().nullable(),
  trackNumber: z.string().optional().nullable(),
  shippingMethodId: z.number().int().positive().optional().nullable(),
  saleStatus: saleStatusSchema.optional().nullable(),
});

export type InsertMovement = z.infer<typeof insertMovementSchema>;

// Stock level from inventory.stock VIEW (only items with totalQty > 0)
export type StockLevel = {
  smart: string;
  totalQty: number;
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
  articles?: string[];
  boxes?: Array<{ boxNumber: string; qty: number }>;
};

export type StockBoxQty = { boxNumber: string; qty: number };

export type StockBySmart = {
  smart: string;
  totalQty: number;
  boxedQty: number;
  unboxedQty: number;
  boxes: StockBoxQty[];
  existed: boolean;
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
  articles?: string[];
};

export type ArticleSearchResult = {
  smart: string;
  articles: string[];
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
  currentStock: number;
};

export type BulkImportRow = {
  smart: string;
  qtyDelta: number;
  // Import is external input; keep as string to report invalid values per-row.
  reason: string;
  note?: string;

  purchasePrice?: string;
  salePrice?: string;
  deliveryPrice?: string;
  boxNumber?: string;
  trackNumber?: string;
  shippingMethodId?: number;
};

export type BulkImportResult = {
  totalRows: number;
  imported: number;
  errors: Array<{
    row: number;
    error: string;
    data: BulkImportRow;
  }>;
};

export type SoldOutItem = {
  smart: string;
  name?: string | null;
  avgSalePrice: number;
  lastSaleDate: string;
  totalSales: number;
};

export type TopPart = {
  smart: string;
  name?: string | null;
  avgProfit: number;
  totalSales: number;
  profitMargin: number;
  currentStock: number;
  combinedScore?: number;
};

export const customerSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  phone: z.string().nullable(),
  note: z.string().nullable(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Customer = z.infer<typeof customerSchema>;

export const createCustomerSchema = z.object({
  name: z.string().min(1, "Имя клиента обязательно"),
  phone: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;

export const updateCustomerSchema = z
  .object({
    name: z.string().min(1).optional(),
    phone: z.string().optional().nullable(),
    note: z.string().optional().nullable(),
    archived: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, {
    message: "Нет полей для обновления",
  });

export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;

const nonNegativeMoneyStringSchema = (requiredMessage: string, invalidMessage: string, nonNegativeMessage: string) =>
  z
    .string()
    .min(1, requiredMessage)
    .refine((value) => Number.isFinite(Number(value)), {
      message: invalidMessage,
    })
    .refine((value) => Number(value) >= 0, {
      message: nonNegativeMessage,
    });

export const orderItemInputSchema = z.object({
  smart: z.string().min(1, "SMART код обязателен"),
  qty: z.number().int().positive("Количество должно быть положительным"),
  salePrice: nonNegativeMoneyStringSchema(
    "Цена продажи обязательна",
    "Цена продажи должна быть числом",
    "Цена продажи не может быть отрицательной"
  ),
  boxNumber: z.string().min(1, "Коробка обязательна"),
});

export type OrderItemInput = z.infer<typeof orderItemInputSchema>;

export const shipmentInputSchema = z.object({
  shippingMethodId: z.number().int().positive("Способ доставки обязателен"),
  trackNumber: z.string().optional().nullable(),
  deliveryPrice: nonNegativeMoneyStringSchema(
    "Стоимость доставки обязательна",
    "Стоимость доставки должна быть числом",
    "Стоимость доставки не может быть отрицательной"
  ),
  deliveryPayer: deliveryPayerSchema.optional().nullable(),
});

export type ShipmentInput = z.infer<typeof shipmentInputSchema>;

export const createOrderSchema = z
  .object({
    customerId: z.number().int().positive().optional(),
    customer: createCustomerSchema.optional(),
    note: z.string().optional().nullable(),
    items: z.array(orderItemInputSchema).min(1, "Добавьте хотя бы одну позицию"),
    shipment: shipmentInputSchema,
  })
  .superRefine((value, ctx) => {
    if (!value.customerId && !value.customer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Выберите клиента или создайте нового",
        path: ["customerId"],
      });
    }
    if (value.customerId && value.customer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Передайте либо customerId, либо customer",
        path: ["customer"],
      });
    }
  });

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export type OrderItem = {
  id: number;
  orderId: number;
  smart: string;
  qty: number;
  salePrice: string;
  boxNumber?: string | null;
  returnedQty: number;
  shippedQty: number;
  createdAt: string;
  articles?: string[];
  name?: string | null;
  brand?: string[] | null;
  description?: string[] | null;
};

export type ShipmentItem = {
  id: number;
  shipmentId: number;
  orderItemId: number;
  qty: number;
  createdAt: string;
};

export type OrderShipment = {
  id: number;
  orderId: number;
  shippingMethodId: number;
  shippingMethodName: string;
  isPickup: boolean;
  trackNumber: string | null;
  deliveryPrice: string;
  deliveryPayer: DeliveryPayer | null;
  status: ShipmentStatus;
  createdAt: string;
  updatedAt: string;
  items: ShipmentItem[];
};

export type ReturnItem = {
  id: number;
  returnId: number;
  orderItemId: number;
  qty: number;
  createdAt: string;
};

export type OrderReturn = {
  id: number;
  orderId: number;
  kind: ReturnKind;
  note: string | null;
  returnPrice: string;
  returnPayer: DeliveryPayer | null;
  shippingMethodId: number | null;
  shippingMethodName: string | null;
  trackNumber: string | null;
  createdAt: string;
  items: ReturnItem[];
};

export type OrderFinancialSummary = {
  revenue: number;
  cost: number;
  deliveryCost: number;
  returnCost: number;
  profit: number;
};

export type OrderSummary = {
  id: number;
  customerId: number;
  customerName: string;
  customerPhone: string | null;
  customerArchivedAt: string | null;
  note: string | null;
  createdAt: string;
  positionsCount: number;
  totalQty: number;
  itemsTotal: number;
  shipmentsPending: number;
  shipmentsShipped: number;
  shipmentsDelivered: number;
  returnsCount: number;
};

export type OrderDetails = {
  id: number;
  customer: Customer;
  note: string | null;
  createdAt: string;
  items: OrderItem[];
  shipments: OrderShipment[];
  returns: OrderReturn[];
  financial: OrderFinancialSummary;
};

export const updateShipmentStatusSchema = z.object({
  status: shipmentStatusSchema,
});

export type UpdateShipmentStatusInput = z.infer<typeof updateShipmentStatusSchema>;

export const createOrderReturnItemSchema = z.object({
  orderItemId: z.number().int().positive(),
  qty: z.number().int().positive(),
  boxNumber: z.string().min(1, "Коробка обязательна"),
});

export const createOrderReturnSchema = z
  .object({
    kind: returnKindSchema.optional(),
    note: z.string().optional().nullable(),
    returnPrice: nonNegativeMoneyStringSchema(
      "Стоимость обратной доставки обязательна",
      "Стоимость обратной доставки должна быть числом",
      "Стоимость обратной доставки не может быть отрицательной"
    ),
    returnPayer: deliveryPayerSchema.optional().nullable(),
    shippingMethodId: z.number().int().positive().optional().nullable(),
    trackNumber: z.string().optional().nullable(),
    items: z.array(createOrderReturnItemSchema).min(1, "Добавьте хотя бы одну позицию для возврата"),
  })
  .superRefine((value, ctx) => {
    const hasShippingPrice = Number(value.returnPrice) > 0;
    if (hasShippingPrice && !value.returnPayer) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Укажите, кто платит за обратную доставку",
        path: ["returnPayer"],
      });
    }
  });

export type CreateOrderReturnInput = z.infer<typeof createOrderReturnSchema>;
