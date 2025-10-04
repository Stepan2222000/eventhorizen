import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
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
import type { InsertMovement, Reason, ArticleSearchResult } from "@shared/schema";
import { z } from "zod";
import { DisambiguationModal } from "@/components/disambiguation-modal";
import { Check } from "lucide-react";

const formSchema = insertMovementSchema.extend({
  qtyDelta: z.number().int().min(-999999).max(999999),
});

type FormData = z.infer<typeof formSchema>;

export default function AddMovement() {
  const [qtyInput, setQtyInput] = useState(0);
  const [searchResults, setSearchResults] = useState<ArticleSearchResult[]>([]);
  const [showDisambiguation, setShowDisambiguation] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [lastSearchedArticle, setLastSearchedArticle] = useState<string>("");
  const [hasPrefilled, setHasPrefilled] = useState(false);
  const [autocompleteOpen, setAutocompleteOpen] = useState(false);
  const [autocompleteResults, setAutocompleteResults] = useState<ArticleSearchResult[]>([]);
  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const [location] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      smart: "",
      article: "",
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

  // Pre-fill form from URL parameters
  useEffect(() => {
    // Extract query string from location
    const queryString = location.split('?')[1];
    if (!queryString) return;
    
    const params = new URLSearchParams(queryString);
    const smart = params.get('smart');
    const article = params.get('article');
    
    // Only prefill if both params exist and haven't already prefilled
    if (smart && article && !hasPrefilled) {
      form.reset({
        smart,
        article,
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
      });
      setHasPrefilled(true);
      toast({
        title: "Данные загружены",
        description: "Артикул и SMART код автоматически заполнены из результатов поиска",
      });
    }
  }, [location, hasPrefilled, form, toast]);

  // Cleanup debounce timeout on unmount
  useEffect(() => {
    return () => {
      if (debounceTimeout.current) {
        clearTimeout(debounceTimeout.current);
      }
    };
  }, []);

  // Autocomplete search with debouncing
  const performAutocompleteSearch = async (query: string) => {
    if (!query.trim() || query.trim().length < 2) {
      setAutocompleteResults([]);
      setAutocompleteOpen(false);
      return;
    }

    try {
      const response = await apiRequest("GET", `/api/articles/search?query=${encodeURIComponent(query.trim())}`);
      const results: ArticleSearchResult[] = await response.json();
      setAutocompleteResults(results);
      setAutocompleteOpen(results.length > 0);
    } catch (error) {
      console.error("Autocomplete search error:", error);
      setAutocompleteResults([]);
      setAutocompleteOpen(false);
    }
  };

  // Trigger autocomplete search on article input change with debouncing
  const handleArticleInputChange = (value: string) => {
    if (debounceTimeout.current) {
      clearTimeout(debounceTimeout.current);
    }

    debounceTimeout.current = setTimeout(() => {
      performAutocompleteSearch(value);
    }, 300);
  };

  const { data: reasons } = useQuery({
    queryKey: ["/api/reasons"],
  });

  const { data: shippingMethods } = useQuery({
    queryKey: ["/api/shipping-methods"],
  });

  // Watch the reason field to show conditional fields
  const selectedReason = form.watch("reason");

  const searchArticleMutation = useMutation({
    mutationFn: async (query: string) => {
      const response = await apiRequest("GET", `/api/articles/search?query=${encodeURIComponent(query)}`);
      return response.json();
    },
    onSuccess: (results: ArticleSearchResult[], variables) => {
      // Ignore results if article has changed since search was initiated
      const currentArticle = form.getValues('article');
      if (currentArticle.trim() !== variables.trim()) {
        setIsSearching(false);
        return;
      }
      
      setSearchResults(results);
      setIsSearching(false);
      
      if (results.length === 0) {
        toast({
          title: "Совпадений не найдено",
          description: `SMART код для артикула не найден`,
          variant: "destructive",
        });
        form.setValue('smart', '');
      } else if (results.length === 1) {
        form.setValue('smart', results[0].smart);
        toast({
          title: "SMART код найден",
          description: `Автоматически подставлен: ${results[0].smart}`,
        });
      } else {
        setShowDisambiguation(true);
      }
    },
    onError: (error) => {
      setIsSearching(false);
      toast({
        title: "Ошибка поиска",
        description: error instanceof Error ? error.message : "Не удалось выполнить поиск",
        variant: "destructive",
      });
    },
  });

  const createMovementMutation = useMutation({
    mutationFn: async (data: FormData) => {
      const response = await apiRequest("POST", "/api/movements", data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stock"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      
      toast({
        title: "Движение записано",
        description: "Движение товара успешно зарегистрировано",
      });
      
      // Reset all form and search state
      form.reset();
      setQtyInput(0);
      setSearchResults([]);
      setShowDisambiguation(false);
      setIsSearching(false);
      setLastSearchedArticle("");
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
    // Set saleStatus to "awaiting_shipment" for sales
    const saleStatus = data.reason === "sale" ? "awaiting_shipment" : null;
    
    createMovementMutation.mutate({
      ...data,
      qtyDelta: qtyInput,
      saleStatus,
    });
  };

  const incrementQty = () => {
    setQtyInput(prev => prev + 1);
    form.setValue('qtyDelta', qtyInput + 1);
  };

  const decrementQty = () => {
    setQtyInput(prev => prev - 1);
    form.setValue('qtyDelta', qtyInput - 1);
  };

  const handleArticleSearch = () => {
    const article = form.getValues('article');
    if (!article.trim()) {
      toast({
        title: "Введите артикул",
        description: "Для поиска SMART кода необходимо ввести артикул",
        variant: "destructive",
      });
      return;
    }
    
    setIsSearching(true);
    setSearchResults([]);
    searchArticleMutation.mutate(article.trim());
  };

  const handleSelectMatch = (result: ArticleSearchResult) => {
    form.setValue('smart', result.smart);
    setShowDisambiguation(false);
    toast({
      title: "SMART код выбран",
      description: `Выбран: ${result.smart}`,
    });
  };

  const handleAutocompleteSelect = (result: ArticleSearchResult) => {
    // Set the full article code from the selected result
    const fullArticles = result.articles.join(', ');
    form.setValue('article', fullArticles);
    form.setValue('smart', result.smart);
    setAutocompleteOpen(false);
    setAutocompleteResults([]);
    toast({
      title: "Артикул выбран",
      description: `SMART код: ${result.smart}`,
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <h2 className="text-2xl font-bold text-foreground">Добавить движение</h2>
          <p className="text-sm text-muted-foreground mt-1">Зарегистрируйте изменение остатков</p>
        </div>
      </header>

      <div className="p-8">
        <div className="max-w-2xl mx-auto">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-foreground">Ввод движения</div>
                  <p className="text-sm text-muted-foreground mt-1">Введите данные движения товара</p>
                </div>
                <i className="fas fa-plus-circle text-muted-foreground text-xl"></i>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
                  <FormField
                    control={form.control}
                    name="article"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Артикул <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <div className="flex gap-2">
                            <Popover open={autocompleteOpen} onOpenChange={setAutocompleteOpen}>
                              <PopoverTrigger asChild>
                                <div className="flex-1">
                                  <Input 
                                    placeholder="Начните вводить артикул..." 
                                    className="font-mono" 
                                    {...field}
                                    onChange={(e) => {
                                      field.onChange(e);
                                      handleArticleInputChange(e.target.value);
                                      // Clear all search state when article changes
                                      form.setValue('smart', '');
                                      setSearchResults([]);
                                      setShowDisambiguation(false);
                                      setIsSearching(false);
                                    }}
                                    data-testid="input-article"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        handleArticleSearch();
                                      } else if (e.key === 'Escape') {
                                        setAutocompleteOpen(false);
                                      }
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
                                    <CommandGroup heading="Найденные артикулы">
                                      {autocompleteResults.map((result, idx) => (
                                        <CommandItem
                                          key={`${result.smart}-${idx}`}
                                          value={result.smart}
                                          onSelect={() => handleAutocompleteSelect(result)}
                                          className="cursor-pointer"
                                          data-testid={`autocomplete-item-${idx}`}
                                        >
                                          <div className="flex flex-col gap-1 w-full">
                                            <div className="flex items-center justify-between">
                                              <span className="font-mono text-sm font-medium">
                                                {result.articles.join(', ')}
                                              </span>
                                              <span className="text-xs text-muted-foreground font-mono">
                                                {result.smart}
                                              </span>
                                            </div>
                                            {result.name && (
                                              <span className="text-xs text-muted-foreground">
                                                {result.name}
                                              </span>
                                            )}
                                          </div>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  </CommandList>
                                </Command>
                              </PopoverContent>
                            </Popover>
                            <Button
                              type="button"
                              onClick={handleArticleSearch}
                              disabled={isSearching}
                              data-testid="button-search-smart"
                            >
                              {isSearching ? (
                                <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                              ) : (
                                <>
                                  <i className="fas fa-search mr-2"></i>
                                  Найти SMART
                                </>
                              )}
                            </Button>
                          </div>
                        </FormControl>
                        <FormMessage />
                        <p className="text-xs text-muted-foreground mt-1">
                          <i className="fas fa-info-circle mr-1"></i>
                          Начните вводить артикул - появятся подсказки
                        </p>
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="smart"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          SMART код <span className="text-destructive">*</span>
                        </FormLabel>
                        <FormControl>
                          <Input 
                            placeholder="Будет найден автоматически" 
                            className="font-mono bg-muted cursor-not-allowed" 
                            {...field}
                            onKeyDown={(e) => e.preventDefault()}
                            onPaste={(e) => e.preventDefault()}
                            data-testid="input-smart-code"
                          />
                        </FormControl>
                        <FormMessage />
                        {field.value && (
                          <p className="text-xs text-success mt-1">
                            <i className="fas fa-check-circle mr-1"></i>
                            SMART код найден
                          </p>
                        )}
                      </FormItem>
                    )}
                  />

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>
                        Изменение количества <span className="text-destructive">*</span>
                      </Label>
                      <div className="flex gap-2">
                        <Button 
                          type="button" 
                          variant="destructive" 
                          size="icon"
                          onClick={decrementQty}
                          data-testid="button-decrement-qty"
                        >
                          <i className="fas fa-minus"></i>
                        </Button>
                        <Input
                          type="number"
                          className="font-mono text-center"
                          value={qtyInput}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 0;
                            setQtyInput(val);
                            form.setValue('qtyDelta', val);
                          }}
                          data-testid="input-qty-delta"
                        />
                        <Button 
                          type="button" 
                          className="bg-success text-success-foreground hover:bg-success/90"
                          size="icon"
                          onClick={incrementQty}
                          data-testid="button-increment-qty"
                        >
                          <i className="fas fa-plus"></i>
                        </Button>
                      </div>
                    </div>

                    <FormField
                      control={form.control}
                      name="reason"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Причина <span className="text-destructive">*</span>
                          </FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger data-testid="select-reason">
                                <SelectValue placeholder="Выберите причину" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {(reasons as Reason[] || []).map((reason) => (
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

                    {/* Conditional fields for purchase */}
                    {selectedReason === "purchase" && (
                      <>
                        <FormField
                          control={form.control}
                          name="purchasePrice"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Цена закупки <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  {...field}
                                  value={field.value || ""}
                                  onChange={(e) => field.onChange(e.target.value || null)}
                                  data-testid="input-purchase-price"
                                />
                              </FormControl>
                              <FormMessage />
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
                                  {...field}
                                  value={field.value || ""}
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

                    {/* Conditional fields for sale */}
                    {selectedReason === "sale" && (
                      <>
                        <FormField
                          control={form.control}
                          name="salePrice"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>
                                Цена продажи <span className="text-destructive">*</span>
                              </FormLabel>
                              <FormControl>
                                <Input
                                  type="number"
                                  step="0.01"
                                  placeholder="0.00"
                                  {...field}
                                  value={field.value || ""}
                                  onChange={(e) => field.onChange(e.target.value || null)}
                                  data-testid="input-sale-price"
                                />
                              </FormControl>
                              <FormMessage />
                            </FormItem>
                          )}
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
                                  {...field}
                                  value={field.value || ""}
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
                                onValueChange={(value) => field.onChange(parseInt(value))} 
                                value={field.value?.toString() || ""}
                              >
                                <FormControl>
                                  <SelectTrigger data-testid="select-shipping-method">
                                    <SelectValue placeholder="Выберите способ доставки" />
                                  </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                  {(shippingMethods as any[] || []).map((method: any) => (
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
                                  {...field}
                                  value={field.value || ""}
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
                  </div>

                  <FormField
                    control={form.control}
                    name="note"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>
                          Примечание <span className="text-muted-foreground font-normal">(опционально)</span>
                        </FormLabel>
                        <FormControl>
                          <Textarea
                            rows={3}
                            placeholder="Дополнительные комментарии..."
                            className="resize-none"
                            {...field}
                            value={field.value || ""}
                            data-testid="textarea-note"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <div className="flex gap-3 pt-2">
                    <Button 
                      type="submit" 
                      className="flex-1"
                      disabled={createMovementMutation.isPending}
                      data-testid="button-submit-movement"
                    >
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
                        setQtyInput(0);
                        setSearchResults([]);
                        setShowDisambiguation(false);
                        setIsSearching(false);
                        setLastSearchedArticle("");
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

      <DisambiguationModal
        isOpen={showDisambiguation}
        onClose={() => setShowDisambiguation(false)}
        onSelect={handleSelectMatch}
        matches={searchResults}
        searchQuery={form.getValues('article')}
      />
    </div>
  );
}
