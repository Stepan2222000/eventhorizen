import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import type { StockLevel, Movement } from "@shared/schema";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useQuery<{
    inStock: number;
    totalParts: number;
    movementsToday: number;
    salesToday: number;
  }>({
    queryKey: ["/api/dashboard/stats"],
  });

  const { data: stockLevels, isLoading: stockLoading } = useQuery({
    queryKey: ["/api/stock"],
  });

  const { data: movements, isLoading: movementsLoading } = useQuery({
    queryKey: ["/api/movements"],
  });

  const getStockStatus = (qty: number) => {
    if (qty === 0) return { label: "Нет в наличии", variant: "destructive" as const, icon: "fas fa-circle-xmark" };
    if (qty <= 10) return { label: "Мало", variant: "secondary" as const, icon: "fas fa-triangle-exclamation" };
    return { label: "В наличии", variant: "default" as const, icon: "fas fa-circle" };
  };

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

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8">
        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-lg bg-success/10 flex items-center justify-center">
                  <i className="fas fa-boxes-stacked text-success text-xl"></i>
                </div>
                <Badge variant="secondary" className="bg-success/10 text-success">
                  <i className="fas fa-check mr-1"></i>
                  Склад
                </Badge>
              </div>
              {statsLoading ? (
                <Skeleton className="h-8 w-20 mb-1" />
              ) : (
                <h3 className="text-2xl font-bold text-foreground mb-1 font-mono">{stats?.inStock || 0}</h3>
              )}
              <p className="text-sm text-muted-foreground">Позиций в наличии</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center">
                  <i className="fas fa-cubes text-primary text-xl"></i>
                </div>
                <Badge variant="secondary" className="bg-primary/10 text-primary">
                  <i className="fas fa-warehouse mr-1"></i>
                  Всего
                </Badge>
              </div>
              {statsLoading ? (
                <Skeleton className="h-8 w-20 mb-1" />
              ) : (
                <h3 className="text-2xl font-bold text-foreground mb-1 font-mono">{stats?.totalParts || 0}</h3>
              )}
              <p className="text-sm text-muted-foreground">Запчастей на складе</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-lg bg-secondary/10 flex items-center justify-center">
                  <i className="fas fa-clock text-secondary text-xl"></i>
                </div>
                <Badge variant="secondary" className="bg-muted text-muted-foreground">
                  Сегодня
                </Badge>
              </div>
              {statsLoading ? (
                <Skeleton className="h-8 w-20 mb-1" />
              ) : (
                <h3 className="text-2xl font-bold text-foreground mb-1 font-mono">{stats?.movementsToday || 0}</h3>
              )}
              <p className="text-sm text-muted-foreground">Движений сегодня</p>
            </CardContent>
          </Card>

          <Card className="hover:shadow-lg transition-shadow">
            <CardContent className="p-6">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-lg bg-orange-500/10 flex items-center justify-center">
                  <i className="fas fa-cash-register text-orange-500 text-xl"></i>
                </div>
                <Badge variant="secondary" className="bg-orange-500/10 text-orange-500">
                  Сегодня
                </Badge>
              </div>
              {statsLoading ? (
                <Skeleton className="h-8 w-20 mb-1" />
              ) : (
                <h3 className="text-2xl font-bold text-foreground mb-1 font-mono">{stats?.salesToday || 0}</h3>
              )}
              <p className="text-sm text-muted-foreground">Продаж сегодня</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* Stock Levels Preview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-foreground">Текущие остатки</div>
                  <CardDescription>Топ позиций на складе</CardDescription>
                </div>
                <Link href="/stock">
                  <Button variant="ghost" size="sm" data-testid="link-view-all-stock">
                    Все остатки
                    <i className="fas fa-arrow-right ml-2"></i>
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {stockLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded border">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-6 w-16" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {(stockLevels as StockLevel[] || []).slice(0, 5).map((item) => {
                    const status = getStockStatus(item.totalQty);
                    return (
                      <div key={item.smart} className="flex items-center justify-between p-3 rounded border hover:bg-muted/50 transition-colors">
                        <div>
                          <div className="font-mono font-semibold text-sm">{item.smart}</div>
                          <div className="text-xs text-muted-foreground">
                            {item.description?.length ? item.description.join(", ") : "—"}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono font-semibold">{item.totalQty}</div>
                          <Badge variant={status.variant} className="text-xs">
                            <i className={`${status.icon} text-xs mr-1`}></i>
                            {status.label}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Movements */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-foreground">Последние движения</div>
                  <CardDescription>Недавние изменения остатков</CardDescription>
                </div>
                <Link href="/history">
                  <Button variant="ghost" size="sm" data-testid="link-view-all-movements">
                    Вся история
                    <i className="fas fa-arrow-right ml-2"></i>
                  </Button>
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {movementsLoading ? (
                <div className="space-y-3">
                  {[...Array(5)].map((_, i) => (
                    <div key={i} className="flex items-center justify-between p-3 rounded border">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                      <Skeleton className="h-6 w-16" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="space-y-3">
                  {(movements as Movement[] || []).slice(0, 5).map((movement) => (
                    <div key={movement.id} className="flex items-center justify-between p-3 rounded border hover:bg-muted/50 transition-colors">
                      <div>
                        <div className="font-mono font-semibold text-sm">{movement.smart}</div>
                        <div className="text-xs text-muted-foreground">
                          {new Date(movement.createdAt).toLocaleString()}
                        </div>
                      </div>
                      <div className="text-right space-y-1">
                        <div className={`font-mono font-semibold ${movement.qtyDelta >= 0 ? 'text-success' : 'text-destructive'}`}>
                          {movement.qtyDelta >= 0 ? '+' : ''}{movement.qtyDelta}
                        </div>
                        <Badge variant={getReasonVariant(movement.reason)} className="text-xs">
                          {movement.reason}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
