import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";

import { Page } from "@/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { BoxSelector } from "@/components/box-selector";
import { SmartSearch } from "@/components/smart-search";
import type { Movement } from "@shared/schema";

type BoxInfo = {
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  positionsCount: number;
  totalQty: number;
  lastMovementAt: string | null;
};

type BoxContentItem = {
  smart: string;
  qty: number;
  articles?: string[];
  name?: string | null;
};

type BoxDetailsResponse = {
  box: BoxInfo;
  contents: BoxContentItem[];
  history: Movement[];
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

type InventoryRow = {
  smart: string;
  expectedQty: number;
  actualQty: number;
  name?: string | null;
  articles?: string[];
};

export default function BoxDetailsPage() {
  const { name } = useParams<{ name: string }>();
  const boxName = name || "";
  const encoded = encodeURIComponent(boxName);

  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, isError, error } = useQuery<BoxDetailsResponse>({
    queryKey: [`/api/boxes/${encoded}`],
    enabled: Boolean(boxName),
  });

  const box = data?.box;
  const contents = Array.isArray(data?.contents) ? data!.contents : [];
  const history = Array.isArray(data?.history) ? data!.history : [];

  // Inline description edit
  const [editingDescription, setEditingDescription] = useState(false);
  const [descriptionDraft, setDescriptionDraft] = useState("");

  useEffect(() => {
    if (!box) return;
    setDescriptionDraft(box.description || "");
  }, [box?.name, box?.description]); // eslint-disable-line react-hooks/exhaustive-deps

  const updateBoxMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/boxes/${encoded}`, patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/boxes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/boxes?activeOnly=1"] });
      queryClient.invalidateQueries({ queryKey: [`/api/boxes/${encoded}`] });
      queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/items") });
      toast({ title: "Коробка обновлена" });
      setEditingDescription(false);
    },
    onError: (error) => {
      toast({
        title: "Ошибка обновления",
        description: error instanceof Error ? error.message : "Ошибка",
        variant: "destructive",
      });
    },
  });

  // Transfer modal
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferSmart, setTransferSmart] = useState<string>("");
  const [transferMax, setTransferMax] = useState<number>(0);
  const [transferQty, setTransferQty] = useState<number>(1);
  const [transferToBox, setTransferToBox] = useState<string | null>(null);
  const [transferNote, setTransferNote] = useState("");

  const startTransfer = (smart: string, maxQty: number) => {
    setTransferSmart(smart);
    setTransferMax(maxQty);
    setTransferQty(Math.min(1, Math.max(1, maxQty)));
    setTransferToBox(null);
    setTransferNote("");
    setTransferOpen(true);
  };

  const transferMutation = useMutation({
    mutationFn: async () => {
      if (!box) throw new Error("Коробка не загружена");
      if (!transferSmart) throw new Error("SMART не выбран");
      if (!transferToBox) throw new Error("Выберите коробку назначения");
      const qty = Number(transferQty);
      if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
        throw new Error("Количество должно быть целым положительным числом");
      }
      if (qty > transferMax) throw new Error(`В коробке только ${transferMax} шт`);

      const payload = {
        smart: transferSmart,
        qty,
        fromBox: box.name,
        toBox: transferToBox,
        note: transferNote.trim() || null,
      };
      const res = await apiRequest("POST", "/api/boxes/transfer", payload);
      return res.json();
    },
    onSuccess: () => {
      setTransferOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/boxes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/boxes?activeOnly=1"] });
      queryClient.invalidateQueries({ queryKey: [`/api/boxes/${encoded}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
      if (transferSmart) {
        const smartEncoded = encodeURIComponent(String(transferSmart));
        queryClient.invalidateQueries({ queryKey: [`/api/stock/${transferSmart}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/stock/${transferSmart}/purchases`] });
        queryClient.invalidateQueries({ queryKey: [`/api/stock/${transferSmart}/sales`] });
        queryClient.invalidateQueries({ queryKey: [`/api/stock/${smartEncoded}/boxes`] });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=profit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=combined"] });
      queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/items") });
      toast({ title: "Перемещение выполнено" });
    },
    onError: (error) => {
      toast({
        title: "Ошибка перемещения",
        description: error instanceof Error ? error.message : "Ошибка",
        variant: "destructive",
      });
    },
  });

  // Inventory
  const [inventoryOpen, setInventoryOpen] = useState(false);
  const [inventoryRows, setInventoryRows] = useState<InventoryRow[]>([]);
  const [addSmartKey, setAddSmartKey] = useState(0);
  const [addSmart, setAddSmart] = useState<string>("");
  const [addActualQty, setAddActualQty] = useState<number>(1);

  const openInventory = () => {
    const base: InventoryRow[] = contents.map((c) => ({
      smart: c.smart,
      expectedQty: c.qty,
      actualQty: c.qty,
      name: c.name,
      articles: c.articles,
    }));
    setInventoryRows(base);
    setAddSmart("");
    setAddActualQty(1);
    setAddSmartKey((k) => k + 1);
    setInventoryOpen(true);
  };

  const inventoryDiffs = useMemo(() => {
    return inventoryRows
      .map((r) => ({
        ...r,
        diff: Math.trunc(Number(r.actualQty || 0)) - Math.trunc(Number(r.expectedQty || 0)),
      }))
      .filter((r) => Number.isFinite(r.diff));
  }, [inventoryRows]);

  const applyInventoryMutation = useMutation({
    mutationFn: async () => {
      if (!box) throw new Error("Коробка не загружена");
      const diffs = inventoryDiffs.filter((r) => r.diff !== 0);
      if (diffs.length === 0) return 0;
      const items = diffs.map((r) => ({
        smart: r.smart,
        qtyDelta: r.diff,
        reason: "adjust",
        note: `Инвентаризация: расхождение ${r.diff}`,
        purchasePrice: null,
        boxNumber: box.name,
      }));
      await apiRequest("POST", "/api/movements/batch", { items });
      return diffs.length;
    },
    onSuccess: (count) => {
      setInventoryOpen(false);
      queryClient.invalidateQueries({ queryKey: ["/api/boxes"] });
      queryClient.invalidateQueries({ queryKey: ["/api/boxes?activeOnly=1"] });
      queryClient.invalidateQueries({ queryKey: [`/api/boxes/${encoded}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
      queryClient.invalidateQueries({
        predicate: (query) =>
          Array.isArray(query.queryKey) &&
          typeof query.queryKey[0] === "string" &&
          query.queryKey[0].startsWith("/api/stock/"),
      });
      queryClient.invalidateQueries({ queryKey: ["/api/unboxed"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sold-out"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=profit"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=sales"] });
      queryClient.invalidateQueries({ queryKey: ["/api/top-parts?mode=combined"] });
      queryClient.invalidateQueries({ predicate: (query) => typeof query.queryKey[0] === "string" && query.queryKey[0].startsWith("/api/items") });
      toast({ title: "Инвентаризация применена", description: `Создано корректировок: ${count}` });
    },
    onError: (error) => {
      toast({
        title: "Ошибка инвентаризации",
        description: error instanceof Error ? error.message : "Ошибка",
        variant: "destructive",
      });
    },
  });

  const addInventoryRow = () => {
    const smart = addSmart.trim();
    const qty = Math.max(0, Math.trunc(Number(addActualQty || 0)));
    if (!smart) return;
    if (inventoryRows.some((r) => r.smart === smart)) return;
    setInventoryRows((prev) => [...prev, { smart, expectedQty: 0, actualQty: qty }]);
    setAddSmart("");
    setAddActualQty(1);
    setAddSmartKey((k) => k + 1);
  };

  if (!boxName) {
    return (
      <Page title="Коробка" description="Имя коробки не указано">
        <p className="text-sm text-muted-foreground">Имя коробки не указано</p>
      </Page>
    );
  }

  if (isLoading) {
    return (
      <Page title="Коробка" description="Загрузка...">
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      </Page>
    );
  }

  if (isError) {
    return (
      <Page title="Коробка" description="Ошибка загрузки">
        <p className="text-sm text-destructive">{error instanceof Error ? error.message : "Не удалось загрузить коробку"}</p>
      </Page>
    );
  }

  if (!box) {
    return (
      <Page title="Коробка" description="Коробка не найдена">
        <p className="text-sm text-muted-foreground">Коробка не найдена</p>
      </Page>
    );
  }

  return (
    <Page
      title={
        <div className="flex items-center gap-3">
          <span className="font-mono">{box.name}</span>
          <Badge variant={box.isActive ? "default" : "secondary"}>
            {box.isActive ? "Активна" : "Закрыта"}
          </Badge>
        </div>
      }
      description={box.lastMovementAt ? `Последняя операция: ${formatDate(box.lastMovementAt)}` : "Нет операций"}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/boxes">
            <Button variant="outline">К списку</Button>
          </Link>
          <Button
            variant="outline"
            onClick={openInventory}
            disabled={!box.isActive}
            data-testid="button-open-inventory"
          >
            Инвентаризация
          </Button>
          <Button
            variant="outline"
            onClick={() => updateBoxMutation.mutate({ isActive: !box.isActive })}
            disabled={updateBoxMutation.isPending}
            data-testid="button-toggle-box-active"
          >
            {box.isActive ? "Закрыть" : "Открыть"}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Описание</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editingDescription ? (
              <>
                <Textarea
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  rows={3}
                  data-testid="textarea-box-description"
                />
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => updateBoxMutation.mutate({ description: descriptionDraft.trim() || null })}
                    disabled={updateBoxMutation.isPending}
                    data-testid="button-save-box-description"
                  >
                    Сохранить
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingDescription(false);
                      setDescriptionDraft(box.description || "");
                    }}
                  >
                    Отмена
                  </Button>
                </div>
              </>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {box.description || "—"}
                </p>
                <Button variant="ghost" size="sm" onClick={() => setEditingDescription(true)}>
                  <i className="fas fa-edit mr-2"></i>
                  Редактировать
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Содержимое</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">SMART</TableHead>
                    <TableHead className="w-[240px]">Артикулы</TableHead>
                    <TableHead>Название</TableHead>
                    <TableHead className="text-right w-[110px]">Кол-во</TableHead>
                    <TableHead className="text-right w-[90px]">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {contents.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        Коробка пустая
                      </TableCell>
                    </TableRow>
                  ) : (
                    contents.map((c) => (
                      <TableRow key={c.smart} className="hover:bg-muted/50">
                        <TableCell className="font-mono font-semibold">
                          <Link href={`/stock/${encodeURIComponent(c.smart)}`}>
                            <a className="hover:underline">{c.smart}</a>
                          </Link>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {(c.articles || []).length ? (c.articles || []).join(", ") : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[420px] truncate">
                          {c.name || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">{c.qty}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => startTransfer(c.smart, Math.max(0, c.qty))}
                            disabled={!box.isActive || c.qty <= 0}
                            data-testid={`button-transfer-${c.smart}`}
                          >
                            Переместить
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>История операций</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[160px]">Дата</TableHead>
                    <TableHead className="w-[140px]">SMART</TableHead>
                    <TableHead className="text-right w-[110px]">Кол-во Δ</TableHead>
                    <TableHead className="w-[120px]">Причина</TableHead>
                    <TableHead>Примечание</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                        Нет операций
                      </TableCell>
                    </TableRow>
                  ) : (
                    history.map((m) => (
                      <TableRow key={m.id} className="hover:bg-muted/50">
                        <TableCell className="font-mono text-sm">{formatDate(m.createdAt)}</TableCell>
                        <TableCell className="font-mono font-semibold">{m.smart}</TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          <span className={m.qtyDelta >= 0 ? "text-success" : "text-destructive"}>
                            {m.qtyDelta >= 0 ? "+" : ""}{m.qtyDelta}
                          </span>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{m.reason}</Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[520px] truncate">
                          {m.note || "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transfer dialog */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Перемещение</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-muted-foreground mb-1">SMART</p>
              <Input value={transferSmart} readOnly className="font-mono" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Количество (макс. {transferMax})</p>
              <Input
                type="number"
                min={1}
                step={1}
                max={transferMax}
                value={transferQty}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10);
                  setTransferQty(Number.isFinite(parsed) ? parsed : 1);
                }}
                data-testid="input-transfer-qty"
              />
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">В коробку</p>
              <BoxSelector
                mode="all"
                value={transferToBox}
                onSelect={setTransferToBox}
                exclude={[box.name]}
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

      {/* Inventory dialog */}
      <Dialog open={inventoryOpen} onOpenChange={setInventoryOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Инвентаризация: {box.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[140px]">SMART</TableHead>
                    <TableHead>Название</TableHead>
                    <TableHead className="text-right w-[140px]">Ожидалось</TableHead>
                    <TableHead className="text-right w-[140px]">По факту</TableHead>
                    <TableHead className="text-right w-[120px]">Разница</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {inventoryDiffs.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="py-6 text-center text-muted-foreground">
                        Нет позиций
                      </TableCell>
                    </TableRow>
                  ) : (
                    inventoryDiffs.map((r) => (
                      <TableRow key={r.smart} className={r.diff === 0 ? "" : "bg-warning/5"}>
                        <TableCell className="font-mono font-semibold">{r.smart}</TableCell>
                        <TableCell className="text-sm text-muted-foreground max-w-[420px] truncate">
                          {r.name || "—"}
                        </TableCell>
                        <TableCell className="text-right font-mono">{r.expectedQty}</TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            value={r.actualQty}
                            onChange={(e) => {
                              const next = Math.max(0, Math.trunc(Number(e.target.value) || 0));
                              setInventoryRows((prev) =>
                                prev.map((x) => (x.smart === r.smart ? { ...x, actualQty: next } : x))
                              );
                            }}
                            className="h-8 font-mono text-right"
                            data-testid={`input-inventory-actual-${r.smart}`}
                          />
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          <span className={r.diff === 0 ? "text-muted-foreground" : r.diff > 0 ? "text-success" : "text-destructive"}>
                            {r.diff > 0 ? "+" : ""}{r.diff}
                          </span>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-sm">Добавить найденный товар</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 md:grid-cols-[1fr_140px_120px] gap-3 items-end">
                <div>
                  <p className="text-xs text-muted-foreground mb-1">SMART</p>
                  <SmartSearch
                    key={addSmartKey}
                    defaultValue={addSmart}
                    onSelect={(r) => setAddSmart(r.smart)}
                    onClear={() => setAddSmart("")}
                    showSelectedInfo={false}
                    showName={false}
                    data-testid="input-inventory-add-smart"
                  />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground mb-1">Количество</p>
                  <Input
                    type="number"
                    min={0}
                    value={addActualQty}
                    onChange={(e) => {
                      const parsed = Number.parseInt(e.target.value, 10);
                      setAddActualQty(Number.isFinite(parsed) ? parsed : 0);
                    }}
                    className="font-mono"
                    data-testid="input-inventory-add-qty"
                  />
                </div>
                <Button type="button" variant="outline" onClick={addInventoryRow} data-testid="button-inventory-add-row">
                  Добавить
                </Button>
              </CardContent>
            </Card>
          </div>

          <DialogFooter>
            <Button
              onClick={() => applyInventoryMutation.mutate()}
              disabled={applyInventoryMutation.isPending || !box.isActive}
              data-testid="button-apply-inventory"
            >
              {applyInventoryMutation.isPending ? "Применение..." : "Применить корректировки"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Page>
  );
}
