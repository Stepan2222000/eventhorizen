import { useEffect, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Check, X } from "lucide-react";
import type { ArticleSearchResult } from "@shared/schema";

export type SmartSearchProps = {
  /** Вызывается при выборе элемента из dropdown */
  onSelect: (item: ArticleSearchResult) => void;
  /** Вызывается при очистке (кнопка × или стирание после выбора) */
  onClear?: () => void;
  /** Начальное значение инпута (для prefill). Сброс через key prop. */
  defaultValue?: string;
  /** Placeholder текст */
  placeholder?: string;
  /** Лимит результатов API */
  limit?: number;
  /** Показывать название товара в dropdown */
  showName?: boolean;
  /** Показывать артикулы под инпутом после выбора */
  showSelectedInfo?: boolean;
  /** Отключить инпут */
  disabled?: boolean;
  /** data-testid для инпута */
  "data-testid"?: string;
  /** Дополнительные CSS-классы для контейнера */
  className?: string;
};

export function SmartSearch({
  onSelect,
  onClear,
  defaultValue,
  placeholder = "Артикул или SMART...",
  limit = 10,
  showName = true,
  showSelectedInfo = true,
  disabled = false,
  "data-testid": testId,
  className,
}: SmartSearchProps) {
  const [inputValue, setInputValue] = useState(defaultValue ?? "");
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<ArticleSearchResult[]>([]);
  const [selectedItem, setSelectedItem] = useState<ArticleSearchResult | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
    };
  }, []);

  const performSearch = async (query: string) => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(
        `/api/articles/search?query=${encodeURIComponent(q)}&limit=${limit}`,
        { credentials: "include", signal: controller.signal },
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || res.statusText);
      }
      const data = (await res.json()) as ArticleSearchResult[];
      setResults(data);
      setIsOpen(data.length > 0);
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      console.error("SmartSearch error:", err);
      setResults([]);
      setIsOpen(false);
    }
  };

  const handleInputChange = (value: string) => {
    setInputValue(value);

    if (selectedItem) {
      setSelectedItem(null);
      onClear?.();
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!value.trim()) {
      setResults([]);
      setIsOpen(false);
      return;
    }

    debounceRef.current = setTimeout(() => performSearch(value), 300);
  };

  const handleSelect = (item: ArticleSearchResult) => {
    setSelectedItem(item);
    setInputValue(item.smart);
    setIsOpen(false);
    setResults([]);
    onSelect(item);
  };

  const handleClear = () => {
    setInputValue("");
    setSelectedItem(null);
    setResults([]);
    setIsOpen(false);
    onClear?.();
    inputRef.current?.focus();
  };

  return (
    <div className={className}>
      <Popover open={isOpen} onOpenChange={setIsOpen}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Input
              ref={inputRef}
              placeholder={placeholder}
              className="font-mono pr-8"
              value={inputValue}
              onChange={(e) => handleInputChange(e.target.value)}
              disabled={disabled}
              data-testid={testId}
              onKeyDown={(e) => {
                if (e.key === "Escape") setIsOpen(false);
              }}
            />
            {inputValue && !disabled && (
              <button
                type="button"
                onClick={handleClear}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                tabIndex={-1}
                aria-label="Очистить"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </PopoverTrigger>
        <PopoverContent
          className="w-[var(--radix-popover-trigger-width)] p-0"
          align="start"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <Command shouldFilter={false}>
            <CommandList>
              <CommandEmpty>Ничего не найдено</CommandEmpty>
              <CommandGroup heading="Найденные позиции">
                {results.map((result, idx) => (
                  <CommandItem
                    key={`${result.smart}-${idx}`}
                    value={result.smart}
                    onSelect={() => handleSelect(result)}
                    className="cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-3 w-full">
                      <div className="flex flex-col gap-1">
                        <div className="font-mono text-sm font-bold text-primary">
                          {result.smart}
                        </div>
                        {!!result.articles?.length && (
                          <div className="font-mono text-xs text-muted-foreground break-words">
                            {result.articles.join(", ")}
                          </div>
                        )}
                        {showName && result.name && (
                          <div className="text-xs text-muted-foreground">{result.name}</div>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {!!result.brand?.length && result.brand.some((b) => b) && (
                          <div className="text-xs text-muted-foreground">
                            {result.brand.filter((b) => b).join(", ")}
                          </div>
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

      {showSelectedInfo && selectedItem && (
        <div className="mt-2 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <Check className="h-4 w-4 text-green-600" />
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
    </div>
  );
}
