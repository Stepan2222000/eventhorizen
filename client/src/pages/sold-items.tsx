import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Page } from "@/components/page";
import { SmartSearch } from "@/components/smart-search";
import { BoxSelector } from "@/components/box-selector";
import { ItemPickerDialog } from "@/components/item-picker-dialog";
import type { Customer, DeliveryPayer, Movement, OrderDetails, OrderSummary, ShippingMethod } from "@shared/schema";

type OrderItemDraft = {
  id: string;
  smart: string;
  qty: number;
  salePrice: string;
  boxNumber: string;
  itemIds?: number[];
};

type CreateOrderResponse = OrderDetails;

const DELIVERY_PAYER_OPTIONS: Array<{ value: DeliveryPayer; label: string }> = [
  { value: "buyer", label: "Покупатель" },
  { value: "seller", label: "Продавец" },
];

function formatCurrency(value: number) {
  return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB" }).format(value);
}

function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function SoldItems() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createDraftItem = (): OrderItemDraft => ({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    smart: "",
    qty: 1,
    salePrice: "",
    boxNumber: "",
  });

  const [filter, setFilter] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [customerComboOpen, setCustomerComboOpen] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerNote, setNewCustomerNote] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [items, setItems] = useState<OrderItemDraft[]>([createDraftItem()]);
  const [shippingMethodId, setShippingMethodId] = useState<string>("");
  const [trackNumber, setTrackNumber] = useState("");
  const [deliveryPrice, setDeliveryPrice] = useState("0");
  const [deliveryPayer, setDeliveryPayer] = useState<DeliveryPayer>("buyer");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerItemId, setPickerItemId] = useState<string | null>(null);

  const ordersQueryKey = "/api/orders?includeArchived=1";

  const { data: orders = [], isLoading, isError: isOrdersError, error: ordersError } = useQuery<OrderSummary[]>({
    queryKey: [ordersQueryKey],
  });

  const { data: customers = [], isError: isCustomersError, error: customersError } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: shippingMethods = [], isError: isShippingMethodsError, error: shippingMethodsError } = useQuery<ShippingMethod[]>({
    queryKey: ["/api/shipping-methods"],
  });

  const { data: movements = [], isError: isMovementsError, error: movementsError } = useQuery<Movement[]>({
    queryKey: ["/api/movements"],
  });

  const selectedMethod = shippingMethods.find((m) => String(m.id) === shippingMethodId);
  const isPickup = Boolean(selectedMethod?.isPickup);
  const deliveryPriceNumber = Number(deliveryPrice || 0);
  const shouldShowPayer = !(isPickup && deliveryPriceNumber === 0);

  const legacySales = useMemo(
    () => movements.filter((m) => m.reason === "sale" && !m.orderId),
    [movements]
  );

  const filteredOrders = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((order) => {
      return (
        order.customerName.toLowerCase().includes(q) ||
        (order.customerPhone || "").toLowerCase().includes(q) ||
        String(order.id).includes(q)
      );
    });
  }, [orders, filter]);

  const totals = useMemo(() => {
    const itemsTotal = items.reduce((sum, item) => sum + Number(item.salePrice || 0) * Number(item.qty || 0), 0);
    const deliveryForCustomer = shouldShowPayer && deliveryPayer === "buyer" ? Number(deliveryPrice || 0) : 0;
    return {
      qty: items.reduce((sum, item) => sum + Number(item.qty || 0), 0),
      itemsTotal,
      grandTotal: itemsTotal + deliveryForCustomer,
    };
  }, [deliveryPayer, deliveryPrice, items, shouldShowPayer]);

  const invalidateAfterOrderChanges = () => {
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/orders"),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
    queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
    // Keep BoxSelector and per-SMART pages consistent (staleTime is Infinity).
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/stock/"),
    });
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/boxes"),
    });
    queryClient.invalidateQueries({ queryKey: ["/api/unboxed"] });
    queryClient.invalidateQueries({ queryKey: ["/api/sold-out"] });
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=profit"] });
    queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=sales"] });
    queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=combined"] });
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/items"),
    });
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/customers"),
    });
  };

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      if (!shippingMethodId) throw new Error("Выберите способ доставки");
      if (!selectedCustomerId) throw new Error("Выберите клиента");
      if (items.length === 0) throw new Error("Добавьте хотя бы одну позицию");

      const normalizedItems = items.map((item) => ({
        smart: item.smart.trim(),
        qty: Number(item.qty),
        salePrice: String(item.salePrice).trim(),
        boxNumber: String(item.boxNumber || "").trim(),
        itemIds: Array.isArray(item.itemIds) && item.itemIds.length ? item.itemIds : undefined,
      }));

      const usedItemIds = new Set<number>();
      for (const item of normalizedItems) {
        if (!item.smart) throw new Error("SMART код обязателен для каждой позиции");
        if (!Number.isFinite(item.qty) || item.qty <= 0 || !Number.isInteger(item.qty)) {
          throw new Error("Количество должно быть положительным целым числом");
        }
        if (!item.boxNumber) throw new Error("Выберите коробку для каждой позиции");
        if (!item.salePrice || !Number.isFinite(Number(item.salePrice))) throw new Error("Цена продажи должна быть числом");
        if (Number(item.salePrice) < 0) throw new Error("Цена продажи не может быть отрицательной");
        if (item.itemIds && item.itemIds.length !== item.qty) {
          throw new Error(`Выберите ровно ${item.qty} экземпляров для ${item.smart} (выбрано: ${item.itemIds.length})`);
        }
        if (item.itemIds) {
          for (const itemId of item.itemIds) {
            if (usedItemIds.has(itemId)) {
              throw new Error("Один и тот же экземпляр выбран в нескольких позициях");
            }
            usedItemIds.add(itemId);
          }
        }
      }

      // Validate per-box availability using cached /api/stock/:smart/boxes data (fetched by BoxSelector).
      const requestedBySmartBox = new Map<string, { smart: string; boxNumber: string; qty: number }>();
      for (const item of normalizedItems) {
        const key = `${item.smart}||${item.boxNumber}`;
        const prev = requestedBySmartBox.get(key);
        requestedBySmartBox.set(key, {
          smart: item.smart,
          boxNumber: item.boxNumber,
          qty: (prev?.qty || 0) + item.qty,
        });
      }

      for (const entry of Array.from(requestedBySmartBox.values())) {
        const smartEncoded = encodeURIComponent(entry.smart);
        const boxRows = queryClient.getQueryData<Array<{ boxNumber: string; qty: number }>>([
          `/api/stock/${smartEncoded}/boxes`,
        ]);
        const available = (boxRows || []).find((r) => r.boxNumber === entry.boxNumber)?.qty;
        if (typeof available === "number" && entry.qty > available) {
          throw new Error(
            `В коробке ${entry.boxNumber} только ${available} шт. ${entry.smart}. Запрошено: ${entry.qty}.`
          );
        }
      }

      if (!Number.isFinite(deliveryPriceNumber)) throw new Error("Стоимость доставки должна быть числом");
      if (deliveryPriceNumber < 0) throw new Error("Стоимость доставки не может быть отрицательной");

      const shipment: Record<string, unknown> = {
        shippingMethodId: Number(shippingMethodId),
        trackNumber: isPickup ? null : trackNumber.trim() || null,
        deliveryPrice: deliveryPrice.trim() || "0",
        deliveryPayer: shouldShowPayer ? deliveryPayer : null,
      };

      const payload: Record<string, unknown> = {
        note: orderNote.trim() || null,
        items: normalizedItems,
        shipment,
      };

      if (selectedCustomerId === "__new__") {
        if (!newCustomerName.trim()) throw new Error("Введите имя нового клиента");
        payload.customer = {
          name: newCustomerName.trim(),
          phone: newCustomerPhone.trim() || null,
          note: newCustomerNote.trim() || null,
        };
      } else {
        payload.customerId = Number(selectedCustomerId);
      }

      const response = await apiRequest("POST", "/api/orders", payload);
      return (await response.json()) as CreateOrderResponse;
    },
    onSuccess: (order) => {
      invalidateAfterOrderChanges();
      toast({
        title: "Заказ оформлен",
        description: `Заказ #${order.id} успешно создан`,
      });
      setSelectedCustomerId("");
      setNewCustomerName("");
      setNewCustomerPhone("");
      setNewCustomerNote("");
      setOrderNote("");
      setItems([createDraftItem()]);
      setShippingMethodId("");
      setTrackNumber("");
      setDeliveryPrice("0");
      setDeliveryPayer("buyer");
    },
    onError: (error) => {
      toast({
        title: "Ошибка создания заказа",
        description: error instanceof Error ? error.message : "Не удалось создать заказ",
        variant: "destructive",
      });
    },
  });

  const updateItem = (id: string, patch: Partial<OrderItemDraft>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    setItems((prev) => [...prev, createDraftItem()]);
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((item) => item.id !== id);
    });
  };

  return (
    <Page
      title="Заказы"
      description="Продажи оформляются через заказы с клиентами и отправками"
      actions={
        <Link href="/customers">
          <Button variant="outline" data-testid="button-open-customers">
            <i className="fas fa-users mr-2"></i>
            Клиенты
          </Button>
        </Link>
      }
    >
      <div className="space-y-6">
        {(isOrdersError || isCustomersError || isShippingMethodsError || isMovementsError) && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="pt-4 text-sm text-destructive">
              {String(
                (ordersError as Error)?.message ||
                  (customersError as Error)?.message ||
                  (shippingMethodsError as Error)?.message ||
                  (movementsError as Error)?.message ||
                  "Не удалось загрузить данные для страницы заказов"
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Оформить заказ</CardTitle>
            <CardDescription>Один заказ может включать несколько товаров и одну отправку (в v1)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-2">Клиент</p>
                <Popover open={customerComboOpen} onOpenChange={setCustomerComboOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={customerComboOpen}
                      className="w-full justify-between font-normal"
                      data-testid="select-order-customer"
                    >
                      {selectedCustomerId === "__new__"
                        ? "+ Новый клиент"
                        : selectedCustomerId
                          ? (() => {
                              const c = customers.find((c) => String(c.id) === selectedCustomerId);
                              return c ? `${c.name}${c.phone ? ` (${c.phone})` : ""}` : "Выберите клиента";
                            })()
                          : "Выберите клиента"}
                      <i className="fas fa-chevron-down ml-2 h-4 w-4 shrink-0 opacity-50"></i>
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <Command>
                      <CommandInput placeholder="Поиск по имени или телефону..." />
                      <CommandList>
                        <CommandEmpty>Клиент не найден</CommandEmpty>
                        <CommandGroup>
                          <CommandItem
                            value="__new__"
                            onSelect={() => {
                              setSelectedCustomerId("__new__");
                              setCustomerComboOpen(false);
                            }}
                          >
                            <i className="fas fa-plus mr-2 text-xs"></i>
                            Новый клиент
                          </CommandItem>
                          {customers
                            .filter((c) => !c.archivedAt)
                            .map((customer) => (
                              <CommandItem
                                key={customer.id}
                                value={`${customer.name} ${customer.phone || ""}`}
                                onSelect={() => {
                                  setSelectedCustomerId(String(customer.id));
                                  setCustomerComboOpen(false);
                                }}
                              >
                                <i className={`fas fa-check mr-2 text-xs ${selectedCustomerId === String(customer.id) ? "opacity-100" : "opacity-0"}`}></i>
                                {customer.name} {customer.phone ? `(${customer.phone})` : ""}
                              </CommandItem>
                            ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
              <div>
                <p className="text-sm font-medium mb-2">Заметка по заказу</p>
                <Input
                  value={orderNote}
                  onChange={(e) => setOrderNote(e.target.value)}
                  placeholder="Например: оплата при получении"
                  data-testid="input-order-note"
                />
              </div>
            </div>

            {selectedCustomerId === "__new__" && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 rounded-md border p-4">
                <div>
                  <p className="text-sm font-medium mb-2">Имя *</p>
                  <Input
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    placeholder="Имя клиента"
                    data-testid="input-new-customer-name"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Телефон</p>
                  <Input
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    placeholder="+7..."
                    data-testid="input-new-customer-phone"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium mb-2">Заметка</p>
                  <Input
                    value={newCustomerNote}
                    onChange={(e) => setNewCustomerNote(e.target.value)}
                    placeholder="Опционально"
                    data-testid="input-new-customer-note"
                  />
                </div>
              </div>
            )}

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Позиции заказа</p>
                <Button type="button" size="sm" variant="outline" onClick={addItem} data-testid="button-add-order-item">
                  <i className="fas fa-plus mr-2"></i>
                  Добавить товар
                </Button>
              </div>
              {items.map((item, index) => (
                <div
                  key={item.id}
                  className="grid grid-cols-1 md:grid-cols-[1fr_220px_120px_160px_56px] gap-3 items-end rounded-md border p-3"
                >
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">SMART код</p>
                    <SmartSearch
                      value={item.smart}
                      defaultValue={item.smart}
                      onValueChange={(value) => updateItem(item.id, { smart: value })}
                      onSelect={(result) => updateItem(item.id, { smart: result.smart, boxNumber: "", itemIds: [] })}
                      onClear={() => updateItem(item.id, { smart: "", boxNumber: "", itemIds: [] })}
                      placeholder="Артикул или SMART..."
                      limit={10}
                      showName={false}
                      showSelectedInfo={false}
                      data-testid={`input-order-item-smart-${index}`}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Коробка</p>
                    <BoxSelector
                      mode="bySmart"
                      smart={item.smart}
                      value={item.boxNumber || null}
                      onSelect={(value) => updateItem(item.id, { boxNumber: value || "", itemIds: [] })}
                      placeholder="Выберите коробку..."
                      required
                      data-testid={`select-order-item-box-${index}`}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Кол-во</p>
                    <Input
                      type="number"
                      min={1}
                      step={1}
                      value={item.qty}
                      onChange={(e) => {
                        const parsed = Number.parseInt(e.target.value, 10);
                        const nextQty = Math.max(1, Number.isFinite(parsed) ? parsed : 1);
                        const nextIds = (item.itemIds || []).slice(0, nextQty);
                        updateItem(item.id, { qty: nextQty, itemIds: nextIds });
                      }}
                      data-testid={`input-order-item-qty-${index}`}
                    />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Цена за ед.</p>
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      value={item.salePrice}
                      onChange={(e) => updateItem(item.id, { salePrice: e.target.value })}
                      data-testid={`input-order-item-price-${index}`}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={items.length === 1}
                    onClick={() => removeItem(item.id)}
                    data-testid={`button-remove-order-item-${index}`}
                  >
                    <i className="fas fa-trash-can"></i>
                  </Button>

                  <div className="md:col-span-5 -mt-1 flex items-center justify-between gap-3">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const smart = String(item.smart || "").trim();
                        const box = String(item.boxNumber || "").trim();
                        if (!smart) {
                          toast({ title: "Выберите SMART", variant: "destructive" });
                          return;
                        }
                        if (!box) {
                          toast({ title: "Выберите коробку", variant: "destructive" });
                          return;
                        }
                        setPickerItemId(item.id);
                        setPickerOpen(true);
                      }}
                      disabled={!String(item.smart || "").trim() || !String(item.boxNumber || "").trim()}
                      data-testid={`button-pick-items-${index}`}
                    >
                      Выбрать экземпляры
                    </Button>
                    <div className="text-xs text-muted-foreground">
                      Выбрано: <span className="font-semibold text-foreground">{(item.itemIds || []).length}</span> /{" "}
                      {item.qty}
                    </div>
                  </div>
                </div>
              ))}
              <div className="text-sm text-muted-foreground">
                Итого по товарам: <span className="font-semibold text-foreground">{totals.qty} шт</span> на{" "}
                <span className="font-semibold text-foreground">{formatCurrency(totals.itemsTotal)}</span>
              </div>
            </div>

            <div className="space-y-3 rounded-md border p-4">
              <p className="text-sm font-medium">Отправка</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Способ доставки</p>
                  <Select
                    value={shippingMethodId}
                    onValueChange={(value) => {
                      setShippingMethodId(value);
                      const method = shippingMethods.find((m) => String(m.id) === value);
                      if (method?.isPickup) {
                        setDeliveryPrice("0");
                        setTrackNumber("");
                      }
                    }}
                  >
                    <SelectTrigger data-testid="select-order-shipping-method">
                      <SelectValue placeholder="Выберите способ доставки" />
                    </SelectTrigger>
                    <SelectContent>
                      {shippingMethods.map((method) => (
                        <SelectItem key={method.id} value={String(method.id)}>
                          {method.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <p className="text-xs text-muted-foreground mb-1">Стоимость доставки (за отправку)</p>
                  <Input
                    type="number"
                    step="0.01"
                    min={0}
                    value={deliveryPrice}
                    onChange={(e) => setDeliveryPrice(e.target.value)}
                    data-testid="input-order-delivery-price"
                  />
                </div>

                {!isPickup && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Трек-номер</p>
                    <Input
                      value={trackNumber}
                      onChange={(e) => setTrackNumber(e.target.value)}
                      placeholder="RA123..."
                      data-testid="input-order-track-number"
                    />
                  </div>
                )}

                {shouldShowPayer && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Кто платит</p>
                    <Select value={deliveryPayer} onValueChange={(value) => setDeliveryPayer(value as DeliveryPayer)}>
                      <SelectTrigger data-testid="select-order-delivery-payer">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DELIVERY_PAYER_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <div className="text-sm">
                Итого к оплате клиентом: <span className="font-semibold">{formatCurrency(totals.grandTotal)}</span>
              </div>
            </div>

            <div className="flex justify-end">
              <Button
                onClick={() => createOrderMutation.mutate()}
                disabled={createOrderMutation.isPending}
                data-testid="button-create-order"
              >
                {createOrderMutation.isPending ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Оформление...
                  </>
                ) : (
                  <>
                    <i className="fas fa-check mr-2"></i>
                    Оформить заказ
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Список заказов</CardTitle>
                <CardDescription>Новые продажи сгруппированы по клиентам и отправкам</CardDescription>
              </div>
              <Input
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Поиск по клиенту или номеру заказа"
                className="max-w-sm"
                data-testid="input-orders-filter"
              />
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка...</p>
            ) : isOrdersError ? (
              <p className="text-sm text-destructive">
                {ordersError instanceof Error ? ordersError.message : "Не удалось загрузить заказы"}
              </p>
            ) : filteredOrders.length === 0 ? (
              <p className="text-sm text-muted-foreground">Заказы пока отсутствуют</p>
            ) : (
              <div className="space-y-3">
                {filteredOrders.map((order) => (
                  <div key={order.id} className="rounded-md border p-4" data-testid={`card-order-${order.id}`}>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold">
                          Заказ #{order.id} · {order.customerName}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{formatDate(order.createdAt)}</p>
                      </div>
                      <Link href={`/orders/${order.id}`}>
                        <Button size="sm" variant="outline" data-testid={`button-open-order-${order.id}`}>
                          Подробнее
                        </Button>
                      </Link>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Позиции</p>
                        <p>{order.positionsCount}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Количество</p>
                        <p>{order.totalQty} шт</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Сумма товаров</p>
                        <p>{formatCurrency(order.itemsTotal)}</p>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {order.shipmentsPending > 0 && <Badge variant="secondary">Ожидает: {order.shipmentsPending}</Badge>}
                        {order.shipmentsShipped > 0 && <Badge variant="outline">Отправлено: {order.shipmentsShipped}</Badge>}
                        {order.shipmentsDelivered > 0 && <Badge>Получено: {order.shipmentsDelivered}</Badge>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Старые продажи без заказа</CardTitle>
            <CardDescription>Исторические записи из плоских движений (legacy)</CardDescription>
          </CardHeader>
          <CardContent>
            {legacySales.length === 0 ? (
              <p className="text-sm text-muted-foreground">Старых продаж без заказа не найдено</p>
            ) : (
              <div className="space-y-2">
                {legacySales.slice(0, 20).map((sale) => (
                  <div key={sale.id} className="flex items-center justify-between rounded-md border px-3 py-2 text-sm">
                    <div>
                      <span className="font-mono">{sale.smart}</span>
                      <span className="text-muted-foreground ml-2">{formatDate(sale.createdAt)}</span>
                    </div>
                    <div className="font-mono">
                      {Math.abs(sale.qtyDelta)} шт · {sale.salePrice ? `${sale.salePrice} ₽` : "—"}
                    </div>
                  </div>
                ))}
                {legacySales.length > 20 && (
                  <p className="text-xs text-muted-foreground">Показаны первые 20 из {legacySales.length}</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <ItemPickerDialog
        open={pickerOpen}
        onOpenChange={(open) => {
          setPickerOpen(open);
          if (!open) setPickerItemId(null);
        }}
        title="Выбор экземпляров для продажи"
        smart={pickerItemId ? String(items.find((x) => x.id === pickerItemId)?.smart || "") : ""}
        boxNumber={pickerItemId ? String(items.find((x) => x.id === pickerItemId)?.boxNumber || "") : ""}
        qty={pickerItemId ? Number(items.find((x) => x.id === pickerItemId)?.qty || 1) : 1}
        initialSelectedIds={pickerItemId ? items.find((x) => x.id === pickerItemId)?.itemIds : []}
        onConfirm={(itemIds) => {
          if (!pickerItemId) return;
          updateItem(pickerItemId, { itemIds });
        }}
      />
    </Page>
  );
}
