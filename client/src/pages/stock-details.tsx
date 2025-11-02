import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
  const [editingCell, setEditingCell] = useState<{id: number, field: 'purchasePrice' | 'note'} | null>(null);
  const [editValue, setEditValue] = useState<string>("");

  const { data: purchasesData, isLoading } = useQuery<Movement[]>({
    queryKey: [`/api/stock/${smart}/purchases`],
    enabled: !!smart,
  });

  // Ensure purchases is always an array
  const purchases = Array.isArray(purchasesData) ? purchasesData : [];

  const updateMutation = useMutation({
    mutationFn: async ({ id, field, value }: { id: number; field: 'purchasePrice' | 'note'; value: string | null }) => {
      return await apiRequest('PATCH', `/api/movements/${id}`, {
        [field]: value,
      });
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

  const handleEditStart = (id: number, field: 'purchasePrice' | 'note', currentValue: string | null) => {
    setEditingCell({ id, field });
    setEditValue(currentValue || "");
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
          <p className="text-sm text-muted-foreground mt-1">Просмотр и редактирование покупок</p>
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
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted">
                    <TableRow>
                      <TableHead className="w-[120px]">Дата</TableHead>
                      <TableHead className="w-[180px]">Артикул</TableHead>
                      <TableHead className="text-right w-[100px]">Кол-во</TableHead>
                      <TableHead className="text-right w-[150px]">Цена закупа</TableHead>
                      <TableHead className="min-w-[200px]">Комментарий</TableHead>
                      <TableHead className="w-[100px]">Номер коробки</TableHead>
                      <TableHead className="text-right w-[120px]">Итого</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {purchases.map((purchase) => (
                      <TableRow 
                        key={purchase.id} 
                        className="hover:bg-muted/50 transition-colors"
                        data-testid={`row-purchase-${purchase.id}`}
                      >
                        <TableCell className="font-mono text-sm">
                          {format(new Date(purchase.createdAt), "dd.MM.yyyy")}
                        </TableCell>
                        <TableCell className="font-mono">{purchase.article}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {Math.abs(purchase.qtyDelta)}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingCell?.id === purchase.id && editingCell.field === 'purchasePrice' ? (
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                step="0.01"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="border-2 border-primary font-mono text-right"
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
                                onClick={handleEditSave}
                                disabled={updateMutation.isPending}
                                data-testid={`button-save-price-${purchase.id}`}
                              >
                                <i className="fas fa-check text-green-500"></i>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleEditCancel}
                                disabled={updateMutation.isPending}
                                data-testid={`button-cancel-price-${purchase.id}`}
                              >
                                <i className="fas fa-times text-red-500"></i>
                              </Button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleEditStart(purchase.id, 'purchasePrice', purchase.purchasePrice)}
                              className="w-full text-right font-mono hover:bg-muted px-2 py-1 rounded transition-colors group"
                              data-testid={`button-edit-price-${purchase.id}`}
                            >
                              <span>{purchase.purchasePrice ? `${purchase.purchasePrice} ₽` : "—"}</span>
                              <i className="fas fa-edit text-xs ml-2 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                            </button>
                          )}
                        </TableCell>
                        <TableCell>
                          {editingCell?.id === purchase.id && editingCell.field === 'note' ? (
                            <div className="flex items-center gap-2">
                              <Input
                                type="text"
                                value={editValue}
                                onChange={(e) => setEditValue(e.target.value)}
                                className="border-2 border-primary"
                                autoFocus
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleEditSave();
                                  if (e.key === 'Escape') handleEditCancel();
                                }}
                                data-testid={`input-edit-note-${purchase.id}`}
                              />
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleEditSave}
                                disabled={updateMutation.isPending}
                                data-testid={`button-save-note-${purchase.id}`}
                              >
                                <i className="fas fa-check text-green-500"></i>
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleEditCancel}
                                disabled={updateMutation.isPending}
                                data-testid={`button-cancel-note-${purchase.id}`}
                              >
                                <i className="fas fa-times text-red-500"></i>
                              </Button>
                            </div>
                          ) : (
                            <button
                              onClick={() => handleEditStart(purchase.id, 'note', purchase.note)}
                              className="w-full text-left hover:bg-muted px-2 py-1 rounded transition-colors group"
                              data-testid={`button-edit-note-${purchase.id}`}
                            >
                              <span className="text-foreground">{purchase.note || "—"}</span>
                              <i className="fas fa-edit text-xs ml-2 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                            </button>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="font-mono">
                            {purchase.boxNumber || "—"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono font-bold">
                          {getTotalPrice(purchase) ? `${getTotalPrice(purchase)} ₽` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                
                <div className="mt-4 text-sm text-muted-foreground">
                  Показано {purchases.length} {purchases.length === 1 ? 'запись' : purchases.length < 5 ? 'записи' : 'записей'}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
