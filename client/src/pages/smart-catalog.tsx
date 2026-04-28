import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Page } from "@/components/page";
import { TagInput } from "@/components/tag-input";
import type { SmartCatalogEntry, SmartCatalogResponse } from "@shared/schema";

const PAGE_SIZE = 50;

function invalidateSmartQueries(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({
    predicate: (query) =>
      Array.isArray(query.queryKey) &&
      typeof query.queryKey[0] === "string" &&
      (query.queryKey[0].startsWith("/api/smart-catalog") ||
        query.queryKey[0].startsWith("/api/articles")),
  });
}

export default function SmartCatalogPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SmartCatalogEntry | null>(null);

  // Form fields
  const [formSmart, setFormSmart] = useState("");
  const [formName, setFormName] = useState("");
  const [formArticles, setFormArticles] = useState<string[]>([]);
  const [formBrand, setFormBrand] = useState<string[]>([]);
  const [formDescription, setFormDescription] = useState<string[]>([]);

  // Delete confirmation
  const [deleteTarget, setDeleteTarget] = useState<SmartCatalogEntry | null>(null);

  const queryKey = useMemo(() => {
    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    return `/api/smart-catalog?${params.toString()}`;
  }, [search, offset]);

  const { data, isLoading, isError, error } = useQuery<SmartCatalogResponse>({
    queryKey: [queryKey],
  });

  const items = data?.items ?? [];
  const total = data?.total ?? 0;

  const openCreateDialog = () => {
    setEditing(null);
    setFormSmart("");
    setFormName("");
    setFormArticles([]);
    setFormBrand([]);
    setFormDescription([]);
    setDialogOpen(true);
  };

  const openEditDialog = (entry: SmartCatalogEntry) => {
    setEditing(entry);
    setFormSmart(entry.smart);
    setFormName(entry.name ?? "");
    setFormArticles([...entry.articles]);
    setFormBrand([...entry.brand]);
    setFormDescription([...entry.description]);
    setDialogOpen(true);
  };

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/smart-catalog", {
        smart: formSmart.trim(),
        name: formName.trim() || null,
        articles: formArticles,
        brand: formBrand,
        description: formDescription,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateSmartQueries(queryClient);
      setDialogOpen(false);
      toast({ title: "SMART запись создана" });
    },
    onError: (err) => {
      toast({
        title: "Ошибка создания",
        description: err instanceof Error ? err.message : "Не удалось создать запись",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/smart-catalog/${encodeURIComponent(editing!.smart)}`, {
        name: formName.trim() || null,
        articles: formArticles,
        brand: formBrand,
        description: formDescription,
      });
      return res.json();
    },
    onSuccess: () => {
      invalidateSmartQueries(queryClient);
      setDialogOpen(false);
      toast({ title: "SMART запись обновлена" });
    },
    onError: (err) => {
      toast({
        title: "Ошибка обновления",
        description: err instanceof Error ? err.message : "Не удалось обновить запись",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (code: string) => {
      const res = await apiRequest("DELETE", `/api/smart-catalog/${encodeURIComponent(code)}`);
      return res.json();
    },
    onSuccess: () => {
      invalidateSmartQueries(queryClient);
      setDeleteTarget(null);
      toast({ title: "SMART запись удалена" });
    },
    onError: (err) => {
      toast({
        title: "Ошибка удаления",
        description: err instanceof Error ? err.message : "Не удалось удалить запись",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    if (editing) {
      updateMutation.mutate();
    } else {
      createMutation.mutate();
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <Page
      title="SMART Каталог"
      description="Справочник SMART кодов, артикулов и брендов"
      actions={
        <Button onClick={openCreateDialog}>
          <Plus className="mr-2 size-4" />
          Добавить SMART
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <CardTitle>
              Записи {total > 0 && <span className="text-muted-foreground font-normal text-sm ml-2">({total})</span>}
            </CardTitle>
            <div className="relative w-full sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setOffset(0);
                }}
                placeholder="Поиск по коду или названию"
                className="pl-9"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Загрузка...</p>
          ) : isError ? (
            <p className="text-sm text-destructive">
              {error instanceof Error ? error.message : "Ошибка загрузки"}
            </p>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {search.trim() ? "Ничего не найдено" : "Каталог пуст. Добавьте первый SMART код."}
            </p>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">SMART код</TableHead>
                      <TableHead>Наименование</TableHead>
                      <TableHead>Артикулы</TableHead>
                      <TableHead>Бренды</TableHead>
                      <TableHead className="w-[100px] text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((entry) => (
                      <TableRow key={entry.smart}>
                        <TableCell className="font-mono text-xs font-medium">
                          {entry.smart}
                        </TableCell>
                        <TableCell className="text-sm">
                          {entry.name || <span className="text-muted-foreground">--</span>}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {entry.articles.slice(0, 3).map((a) => (
                              <Badge key={a} variant="outline" className="text-xs">
                                {a}
                              </Badge>
                            ))}
                            {entry.articles.length > 3 && (
                              <Badge variant="outline" className="text-xs text-muted-foreground">
                                +{entry.articles.length - 3}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap gap-1">
                            {entry.brand.slice(0, 2).map((b) => (
                              <Badge key={b} variant="secondary" className="text-xs">
                                {b}
                              </Badge>
                            ))}
                            {entry.brand.length > 2 && (
                              <Badge variant="secondary" className="text-xs text-muted-foreground">
                                +{entry.brand.length - 2}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8"
                              onClick={() => openEditDialog(entry)}
                            >
                              <Pencil className="size-3.5" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="size-8 text-destructive hover:text-destructive"
                              onClick={() => setDeleteTarget(entry)}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {total > PAGE_SIZE && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-muted-foreground">
                    {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} из {total}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                    >
                      Назад
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={offset + PAGE_SIZE >= total}
                      onClick={() => setOffset(offset + PAGE_SIZE)}
                    >
                      Вперед
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? "Редактировать SMART" : "Новый SMART код"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                SMART код <span className="text-destructive">*</span>
              </label>
              <Input
                value={formSmart}
                onChange={(e) => setFormSmart(e.target.value)}
                placeholder="smart_12345"
                disabled={!!editing}
              />
              {editing && (
                <p className="text-xs text-muted-foreground">Код нельзя изменить (первичный ключ)</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Наименование</label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Название детали"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Артикулы</label>
              <TagInput
                value={formArticles}
                onChange={setFormArticles}
                placeholder="Введите артикул и нажмите Enter"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Бренды</label>
              <TagInput
                value={formBrand}
                onChange={setFormBrand}
                placeholder="Введите бренд и нажмите Enter"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Описание</label>
              <TagInput
                value={formDescription}
                onChange={setFormDescription}
                placeholder="Введите описание и нажмите Enter"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>
              Отмена
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || (!editing && !formSmart.trim())}
            >
              {isSaving ? "Сохранение..." : editing ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить SMART код?</AlertDialogTitle>
            <AlertDialogDescription>
              Вы собираетесь удалить <strong>{deleteTarget?.smart}</strong>
              {deleteTarget?.name && <> ({deleteTarget.name})</>}.
              Если этот код используется в движениях или экземплярах, удаление будет заблокировано.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteMutation.isPending}
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.smart)}
            >
              {deleteMutation.isPending ? "Удаление..." : "Удалить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Page>
  );
}
