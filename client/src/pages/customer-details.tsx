import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Page } from "@/components/page";
import type { Customer, OrderSummary } from "@shared/schema";

type CustomerDetailsResponse = {
  customer: Customer;
  orders: OrderSummary[];
  stats: {
    ordersCount: number;
    totalAmount: number;
    returnsCount: number;
  };
};

function parseStrictRouteId(value: string | undefined): number {
  const text = (value || "").trim();
  if (!/^\d+$/.test(text)) return Number.NaN;
  const parsed = Number(text);
  return Number.isSafeInteger(parsed) ? parsed : Number.NaN;
}

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

export default function CustomerDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const customerId = parseStrictRouteId(id);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<CustomerDetailsResponse>({
    queryKey: [`/api/customers/${customerId}`],
    enabled: Number.isFinite(customerId),
  });

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!data) return;
    setName(data.customer.name);
    setPhone(data.customer.phone || "");
    setNote(data.customer.note || "");
  }, [data?.customer.id, data?.customer.updatedAt]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!Number.isFinite(customerId)) throw new Error("Некорректный ID клиента");
      const normalizedName = name.trim();
      if (!normalizedName) {
        throw new Error("Имя клиента обязательно");
      }
      const response = await apiRequest("PATCH", `/api/customers/${customerId}`, {
        name: normalizedName,
        phone: phone.trim() || null,
        note: note.trim() || null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/customers/${customerId}`] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("/api/customers"),
      });
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("/api/orders"),
      });
      toast({ title: "Клиент обновлен" });
    },
    onError: (error) => {
      toast({
        title: "Ошибка обновления клиента",
        description: error instanceof Error ? error.message : "Не удалось обновить данные",
        variant: "destructive",
      });
    },
  });

  if (!Number.isFinite(customerId)) {
    return (
      <Page title="Клиент" description="Некорректный ID клиента">
        <p className="text-sm text-muted-foreground">Некорректный ID клиента</p>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page title="Клиент" description="Загрузка данных клиента...">
        <p className="text-sm text-muted-foreground">Загрузка данных клиента...</p>
      </Page>
    );
  }

  if (isError) {
    return (
      <Page title="Клиент" description="Ошибка загрузки клиента">
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Не удалось загрузить клиента"}</p>
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title="Клиент" description="Клиент не найден">
        <p className="text-sm text-muted-foreground">Клиент не найден</p>
      </Page>
    );
  }

  const customer = data.customer;

  return (
    <Page
      title={customer.name}
      description="Карточка клиента и история заказов"
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/customers">
            <Button variant="outline">К списку клиентов</Button>
          </Link>
          <Link href="/orders">
            <Button variant="outline">К заказам</Button>
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        {/* --- Данные клиента --- */}
        <Card className="border-dashed">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <i className="fas fa-user-pen text-sm"></i>
              </div>
              <CardTitle className="text-base">Данные клиента</CardTitle>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.5fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Имя <span className="text-destructive">*</span></label>
                <div className="relative">
                  <i className="fas fa-user absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-xs"></i>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Имя"
                    className="pl-8"
                    data-testid="input-edit-customer-name"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Телефон</label>
                <div className="relative">
                  <i className="fas fa-phone absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-xs"></i>
                  <Input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+7 999 123-45-67"
                    className="pl-8"
                    data-testid="input-edit-customer-phone"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Заметка</label>
                <div className="relative">
                  <i className="fas fa-comment absolute left-3 top-2.5 text-muted-foreground/50 text-xs"></i>
                  <Textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={1}
                    placeholder="Любая дополнительная информация"
                    className="pl-8 min-h-9 resize-none"
                    data-testid="textarea-edit-customer-note"
                  />
                </div>
              </div>
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending || !name.trim()}
                className="h-9 px-5"
                data-testid="button-save-customer"
              >
                <i className="fas fa-check mr-2 text-xs"></i>
                {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* --- Статистика --- */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-blue-500/10 text-blue-600">
                <i className="fas fa-box text-base"></i>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Заказов</p>
                <p className="text-2xl font-bold tracking-tight">{data.stats.ordersCount}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-600">
                <i className="fas fa-ruble-sign text-base"></i>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Сумма заказов</p>
                <p className="text-2xl font-bold tracking-tight">{formatCurrency(data.stats.totalAmount)}</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4 flex items-center gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-600">
                <i className="fas fa-rotate-left text-base"></i>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Возвратов</p>
                <p className="text-2xl font-bold tracking-tight">{data.stats.returnsCount}</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* --- Заказы клиента --- */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <i className="fas fa-cart-shopping text-sm"></i>
              </div>
              <CardTitle className="text-base">Заказы клиента</CardTitle>
              {data.orders.length > 0 && (
                <span className="ml-1 text-xs text-muted-foreground">({data.orders.length})</span>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {data.orders.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <i className="fas fa-inbox text-3xl mb-3 opacity-30"></i>
                <p className="text-sm">У клиента пока нет заказов</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.orders.map((order) => (
                  <Link
                    key={order.id}
                    href={`/orders/${order.id}`}
                    className="block"
                  >
                    <div
                      className="rounded-lg border p-3.5 flex items-center justify-between gap-4 transition-colors hover:bg-muted/50 cursor-pointer"
                      data-testid={`row-customer-order-${order.id}`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground font-bold text-sm">
                          #{order.id}
                        </div>
                        <div>
                          <p className="font-semibold text-sm">Заказ #{order.id}</p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatDate(order.createdAt)} · {order.positionsCount} поз., {order.totalQty} шт
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-semibold text-sm">{formatCurrency(order.itemsTotal)}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          <i className="fas fa-arrow-right text-[10px]"></i>
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
