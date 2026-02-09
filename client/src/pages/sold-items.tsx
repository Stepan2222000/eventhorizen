import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Page } from "@/components/page";
import type { ArticleSearchResult, Customer, DeliveryPayer, Movement, OrderDetails, OrderSummary, ShippingMethod } from "@shared/schema";

type OrderItemDraft = {
  smart: string;
  qty: number;
  salePrice: string;
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

  const [filter, setFilter] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [newCustomerNote, setNewCustomerNote] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [items, setItems] = useState<OrderItemDraft[]>([{ smart: "", qty: 1, salePrice: "" }]);
  const [shippingMethodId, setShippingMethodId] = useState<string>("");
  const [trackNumber, setTrackNumber] = useState("");
  const [deliveryPrice, setDeliveryPrice] = useState("0");
  const [deliveryPayer, setDeliveryPayer] = useState<DeliveryPayer>("buyer");
  const [autocompleteResults, setAutocompleteResults] = useState<ArticleSearchResult[]>([]);
  const [autocompleteOpenIndex, setAutocompleteOpenIndex] = useState<number | null>(null);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const ordersQueryKey = "/api/orders?includeArchived=1";

  const { data: orders = [], isLoading } = useQuery<OrderSummary[]>({
    queryKey: [ordersQueryKey],
  });

  const { data: customers = [] } = useQuery<Customer[]>({
    queryKey: ["/api/customers"],
  });

  const { data: shippingMethods = [] } = useQuery<ShippingMethod[]>({
    queryKey: ["/api/shipping-methods"],
  });

  const { data: movements = [] } = useQuery<Movement[]>({
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
    queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=profit"] });
    queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=sales"] });
    queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=combined"] });
    queryClient.invalidateQueries({
      predicate: (query) =>
        Array.isArray(query.queryKey) &&
        typeof query.queryKey[0] === "string" &&
        query.queryKey[0].startsWith("/api/customers"),
    });
  };

  // Cleanup debounce + abort on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  const performSearch = async (query: string, itemIndex: number) => {
    const q = query.trim();
    if (q.length < 2) {
      setAutocompleteResults([]);
      setAutocompleteOpenIndex(null);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      const res = await fetch(
        `/api/articles/search?query=${encodeURIComponent(q)}&limit=10`,
        { credentials: "include", signal: controller.signal },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const results = (await res.json()) as ArticleSearchResult[];
      setAutocompleteResults(results);
      setAutocompleteOpenIndex(results.length > 0 ? itemIndex : null);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("Autocomplete search error:", err);
      setAutocompleteResults([]);
      setAutocompleteOpenIndex(null);
    }
  };

  const handleSmartInputChange = (value: string, index: number) => {
    updateItem(index, { smart: value });
    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    if (!value.trim()) {
      setAutocompleteResults([]);
      setAutocompleteOpenIndex(null);
      return;
    }
    debounceTimeout.current = setTimeout(() => performSearch(value, index), 300);
  };

  const handleSelectSmartResult = (result: ArticleSearchResult, index: number) => {
    updateItem(index, { smart: result.smart });
    setAutocompleteOpenIndex(null);
    setAutocompleteResults([]);
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
      }));

      for (const item of normalizedItems) {
        if (!item.smart) throw new Error("SMART код обязателен для каждой позиции");
        if (!Number.isFinite(item.qty) || item.qty <= 0) throw new Error("Количество должно быть положительным");
        if (!item.salePrice || !Number.isFinite(Number(item.salePrice))) throw new Error("Цена продажи должна быть числом");
        if (Number(item.salePrice) < 0) throw new Error("Цена продажи не может быть отрицательной");
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
      setItems([{ smart: "", qty: 1, salePrice: "" }]);
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

  const updateItem = (index: number, patch: Partial<OrderItemDraft>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const addItem = () => {
    setItems((prev) => [...prev, { smart: "", qty: 1, salePrice: "" }]);
  };

  const removeItem = (index: number) => {
    setItems((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((_, i) => i !== index);
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

        <Card>
          <CardHeader>
            <CardTitle>Оформить заказ</CardTitle>
            <CardDescription>Один заказ может включать несколько товаров и одну отправку (в v1)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-sm font-medium mb-2">Клиент</p>
                <Select value={selectedCustomerId} onValueChange={setSelectedCustomerId}>
                  <SelectTrigger data-testid="select-order-customer">
                    <SelectValue placeholder="Выберите клиента" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__new__">+ Новый клиент</SelectItem>
                    {customers
                      .filter((c) => !c.archivedAt)
                      .map((customer) => (
                        <SelectItem key={customer.id} value={String(customer.id)}>
                          {customer.name} {customer.phone ? `(${customer.phone})` : ""}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
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
                <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_120px_160px_56px] gap-3 items-end rounded-md border p-3">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">SMART код</p>
                    <Popover
                      open={autocompleteOpenIndex === index}
                      onOpenChange={(open) => {
                        if (!open) setAutocompleteOpenIndex(null);
                      }}
                    >
                      <PopoverTrigger asChild>
                        <div>
                          <Input
                            value={item.smart}
                            onChange={(e) => handleSmartInputChange(e.target.value, index)}
                            placeholder="Артикул или SMART..."
                            className="font-mono"
                            data-testid={`input-order-item-smart-${index}`}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") setAutocompleteOpenIndex(null);
                            }}
                          />
                        </div>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[var(--radix-popover-trigger-width)] p-0"
                        align="start"
                        onOpenAutoFocus={(e) => e.preventDefault()}
                      >
                        <Command>
                          <CommandList>
                            <CommandEmpty>Ничего не найдено</CommandEmpty>
                            <CommandGroup heading="Найденные позиции">
                              {autocompleteResults.map((result, idx) => (
                                <CommandItem
                                  key={`${result.smart}-${idx}`}
                                  value={result.smart}
                                  onSelect={() => handleSelectSmartResult(result, index)}
                                  className="cursor-pointer"
                                  data-testid={`autocomplete-order-item-${index}-${idx}`}
                                >
                                  <div className="flex items-start justify-between gap-3 w-full">
                                    <div className="flex flex-col gap-1">
                                      <div className="font-mono text-sm font-bold text-primary">{result.smart}</div>
                                      {!!result.articles?.length && (
                                        <div className="font-mono text-xs text-muted-foreground break-words">
                                          {result.articles.join(", ")}
                                        </div>
                                      )}
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                      {!!result.brand?.length && result.brand.some(b => b) && (
                                        <div className="text-xs text-muted-foreground">{result.brand.filter(b => b).join(", ")}</div>
                                      )}
                                      <div className="text-xs text-muted-foreground">
                                        Остаток: <span className="font-mono font-semibold">{result.currentStock}</span>
                                      </div>
                                    </div>
                                  </div>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Кол-во</p>
                    <Input
                      type="number"
                      min={1}
                      value={item.qty}
                      onChange={(e) => updateItem(index, { qty: Number(e.target.value) || 1 })}
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
                      onChange={(e) => updateItem(index, { salePrice: e.target.value })}
                      data-testid={`input-order-item-price-${index}`}
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={items.length === 1}
                    onClick={() => removeItem(index)}
                    data-testid={`button-remove-order-item-${index}`}
                  >
                    <i className="fas fa-trash-can"></i>
                  </Button>
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
    </Page>
  );
}
