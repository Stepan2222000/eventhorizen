import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";

import { Page } from "@/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

type UnboxedRow = {
  smart: string;
  totalQty: number;
  boxedQty: number;
  unboxedQty: number;
  articles?: string[];
  name?: string | null;
};

export default function UnboxedPage() {
  const [filter, setFilter] = useState("");

  const { data = [], isLoading, isError, error } = useQuery<UnboxedRow[]>({
    queryKey: ["/api/unboxed"],
  });

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return data;
    return (data || []).filter((r) => {
      return (
        r.smart.toLowerCase().includes(q) ||
        (r.name || "").toLowerCase().includes(q) ||
        (r.articles || []).join(",").toLowerCase().includes(q)
      );
    });
  }, [data, filter]);

  return (
    <Page
      title="Товары без коробки"
      description="Позиции, у которых общий остаток не совпадает с суммой по коробкам (исторические данные)"
      actions={
        <div className="flex items-center gap-3">
          <div className="relative">
            <Input
              placeholder="Фильтр (SMART/артикулы/название)..."
              className="w-full pl-9 text-sm sm:w-72"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              data-testid="input-filter-unboxed"
            />
            <i className="fas fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs"></i>
          </div>
          <Link href="/boxes">
            <Button variant="outline">К коробкам</Button>
          </Link>
        </div>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle>Список позиций</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[140px]">SMART</TableHead>
                  <TableHead className="w-[240px]">Артикулы</TableHead>
                  <TableHead>Название</TableHead>
                  <TableHead className="text-right w-[110px]">Всего</TableHead>
                  <TableHead className="text-right w-[110px]">В коробках</TableHead>
                  <TableHead className="text-right w-[110px]">Разница</TableHead>
                  <TableHead className="text-right w-[90px]">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      Загрузка...
                    </TableCell>
                  </TableRow>
                ) : isError ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-destructive">
                      {error instanceof Error ? error.message : "Не удалось загрузить данные"}
                    </TableCell>
                  </TableRow>
                ) : filtered.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                      {filter ? "Нет совпадений" : "Нет расхождений"}
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.map((r) => (
                    <TableRow key={r.smart} className="hover:bg-muted/50">
                      <TableCell className="font-mono font-semibold">{r.smart}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {(r.articles || []).length ? (r.articles || []).join(", ") : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[420px] truncate">
                        {r.name || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono">{r.totalQty}</TableCell>
                      <TableCell className="text-right font-mono">{r.boxedQty}</TableCell>
                      <TableCell className="text-right font-mono font-semibold">
                        <Badge variant={r.unboxedQty >= 0 ? "outline" : "secondary"} className="font-mono">
                          {r.unboxedQty}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={`/stock/${encodeURIComponent(r.smart)}`}>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" data-testid={`button-open-${r.smart}`}>
                            <i className="fas fa-eye text-xs"></i>
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}
