import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
  const customerId = Number.parseInt(id || "", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<CustomerDetailsResponse>({
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
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
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
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Некорректный ID клиента</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Загрузка данных клиента...</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="p-8">
        <p className="text-sm text-muted-foreground">Клиент не найден</p>
      </div>
    );
  }

  const customer = data.customer;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{customer.name}</h1>
            <p className="text-sm text-muted-foreground mt-1">Карточка клиента и история заказов</p>
          </div>
          <div className="flex gap-2">
            <Link href="/customers">
              <Button variant="outline">К списку клиентов</Button>
            </Link>
            <Link href="/orders">
              <Button variant="outline">К заказам</Button>
            </Link>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Данные клиента</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Имя"
              data-testid="input-edit-customer-name"
            />
            <Input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="Телефон"
              data-testid="input-edit-customer-phone"
            />
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={1}
              placeholder="Заметка"
              data-testid="textarea-edit-customer-note"
            />
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={updateMutation.isPending}
              data-testid="button-save-customer"
            >
              {updateMutation.isPending ? "Сохранение..." : "Сохранить"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Статистика</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <p className="text-xs text-muted-foreground">Количество заказов</p>
              <p className="text-xl font-semibold">{data.stats.ordersCount}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Сумма заказов</p>
              <p className="text-xl font-semibold">{formatCurrency(data.stats.totalAmount)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Количество возвратов</p>
              <p className="text-xl font-semibold">{data.stats.returnsCount}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Заказы клиента</CardTitle>
          </CardHeader>
          <CardContent>
            {data.orders.length === 0 ? (
              <p className="text-sm text-muted-foreground">У клиента пока нет заказов</p>
            ) : (
              <div className="space-y-2">
                {data.orders.map((order) => (
                  <div
                    key={order.id}
                    className="rounded-md border p-3 flex items-center justify-between gap-4"
                    data-testid={`row-customer-order-${order.id}`}
                  >
                    <div>
                      <p className="font-semibold">Заказ #{order.id}</p>
                      <p className="text-xs text-muted-foreground mt-1">{formatDate(order.createdAt)}</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {order.positionsCount} поз., {order.totalQty} шт · {formatCurrency(order.itemsTotal)}
                      </p>
                    </div>
                    <Link href={`/orders/${order.id}`}>
                      <Button variant="outline" size="sm">
                        Открыть
                      </Button>
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
