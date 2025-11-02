import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Movement } from "@shared/schema";
import { format } from "date-fns";

export default function StockDetails() {
  const { smart } = useParams();
  const { toast } = useToast();
  const [editingCell, setEditingCell] = useState<{id: number, field: 'purchasePrice' | 'note' | 'qtyDelta' | 'boxNumber'} | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const { data: purchasesData, isLoading } = useQuery<Movement[]>({
    queryKey: [`/api/stock/${smart}/purchases`],
    enabled: !!smart,
  });

  // Ensure purchases is always an array
  const purchases = Array.isArray(purchasesData) ? purchasesData : [];

  // Fetch sales analytics
  const { data: salesData, isLoading: salesLoading } = useQuery<{
    sales: (Movement & { profit: number; profitMarginPercent: number; daysFromPurchase: number | null; purchasePriceUsed: number })[];
    metrics: {
      averageDaysToSell: number;
      soldQuantity: number;
      totalPurchased: number;
      sellThroughRate: number;
      averageProfitPerUnit: number;
      averageProfitMarginPercent: number;
    };
  }>({
    queryKey: [`/api/stock/${smart}/sales`],
    enabled: !!smart,
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: 'purchasePrice' | 'note' | 'qtyDelta' | 'boxNumber'; value: string | number | null }) => {
      const payload: any = {};
      if (field === 'qtyDelta') {
        const numValue = parseInt(value as string);
        if (!value || isNaN(numValue) || numValue <= 0) {
          throw new Error('Количество должно быть положительным числом');
        }
        payload[field] = numValue;
      } else {
        payload[field] = value;
      }
      return await apiRequest('PATCH', `/api/movements/${id}`, payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${smart}/purchases`] });
      toast({
        title: "Сохранено",
        description: "Изменения успешно сохранены",
      });
      setEditingCell(null);
    },
    onError: (error: any) => {
      toast({
        title: "Ошибка",
        description: error.message || "Не удалось сохранить изменения",
        variant: "destructive",
      });
    },
  });

  const handleEditStart = (id: number, field: 'purchasePrice' | 'note' | 'qtyDelta' | 'boxNumber', currentValue: string | number | null) => {
    setEditingCell({ id, field });
    setEditValue(currentValue?.toString() || "");
  };

  const handleEditCancel = () => {
    setEditingCell(null);
    setEditValue("");
  };

  const handleEditSave = () => {
    if (editingCell) {
      updateMutation.mutate({
        id: editingCell.id,
        field: editingCell.field,
        value: editValue || null,
      });
    }
  };

  const getTotalPrice = (purchase: Movement) => {
    if (!purchase.purchasePrice) return null;
    const price = parseFloat(purchase.purchasePrice);
    const qty = Math.abs(purchase.qtyDelta);
    return (price * qty).toFixed(2);
  };

  if (!smart) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-muted-foreground">SMART код не указан</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto bg-background">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Link href="/" className="hover:text-foreground transition-colors">
              Главная
            </Link>
            <span>/</span>
            <Link href="/stock" className="hover:text-foreground transition-colors">
              Остатки
            </Link>
            <span>/</span>
            <span className="text-foreground">{smart}</span>
          </div>
          <h2 className="text-2xl font-bold text-foreground">Детали по SMART коду</h2>
          <p className="text-sm text-muted-foreground mt-1">Просмотр покупок, продаж и аналитики доходности</p>
        </div>
      </header>

      <div className="p-8 max-w-7xl mx-auto">
        <Card className="bg-card border-border mb-6">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground mb-1">SMART КОД</p>
                <h3 className="text-3xl font-mono font-bold text-foreground">{smart}</h3>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  navigator.clipboard.writeText(smart);
                  toast({
                    title: "Скопировано",
                    description: "SMART код скопирован в буфер обмена",
                  });
                }}
                data-testid="button-copy-smart"
              >
                <i className="fas fa-copy"></i>
              </Button>
            </div>
          </CardHeader>
          {purchases && purchases.length > 0 && (
            <CardContent>
              <div className="grid grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Всего покупок</p>
                  <p className="text-2xl font-semibold text-foreground">{purchases.length}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Общее количество</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {purchases.reduce((sum, p) => sum + Math.abs(p.qtyDelta), 0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Средняя цена</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {purchases.filter(p => p.purchasePrice).length > 0
                      ? (purchases
                          .filter(p => p.purchasePrice)
                          .reduce((sum, p) => sum + parseFloat(p.purchasePrice!), 0) /
                          purchases.filter(p => p.purchasePrice).length).toFixed(2)
                      : "—"} ₽
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Всего затрат</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {purchases
                      .filter(p => p.purchasePrice)
                      .reduce((sum, p) => {
                        const price = parseFloat(p.purchasePrice!);
                        const qty = Math.abs(p.qtyDelta);
                        return sum + (price * qty);
                      }, 0)
                      .toFixed(2)} ₽
                  </p>
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>История покупок</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : !purchases || purchases.length === 0 ? (
              <div className="text-center py-12">
                <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-muted mb-4">
                  <i className="fas fa-box-open text-2xl text-muted-foreground"></i>
                </div>
                <p className="text-muted-foreground mb-4">Нет записей о покупках</p>
                <Link href="/movement">
                  <Button data-testid="button-add-first-purchase">
                    <i className="fas fa-plus mr-2"></i>
                    Добавить первую покупку
                  </Button>
                </Link>
              </div>
            ) : (
              <>
                <div className="relative max-h-[300px] overflow-auto border rounded-md">
                  <table className="w-full caption-bottom text-sm">
                    <thead className="[&_tr]:border-b bg-muted/50">
                      <tr className="border-b transition-colors">
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-[120px]">Дата</th>
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-[180px]">Артикул</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground w-[100px]">Кол-во</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground w-[150px]">Цена закупа</th>
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground min-w-[200px]">Комментарий</th>
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-[100px]">Номер коробки</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground w-[120px]">Итого</th>
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                      {purchases.map((purchase) => (
                        <tr 
                          key={purchase.id} 
                          className="hover:bg-muted/50 transition-colors border-b"
                          data-testid={`row-purchase-${purchase.id}`}
                        >
                          <td className="p-4 align-middle font-mono text-sm whitespace-nowrap">
                            {format(new Date(purchase.createdAt), "dd.MM.yyyy")}
                          </td>
                          <td className="p-4 align-middle font-mono whitespace-nowrap">{purchase.article}</td>
                          <td className="p-4 align-middle text-right">
                            {editingCell?.id === purchase.id && editingCell.field === 'qtyDelta' ? (
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  type="number"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="w-20 border-2 border-primary font-mono text-right h-8"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleEditSave();
                                    if (e.key === 'Escape') handleEditCancel();
                                  }}
                                  data-testid={`input-edit-qty-${purchase.id}`}
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={handleEditSave}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-save-qty-${purchase.id}`}
                                >
                                  <i className="fas fa-check text-green-500 text-xs"></i>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={handleEditCancel}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-cancel-qty-${purchase.id}`}
                                >
                                  <i className="fas fa-times text-red-500 text-xs"></i>
                                </Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleEditStart(purchase.id, 'qtyDelta', Math.abs(purchase.qtyDelta))}
                                className="w-full text-right font-mono font-semibold hover:bg-muted px-2 py-1 rounded transition-colors group"
                                data-testid={`button-edit-qty-${purchase.id}`}
                              >
                                <span>{Math.abs(purchase.qtyDelta)}</span>
                                <i className="fas fa-edit text-xs ml-1 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                              </button>
                            )}
                          </td>
                          <td className="p-4 align-middle text-right">
                            {editingCell?.id === purchase.id && editingCell.field === 'purchasePrice' ? (
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  type="number"
                                  step="0.01"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="w-28 border-2 border-primary font-mono text-right h-8"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleEditSave();
                                    if (e.key === 'Escape') handleEditCancel();
                                  }}
                                  data-testid={`input-edit-price-${purchase.id}`}
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={handleEditSave}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-save-price-${purchase.id}`}
                                >
                                  <i className="fas fa-check text-green-500 text-xs"></i>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={handleEditCancel}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-cancel-price-${purchase.id}`}
                                >
                                  <i className="fas fa-times text-red-500 text-xs"></i>
                                </Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleEditStart(purchase.id, 'purchasePrice', purchase.purchasePrice)}
                                className="w-full text-right font-mono hover:bg-muted px-2 py-1 rounded transition-colors group"
                                data-testid={`button-edit-price-${purchase.id}`}
                              >
                                <span>{purchase.purchasePrice ? `${purchase.purchasePrice} ₽` : "—"}</span>
                                <i className="fas fa-edit text-xs ml-1 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                              </button>
                            )}
                          </td>
                          <td className="p-4 align-middle">
                            {editingCell?.id === purchase.id && editingCell.field === 'note' ? (
                              <div className="flex items-start gap-1">
                                <Textarea
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="border-2 border-primary min-h-[80px] resize-y"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && e.ctrlKey) handleEditSave();
                                    if (e.key === 'Escape') handleEditCancel();
                                  }}
                                  data-testid={`input-edit-note-${purchase.id}`}
                                />
                                <div className="flex flex-col gap-1">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={handleEditSave}
                                    disabled={updateMutation.isPending}
                                    data-testid={`button-save-note-${purchase.id}`}
                                  >
                                    <i className="fas fa-check text-green-500 text-xs"></i>
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 w-8 p-0"
                                    onClick={handleEditCancel}
                                    disabled={updateMutation.isPending}
                                    data-testid={`button-cancel-note-${purchase.id}`}
                                  >
                                    <i className="fas fa-times text-red-500 text-xs"></i>
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleEditStart(purchase.id, 'note', purchase.note)}
                                className="w-full text-left hover:bg-muted px-2 py-1 rounded transition-colors group"
                                data-testid={`button-edit-note-${purchase.id}`}
                              >
                                <span className="text-foreground whitespace-pre-wrap">{purchase.note || "—"}</span>
                                <i className="fas fa-edit text-xs ml-1 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                              </button>
                            )}
                          </td>
                          <td className="p-4 align-middle whitespace-nowrap">
                            {editingCell?.id === purchase.id && editingCell.field === 'boxNumber' ? (
                              <div className="flex items-center gap-1">
                                <Input
                                  type="text"
                                  value={editValue}
                                  onChange={(e) => setEditValue(e.target.value)}
                                  className="w-24 border-2 border-primary font-mono h-8"
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') handleEditSave();
                                    if (e.key === 'Escape') handleEditCancel();
                                  }}
                                  data-testid={`input-edit-box-${purchase.id}`}
                                />
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={handleEditSave}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-save-box-${purchase.id}`}
                                >
                                  <i className="fas fa-check text-green-500 text-xs"></i>
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0"
                                  onClick={handleEditCancel}
                                  disabled={updateMutation.isPending}
                                  data-testid={`button-cancel-box-${purchase.id}`}
                                >
                                  <i className="fas fa-times text-red-500 text-xs"></i>
                                </Button>
                              </div>
                            ) : (
                              <button
                                onClick={() => handleEditStart(purchase.id, 'boxNumber', purchase.boxNumber)}
                                className="hover:bg-muted px-2 py-1 rounded transition-colors group inline-flex items-center"
                                data-testid={`button-edit-box-${purchase.id}`}
                              >
                                <Badge variant="outline" className="font-mono whitespace-nowrap">
                                  {purchase.boxNumber || "—"}
                                </Badge>
                                <i className="fas fa-edit text-xs ml-1 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                              </button>
                            )}
                          </td>
                          <td className="p-4 align-middle text-right font-mono font-bold whitespace-nowrap">
                            {getTotalPrice(purchase) ? `${getTotalPrice(purchase)} ₽` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                <div className="mt-4 text-sm text-muted-foreground">
                  Показано {purchases.length} {purchases.length === 1 ? 'запись' : purchases.length < 5 ? 'записи' : 'записей'}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Sales History Section */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-foreground">История продаж</CardTitle>
          </CardHeader>
          <CardContent>
            {salesLoading ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
                <Skeleton className="h-64" />
              </div>
            ) : salesData && salesData.sales.length > 0 ? (
              <div className="space-y-6">
                {/* Metrics Cards */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <Card className="bg-muted/50 border-border">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Среднее время продажи</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="metric-avg-days">
                        {salesData.metrics.averageDaysToSell} дн.
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-muted/50 border-border">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Продано / Куплено</p>
                      <p className="text-2xl font-bold text-foreground" data-testid="metric-sell-through">
                        {salesData.metrics.soldQuantity} из {salesData.metrics.totalPurchased} шт
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        ({salesData.metrics.sellThroughRate}%)
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-muted/50 border-border">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Средняя доходность</p>
                      <p className="text-2xl font-bold text-green-600" data-testid="metric-avg-profit">
                        +{salesData.metrics.averageProfitPerUnit.toFixed(2)} ₽/шт
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-muted/50 border-border">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Процент доходности</p>
                      <p className="text-2xl font-bold text-green-600" data-testid="metric-avg-margin">
                        +{salesData.metrics.averageProfitMarginPercent.toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Sales Table */}
                <div className="relative max-h-[300px] overflow-auto border rounded-md">
                  <table className="w-full caption-bottom text-sm">
                    <thead className="[&_tr]:border-b">
                      <tr className="border-b transition-colors">
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Дата</th>
                        <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground">Кол-во</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Цена продажи</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Цена закупа</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Доставка</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Прибыль</th>
                        <th className="h-12 px-4 text-right align-middle font-medium text-muted-foreground">Доходность %</th>
                        <th className="h-12 px-4 text-center align-middle font-medium text-muted-foreground">Время от покупки</th>
                      </tr>
                    </thead>
                    <tbody className="[&_tr:last-child]:border-0">
                      {salesData.sales.map((sale) => (
                        <tr key={sale.id} className="border-b transition-colors" data-testid={`sale-row-${sale.id}`}>
                          <td className="p-4 align-middle whitespace-nowrap">
                            {format(new Date(sale.createdAt), "dd.MM.yyyy")}
                          </td>
                          <td className="p-4 align-middle text-center font-mono">
                            {Math.abs(sale.qtyDelta)}
                          </td>
                          <td className="p-4 align-middle text-right font-mono">
                            {sale.salePrice ? `${parseFloat(sale.salePrice).toFixed(2)} ₽` : "—"}
                          </td>
                          <td className="p-4 align-middle text-right font-mono">
                            {sale.purchasePriceUsed > 0 ? `${sale.purchasePriceUsed.toFixed(2)} ₽` : "—"}
                          </td>
                          <td className="p-4 align-middle text-right font-mono">
                            {sale.deliveryPrice ? `${parseFloat(sale.deliveryPrice).toFixed(2)} ₽` : "—"}
                          </td>
                          <td className="p-4 align-middle text-right font-mono font-bold">
                            <span className={sale.profit >= 0 ? "text-green-600" : "text-red-600"}>
                              {sale.profit >= 0 ? "+" : ""}{sale.profit.toFixed(2)} ₽
                            </span>
                          </td>
                          <td className="p-4 align-middle text-right font-mono font-bold">
                            <span className={sale.profitMarginPercent >= 0 ? "text-green-600" : "text-red-600"}>
                              {sale.profitMarginPercent >= 0 ? "+" : ""}{sale.profitMarginPercent.toFixed(1)}%
                            </span>
                          </td>
                          <td className="p-4 align-middle text-center">
                            <Badge variant="secondary">
                              {sale.daysFromPurchase !== null ? `${sale.daysFromPurchase} дн.` : "—"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="mt-4 text-sm text-muted-foreground">
                  Показано {salesData.sales.length} {salesData.sales.length === 1 ? 'продажа' : salesData.sales.length < 5 ? 'продажи' : 'продаж'}
                </div>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <p>Продаж пока не было</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
