import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import type { ItemsResponse, ItemInstance } from "@shared/schema";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  smart: string;
  boxNumber: string;
  qty: number;
  initialSelectedIds?: number[];
  onConfirm: (itemIds: number[]) => void;
};

function fetchItems(params: Record<string, string>) {
  const url = new URL("/api/items", window.location.origin);
  for (const [k, v] of Object.entries(params)) {
    if (v) url.searchParams.set(k, v);
  }
  return fetch(url.toString(), { credentials: "include" }).then(async (res) => {
    const text = await res.text();
    if (!res.ok) {
      try {
        const json = JSON.parse(text);
        throw new Error(json.error || json.message || text);
      } catch {
        throw new Error(text || res.statusText);
      }
    }
    return JSON.parse(text) as ItemsResponse;
  });
}

export function ItemPickerDialog({
  open,
  onOpenChange,
  title = "Выбор экземпляров",
  smart,
  boxNumber,
  qty,
  initialSelectedIds,
  onConfirm,
}: Props) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (!open) return;
    const next = new Set<number>();
    for (const id of initialSelectedIds || []) {
      if (Number.isFinite(id) && id > 0) next.add(id);
    }
    setSelected(next);
    setSearch("");
  }, [open, initialSelectedIds]);

  const query = useQuery<ItemsResponse>({
    queryKey: ["/api/items", smart, boxNumber, search],
    enabled: open && Boolean(smart.trim()) && Boolean(boxNumber.trim()),
    queryFn: () =>
      fetchItems({
        smart: smart.trim(),
        boxNumber: boxNumber.trim(),
        state: "in_stock",
        limit: "200",
        offset: "0",
        q: search.trim(),
      }),
  });

  const items = query.data?.items || [];
  const total = query.data?.total ?? 0;

  const selectedIds = useMemo(() => Array.from(selected.values()).sort((a, b) => a - b), [selected]);

  const toggle = (item: ItemInstance) => {
    const id = Number(item.id);
    if (!Number.isFinite(id) || id <= 0) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }
      if (next.size >= qty) {
        toast({
          title: "Лимит выбора",
          description: `Нужно выбрать ровно ${qty} шт`,
          variant: "destructive",
        });
        return prev;
      }
      next.add(id);
      return next;
    });
  };

  const canConfirm = selected.size === qty;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 items-end">
          <div>
            <p className="text-xs text-muted-foreground mb-1">Поиск по itemCode / ID / заметке</p>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Например: EH-000123"
              data-testid="input-item-picker-search"
            />
          </div>
          <div className="text-xs text-muted-foreground">
            Выбрано: <span className="font-semibold text-foreground">{selected.size}</span> / {qty}
          </div>
        </div>

        <div className="rounded-md border max-h-[440px] overflow-auto">
          {query.isLoading ? (
            <div className="p-4 space-y-2">
              {[...Array(10)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : query.isError ? (
            <div className="p-4 text-sm text-destructive">{String((query.error as Error)?.message || "Ошибка")}</div>
          ) : items.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">
              Нет экземпляров в коробке {boxNumber} для {smart}
            </div>
          ) : (
            <div className="divide-y">
              {items.map((item) => {
                const id = Number(item.id);
                const checked = selected.has(id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="w-full text-left px-4 py-2.5 hover:bg-muted/40 flex items-center gap-3"
                    onClick={() => toggle(item)}
                    data-testid={`item-picker-row-${item.id}`}
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={() => toggle(item)}
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-mono font-semibold truncate">{item.itemCode}</div>
                        <div className="text-xs text-muted-foreground whitespace-nowrap">ID: {item.id}</div>
                      </div>
                      <div className="text-xs text-muted-foreground truncate">{item.note || "—"}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground">
          Найдено: <span className="font-semibold text-foreground">{items.length}</span>
          {total > items.length ? <span> из {total}</span> : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setSelected(new Set());
            }}
            data-testid="button-item-picker-clear"
          >
            Очистить
          </Button>
          <Button
            onClick={() => {
              if (!canConfirm) {
                toast({
                  title: "Неверный выбор",
                  description: `Нужно выбрать ровно ${qty} шт (выбрано ${selected.size})`,
                  variant: "destructive",
                });
                return;
              }
              onConfirm(selectedIds);
              onOpenChange(false);
            }}
            disabled={!canConfirm}
            data-testid="button-item-picker-confirm"
          >
            Выбрать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
