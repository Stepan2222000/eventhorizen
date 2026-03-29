import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";

import { Page } from "@/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

type BoxRow = {
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  positionsCount: number;
  totalQty: number;
  lastMovementAt: string | null;
};

type BoxesResponse = {
  boxes: BoxRow[];
  unboxed: { positionsCount: number; totalQty: number };
  overboxed?: { positionsCount: number; totalQty: number };
};

function formatDate(value: string) {
  return new Date(value).toLocaleString("ru-RU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function BoxesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const { data, isLoading, isError, error } = useQuery<BoxesResponse>({
    queryKey: ["/api/boxes"],
  });

  const boxes = Array.isArray(data?.boxes) ? data!.boxes : [];
  const unboxed = data?.unboxed || { positionsCount: 0, totalQty: 0 };
  const overboxed = data?.overboxed || { positionsCount: 0, totalQty: 0 };

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return boxes;
    return boxes.filter((b) => {
      return (
        b.name.toLowerCase().includes(q) ||
        (b.description || "").toLowerCase().includes(q)
      );
    });
  }, [boxes, filter]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: newName.trim(),
        description: newDescription.trim() || null,
      };
      const res = await apiRequest("POST", "/api/boxes", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/boxes"] });
      // BoxSelector uses this query key; staleTime is Infinity so we must invalidate explicitly.
      queryClient.invalidateQueries({ queryKey: ["/api/boxes?activeOnly=1"] });
      toast({ title: "Коробка создана" });
      setCreateOpen(false);
      setNewName("");
      setNewDescription("");
    },
    onError: (error) => {
      toast({
        title: "Не удалось создать коробку",
        description: error instanceof Error ? error.message : "Ошибка",
        variant: "destructive",
      });
    },
  });

  return (
    <Page
      title="Коробки"
      description="Реестр мест хранения и текущее содержимое"
      actions={
        <div className="flex items-center gap-3">
          <div className="relative">
            <Input
              placeholder="Фильтр по имени/описанию..."
              className="w-full pl-9 text-sm sm:w-72"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              data-testid="input-filter-boxes"
            />
            <i className="fas fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs"></i>
          </div>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-create-box">
                <i className="fas fa-plus mr-2"></i>
                Создать коробку
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Новая коробка</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Имя (уникально)</p>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Например: K-4, ПОЛКА-3"
                    data-testid="input-new-box-name"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Описание</p>
                  <Textarea
                    value={newDescription}
                    onChange={(e) => setNewDescription(e.target.value)}
                    placeholder="Опционально"
                    rows={3}
                    data-testid="textarea-new-box-description"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => createMutation.mutate()}
                  disabled={createMutation.isPending}
                  data-testid="button-submit-create-box"
                >
                  {createMutation.isPending ? "Создание..." : "Создать"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Список коробок</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">Коробка</TableHead>
                  <TableHead>Описание</TableHead>
                  <TableHead className="text-right w-[140px]">SMART позиций</TableHead>
                  <TableHead className="text-right w-[120px]">Штук</TableHead>
                  <TableHead className="w-[180px]">Последняя активность</TableHead>
                  <TableHead className="w-[110px]">Статус</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Загрузка...
                    </TableCell>
                  </TableRow>
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-destructive">
                      {error instanceof Error ? error.message : "Не удалось загрузить список коробок"}
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      {filter ? "Нет совпадений" : "Пока нет коробок"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((b) => (
                    <TableRow key={b.name} className="hover:bg-muted/50">
                      <TableCell className="font-mono font-semibold">
                        <Link href={`/boxes/${encodeURIComponent(b.name)}`}>
                          <a className="hover:underline" data-testid={`link-box-${b.name}`}>{b.name}</a>
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[420px] truncate">
                        {b.description || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">{b.positionsCount}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">{b.totalQty}</TableCell>
                      <TableCell className="text-sm">
                        {b.lastMovementAt ? formatDate(b.lastMovementAt) : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={b.isActive ? "default" : "secondary"}>
                          {b.isActive ? "Активна" : "Закрыта"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}

                {!isLoading && !isError && (
                  <TableRow className="bg-muted/30 hover:bg-muted/40">
                    <TableCell className="font-semibold">
                      <Link href="/boxes/unboxed">
                        <a className="hover:underline" data-testid="link-unboxed-row">Товары без коробки</a>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      Остаток есть, но не привязан к коробкам (исторические данные)
                    </TableCell>
                    <TableCell className="text-right font-mono">{unboxed.positionsCount}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{unboxed.totalQty}</TableCell>
                    <TableCell className="text-sm">—</TableCell>
                    <TableCell>
                      <Badge variant="outline">Сводка</Badge>
                    </TableCell>
                  </TableRow>
                )}

                {!isLoading && !isError && (overboxed.positionsCount > 0 || overboxed.totalQty > 0) && (
                  <TableRow className="bg-destructive/5 hover:bg-destructive/10">
                    <TableCell className="font-semibold">
                      <Link href="/boxes/unboxed">
                        <a className="hover:underline" data-testid="link-overboxed-row">Расхождение распределения</a>
                      </Link>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      В коробках числится больше, чем общий остаток (старые продажи/списания без коробки)
                    </TableCell>
                    <TableCell className="text-right font-mono">{overboxed.positionsCount}</TableCell>
                    <TableCell className="text-right font-mono font-semibold">{overboxed.totalQty}</TableCell>
                    <TableCell className="text-sm">—</TableCell>
                    <TableCell>
                      <Badge variant="destructive">Ошибка</Badge>
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}
