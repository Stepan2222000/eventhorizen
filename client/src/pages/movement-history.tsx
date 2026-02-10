import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { Page } from "@/components/page";
import type { Movement } from "@shared/schema";

export default function MovementHistory() {
  const [filter, setFilter] = useState("");
  const [boxFilter, setBoxFilter] = useState<string>("");
  // Radix SelectItem value must be a non-empty string.
  // Use a sentinel that cannot collide with real box names (backend forbids '/').
  const ALL_BOXES_VALUE = "__ALL_BOXES__/";

  const { data: boxesData } = useQuery<{
    boxes: Array<{ name: string; isActive: boolean }>;
  }>({
    queryKey: ["/api/boxes"],
  });

  const { data: movements, isLoading } = useQuery({
    queryKey: ["/api/movements", boxFilter],
    queryFn: async ({ queryKey }) => {
      const [, box] = queryKey as [string, string];
      const url = box ? `/api/movements?boxNumber=${encodeURIComponent(box)}` : "/api/movements";
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        try {
          const json = JSON.parse(text);
          throw new Error(json.error || json.message || text);
        } catch {
          throw new Error(text);
        }
      }
      return await res.json();
    },
  });

  const filteredMovements = (movements as Movement[] || []).filter(movement =>
    movement.smart.toLowerCase().includes(filter.toLowerCase()) ||
    (movement.articles || []).join(", ").toLowerCase().includes(filter.toLowerCase()) ||
    movement.reason.toLowerCase().includes(filter.toLowerCase()) ||
    (movement.boxNumber && movement.boxNumber.toLowerCase().includes(filter.toLowerCase())) ||
    (movement.note && movement.note.toLowerCase().includes(filter.toLowerCase()))
  );

  const getReasonVariant = (reason: string) => {
    switch (reason) {
      case 'purchase': return 'default';
      case 'sale': return 'secondary';
      case 'return': return 'outline';
      case 'adjust': return 'secondary';
      case 'writeoff': return 'destructive';
      case 'transfer': return 'secondary';
      default: return 'secondary';
    }
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  };

  return (
    <Page
      title="История движений"
      description="Все изменения остатков"
      actions={
        <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
          <div className="relative">
            <Input
              placeholder="Фильтр (SMART/артикулы/коробка/причина/заметка)..."
              className="w-full pl-9 text-sm sm:w-72"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              data-testid="input-filter-movements"
            />
            <i className="fas fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs"></i>
          </div>
          <Select
            value={boxFilter || ALL_BOXES_VALUE}
            onValueChange={(value) => setBoxFilter(value === ALL_BOXES_VALUE ? "" : value)}
          >
            <SelectTrigger className="w-full sm:w-56" data-testid="select-filter-box">
              <SelectValue placeholder="Все коробки" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_BOXES_VALUE}>Все коробки</SelectItem>
              {(boxesData?.boxes || []).map((b) => (
                <SelectItem key={b.name} value={b.name}>
                  {b.name}{b.isActive ? "" : " (закрыта)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
    >
      <Card>
        <CardContent className="pt-6">
          <div className="rounded-md border">
            <Table>
                <TableHeader>
                    <TableRow>
                      <TableHead className="w-[140px]">Дата/Время</TableHead>
                      <TableHead className="w-[130px]">SMART</TableHead>
                      <TableHead className="w-[140px]">Коробка</TableHead>
                      <TableHead className="w-[220px]">Артикулы</TableHead>
                      <TableHead className="text-right w-[80px]">Кол-во Δ</TableHead>
                      <TableHead className="w-[100px]">Причина</TableHead>
                      <TableHead>Примечание</TableHead>
                    </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    [...Array(15)].map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredMovements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                        {filter ? "Нет совпадений с фильтром" : "Нет записанных движений"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredMovements.map((movement) => (
                      <TableRow key={movement.id} className="hover:bg-muted/50">
                        <TableCell className="text-sm font-mono">
                          {formatDateTime(movement.createdAt.toString())}
                        </TableCell>
                        <TableCell className="font-mono font-semibold">
                          {movement.smart}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono whitespace-nowrap">
                            {movement.reason === "transfer" && movement.note
                              ? `${movement.boxNumber || "—"} ${movement.note.split("·")[0].trim()}`
                              : (movement.boxNumber || "—")}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono">
                          {(movement.articles || []).length ? (movement.articles || []).join(", ") : "—"}
                        </TableCell>
                        <TableCell className="text-right">
                          <span className={`font-mono font-semibold ${
                            movement.qtyDelta >= 0 ? 'text-success' : 'text-destructive'
                          }`}>
                            {movement.qtyDelta >= 0 ? '+' : ''}{movement.qtyDelta}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getReasonVariant(movement.reason)} className="capitalize">
                            {movement.reason}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-sm text-muted-foreground">
                          {movement.note || "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
          </div>
            
          {!isLoading && (
            <div className="flex items-center justify-between px-2 py-4">
              <div className="text-sm text-muted-foreground">
                Показано <span className="font-semibold text-foreground">{filteredMovements.length}</span> движений
                {filter && <span> (отфильтровано из {(movements as Movement[] || []).length} всего)</span>}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </Page>
  );
}
