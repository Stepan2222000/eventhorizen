import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Page } from "@/components/page";
import type { Customer } from "@shared/schema";

export default function CustomersPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");

  const queryKey = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("query", search.trim());
    if (showArchived) params.set("includeArchived", "1");
    const qs = params.toString();
    return qs ? `/api/customers?${qs}` : "/api/customers";
  }, [search, showArchived]);

  const { data: customers = [], isLoading } = useQuery<Customer[]>({
    queryKey: [queryKey],
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      if (!name.trim()) throw new Error("Имя клиента обязательно");
      const response = await apiRequest("POST", "/api/customers", {
        name: name.trim(),
        phone: phone.trim() || null,
        note: note.trim() || null,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      setName("");
      setPhone("");
      setNote("");
      toast({ title: "Клиент добавлен" });
    },
    onError: (error) => {
      toast({
        title: "Ошибка добавления клиента",
        description: error instanceof Error ? error.message : "Не удалось создать клиента",
        variant: "destructive",
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async ({ id, archived }: { id: number; archived: boolean }) => {
      const response = await apiRequest("PATCH", `/api/customers/${id}`, { archived });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/customers"] });
      queryClient.invalidateQueries({ queryKey: [queryKey] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("/api/orders"),
      });
      toast({ title: "Статус клиента обновлен" });
    },
    onError: (error) => {
      toast({
        title: "Ошибка обновления клиента",
        description: error instanceof Error ? error.message : "Не удалось обновить клиента",
        variant: "destructive",
      });
    },
  });

  return (
    <Page
      title="Клиенты"
      description="Поиск, добавление и архивирование клиентов"
      actions={
        <Link href="/orders">
          <Button variant="outline">
            <i className="fas fa-cart-shopping mr-2"></i>
            К заказам
          </Button>
        </Link>
      }
    >
      <div className="space-y-6">
        <Card className="border-dashed">
          <CardContent className="pt-5 pb-4">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <i className="fas fa-user-plus text-sm"></i>
              </div>
              <CardTitle className="text-base">Новый клиент</CardTitle>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_1.5fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Имя <span className="text-destructive">*</span></label>
                <div className="relative">
                  <i className="fas fa-user absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/50 text-xs"></i>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Иван Иванов"
                    className="pl-8"
                    data-testid="input-customer-name"
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
                    data-testid="input-customer-phone"
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
                    placeholder="Любая дополнительная информация"
                    rows={1}
                    className="pl-8 min-h-9 resize-none"
                    data-testid="textarea-customer-note"
                  />
                </div>
              </div>
              <Button
                onClick={() => createMutation.mutate()}
                disabled={createMutation.isPending || !name.trim()}
                className="h-9 px-5"
                data-testid="button-create-customer"
              >
                <i className="fas fa-plus mr-2 text-xs"></i>
                {createMutation.isPending ? "Сохранение..." : "Создать"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-4">
              <div>
                <CardTitle>Список клиентов</CardTitle>
                <CardDescription>Нажмите на клиента, чтобы открыть его заказы и статистику</CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Поиск по имени или телефону"
                  className="w-full sm:w-72"
                  data-testid="input-customers-search"
                />
                <Button
                  variant={showArchived ? "default" : "outline"}
                  onClick={() => setShowArchived((prev) => !prev)}
                  data-testid="button-toggle-archived-customers"
                >
                  {showArchived ? "Скрыть архив" : "Показать архив"}
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <p className="text-sm text-muted-foreground">Загрузка клиентов...</p>
            ) : customers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Клиенты не найдены</p>
            ) : (
              <div className="space-y-2">
                {customers.map((customer) => (
                  <div
                    key={customer.id}
                    className="rounded-md border p-3 flex items-center justify-between gap-4"
                    data-testid={`row-customer-${customer.id}`}
                  >
                    <Link href={`/customers/${customer.id}`} className="flex-1">
                      <div>
                        <p className="font-semibold">{customer.name}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {customer.phone || "телефон не указан"} · {customer.note || "без заметки"}
                        </p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-2">
                      {customer.archivedAt && <Badge variant="outline">Архив</Badge>}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => archiveMutation.mutate({ id: customer.id, archived: !customer.archivedAt })}
                        disabled={archiveMutation.isPending}
                        data-testid={`button-toggle-customer-archive-${customer.id}`}
                      >
                        {customer.archivedAt ? "Разархивировать" : "Архивировать"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
