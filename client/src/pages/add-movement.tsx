import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { insertMovementSchema } from "@shared/schema";
import type { ArticleSearchResult, InsertMovement, Reason } from "@shared/schema";
import { z } from "zod";
import { Check } from "lucide-react";

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
  const [location] = useLocation();

  const [searchQuery, setSearchQuery] = useState("");
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState<ArticleSearchResult[]>([]);
  const [selectedItem, setSelectedItem] = useState<ArticleSearchResult | null>(null);
  const [hasPrefilled, setHasPrefilled] = useState(false);

  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

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
      smart: "",
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

  // Prefill by SMART from URL (only `smart` is supported by spec).
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const smart = searchParams.get("smart");
    if (!smart || hasPrefilled) return;

    form.setValue("smart", smart);
    setSearchQuery(smart);
    setHasPrefilled(true);
    toast({
      title: "SMART код загружен",
      description: `Предзаполнено из URL: ${smart}`,
    });
  }, [location, hasPrefilled, form, toast]);

  // Cleanup debounce + abort on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  const performAutocompleteSearch = async (query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setAutocompleteResults([]);
      setAutocompleteOpen(false);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    try {
      const res = await fetch(`/api/articles/search?query=${encodeURIComponent(q)}`, {
        credentials: "include",
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const results = (await res.json()) as ArticleSearchResult[];
      setAutocompleteResults(results);
      setAutocompleteOpen(results.length > 0);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("Autocomplete search error:", err);
      setAutocompleteResults([]);
      setAutocompleteOpen(false);
    }
  };

  const handleSearchInputChange = (value: string) => {
    setSearchQuery(value);

    // If user starts typing again, drop previous selection to avoid mismatch.
    if (selectedItem) {
      setSelectedItem(null);
      form.setValue("smart", "");
    }

    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
    debounceTimeout.current = setTimeout(() => performAutocompleteSearch(value), 300);
  };

  const handleSelectItem = (item: ArticleSearchResult) => {
    setSelectedItem(item);
    form.setValue("smart", item.smart, { shouldValidate: true });
    setSearchQuery(item.smart);
    setAutocompleteOpen(false);
    setAutocompleteResults([]);
    toast({
      title: "Позиция выбрана",
      description: `SMART код: ${item.smart}`,
    });
  };

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

      form.reset();
      setSelectedItem(null);
      setSearchQuery("");
      setAutocompleteOpen(false);
      setAutocompleteResults([]);
      clearPrefillParamsFromUrl();
      setHasPrefilled(false);
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

  const incrementQty = () => {
    const currentValue = form.getValues("qtyDelta");
    form.setValue("qtyDelta", currentValue + 1);
    void form.trigger("qtyDelta");
  };

  const decrementQty = () => {
    const currentValue = form.getValues("qtyDelta");
    form.setValue("qtyDelta", currentValue - 1);
    void form.trigger("qtyDelta");
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-foreground">Ввод движения</div>
                  <p className="text-sm text-muted-foreground mt-1">Поиск по артикулам или SMART, затем заполнение операции</p>
                </div>
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
                      <Popover open={autocompleteOpen} onOpenChange={setAutocompleteOpen}>
                        <PopoverTrigger asChild>
                          <div>
                            <Input
                              placeholder="Начните вводить артикул или SMART..."
                              className="font-mono"
                              value={searchQuery}
                              onChange={(e) => handleSearchInputChange(e.target.value)}
                              data-testid="input-smart-search"
                              onKeyDown={(e) => {
                                if (e.key === "Escape") setAutocompleteOpen(false);
                              }}
                            />
                          </div>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-[var(--radix-popover-trigger-width)] p-0"
                          align="start"
                          onOpenAutoFocus={(e) => e.preventDefault()}
                        >
                          <Command>
                            <CommandList>
                              <CommandEmpty>Ничего не найдено</CommandEmpty>
                              <CommandGroup heading="Найденные позиции">
                                {autocompleteResults.map((result, idx) => (
                                  <CommandItem
                                    key={`${result.smart}-${idx}`}
                                    value={result.smart}
                                    onSelect={() => handleSelectItem(result)}
                                    className="cursor-pointer"
                                    data-testid={`autocomplete-item-${idx}`}
                                  >
                                    <div className="flex items-start justify-between gap-3 w-full">
                                      <div className="flex flex-col gap-1">
                                        <div className="font-mono text-sm font-bold text-primary">{result.smart}</div>
                                        {!!result.articles?.length && (
                                          <div className="font-mono text-xs text-muted-foreground break-words">
                                            {result.articles.join(", ")}
                                          </div>
                                        )}
                                        {result.name && (
                                          <div className="text-xs text-muted-foreground">{result.name}</div>
                                        )}
                                      </div>
                                      <div className="flex flex-col items-end gap-1">
                                        {!!result.brand?.length && (
                                          <div className="text-xs text-muted-foreground">{result.brand.join(", ")}</div>
                                        )}
                                        <div className="text-xs text-muted-foreground">
                                          Остаток: <span className="font-mono font-semibold">{result.currentStock}</span>
                                        </div>
                                      </div>
                                    </div>
                                  </CommandItem>
                                ))}
                              </CommandGroup>
                            </CommandList>
                          </Command>
                        </PopoverContent>
                      </Popover>
                      <p className="text-xs text-muted-foreground mt-2">
                        <i className="fas fa-info-circle mr-1"></i>
                        Устаревшие запросы поиска отменяются автоматически (защита от гонок)
                      </p>
                    </div>
                  </div>

                  {/* Selected SMART */}
                  <FormField
                    control={form.control}
                    name="smart"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Выбранный SMART код <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder="Выберите из поиска выше"
                            className="font-mono bg-muted"
                            value={field.value || ""}
                            readOnly
                            data-testid="input-smart-code"
                          />
                        </FormControl>
                        <FormMessage />
                        {selectedItem && (
                          <div className="mt-2 text-xs text-muted-foreground">
                            <div className="flex items-center gap-2">
                              <Check className="h-4 w-4 text-success" />
                              <span>Выбрано: </span>
                              <span className="font-mono font-semibold text-foreground">{selectedItem.smart}</span>
                            </div>
                            {!!selectedItem.articles?.length && (
                              <div className="mt-1">
                                <span className="font-semibold">Артикулы:</span>{" "}
                                <span className="font-mono">{selectedItem.articles.join(", ")}</span>
                              </div>
                            )}
                          </div>
                        )}
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    {/* qty */}
                    <FormField
                      control={form.control}
                      name="qtyDelta"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Изменение количества <span className="text-destructive">*</span>
                          </FormLabel>
                          <div className="flex gap-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={decrementQty}
                              data-testid="button-decrement-qty"
                              className="text-orange-600 hover:text-orange-700 hover:bg-orange-50"
                            >
                              <i className="fas fa-minus"></i>
                            </Button>
                            <FormControl>
                              <Input
                                type="number"
                                className="font-mono text-center"
                                value={field.value ?? 0}
                                onChange={(e) => {
                                  const val = Number.parseInt(e.target.value, 10);
                                  field.onChange(Number.isFinite(val) ? val : 0);
                                  void form.trigger("qtyDelta");
                                }}
                                data-testid="input-qty-delta"
                              />
                            </FormControl>
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={incrementQty}
                              data-testid="button-increment-qty"
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            >
                              <i className="fas fa-plus"></i>
                            </Button>
                          </div>
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
                      onClick={() => {
                        form.reset();
                        setSelectedItem(null);
                        setSearchQuery("");
                        setAutocompleteOpen(false);
                        setAutocompleteResults([]);
                        clearPrefillParamsFromUrl();
                        setHasPrefilled(false);
                      }}
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
        </div>
      </div>
    </div>
  );
}
