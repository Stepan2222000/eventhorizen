import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Page } from "@/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BoxSelector } from "@/components/box-selector";
import { SmartSearch } from "@/components/smart-search";
import type { ItemInstance, ItemsResponse, ItemState } from "@shared/schema";

const LIMIT = 50;

const ALL_STATES_VALUE = "__ALL_STATES__/";

const STATE_OPTIONS: Array<{ value: ItemState | typeof ALL_STATES_VALUE; label: string }> = [
  { value: ALL_STATES_VALUE, label: "Все" },
  { value: "in_stock", label: "На складе" },
  { value: "sold", label: "Продано" },
  { value: "written_off", label: "Списано" },
];

function fetchItems(params: Record<string, string>) {
  const url = new URL("/api/items", window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return fetch(url.toString(), { credentials: "include" }).then(async (res) => {
    const text = await res.text();
    if (!res.ok) {
      let message = text || res.statusText;
      try {
        const json = JSON.parse(text);
        message = json.error || json.message || text;
      } catch { /* not JSON, use raw text */ }
      throw new Error(message);
    }
    return JSON.parse(text) as ItemsResponse;
  });
}

function getStateBadge(state: string) {
  if (state === "in_stock") return { label: "in_stock", variant: "default" as const };
  if (state === "sold") return { label: "sold", variant: "secondary" as const };
  if (state === "written_off") return { label: "written_off", variant: "destructive" as const };
  return { label: state || "—", variant: "outline" as const };
}

export default function ItemsPage() {
  const [q, setQ] = useState("");
  const [smart, setSmart] = useState("");
  const [box, setBox] = useState<string | null>(null);
  const [state, setState] = useState<"" | ItemState>("");
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    setOffset(0);
  }, [q, smart, box, state]);

  const query = useQuery<ItemsResponse>({
    queryKey: ["/api/items", q, smart, box, state, offset],
    queryFn: () =>
      fetchItems({
        q: q.trim(),
        smart: smart.trim(),
        boxNumber: String(box || "").trim(),
        state: state || "",
        limit: String(LIMIT),
        offset: String(offset),
      }),
  });

  const data = query.data;
  const items = data?.items || [];
  const total = data?.total || 0;

  const page = useMemo(() => Math.floor(offset / LIMIT) + 1, [offset]);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / LIMIT)), [total]);
  const hasPrev = offset > 0;
  const hasNext = offset + LIMIT < total;

  return (
    <Page
      title="Экземпляры"
      description="Каждая физическая запчасть (item)"
      actions={
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск: EH-000123 / SMART / заметка"
            className="w-full sm:w-72"
            data-testid="input-items-search"
          />
          <Select
            value={state || ALL_STATES_VALUE}
            onValueChange={(v) => setState(v === ALL_STATES_VALUE ? "" : (v as ItemState))}
          >
            <SelectTrigger className="w-full sm:w-48" data-testid="select-items-state">
              <SelectValue placeholder="Состояние" />
            </SelectTrigger>
            <SelectContent>
              {STATE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value || "__all__"} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Фильтры</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-1">SMART</p>
            <SmartSearch
              defaultValue={smart}
              onSelect={(result) => setSmart(result.smart)}
              onClear={() => setSmart("")}
              placeholder="Артикул или SMART..."
              limit={10}
              showName={false}
              showSelectedInfo={false}
              data-testid="input-items-smart"
            />
          </div>
          <div>
            <p className="text-xs text-muted-foreground mb-1">Коробка</p>
            <BoxSelector
              mode="all"
              value={box}
              onSelect={setBox}
              placeholder="Все коробки"
              data-testid="select-items-box"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="mt-6">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">
            Найдено: {total}
            <span className="text-muted-foreground font-normal"> · страница {page} из {totalPages}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {query.isLoading ? (
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          ) : query.isError ? (
            <p className="text-sm text-destructive">{String((query.error as Error)?.message || "Ошибка")}</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет экземпляров по заданным фильтрам</p>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">Item</TableHead>
                    <TableHead className="w-[140px]">SMART</TableHead>
                    <TableHead className="w-[120px]">Статус</TableHead>
                    <TableHead className="w-[140px]">Коробка</TableHead>
                    <TableHead>Заметка</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item: ItemInstance) => {
                    const badge = getStateBadge(item.state);
                    return (
                      <TableRow key={item.id} className="hover:bg-muted/40">
                        <TableCell className="font-mono font-semibold">
                          <Link href={`/items/${item.id}`} className="hover:underline" data-testid={`link-item-${item.id}`}>
                            {item.itemCode}
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono">{item.smart}</TableCell>
                        <TableCell>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </TableCell>
                        <TableCell className="font-mono">{item.boxNumber || "—"}</TableCell>
                        <TableCell className="max-w-[520px] truncate text-sm text-muted-foreground">{item.note || "—"}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <Button
              variant="outline"
              onClick={() => setOffset((v) => Math.max(0, v - LIMIT))}
              disabled={!hasPrev}
              data-testid="button-items-prev"
            >
              Назад
            </Button>
            <Button
              variant="outline"
              onClick={() => setOffset((v) => v + LIMIT)}
              disabled={!hasNext}
              data-testid="button-items-next"
            >
              Вперед
            </Button>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}
