import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Page } from "@/components/page";
import { BoxSelector } from "@/components/box-selector";
import type { Movement, StockBySmart } from "@shared/schema";
import { format } from "date-fns";

export default function StockDetails() {
  const { smart } = useParams();
  const { toast } = useToast();
  const [editingCell, setEditingCell] = useState<{id: number, field: 'purchasePrice' | 'note' | 'qtyDelta' | 'boxNumber'} | null>(null);
  const [editValue, setEditValue] = useState<string>("");
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferFromBox, setTransferFromBox] = useState<string | null>(null);
  const [transferToBox, setTransferToBox] = useState<string | null>(null);
  const [transferQty, setTransferQty] = useState<number>(1);
  const [transferMax, setTransferMax] = useState<number>(0);
  const [transferNote, setTransferNote] = useState<string>("");

  const { data: stockInfo, isLoading: stockInfoLoading } = useQuery<StockBySmart>({
    queryKey: [`/api/stock/${smart}`],
    enabled: !!smart,
  });

  const { data: purchasesData, isLoading } = useQuery<Movement[]>({
    queryKey: [`/api/stock/${smart}/purchases`],
    enabled: !!smart,
  });

  // Ensure purchases is always an array
  const purchases = Array.isArray(purchasesData) ? purchasesData : [];

  const purchaseLines = purchases
    .map((p) => ({
      price: p.purchasePrice ? Number(p.purchasePrice) : NaN,
      qty: Math.abs(p.qtyDelta),
    }))
    .filter((l) => Number.isFinite(l.price) && l.qty > 0);

  const totalPurchasedQty = purchases.reduce((sum, p) => sum + Math.abs(p.qtyDelta), 0);
  const totalPurchaseQtyWithPrice = purchaseLines.reduce((sum, l) => sum + l.qty, 0);
  const totalPurchaseCost =
    purchaseLines.length > 0 ? purchaseLines.reduce((sum, l) => sum + l.price * l.qty, 0) : null;
  const avgPurchasePrice =
    totalPurchaseQtyWithPrice > 0 && totalPurchaseCost !== null ? totalPurchaseCost / totalPurchaseQtyWithPrice : null;

  // Fetch sales analytics
  const { data: salesData, isLoading: salesLoading } = useQuery<{
    sales: Array<{
      id: string;
      source: "legacy" | "order";
      createdAt: string;
      qty: number;
      salePrice: number;
      deliveryPrice: number;
      deliveryPayer: "seller" | "buyer" | "mixed" | null;
      customerName: string | null;
      orderId: number | null;
      profit: number;
      profitMarginPercent: number;
      daysFromPurchase: number | null;
      purchasePriceUsed: number;
    }>;
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
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${smart}/sales`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${smart}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${encodeURIComponent(String(smart || ""))}/boxes`] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sold-out"] });
      queryClient.invalidateQueries({ queryKey: ["/api/boxes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/boxes?activeOnly=1"] });
      queryClient.invalidateQueries({ queryKey: ["/api/unboxed"] });
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
      if (editingCell.field === "boxNumber" && !editValue.trim()) {
        toast({
          title: "Ошибка",
          description: "Номер коробки обязателен",
          variant: "destructive",
        });
        return;
      }

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

  const startTransfer = (fromBox: string, maxQty: number) => {
    setTransferFromBox(fromBox);
    setTransferMax(maxQty);
    setTransferQty(1);
    setTransferToBox(null);
    setTransferNote("");
    setTransferOpen(true);
  };

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!smart) throw new Error("SMART код не указан");
      if (!transferFromBox) throw new Error("Коробка-источник не выбрана");
      if (!transferToBox) throw new Error("Выберите коробку назначения");

      const qty = Number(transferQty);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error("Количество должно быть положительным");
      }
      if (transferMax > 0 && qty > transferMax) {
        throw new Error(`Нельзя переместить больше, чем есть в коробке (макс. ${transferMax})`);
      }

      const payload = {
        smart,
        qty,
        fromBox: transferFromBox,
        toBox: transferToBox,
        note: transferNote.trim() || null,
      };
      const res = await apiRequest("POST", "/api/boxes/transfer", payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${smart}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${smart}/purchases`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${smart}/sales`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${encodeURIComponent(String(smart || ""))}/boxes`] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/boxes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/boxes?activeOnly=1"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });

      toast({
        title: "Перемещение выполнено",
        description: "Товар перемещён между коробками",
      });
      setTransferOpen(false);
    },
    onError: (error: any) => {
      toast({
        title: "Ошибка перемещения",
        description: error?.message || "Не удалось выполнить перемещение",
        variant: "destructive",
      });
    },
  });

  if (!smart) {
    return (
      <Page title="SMART" description="SMART код не указан">
        <p className="text-muted-foreground">SMART код не указан</p>
      </Page>
    );
  }

  return (
    <Page title={`SMART ${smart}`} description="Детализация покупок и продаж" containerClassName="max-w-7xl">
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
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Всего покупок</p>
                  <p className="text-2xl font-semibold text-foreground">{purchases.length}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Общее количество</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {totalPurchasedQty}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Средняя цена</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {avgPurchasePrice !== null ? `${avgPurchasePrice.toFixed(2)} ₽` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Всего затрат</p>
                  <p className="text-2xl font-semibold text-foreground">
                    {totalPurchaseCost !== null ? `${totalPurchaseCost.toFixed(2)} ₽` : "—"}
                  </p>
                </div>
              </div>
            </CardContent>
          )}
        </Card>

        <Card className="bg-card border-border mb-6">
          <CardHeader>
            <CardTitle>Распределение по коробкам</CardTitle>
          </CardHeader>
          <CardContent>
            {stockInfoLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : !stockInfo || !stockInfo.existed ? (
              <p className="text-sm text-muted-foreground">Нет данных по этому SMART</p>
            ) : (
              <div className="space-y-3">
	                {(() => {
	                  const delta = Number(stockInfo.unboxedQty || 0);
	                  const unboxed = Math.max(delta, 0);
	                  const overboxed = Math.max(-delta, 0);

	                  return (
	                    <>
	                <div className="text-sm text-muted-foreground">
	                  В коробках:{" "}
	                  <span className="font-mono font-semibold text-foreground">{stockInfo.boxedQty}</span>{" "}
	                  · Без коробки:{" "}
	                  <span className="font-mono font-semibold text-foreground">{unboxed}</span>{" "}
                  {overboxed > 0 && (
                    <>
                      · Расхождение:{" "}
                      <span className="font-mono font-semibold text-destructive">{overboxed}</span>{" "}
                    </>
                  )}
                  · Всего:{" "}
                  <span className="font-mono font-semibold text-foreground">{stockInfo.totalQty}</span>
                </div>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[180px]">Коробка</TableHead>
                        <TableHead className="text-right w-[120px]">Кол-во</TableHead>
                        <TableHead className="text-right w-[140px]">Действия</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stockInfo.boxes.length === 0 && stockInfo.totalQty === 0 ? (
                        <TableRow>
                          <TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">
                            Нет остатков
                          </TableCell>
                        </TableRow>
                      ) : (
                        <>
                          {stockInfo.boxes.map((row) => (
                            <TableRow key={row.boxNumber} className="hover:bg-muted/50">
                              <TableCell>
                                <Link href={`/boxes/${encodeURIComponent(row.boxNumber)}`}>
                                  <Button variant="ghost" size="sm" className="h-auto px-2 font-mono">
                                    {row.boxNumber}
                                  </Button>
                                </Link>
                              </TableCell>
                              <TableCell className="text-right font-mono font-semibold">{row.qty}</TableCell>
                              <TableCell className="text-right">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => startTransfer(row.boxNumber, row.qty)}
                                  disabled={row.qty <= 0}
                                  data-testid={`button-transfer-from-${row.boxNumber}`}
                                >
                                  Переместить
                                </Button>
                              </TableCell>
                            </TableRow>
                          ))}

                          {unboxed > 0 && (
                            <TableRow className="hover:bg-muted/50">
                              <TableCell className="font-semibold">Без коробки</TableCell>
                              <TableCell className="text-right font-mono font-semibold">{unboxed}</TableCell>
                              <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                            </TableRow>
                          )}
                          {overboxed > 0 && (
                            <TableRow className="bg-destructive/5 hover:bg-destructive/10">
                              <TableCell className="font-semibold">Расхождение</TableCell>
                              <TableCell className="text-right font-mono font-semibold text-destructive">{overboxed}</TableCell>
                              <TableCell className="text-right text-sm text-muted-foreground">—</TableCell>
                            </TableRow>
                          )}
                        </>
                      )}
                    </TableBody>
	                  </Table>
	                </div>
	                    </>
	                  );
	                })()}
	              </div>
	            )}
          </CardContent>
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
                  <Table>
                    <thead className="[&_tr]:border-b bg-muted/50">
                      <tr className="border-b transition-colors">
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground w-[120px]">Дата</th>
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
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditStart(purchase.id, 'qtyDelta', Math.abs(purchase.qtyDelta))}
                                className="h-auto w-full justify-end font-mono font-semibold px-2 py-1 rounded transition-colors group"
                                data-testid={`button-edit-qty-${purchase.id}`}
                              >
                                <span>{Math.abs(purchase.qtyDelta)}</span>
                                <i className="fas fa-edit text-xs ml-1 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                              </Button>
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
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditStart(purchase.id, 'purchasePrice', purchase.purchasePrice)}
                                className="h-auto w-full justify-end font-mono px-2 py-1 rounded transition-colors group"
                                data-testid={`button-edit-price-${purchase.id}`}
                              >
                                <span>{purchase.purchasePrice ? `${purchase.purchasePrice} ₽` : "—"}</span>
                                <i className="fas fa-edit text-xs ml-1 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                              </Button>
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
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditStart(purchase.id, 'note', purchase.note)}
                                className="h-auto w-full justify-start px-2 py-1 text-left rounded transition-colors group"
                                data-testid={`button-edit-note-${purchase.id}`}
                              >
                                <span className="text-foreground whitespace-pre-wrap">{purchase.note || "—"}</span>
                                <i className="fas fa-edit text-xs ml-1 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                              </Button>
                            )}
                          </td>
                          <td className="p-4 align-middle whitespace-nowrap">
                            {editingCell?.id === purchase.id && editingCell.field === 'boxNumber' ? (
                              <div className="flex items-center gap-1">
                                <div className="min-w-[140px]">
                                  <BoxSelector
                                    mode="all"
                                    value={editValue || null}
                                    onSelect={(value) => setEditValue(value || "")}
                                    required
                                    data-testid={`select-edit-box-${purchase.id}`}
                                  />
                                </div>
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
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => handleEditStart(purchase.id, 'boxNumber', purchase.boxNumber)}
                                className="h-auto px-2 py-1 rounded transition-colors group inline-flex items-center"
                                data-testid={`button-edit-box-${purchase.id}`}
                              >
                                <Badge variant="outline" className="font-mono whitespace-nowrap">
                                  {purchase.boxNumber || "—"}
                                </Badge>
                                <i className="fas fa-edit text-xs ml-1 opacity-0 group-hover:opacity-50 transition-opacity"></i>
                              </Button>
                            )}
                          </td>
                          <td className="p-4 align-middle text-right font-mono font-bold whitespace-nowrap">
                            {getTotalPrice(purchase) ? `${getTotalPrice(purchase)} ₽` : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
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
                      <p
                        className={`text-2xl font-bold ${
                          salesData.metrics.averageProfitPerUnit >= 0 ? "text-success" : "text-destructive"
                        }`}
                        data-testid="metric-avg-profit"
                      >
                        {salesData.metrics.averageProfitPerUnit >= 0 ? "+" : ""}
                        {salesData.metrics.averageProfitPerUnit.toFixed(2)} ₽/шт
                      </p>
                    </CardContent>
                  </Card>
                  
                  <Card className="bg-muted/50 border-border">
                    <CardContent className="p-4">
                      <p className="text-xs text-muted-foreground mb-1">Процент доходности</p>
                      <p
                        className={`text-2xl font-bold ${
                          salesData.metrics.averageProfitMarginPercent >= 0 ? "text-success" : "text-destructive"
                        }`}
                        data-testid="metric-avg-margin"
                      >
                        {salesData.metrics.averageProfitMarginPercent >= 0 ? "+" : ""}
                        {salesData.metrics.averageProfitMarginPercent.toFixed(1)}%
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Sales Table */}
                <div className="relative max-h-[300px] overflow-auto border rounded-md">
                  <Table>
                    <thead className="[&_tr]:border-b">
                      <tr className="border-b transition-colors">
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Дата</th>
                        <th className="h-12 px-4 text-left align-middle font-medium text-muted-foreground">Клиент</th>
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
                          <td className="p-4 align-middle">
                            <div className="flex items-center gap-2">
                              <span>{sale.customerName || "legacy"}</span>
                              {sale.orderId && (
                                <Link href={`/orders/${sale.orderId}`}>
                                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs">
                                    #{sale.orderId}
                                  </Button>
                                </Link>
                              )}
                            </div>
                          </td>
                          <td className="p-4 align-middle text-center font-mono">
                            {sale.qty}
                          </td>
                          <td className="p-4 align-middle text-right font-mono">
                            {sale.salePrice.toFixed(2)} ₽
                          </td>
                          <td className="p-4 align-middle text-right font-mono">
                            {sale.purchasePriceUsed > 0 ? `${sale.purchasePriceUsed.toFixed(2)} ₽` : "—"}
                          </td>
                          <td className="p-4 align-middle text-right font-mono">
                            {sale.deliveryPrice > 0 ? `${sale.deliveryPrice.toFixed(2)} ₽` : "—"}
                            <div className="text-[10px] text-muted-foreground mt-1">
                              {sale.deliveryPayer === "seller"
                                ? "платит продавец"
                                : sale.deliveryPayer === "buyer"
                                  ? "платит покупатель"
                                  : sale.deliveryPayer === "mixed"
                                    ? "смешанная оплата"
                                    : "—"}
                            </div>
                          </td>
                          <td className="p-4 align-middle text-right font-mono font-bold">
                            <span className={sale.profit >= 0 ? "text-success" : "text-destructive"}>
                              {sale.profit >= 0 ? "+" : ""}{sale.profit.toFixed(2)} ₽
                            </span>
                          </td>
                          <td className="p-4 align-middle text-right font-mono font-bold">
                            <span className={sale.profitMarginPercent >= 0 ? "text-success" : "text-destructive"}>
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
                  </Table>
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

        <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Перемещение</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-muted-foreground mb-1">SMART</p>
                <Input value={smart} readOnly className="font-mono" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Из коробки</p>
                <Input value={transferFromBox || ""} readOnly className="font-mono" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Количество (макс. {transferMax})</p>
                <Input
                  type="number"
                  min={1}
                  max={transferMax}
                  value={transferQty}
                  onChange={(e) => setTransferQty(Number(e.target.value) || 1)}
                  data-testid="input-transfer-qty"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">В коробку</p>
                <BoxSelector
                  mode="all"
                  value={transferToBox}
                  onSelect={setTransferToBox}
                  exclude={[String(transferFromBox || "")].filter(Boolean)}
                  placeholder="Выберите коробку назначения"
                  data-testid="select-transfer-to-box"
                />
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Примечание</p>
                <Input
                  value={transferNote}
                  onChange={(e) => setTransferNote(e.target.value)}
                  placeholder="Опционально"
                  data-testid="input-transfer-note"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={() => transferMutation.mutate()}
                disabled={transferMutation.isPending}
                data-testid="button-submit-transfer"
              >
                {transferMutation.isPending ? "Перемещение..." : "Переместить"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
    </Page>
  );
}
