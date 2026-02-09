import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Page } from "@/components/page";
import { SmartSearch } from "@/components/smart-search";
import { insertMovementSchema } from "@shared/schema";
import type { InsertMovement, Reason } from "@shared/schema";
import { z } from "zod";

const formSchema = insertMovementSchema
  .extend({
    qtyDelta: z
      .number()
      .int()
      .min(-999999)
      .max(999999)
      .refine((val) => val !== 0, { message: "Количество не может быть равно 0" }),
  })
  .superRefine((data, ctx) => {
    // Quantity direction rules
    if (data.reason === "purchase" && data.qtyDelta <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Для покупки количество должно быть положительным", path: ["qtyDelta"] });
    }
    if ((data.reason === "sale" || data.reason === "writeoff") && data.qtyDelta >= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Для продажи/списания количество должно быть отрицательным",
        path: ["qtyDelta"],
      });
    }

    // Required fields by reason (specification.md)
    const nonEmpty = (v: unknown) => typeof v === "string" && v.trim().length > 0;
    const isNum = (v: unknown) => nonEmpty(v) && Number.isFinite(Number(v));

    if (data.reason === "purchase") {
      if (!isNum(data.purchasePrice)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Цена закупки обязательна", path: ["purchasePrice"] });
      }
      if (!nonEmpty(data.boxNumber)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Номер коробки обязателен", path: ["boxNumber"] });
      }
    }

    if (data.reason === "sale") {
      if (!isNum(data.salePrice)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Цена продажи обязательна", path: ["salePrice"] });
      }
      // delivery can be 0, but must be present and numeric
      if (!isNum(data.deliveryPrice)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Стоимость доставки обязательна", path: ["deliveryPrice"] });
      }
      if (!data.shippingMethodId) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Способ доставки обязателен", path: ["shippingMethodId"] });
      }
    }

    if (data.reason === "adjust") {
      if (!nonEmpty(data.note)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Примечание обязательно для корректировки", path: ["note"] });
      }
      if (nonEmpty(data.purchasePrice) && !isNum(data.purchasePrice)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Цена за единицу должна быть числом", path: ["purchasePrice"] });
      }
    }
  });

type FormData = z.infer<typeof formSchema>;

