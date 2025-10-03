import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { DisambiguationModal } from "@/components/disambiguation-modal";
import type { ArticleSearchResult } from "@shared/schema";

export default function ArticleSearch() {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ArticleSearchResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<ArticleSearchResult | null>(null);
  const [showDisambiguation, setShowDisambiguation] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();

  const searchMutation = useMutation({
    mutationFn: async (query: string) => {
      const response = await apiRequest("GET", `/api/articles/search?query=${encodeURIComponent(query)}`);
      return response.json();
    },
    onSuccess: (results: ArticleSearchResult[]) => {
      setSearchResults(results);
      setIsSearching(false);
      
      if (results.length === 0) {
        toast({
          title: "Совпадений не найдено",
          description: `SMART код для артикула не найден: ${searchQuery}`,
          variant: "destructive",
        });
      } else if (results.length === 1) {
        setSelectedResult(results[0]);
        toast({
          title: "Найдено совпадение",
          description: `Найден SMART код: ${results[0].smart}`,
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

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    
    setIsSearching(true);
    setSearchResults([]);
    setSelectedResult(null);
    searchMutation.mutate(searchQuery.trim());
  };

  const handleSelectMatch = (result: ArticleSearchResult) => {
    setSelectedResult(result);
    setShowDisambiguation(false);
    toast({
      title: "SMART код выбран",
      description: `Выбран: ${result.smart}`,
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <h2 className="text-2xl font-bold text-foreground">Поиск артикулов</h2>
          <p className="text-sm text-muted-foreground mt-1">Поиск SMART кодов по вариантам артикулов</p>
        </div>
      </header>

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
              <form onSubmit={handleSearch} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-foreground mb-2">
                    Код артикула
                    <span className="text-muted-foreground font-normal ml-1">(любой формат)</span>
                  </label>
                  <div className="relative">
                    <Input
                      type="text"
                      placeholder="например: ABC-123, АБЦ123, abc.123"
                      className="font-mono pr-20"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      data-testid="input-article-search"
                    />
                    <Button 
                      type="submit" 
                      size="sm"
                      className="absolute right-2 top-1/2 -translate-y-1/2"
                      disabled={isSearching || !searchQuery.trim()}
                      data-testid="button-search-article"
                    >
                      {isSearching ? (
                        <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin"></div>
                      ) : (
                        "Поиск"
                      )}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    <i className="fas fa-info-circle mr-1"></i>
                    Поддерживаются разные регистры, разделители и кириллица/латиница
                  </p>
                </div>
              </form>

              {/* Search Status */}
              {isSearching && (
                <div className="border border-border rounded-lg p-4 bg-muted/50 mt-4">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
                    <span className="text-sm text-muted-foreground">Поиск в базе данных...</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results Card */}
          <Card>
            <CardHeader>
              <CardTitle>Результаты поиска</CardTitle>
            </CardHeader>
            <CardContent>
              {!selectedResult && searchResults.length === 0 && !isSearching && (
                <div className="text-center py-8 text-muted-foreground">
                  <i className="fas fa-search text-4xl mb-4"></i>
                  <p>Введите артикул для поиска</p>
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
                    <div className="flex flex-col gap-1">
                      <span className="text-muted-foreground">Артикулы:</span>
                      <span className="font-mono font-medium break-words">
                        {selectedResult.articles.join(', ')}
                      </span>
                    </div>
                    {selectedResult.brand && selectedResult.brand.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Бренд:</span>
                        <span className="font-medium">{selectedResult.brand.join(', ')}</span>
                      </div>
                    )}
                    {selectedResult.description && selectedResult.description.length > 0 && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Описание:</span>
                        <span className="font-medium">{selectedResult.description.join(', ')}</span>
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
                      onClick={() => setLocation('/add-movement')}
                    >
                      <i className="fas fa-plus mr-2"></i>
                      Добавить движение
                    </Button>
                    <Button 
                      variant="secondary" 
                      size="icon" 
                      data-testid="button-view-history"
                      onClick={() => setLocation('/movements')}
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

      <DisambiguationModal
        isOpen={showDisambiguation}
        onClose={() => setShowDisambiguation(false)}
        onSelect={handleSelectMatch}
        matches={searchResults}
        searchQuery={searchQuery}
      />
    </div>
  );
}
