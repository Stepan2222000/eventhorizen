import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Page } from "@/components/page";
import { BoxSelector } from "@/components/box-selector";
import { Checkbox } from "@/components/ui/checkbox";
import type {
  DeliveryPayer,
  OrderDetails,
  ReturnKind,
  ShipmentStatus,
  ShippingMethod,
} from "@shared/schema";

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

const SHIPMENT_STATUS_OPTIONS: Array<{ value: ShipmentStatus; label: string }> = [
  { value: "pending", label: "Ожидает отправки" },
  { value: "shipped", label: "Отправлено" },
  { value: "delivered", label: "Доставлено / получено" },
];

const RETURN_KIND_OPTIONS: Array<{ value: ReturnKind; label: string; hint: string }> = [
  { value: "return", label: "Возврат", hint: "Стандартный возврат от клиента" },
  { value: "correction", label: "Корректировка", hint: "Исправление по неотгруженным позициям" },
];

export default function OrderDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const orderId = Number.parseInt(id || "", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [shipmentStatusDraft, setShipmentStatusDraft] = useState<Record<number, ShipmentStatus>>({});
  const [returnKind, setReturnKind] = useState<ReturnKind>("return");
  const [returnNote, setReturnNote] = useState("");
  const [returnPrice, setReturnPrice] = useState("0");
  const [returnPayer, setReturnPayer] = useState<DeliveryPayer>("buyer");
  const [returnShippingMethodId, setReturnShippingMethodId] = useState<string>("");
  const [returnTrackNumber, setReturnTrackNumber] = useState("");
  const [returnItemIdsByItem, setReturnItemIdsByItem] = useState<Record<number, number[]>>({});
  const [returnBoxByItem, setReturnBoxByItem] = useState<Record<number, string>>({});

  const { data: order, isLoading } = useQuery<OrderDetails>({
    queryKey: [`/api/orders/${orderId}`],
    enabled: Number.isFinite(orderId),
  });

  const { data: shippingMethods = [] } = useQuery<ShippingMethod[]>({
    queryKey: ["/api/shipping-methods"],
  });

  useEffect(() => {
    if (!order) return;
    const next: Record<number, ShipmentStatus> = {};
    for (const shipment of order.shipments) {
      next[shipment.id] = shipment.status;
    }
    setShipmentStatusDraft(next);
    const initialReturnIds: Record<number, number[]> = {};
    const initialReturnBoxes: Record<number, string> = {};
    for (const item of order.items) {
      initialReturnIds[item.id] = [];
      initialReturnBoxes[item.id] = String(item.boxNumber || "").trim();
    }
    setReturnItemIdsByItem(initialReturnIds);
    setReturnBoxByItem(initialReturnBoxes);
  }, [order]);

  const invalidateRelated = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/orders/${orderId}`] });
    queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
    queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
    queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
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
  };

  const updateShipmentMutation = useMutation({
    mutationFn: async ({ shipmentId, status }: { shipmentId: number; status: ShipmentStatus }) => {
      const response = await apiRequest("PATCH", `/api/shipments/${shipmentId}/status`, { status });
      return response.json();
    },
    onSuccess: () => {
      invalidateRelated();
      toast({ title: "Статус отправки обновлен" });
    },
    onError: (error) => {
      toast({
        title: "Ошибка обновления статуса",
        description: error instanceof Error ? error.message : "Не удалось обновить статус",
        variant: "destructive",
      });
    },
  });

  const createReturnMutation = useMutation({
    mutationFn: async () => {
      if (!order) throw new Error("Заказ не загружен");
      const items = order.items
        .map((item) => ({
          orderItemId: item.id,
          itemIds: Array.isArray(returnItemIdsByItem[item.id]) ? returnItemIdsByItem[item.id] : [],
          qty: Array.isArray(returnItemIdsByItem[item.id]) ? returnItemIdsByItem[item.id].length : 0,
          maxQty: Math.max(0, item.qty - item.returnedQty),
          boxNumber: String(returnBoxByItem[item.id] || "").trim(),
        }))
        .filter((item) => item.qty > 0);

      if (items.length === 0) {
        throw new Error("Укажите количество хотя бы для одной позиции");
      }
      for (const item of items) {
        if (item.qty > item.maxQty) {
          throw new Error(`Для позиции #${item.orderItemId} превышено максимальное количество`);
        }
        if (!item.boxNumber) {
          throw new Error(`Выберите коробку для возврата позиции #${item.orderItemId}`);
        }
        if (!item.itemIds || item.itemIds.length !== item.qty) {
          throw new Error(`Для позиции #${item.orderItemId} нужно выбрать конкретные экземпляры (itemIds)`);
        }
      }

      const payload: Record<string, unknown> = {
        kind: returnKind,
        note: returnNote.trim() || null,
        returnPrice: returnPrice.trim() || "0",
        returnPayer: Number(returnPrice || 0) > 0 ? returnPayer : null,
        shippingMethodId: returnShippingMethodId ? Number(returnShippingMethodId) : null,
        trackNumber: returnTrackNumber.trim() || null,
        items: items.map((item) => ({
          orderItemId: item.orderItemId,
          qty: item.qty,
          boxNumber: item.boxNumber,
          itemIds: item.itemIds,
        })),
      };

      const response = await apiRequest("POST", `/api/orders/${order.id}/returns`, payload);
      return response.json();
    },
    onSuccess: () => {
      invalidateRelated();
      toast({ title: "Возврат оформлен" });
      setReturnNote("");
      setReturnPrice("0");
      setReturnPayer("buyer");
      setReturnShippingMethodId("");
      setReturnTrackNumber("");
      setReturnItemIdsByItem((prev) => {
        const reset: Record<number, number[]> = {};
        for (const key of Object.keys(prev)) reset[Number(key)] = [];
        return reset;
      });
    },
    onError: (error) => {
      toast({
        title: "Ошибка оформления возврата",
        description: error instanceof Error ? error.message : "Не удалось оформить возврат",
        variant: "destructive",
      });
    },
  });

  const totalReturnQty = useMemo(
    () => Object.values(returnItemIdsByItem).reduce((sum, ids) => sum + (Array.isArray(ids) ? ids.length : 0), 0),
    [returnItemIdsByItem]
  );

  if (!Number.isFinite(orderId)) {
    return (
      <Page title="Заказ" description="Некорректный номер заказа">
        <p className="text-sm text-muted-foreground">Некорректный номер заказа</p>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page title="Заказ" description="Загрузка заказа...">
        <p className="text-sm text-muted-foreground">Загрузка заказа...</p>
      </Page>
    );
  }

  if (!order) {
    return (
      <Page title="Заказ" description="Заказ не найден">
        <p className="text-sm text-muted-foreground">Заказ не найден</p>
      </Page>
    );
  }

  return (
    <Page
      title={`Заказ #${order.id}`}
      description={`Создан: ${formatDate(order.createdAt)}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/orders">
            <Button variant="outline">К заказам</Button>
          </Link>
          <Link href={`/customers/${order.customer.id}`}>
            <Button variant="outline">К клиенту</Button>
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Клиент</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Имя</p>
              <p className="font-semibold">{order.customer.name}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Телефон</p>
              <p>{order.customer.phone || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Заметка</p>
              <p>{order.customer.note || "—"}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Позиции заказа</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {order.items.map((item) => {
                const maxReturn = Math.max(0, item.qty - item.returnedQty);
                const soldItems = item.soldItems || [];
                const availableItems = soldItems.filter((i) => i.state === "sold");
                const selectedIds = new Set<number>((returnItemIdsByItem[item.id] || []).map(Number));
                return (
                  <div key={item.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-mono font-semibold">{item.smart}</p>
                        <p className="text-xs text-muted-foreground">{item.name || "—"}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Коробка:{" "}
                          <span className="font-mono font-semibold text-foreground">
                            {item.boxNumber || "—"}
                          </span>
                        </p>
                      </div>
                      <div className="text-sm text-right">
                        <p>{item.qty} шт × {item.salePrice} ₽</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Отправлено: {item.shippedQty} · Возвращено: {item.returnedQty}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 md:grid-cols-[320px_1fr] gap-3 items-start">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Куда положить</p>
                        <BoxSelector
                          mode="all"
                          value={returnBoxByItem[item.id] || null}
                          onSelect={(value) =>
                            setReturnBoxByItem((prev) => ({
                              ...prev,
                              [item.id]: value || "",
                            }))
                          }
                          placeholder="Выберите коробку..."
                          disabled={maxReturn === 0}
                          required={(returnItemIdsByItem[item.id] || []).length > 0}
                          data-testid={`select-return-box-${item.id}`}
                        />
                        <p className="text-xs text-muted-foreground mt-2">
                          Выбрано к возврату:{" "}
                          <span className="font-semibold text-foreground">
                            {(returnItemIdsByItem[item.id] || []).length}
                          </span>{" "}
                          / {maxReturn}
                        </p>
                      </div>

                      <div>
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-xs text-muted-foreground">
                            Экземпляры (можно вернуть максимум: {maxReturn} шт)
                          </p>
                          <div className="flex items-center gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const ids = availableItems.slice(0, maxReturn).map((i) => i.id);
                                setReturnItemIdsByItem((prev) => ({ ...prev, [item.id]: ids }));
                              }}
                              disabled={maxReturn === 0 || availableItems.length === 0}
                              data-testid={`button-return-select-all-${item.id}`}
                            >
                              Выбрать все
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setReturnItemIdsByItem((prev) => ({ ...prev, [item.id]: [] }));
                              }}
                              disabled={(returnItemIdsByItem[item.id] || []).length === 0}
                              data-testid={`button-return-clear-${item.id}`}
                            >
                              Очистить
                            </Button>
                          </div>
                        </div>

                        {soldItems.length === 0 ? (
                          <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">
                            Этот заказ создан без списка экземпляров (items). Возврат нельзя оформить безопасно.
                          </div>
                        ) : (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {soldItems.map((sold) => {
                              const disabled = maxReturn === 0 || sold.state !== "sold";
                              const checked = selectedIds.has(Number(sold.id));
                              return (
                                <button
                                  key={sold.id}
                                  type="button"
                                  className={[
                                    "inline-flex items-center gap-2 rounded-md border px-2 py-1 text-xs",
                                    disabled ? "opacity-60 cursor-not-allowed" : "hover:bg-muted/40",
                                  ].join(" ")}
                                  onClick={() => {
                                    if (disabled) return;
                                    const idNum = Number(sold.id);
                                    setReturnItemIdsByItem((prev) => {
                                      const current = new Set<number>((prev[item.id] || []).map(Number));
                                      if (current.has(idNum)) {
                                        current.delete(idNum);
                                      } else {
                                        if (current.size >= maxReturn) return prev;
                                        current.add(idNum);
                                      }
                                      return { ...prev, [item.id]: Array.from(current) };
                                    });
                                  }}
                                  data-testid={`button-toggle-return-item-${item.id}-${sold.id}`}
                                >
                                  <Checkbox checked={checked} disabled={disabled} className="pointer-events-none" />
                                  <span className="font-mono font-semibold">{sold.itemCode}</span>
                                  {sold.state !== "sold" ? (
                                    <span className="text-muted-foreground">(на складе)</span>
                                  ) : null}
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Отправки</CardTitle>
            <CardDescription>Обновляйте статусы отправок по мере продвижения заказа</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {order.shipments.length === 0 ? (
              <p className="text-sm text-muted-foreground">Отправок пока нет</p>
            ) : (
              order.shipments.map((shipment) => (
                <div key={shipment.id} className="rounded-md border p-4" data-testid={`card-shipment-${shipment.id}`}>
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold">Отправка #{shipment.id}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {shipment.shippingMethodName} · {shipment.trackNumber || "без трека"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Стоимость: {shipment.deliveryPrice} ₽ · Платит: {shipment.deliveryPayer || "—"}
                      </p>
                    </div>
                    <Badge variant={shipment.status === "pending" ? "secondary" : shipment.status === "shipped" ? "outline" : "default"}>
                      {shipment.status === "pending" && "Ожидает"}
                      {shipment.status === "shipped" && "Отправлено"}
                      {shipment.status === "delivered" && "Доставлено"}
                    </Badge>
                  </div>

                  <div className="mt-3 grid grid-cols-1 md:grid-cols-[260px_160px] gap-3">
                    <Select
                      value={shipmentStatusDraft[shipment.id] || shipment.status}
                      onValueChange={(value) =>
                        setShipmentStatusDraft((prev) => ({ ...prev, [shipment.id]: value as ShipmentStatus }))
                      }
                    >
                      <SelectTrigger data-testid={`select-shipment-status-${shipment.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SHIPMENT_STATUS_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      onClick={() =>
                        updateShipmentMutation.mutate({
                          shipmentId: shipment.id,
                          status: shipmentStatusDraft[shipment.id] || shipment.status,
                        })
                      }
                      disabled={updateShipmentMutation.isPending}
                      data-testid={`button-save-shipment-status-${shipment.id}`}
                    >
                      Обновить статус
                    </Button>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Оформить возврат / корректировку</CardTitle>
            <CardDescription>Поддерживаются и обычный возврат, и корректировка по неотгруженным позициям</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Тип</p>
                <Select value={returnKind} onValueChange={(value) => setReturnKind(value as ReturnKind)}>
                  <SelectTrigger data-testid="select-return-kind">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {RETURN_KIND_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  {RETURN_KIND_OPTIONS.find((option) => option.value === returnKind)?.hint}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Стоимость обратной доставки</p>
                <Input
                  type="number"
                  step="0.01"
                  min={0}
                  value={returnPrice}
                  onChange={(e) => setReturnPrice(e.target.value)}
                  data-testid="input-return-price"
                />
              </div>
              {Number(returnPrice || 0) > 0 && (
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Кто платит</p>
                  <Select value={returnPayer} onValueChange={(value) => setReturnPayer(value as DeliveryPayer)}>
                    <SelectTrigger data-testid="select-return-payer">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="buyer">Покупатель</SelectItem>
                      <SelectItem value="seller">Продавец</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Способ обратной доставки</p>
                <Select value={returnShippingMethodId} onValueChange={setReturnShippingMethodId}>
                  <SelectTrigger data-testid="select-return-shipping-method">
                    <SelectValue placeholder="Опционально" />
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
                <p className="text-xs text-muted-foreground mb-1">Трек обратной доставки</p>
                <Input
                  value={returnTrackNumber}
                  onChange={(e) => setReturnTrackNumber(e.target.value)}
                  placeholder="Опционально"
                  data-testid="input-return-track"
                />
              </div>
            </div>

            <div>
              <p className="text-xs text-muted-foreground mb-1">Заметка</p>
              <Textarea
                value={returnNote}
                onChange={(e) => setReturnNote(e.target.value)}
                rows={3}
                placeholder="Причина возврата/корректировки"
                data-testid="textarea-return-note"
              />
            </div>

            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">Выбрано к возврату: {totalReturnQty} шт</p>
              <Button
                onClick={() => createReturnMutation.mutate()}
                disabled={createReturnMutation.isPending}
                data-testid="button-create-return"
              >
                {createReturnMutation.isPending ? "Оформление..." : "Оформить возврат"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>История возвратов</CardTitle>
          </CardHeader>
          <CardContent>
            {order.returns.length === 0 ? (
              <p className="text-sm text-muted-foreground">Возвратов пока нет</p>
            ) : (
              <div className="space-y-3">
                {order.returns.map((ret) => (
                  <div key={ret.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold">
                          {ret.kind === "correction" ? "Корректировка" : "Возврат"} #{ret.id}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">{formatDate(ret.createdAt)}</p>
                      </div>
                      <Badge variant="outline">{ret.returnPrice} ₽</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-2">
                      Платит: {ret.returnPayer || "—"} · Доставка: {ret.shippingMethodName || "—"} · Трек: {ret.trackNumber || "—"}
                    </p>
                    <p className="text-sm mt-2">{ret.note || "Без заметки"}</p>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Финансовая сводка</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Выручка</p>
              <p className="text-lg font-semibold">{formatCurrency(order.financial.revenue)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Себестоимость</p>
              <p className="text-lg font-semibold">{formatCurrency(order.financial.cost)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Логистика (наш расход)</p>
              <p className="text-lg font-semibold">{formatCurrency(order.financial.deliveryCost)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Прибыль</p>
              <p className={`text-lg font-semibold ${order.financial.profit >= 0 ? "text-green-600" : "text-red-600"}`}>
                {formatCurrency(order.financial.profit)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
