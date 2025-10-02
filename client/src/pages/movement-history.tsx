import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import type { Movement } from "@shared/schema";

export default function MovementHistory() {
  const [filter, setFilter] = useState("");

  const { data: movements, isLoading } = useQuery({
    queryKey: ["/api/movements"],
  });

  const filteredMovements = (movements as Movement[] || []).filter(movement =>
    movement.smart.toLowerCase().includes(filter.toLowerCase()) ||
    movement.article.toLowerCase().includes(filter.toLowerCase()) ||
    movement.reason.toLowerCase().includes(filter.toLowerCase()) ||
    (movement.note && movement.note.toLowerCase().includes(filter.toLowerCase()))
  );

  const getReasonVariant = (reason: string) => {
    switch (reason) {
      case 'purchase': return 'default';
      case 'sale': return 'secondary';
      case 'return': return 'outline';
      case 'adjust': return 'secondary';
      case 'writeoff': return 'destructive';
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
    <div className="flex-1 overflow-y-auto">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <h2 className="text-2xl font-bold text-foreground">История движений</h2>
          <p className="text-sm text-muted-foreground mt-1">Полный аудит всех движений товаров</p>
        </div>
      </header>

      <div className="p-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Все движения</CardTitle>
              <div className="relative">
                <Input
                  placeholder="Фильтр движений..."
                  className="w-64 pl-9 text-sm"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  data-testid="input-filter-movements"
                />
                <i className="fas fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs"></i>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">Дата/Время</TableHead>
                    <TableHead className="w-[130px]">SMART</TableHead>
                    <TableHead className="w-[150px]">Артикул</TableHead>
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
                        <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-12 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-16" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredMovements.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
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
                        <TableCell className="font-mono">
                          {movement.article}
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
      </div>
    </div>
  );
}