export default function AddMovement() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchKey, setSearchKey] = useState(0);

  const prefillSmart = new URLSearchParams(window.location.search).get("smart") ?? undefined;

  const clearPrefillParamsFromUrl = () => {
    const searchParams = new URLSearchParams(window.location.search);
    const hadSmart = searchParams.has("smart");
    if (!hadSmart) return;

    searchParams.delete("smart");
    const nextSearch = searchParams.toString();
    const nextUrl = window.location.pathname + (nextSearch ? `?${nextSearch}` : "") + window.location.hash;
    window.history.replaceState(null, "", nextUrl);
  };

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      smart: prefillSmart || "",
      qtyDelta: 0,
      reason: undefined as any,
      note: "",
      purchasePrice: null,
      salePrice: null,
      deliveryPrice: null,
      boxNumber: null,
      trackNumber: null,
      shippingMethodId: null,
      saleStatus: null,
    },
  });

  // Show toast for URL prefill on mount.
  useEffect(() => {
    if (prefillSmart) {
      toast({
        title: "SMART код загружен",
        description: `Предзаполнено из URL: ${prefillSmart}`,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const { data: reasons } = useQuery<Reason[]>({
    queryKey: ["/api/reasons"],
  });

  const { data: shippingMethods } = useQuery<{ id: number; name: string }[]>({
    queryKey: ["/api/shipping-methods"],
  });

  const availableReasons = (reasons || []).filter((r) => r.code !== "return" && r.code !== "sale");
  const selectedReason = form.watch("reason");

  // Clear hidden fields when reason changes (and also clear stale saleStatus).
  useEffect(() => {
    if (!selectedReason) return;

    if (selectedReason === "purchase") {
      form.setValue("salePrice", null);
      form.setValue("deliveryPrice", null);
      form.setValue("trackNumber", null);
      form.setValue("shippingMethodId", null);
      form.setValue("saleStatus", null);
      return;
    }

    if (selectedReason === "sale") {
      form.setValue("purchasePrice", null);
      form.setValue("boxNumber", null);
      // sale fields remain
      form.setValue("saleStatus", null);
      return;
    }

    if (selectedReason === "adjust") {
      // purchasePrice is optional for adjust, but boxNumber is irrelevant
      form.setValue("boxNumber", null);
      form.setValue("salePrice", null);
      form.setValue("deliveryPrice", null);
      form.setValue("trackNumber", null);
      form.setValue("shippingMethodId", null);
      form.setValue("saleStatus", null);
      return;
    }

    // writeoff (and any other): clear all extra fields
    form.setValue("purchasePrice", null);
    form.setValue("salePrice", null);
    form.setValue("deliveryPrice", null);
    form.setValue("boxNumber", null);
    form.setValue("trackNumber", null);
    form.setValue("shippingMethodId", null);
    form.setValue("saleStatus", null);
  }, [selectedReason, form]);

  // Re-validate qty when reason changes.
  useEffect(() => {
    if (!selectedReason) return;
    void form.trigger("qtyDelta");
  }, [selectedReason, form]);

  const resetForm = () => {
    form.reset();
    setSearchKey((k) => k + 1);
    clearPrefillParamsFromUrl();
  };

  const createMovementMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await apiRequest("POST", "/api/movements", data as InsertMovement);
      return response.json();
    },
    onSuccess: (_movement, variables) => {
      const smart = variables.smart;

      // Full invalidation set (staleTime is Infinity by design).
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/sold-out"] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${smart}/purchases`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${smart}/sales`] });
      queryClient.invalidateQueries({ queryKey: [`/api/stock/${smart}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/top-parts?mode=profit`] });
      queryClient.invalidateQueries({ queryKey: [`/api/top-parts?mode=sales`] });
      queryClient.invalidateQueries({ queryKey: [`/api/top-parts?mode=combined`] });

      toast({
        title: "Движение записано",
        description: "Движение товара успешно зарегистрировано",
      });

      resetForm();
    },
    onError: (error) => {
      toast({
        title: "Ошибка записи движения",
        description: error instanceof Error ? error.message : "Произошла ошибка",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: FormData) => {
    createMovementMutation.mutate(data);
  };

  return (
    <Page
      title="Ввод движения"
      description="Поиск по артикулам или SMART, затем заполнение операции"
      containerClassName="max-w-2xl"
    >
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Параметры движения</span>
            <i className="fas fa-plus-circle text-muted-foreground text-xl"></i>
          </CardTitle>
        </CardHeader>
        <CardContent>
              <div className="mb-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-foreground">Продажи оформляются через заказы</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Покупки, списания и корректировки остаются здесь. Для продажи перейдите на страницу заказов.
                    </p>
                  </div>
                  <Link href="/orders">
                    <Button variant="outline" size="sm" data-testid="button-go-orders">
                      <i className="fas fa-cart-shopping mr-2"></i>
                      Открыть заказы
                    </Button>
                  </Link>
                </div>
              </div>

              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  {/* SMART search */}
                  <div>
                    <FormLabel>
                      Поиск (артикул или SMART) <span className="text-destructive">*</span>
                    </FormLabel>
                    <div className="mt-2">
                      <SmartSearch
                        key={searchKey}
                        defaultValue={prefillSmart}
                        onSelect={(item) => {
                          form.setValue("smart", item.smart, { shouldValidate: true });
                        }}
                        onClear={() => {
                          form.setValue("smart", "");
                        }}
                        placeholder="Начните вводить артикул или SMART..."
                        data-testid="input-smart-search"
                      />
                      <FormField
                        control={form.control}
                        name="smart"
                        render={() => (
                          <FormItem className="mt-1">
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <p className="text-xs text-muted-foreground mt-2">
                        <i className="fas fa-info-circle mr-1"></i>
                        Устаревшие запросы поиска отменяются автоматически (защита от гонок)
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    {/* qty */}
                    <FormField
                      control={form.control}
                      name="qtyDelta"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Изменение количества <span className="text-destructive">*</span>
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              min={-999999}
                              max={999999}
                              step={1}
                              placeholder="0"
                              className="font-mono tabular-nums h-11 text-base"
                              value={field.value ?? 0}
                              onChange={(e) => {
                                const val = Number.parseInt(e.target.value, 10);
                                field.onChange(Number.isFinite(val) ? val : 0);
                                void form.trigger("qtyDelta");
                              }}
                              data-testid="input-qty-delta"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* reason */}
                    <FormField
                      control={form.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Причина <span className="text-destructive">*</span>
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value || ""}>
                            <FormControl>
                              <SelectTrigger data-testid="select-reason">
                                <SelectValue placeholder="Выберите причину" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {availableReasons.map((reason) => (
                                <SelectItem key={reason.code} value={reason.code}>
                                  {reason.title}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* purchase fields */}
                    {selectedReason === "purchase" && (
                      <>
                        <FormField
                          control={form.control}
                          name="purchasePrice"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Цена закупки за ед. <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(e.target.value || null)}
                                  data-testid="input-purchase-price"
                                />
                              </FormControl>
                              <FormMessage />
                              {field.value && Number(field.value) > 0 && Math.abs(form.watch("qtyDelta")) > 0 && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  <i className="fas fa-calculator mr-1"></i>
                                  Итого: {(Number(field.value) * Math.abs(form.watch("qtyDelta"))).toFixed(2)} ₽
                                </p>
                              )}
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="boxNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Номер коробки <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Например: K-123"
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(e.target.value || null)}
                                  data-testid="input-box-number"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    )}

                    {/* sale fields */}
                    {selectedReason === "sale" && (
                      <>
                        <FormField
                          control={form.control}
                          name="salePrice"
                          render={({ field }) => {
                            const salePrice = field.value ? Number(field.value) : 0;
                            const qtyDelta = form.watch("qtyDelta");
                            const totalAmount = Math.abs(qtyDelta) * salePrice;

                            return (
                              <FormItem>
                                <FormLabel>
                                  Цена за единицу товара <span className="text-destructive">*</span>
                                </FormLabel>
                                <FormControl>
                                  <Input
                                    type="number"
                                    step="0.01"
                                    placeholder="0.00"
                                    value={field.value ?? ""}
                                    onChange={(e) => field.onChange(e.target.value || null)}
                                    data-testid="input-sale-price"
                                  />
                                </FormControl>
                                <FormMessage />
                                {salePrice > 0 && qtyDelta !== 0 && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    <i className="fas fa-calculator mr-1"></i>
                                    Общая сумма: {totalAmount.toFixed(2)} ₽
                                  </p>
                                )}
                              </FormItem>
                            );
                          }}
                        />
                        <FormField
                          control={form.control}
                          name="deliveryPrice"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Стоимость доставки <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(e.target.value || null)}
                                  data-testid="input-delivery-price"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="shippingMethodId"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Способ доставки <span className="text-destructive">*</span>
                              </FormLabel>
                              <Select
                                onValueChange={(value) => field.onChange(Number.parseInt(value, 10))}
                                value={field.value?.toString() || ""}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-shipping-method">
                                    <SelectValue placeholder="Выберите способ доставки" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {(shippingMethods || []).map((method) => (
                                    <SelectItem key={method.id} value={method.id.toString()}>
                                      {method.name}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                        <FormField
                          control={form.control}
                          name="trackNumber"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Трек-номер <span className="text-muted-foreground font-normal">(опционально)</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  placeholder="Например: RA123456789RU"
                                  value={field.value ?? ""}
                                  onChange={(e) => field.onChange(e.target.value || null)}
                                  data-testid="input-track-number"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
                      </>
                    )}

                    {/* adjust fields */}
                    {selectedReason === "adjust" && (
                      <FormField
                        control={form.control}
                        name="purchasePrice"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>
                              Цена за единицу{" "}
                              <span className="text-muted-foreground font-normal">(опционально)</span>
                            </FormLabel>
                            <FormControl>
                              <Input
                                type="number"
                                step="0.01"
                                placeholder="0.00"
                                value={field.value ?? ""}
                                onChange={(e) => field.onChange(e.target.value || null)}
                                data-testid="input-adjust-unit-price"
                              />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                  </div>

                  {/* note */}
                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Примечание{" "}
                          {selectedReason === "adjust" ? (
                            <span className="text-destructive">*</span>
                          ) : (
                            <span className="text-muted-foreground font-normal">(опционально)</span>
                          )}
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            rows={3}
                            placeholder="Дополнительные комментарии..."
                            className="resize-none"
                            value={field.value ?? ""}
                            onChange={field.onChange}
                            data-testid="textarea-note"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-3 pt-2">
                    <Button type="submit" className="flex-1" disabled={createMovementMutation.isPending} data-testid="button-submit-movement">
                      {createMovementMutation.isPending ? (
                        <>
                          <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin mr-2"></div>
                          Запись...
                        </>
                      ) : (
                        <>
                          <i className="fas fa-check mr-2"></i>
                          Записать движение
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={resetForm}
                      data-testid="button-clear-form"
                    >
                      <i className="fas fa-rotate-left mr-2"></i>
                      Очистить
                    </Button>
                  </div>
                </form>
              </Form>
        </CardContent>
      </Card>
    </Page>
  );
}
