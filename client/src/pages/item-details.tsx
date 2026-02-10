import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Page } from "@/components/page";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { ItemDetails, ItemMedia, ItemState, Movement } from "@shared/schema";

function getStateBadge(state: ItemState) {
  if (state === "in_stock") return { label: "in_stock", variant: "default" as const };
  if (state === "sold") return { label: "sold", variant: "secondary" as const };
  if (state === "written_off") return { label: "written_off", variant: "destructive" as const };
  return { label: state, variant: "outline" as const };
}

export default function ItemDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const itemId = Number.parseInt(id || "", 10);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [noteDraft, setNoteDraft] = useState("");
  const [uploadKind, setUploadKind] = useState<"photo" | "video">("photo");
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  const itemQuery = useQuery<ItemDetails>({
    queryKey: [`/api/items/${itemId}`],
    enabled: Number.isFinite(itemId),
  });

  const item = itemQuery.data;

  useEffect(() => {
    if (!item) return;
    setNoteDraft(item.note || "");
  }, [item?.id, item?.note]);

  const updateNoteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("PATCH", `/api/items/${itemId}`, { note: noteDraft.trim() || null });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/items/${itemId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/items"] });
      toast({ title: "Заметка сохранена" });
    },
    onError: (error) => {
      toast({
        title: "Ошибка сохранения",
        description: error instanceof Error ? error.message : "Не удалось сохранить",
        variant: "destructive",
      });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async () => {
      if (!uploadFile) throw new Error("Выберите файл");
      const form = new FormData();
      form.set("kind", uploadKind);
      form.set("file", uploadFile);
      const res = await fetch(`/api/items/${itemId}/media`, { method: "POST", body: form, credentials: "include" });
      const text = await res.text();
      if (!res.ok) {
        try {
          const json = JSON.parse(text);
          throw new Error(json.error || json.message || text);
        } catch {
          throw new Error(text || res.statusText);
        }
      }
      return JSON.parse(text);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/items/${itemId}`] });
      setUploadFile(null);
      toast({ title: "Файл загружен" });
    },
    onError: (error) => {
      toast({
        title: "Ошибка загрузки",
        description: error instanceof Error ? error.message : "Не удалось загрузить файл",
        variant: "destructive",
      });
    },
  });

  const deleteMediaMutation = useMutation({
    mutationFn: async (mediaId: number) => {
      await apiRequest("DELETE", `/api/item-media/${mediaId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/items/${itemId}`] });
      toast({ title: "Медиа удалено" });
    },
    onError: (error) => {
      toast({
        title: "Ошибка удаления",
        description: error instanceof Error ? error.message : "Не удалось удалить",
        variant: "destructive",
      });
    },
  });

  const movements: Movement[] = useMemo(() => (item?.movements || []) as Movement[], [item?.movements]);

  if (!Number.isFinite(itemId)) {
    return (
      <Page title="Экземпляр" description="Некорректный ID">
        <p className="text-sm text-muted-foreground">Некорректный ID</p>
      </Page>
    );
  }

  if (itemQuery.isLoading) {
    return (
      <Page title="Экземпляр" description="Загрузка...">
        <p className="text-sm text-muted-foreground">Загрузка...</p>
      </Page>
    );
  }

  if (itemQuery.isError || !item) {
    return (
      <Page title="Экземпляр" description="Не найден">
        <p className="text-sm text-destructive">
          {itemQuery.isError ? String((itemQuery.error as Error)?.message || "Ошибка") : "Не найден"}
        </p>
      </Page>
    );
  }

  const badge = getStateBadge(item.state);

  return (
    <Page
      title={item.itemCode}
      description={`${item.smart} · ${item.boxNumber || "без коробки"}`}
      actions={
        <div className="flex flex-wrap gap-2">
          <Link href="/items">
            <Button variant="outline" data-testid="button-back-items">К списку</Button>
          </Link>
          <Link href={`/stock/${encodeURIComponent(item.smart)}`}>
            <Button variant="outline" data-testid="button-open-smart">К SMART</Button>
          </Link>
        </div>
      }
    >
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Состояние</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Статус</p>
              <Badge variant={badge.variant}>{badge.label}</Badge>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Коробка</p>
              <p className="font-mono font-semibold">{item.boxNumber || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Создан</p>
              <p className="font-mono">{new Date(item.createdAt).toLocaleString("ru-RU")}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Обновлен</p>
              <p className="font-mono">{new Date(item.updatedAt).toLocaleString("ru-RU")}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Заметка</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              rows={4}
              placeholder="Комментарий по конкретной штуке"
              data-testid="textarea-item-note"
            />
            <div className="flex justify-end">
              <Button
                onClick={() => updateNoteMutation.mutate()}
                disabled={updateNoteMutation.isPending}
                data-testid="button-save-item-note"
              >
                {updateNoteMutation.isPending ? "Сохранение..." : "Сохранить"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Медиа</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-[160px_1fr_160px] gap-3 items-end">
              <div>
                <p className="text-xs text-muted-foreground mb-1">Тип</p>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={uploadKind}
                  onChange={(e) => setUploadKind(e.target.value as "photo" | "video")}
                  data-testid="select-item-media-kind"
                >
                  <option value="photo">Фото</option>
                  <option value="video">Видео</option>
                </select>
              </div>
              <div>
                <p className="text-xs text-muted-foreground mb-1">Файл</p>
                <Input
                  type="file"
                  onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                  data-testid="input-item-media-file"
                />
              </div>
              <Button
                onClick={() => uploadMutation.mutate()}
                disabled={uploadMutation.isPending || !uploadFile}
                data-testid="button-upload-item-media"
              >
                {uploadMutation.isPending ? "Загрузка..." : "Загрузить"}
              </Button>
            </div>

            {item.media.length === 0 ? (
              <p className="text-sm text-muted-foreground">Медиа пока нет</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {item.media.map((m: ItemMedia) => (
                  <div key={m.id} className="rounded-md border p-3 space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">{m.kind}</p>
                        <p className="text-xs text-muted-foreground truncate">{m.filename || m.mime}</p>
                        <p className="text-xs text-muted-foreground">{Math.round((m.sizeBytes || 0) / 1024)} KB</p>
                      </div>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => deleteMediaMutation.mutate(m.id)}
                        disabled={deleteMediaMutation.isPending}
                        data-testid={`button-delete-media-${m.id}`}
                      >
                        Удалить
                      </Button>
                    </div>

                    {m.kind === "photo" ? (
                      <img
                        src={`/api/item-media/${m.id}`}
                        alt={m.filename || m.mime}
                        className="w-full rounded-md border"
                        loading="lazy"
                      />
                    ) : (
                      <video className="w-full rounded-md border" controls preload="metadata">
                        <source src={`/api/item-media/${m.id}`} type={m.mime} />
                      </video>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>История</CardTitle>
          </CardHeader>
          <CardContent>
            {movements.length === 0 ? (
              <p className="text-sm text-muted-foreground">Движений пока нет</p>
            ) : (
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[160px]">Дата/Время</TableHead>
                      <TableHead className="w-[110px]">Причина</TableHead>
                      <TableHead className="text-right w-[90px]">Кол-во Δ</TableHead>
                      <TableHead className="w-[160px]">Коробка</TableHead>
                      <TableHead>Заметка</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {movements.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell className="font-mono text-sm">
                          {new Date(m.createdAt).toLocaleString("ru-RU")}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize">{m.reason}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono font-semibold">
                          {m.qtyDelta >= 0 ? "+" : ""}
                          {m.qtyDelta}
                        </TableCell>
                        <TableCell className="font-mono text-sm">{m.boxNumber || "—"}</TableCell>
                        <TableCell className="max-w-[520px] truncate text-sm text-muted-foreground">{m.note || "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </Page>
  );
}
