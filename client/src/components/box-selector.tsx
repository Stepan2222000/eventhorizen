import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

type BoxesApiResponse = {
  boxes: Array<{
    name: string;
    description: string | null;
    isActive: boolean;
    positionsCount: number;
    totalQty: number;
    lastMovementAt: string | null;
    createdAt: string;
  }>;
  unboxed: { positionsCount: number; totalQty: number };
};

type SmartBoxesApiResponse = Array<{
  boxNumber: string;
  qty: number;
  description: string | null;
}>;

export type BoxSelectorMode = "all" | "bySmart";

export type BoxSelectorProps = {
  value: string | null | undefined;
  onSelect: (value: string | null) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  mode?: BoxSelectorMode;
  smart?: string | null | undefined;
  exclude?: string[];
  "data-testid"?: string;
  className?: string;
};

type BoxOption = {
  name: string;
  description: string | null;
  rightLabel: string | null;
};

export function BoxSelector({
  value,
  onSelect,
  placeholder = "Выберите коробку...",
  disabled = false,
  required = false,
  mode = "all",
  smart,
  exclude = [],
  "data-testid": testId,
  className,
}: BoxSelectorProps) {
  const [open, setOpen] = useState(false);

  const boxesQuery = useQuery<BoxesApiResponse>({
    queryKey: ["/api/boxes?activeOnly=1"],
    enabled: mode === "all",
  });

  const smartBoxesQuery = useQuery<SmartBoxesApiResponse>({
    queryKey: [`/api/stock/${encodeURIComponent(String(smart || ""))}/boxes`],
    enabled: mode === "bySmart" && Boolean(smart && String(smart).trim()),
  });

  const options: BoxOption[] = useMemo(() => {
    const excludeSet = new Set((exclude || []).filter(Boolean));

    if (mode === "bySmart") {
      const rows = Array.isArray(smartBoxesQuery.data) ? smartBoxesQuery.data : [];
      return rows
        .filter((r) => r && r.boxNumber && !excludeSet.has(r.boxNumber))
        .map((r) => ({
          name: r.boxNumber,
          description: r.description ?? null,
          rightLabel: `${r.qty} шт`,
        }));
    }

    const rows = boxesQuery.data?.boxes || [];
    return rows
      .filter((b) => b && b.name && !excludeSet.has(b.name))
      .map((b) => ({
        name: b.name,
        description: b.description ?? null,
        rightLabel: `${b.totalQty} шт`,
      }));
  }, [boxesQuery.data, exclude, mode, smartBoxesQuery.data]);

  const selectedOption = useMemo(() => {
    const v = (value || "").trim();
    if (!v) return null;
    return options.find((o) => o.name === v) || { name: v, description: null, rightLabel: null };
  }, [options, value]);

  const isLoading = mode === "bySmart" ? smartBoxesQuery.isLoading : boxesQuery.isLoading;
  const isEmpty = !isLoading && options.length === 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || (mode === "bySmart" && !smart)}
          className={cn("w-full justify-between font-mono", className)}
          data-testid={testId}
        >
          <span className={cn("truncate", !selectedOption && "text-muted-foreground")}>
            {selectedOption ? selectedOption.name : placeholder}
            {required ? " *" : ""}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Поиск коробки..." />
          <CommandList>
            <CommandEmpty>{isLoading ? "Загрузка..." : "Ничего не найдено"}</CommandEmpty>
            <CommandGroup heading={mode === "bySmart" ? "Коробки с товаром" : "Активные коробки"}>
              {options.map((option) => (
                <CommandItem
                  key={option.name}
                  value={`${option.name} ${option.description || ""}`.trim()}
                  onSelect={() => {
                    onSelect(option.name);
                    setOpen(false);
                  }}
                >
                  <div className="flex items-start justify-between gap-3 w-full">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Check
                          className={cn(
                            "h-4 w-4 text-primary",
                            selectedOption?.name === option.name ? "opacity-100" : "opacity-0"
                          )}
                        />
                        <span className="font-mono font-semibold truncate">{option.name}</span>
                      </div>
                      {option.description && (
                        <div className="text-xs text-muted-foreground mt-1 truncate">
                          {option.description}
                        </div>
                      )}
                    </div>
                    {option.rightLabel && (
                      <div className="text-xs text-muted-foreground font-mono shrink-0">
                        {option.rightLabel}
                      </div>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
            {isEmpty && (
              <div className="px-3 py-3 text-xs text-muted-foreground">
                {mode === "bySmart"
                  ? "Нет коробок с этим товаром (или остаток 0)"
                  : "Нет активных коробок"}
              </div>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

