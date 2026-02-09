import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Page } from "@/components/page";
import type { StockLevel } from "@shared/schema";

type SortKey = "smart" | "qty";
type SortDirection = "asc" | "desc";

export default function StockLevels() {
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("smart");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const { toast } = useToast();

  const { data: stockLevels, isLoading } = useQuery({
    queryKey: ["/api/stock"],
  });

  const filteredStock = (stockLevels as StockLevel[] || []).filter(item => {
    const filterLower = filter.toLowerCase();
    const matchesBrand = (item.brand || []).some((b) => b.toLowerCase().includes(filterLower));
    const matchesDescription = (item.description || []).some((d) => d.toLowerCase().includes(filterLower));
    const matchesArticles = (item.articles || []).some((a) => a.toLowerCase().includes(filterLower));
    const matchesName = (item.name || "").toLowerCase().includes(filterLower);
    
    return item.smart.toLowerCase().includes(filterLower) ||
      matchesBrand ||
      matchesDescription ||
      matchesArticles ||
      matchesName;
  });

  const getStockStatus = (qty: number) => {
    if (qty === 0) return { label: "Нет в наличии", variant: "destructive" as const, icon: "fas fa-circle-xmark" };
    if (qty <= 10) return { label: "Мало", variant: "secondary" as const, icon: "fas fa-triangle-exclamation" };
    return { label: "В наличии", variant: "default" as const, icon: "fas fa-circle" };
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    setSortDirection(key === "qty" ? "desc" : "asc");
  };

  const getSortIcon = (key: SortKey) => {
    if (sortKey !== key) return "fas fa-sort";
    return sortDirection === "asc" ? "fas fa-sort-up" : "fas fa-sort-down";
  };

  const sortedStock = [...filteredStock].sort((a, b) => {
    if (sortKey === "qty") {
      const diff = a.totalQty - b.totalQty;
      return sortDirection === "asc" ? diff : -diff;
    }
    const diff = a.smart.localeCompare(b.smart, "ru-RU", { sensitivity: "base" });
    return sortDirection === "asc" ? diff : -diff;
  });

  const exportToCsv = () => {
    if (sortedStock.length === 0) {
      toast({
        title: "Нет данных для экспорта",
        description: "Добавьте или снимите фильтр, чтобы экспортировать остатки",
        variant: "destructive",
      });
      return;
    }

    const headers = ["SMART", "Бренд", "Описание", "Количество", "Статус"];
    const rows = sortedStock.map((item) => {
      const status = getStockStatus(item.totalQty).label;
      return [
        item.smart,
        (item.brand || []).join(", "),
        (item.description || []).join(", "),
        String(item.totalQty),
        status,
      ];
    });

    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const csv = [headers, ...rows].map((row) => row.map(escapeCsv).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = window.URL.createObjectURL(blob);

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const link = document.createElement("a");
    link.href = url;
    link.download = `stock-levels-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);

    toast({
      title: "Экспорт выполнен",
      description: `Выгружено позиций: ${sortedStock.length}`,
    });
  };

  return (
    <Page
      title="Остатки"
      description="Текущие остатки по SMART коду"
      actions={
        <div className="flex items-center gap-3">
          <div className="relative">
            <Input
              placeholder="Фильтр (SMART/артикулы/бренд/описание)..."
              className="w-full pl-9 text-sm sm:w-72"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              data-testid="input-filter-stock"
            />
            <i className="fas fa-filter absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs"></i>
          </div>
          <Button variant="secondary" size="sm" data-testid="button-export-stock" onClick={exportToCsv}>
            <i className="fas fa-download mr-2"></i>
            Экспорт
          </Button>
        </div>
      }
    >
      <Card>
        <CardContent className="pt-6">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[150px]">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 font-medium"
                        data-testid="button-sort-smart"
                        onClick={() => toggleSort("smart")}
                      >
                        SMART код
                        <i className={`${getSortIcon("smart")} text-xs ml-2`}></i>
                      </Button>
                    </TableHead>
                    <TableHead>Бренд</TableHead>
                    <TableHead>Описание</TableHead>
                    <TableHead className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-auto p-0 font-medium ml-auto"
                        data-testid="button-sort-qty"
                        onClick={() => toggleSort("qty")}
                      >
                        Кол-во
                        <i className={`${getSortIcon("qty")} text-xs ml-2`}></i>
                      </Button>
                    </TableHead>
                    <TableHead className="text-center">Статус</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading ? (
                    [...Array(10)].map((_, i) => (
                      <TableRow key={i}>
                        <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-40" /></TableCell>
                        <TableCell><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                        <TableCell><Skeleton className="h-6 w-20 mx-auto" /></TableCell>
                        <TableCell><Skeleton className="h-8 w-16 ml-auto" /></TableCell>
                      </TableRow>
                    ))
                  ) : filteredStock.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                        {filter ? "Нет совпадений с фильтром" : "Нет данных об остатках"}
                      </TableCell>
                    </TableRow>
                  ) : (
                    sortedStock.map((item) => {
                      const status = getStockStatus(item.totalQty);
                      return (
                        <TableRow key={item.smart} className="hover:bg-muted/50">
                          <TableCell className="font-mono font-semibold">{item.smart}</TableCell>
                          <TableCell>{item.brand?.length ? item.brand.join(", ") : "—"}</TableCell>
                          <TableCell className="max-w-xs truncate">
                            {item.description?.length ? item.description.join(", ") : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono font-semibold">{item.totalQty}</TableCell>
                          <TableCell className="text-center">
                            <Badge variant={status.variant} className="text-xs">
                              <i className={`${status.icon} text-xs mr-1`}></i>
                              {status.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link href={`/stock/${item.smart}`}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  data-testid={`button-view-${item.smart}`}
                                >
                                  <i className="fas fa-eye text-xs"></i>
                                </Button>
                              </Link>
                              <Link href={`/movement?smart=${encodeURIComponent(item.smart)}`}>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  data-testid={`button-add-movement-${item.smart}`}
                                >
                                  <i className="fas fa-plus text-xs"></i>
                                </Button>
                              </Link>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
            
            {!isLoading && (
              <div className="flex items-center justify-between px-2 py-4">
                <div className="text-sm text-muted-foreground">
                  Показано <span className="font-semibold text-foreground">{filteredStock.length}</span> позиций
                  {filter && <span> (отфильтровано из {(stockLevels as StockLevel[] || []).length} всего)</span>}
                </div>
              </div>
            )}
        </CardContent>
      </Card>
    </Page>
  );
}
