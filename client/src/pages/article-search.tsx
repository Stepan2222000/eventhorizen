import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import type { ArticleSearchResult } from "@shared/schema";

export default function ArticleSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ArticleSearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<ArticleSearchResult | null>(null);
  const [isSearching, setIsSearching] = useState(false);

  const debounceTimeout = useRef<NodeJS.Timeout | null>(null);
  const searchAbortRef = useRef<AbortController | null>(null);

  const { toast } = useToast();
  const [, setLocation] = useLocation();

  // Cleanup debounce + abort on unmount.
  useEffect(() => {
    return () => {
      if (debounceTimeout.current) clearTimeout(debounceTimeout.current);
      searchAbortRef.current?.abort();
    };
  }, []);

  const performSearch = async (query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    searchAbortRef.current?.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    setIsSearching(true);

    try {
      const res = await fetch(
        `/api/articles/search?query=${encodeURIComponent(q)}&limit=15`,
        { credentials: "include", signal: controller.signal },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const results = (await res.json()) as ArticleSearchResult[];
      setSearchResults(results);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("Search error:", err);
      setSearchResults([]);
    } finally {
      if (!controller.signal.aborted) {
        setIsSearching(false);
      }
    }
  };

  const handleSearchInputChange = (value: string) => {
    setSearchQuery(value);

    if (selectedResult) {
      setSelectedResult(null);
    }

    if (debounceTimeout.current) clearTimeout(debounceTimeout.current);

    if (!value.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    debounceTimeout.current = setTimeout(() => performSearch(value), 300);
  };

  const handleSelectResult = (result: ArticleSearchResult) => {
    setSelectedResult(result);
    toast({
      title: "SMART код выбран",
      description: `Выбран: ${result.smart}`,
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Search Card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-foreground">Поиск артикулов</div>
                  <CardDescription>Найти SMART код по любому варианту артикула</CardDescription>
                </div>
                <i className="fas fa-magnifying-glass text-muted-foreground text-xl"></i>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div>
                <label className="block text-sm font-medium text-foreground mb-2">
                  Код артикула
                  <span className="text-muted-foreground font-normal ml-1">(любой формат)</span>
                </label>
                <div className="relative">
                  <Input
                    type="text"
                    placeholder="Начните вводить артикул или SMART..."
                    className="font-mono pr-10"
                    value={searchQuery}
                    onChange={(e) => handleSearchInputChange(e.target.value)}
                    data-testid="input-article-search"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-2">
                  <i className="fas fa-info-circle mr-1"></i>
                  Поддерживаются разные регистры, разделители и кириллица/латиница
                </p>
              </div>

              {/* Inline results list */}
              {searchQuery.trim().length >= 2 && searchResults.length > 0 && (
                <div className="mt-4 space-y-2 max-h-[60vh] overflow-y-auto">
                  <p className="text-xs text-muted-foreground mb-2">
                    Найдено: {searchResults.length} {searchResults.length >= 15 ? "(показаны первые 15)" : ""}
                  </p>
                  {searchResults.map((result) => (
                    <button
                      key={result.smart}
                      onClick={() => handleSelectResult(result)}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-all ${
                        selectedResult?.smart === result.smart
                          ? "border-primary bg-primary/5"
                          : "border-border bg-card hover:border-primary/50 hover:bg-primary/5"
                      }`}
                      data-testid={`select-smart-${result.smart}`}
                    >
                      <div className="flex items-start justify-between mb-1">
                        <div className="font-mono font-semibold text-sm text-primary">{result.smart}</div>
                        <div className="flex items-center gap-2">
                          {!!result.brand?.length && result.brand.some(b => b) && (
                            <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                              {result.brand.filter(b => b).join(", ")}
                            </span>
                          )}
                          <span className="text-xs font-mono text-muted-foreground">
                            Остаток: <span className="font-semibold">{result.currentStock}</span>
                          </span>
                        </div>
                      </div>
                      {!!result.articles?.length && (
                        <div className="text-xs text-muted-foreground">
                          <span className="font-semibold">Артикулы: </span>
                          <span className="font-mono">{result.articles.join(", ")}</span>
                        </div>
                      )}
                      {!!result.description?.length && result.description.some(d => d) && (
                        <div className="text-xs text-foreground/70 mt-0.5">
                          {result.description.filter(d => d).join(", ")}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {/* Empty state: query too short */}
              {searchQuery.trim().length === 1 && (
                <p className="text-xs text-muted-foreground mt-4">
                  Введите ещё минимум 1 символ для поиска
                </p>
              )}

              {/* Empty state: no results */}
              {searchQuery.trim().length >= 2 && !isSearching && searchResults.length === 0 && (
                <p className="text-sm text-muted-foreground mt-4">
                  Совпадений не найдено для «{searchQuery}»
                </p>
              )}
            </CardContent>
          </Card>

          {/* Results Card */}
          <Card>
            <CardHeader>
              <CardTitle>Результаты поиска</CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedResult && (
                <div className="text-center py-8 text-muted-foreground">
                  <i className="fas fa-search text-4xl mb-4"></i>
                  <p>Выберите элемент из списка слева</p>
                </div>
              )}

              {selectedResult && (
                <div className="border border-success/30 rounded-lg p-4 bg-success/5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <Badge className="bg-success text-success-foreground mb-2">
                        <i className="fas fa-check mr-1"></i>
                        Найдено совпадение
                      </Badge>
                      <h4 className="font-mono font-semibold text-lg text-foreground">{selectedResult.smart}</h4>
                    </div>
                  </div>
                  <div className="space-y-2 text-sm">
                    {!!selectedResult.articles?.length && (
                      <div className="flex flex-col gap-1">
                        <span className="text-muted-foreground">Артикулы:</span>
                        <span className="font-mono font-medium break-words">
                          {selectedResult.articles.join(", ")}
                        </span>
                      </div>
                    )}
                    {!!selectedResult.brand?.length && selectedResult.brand.some(b => b) && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Бренд:</span>
                        <span className="font-medium">{selectedResult.brand.filter(b => b).join(", ")}</span>
                      </div>
                    )}
                    {!!selectedResult.description?.length && selectedResult.description.some(d => d) && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Описание:</span>
                        <span className="font-medium">{selectedResult.description.filter(d => d).join(", ")}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Текущий остаток:</span>
                      <span className="font-mono font-semibold text-success">{selectedResult.currentStock}</span>
                    </div>
                  </div>
                  <div className="flex gap-2 mt-4">
                    <Button
                      className="flex-1"
                      data-testid="button-add-movement"
                      onClick={() => {
                        const params = new URLSearchParams({ smart: selectedResult.smart });
                        setLocation(`/movement?${params.toString()}`);
                      }}
                    >
                      <i className="fas fa-plus mr-2"></i>
                      Добавить движение
                    </Button>
                    <Button
                      variant="secondary"
                      size="icon"
                      data-testid="button-view-history"
                      onClick={() => setLocation("/history")}
                    >
                      <i className="fas fa-history"></i>
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
