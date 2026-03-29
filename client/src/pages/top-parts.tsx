import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Page } from "@/components/page";
import type { TopPart } from "@shared/schema";
import { TrendingUp, ShoppingCart, Award } from "lucide-react";

type RankingMode = 'profit' | 'sales' | 'combined';

export default function TopParts() {
  const [mode, setMode] = useState<RankingMode>('combined');

  const { data: items, isLoading, isError, error } = useQuery<TopPart[]>({
    queryKey: [`/api/top-parts?mode=${mode}`],
  });

  if (isLoading) {
    return (
      <Page title="Топ запчастей" description="Рейтинг по доходности и продажам">
        <div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <Skeleton className="h-64 w-full" />
        </div>
      </Page>
    );
  }

  if (isError) {
    return (
      <Page title="Топ запчастей" description="Рейтинг по доходности и продажам">
        <Card>
          <CardContent className="py-10 text-sm text-destructive">
            {error instanceof Error ? error.message : "Ошибка загрузки рейтинга"}
          </CardContent>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Топ запчастей" description="Рейтинг по доходности и продажам">
      <Tabs value={mode} onValueChange={(value) => setMode(value as RankingMode)}>
        <TabsList className="mb-6" data-testid="tabs-ranking-mode">
          <TabsTrigger value="profit" data-testid="tab-profit">
            <TrendingUp className="h-4 w-4 mr-2" />
            По доходности
          </TabsTrigger>
          <TabsTrigger value="sales" data-testid="tab-sales">
            <ShoppingCart className="h-4 w-4 mr-2" />
            По продажам
          </TabsTrigger>
          <TabsTrigger value="combined" data-testid="tab-combined">
            <Award className="h-4 w-4 mr-2" />
            Комбинированный
          </TabsTrigger>
        </TabsList>

        <TabsContent value={mode}>
          {!items || items.length === 0 ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <p className="text-lg font-medium text-muted-foreground">
                  Нет данных для отображения
                </p>
                <p className="text-sm text-muted-foreground mt-2">
                  Запчасти появятся здесь после совершения продаж
                </p>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Найдено записей: {items.length}</CardTitle>
                <CardDescription>
                  {mode === 'profit' && 'Отсортировано по средней доходности (убыванию)'}
                  {mode === 'sales' && 'Отсортировано по количеству продаж (убыванию)'}
                  {mode === 'combined' && 'Отсортировано по комбинированному коэффициенту (взвешенная формула)'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-[90px]">Место</TableHead>
                      <TableHead className="w-[150px]">SMART код</TableHead>
                      <TableHead>Название</TableHead>
                      <TableHead className="text-right">Средняя доходность</TableHead>
                      <TableHead className="text-right">Количество продаж</TableHead>
                      <TableHead className="text-right">Процент маржи</TableHead>
                      <TableHead className="text-right">Текущий остаток</TableHead>
                      {mode === "combined" && (
                        <TableHead className="text-right">Коэффициент</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {items.map((item, index) => (
                      <TableRow
                        key={item.smart}
                        data-testid={`row-toppart-${index}`}
                      >
                        <TableCell data-testid={`text-rank-${index}`}>
                          <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">
                            {index + 1}
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap" data-testid={`text-smart-${index}`}>
                          <span className="font-mono font-medium">{item.smart}</span>
                        </TableCell>
                        <TableCell data-testid={`text-name-${index}`}>
                          <span className="text-sm text-muted-foreground">
                            {item.name || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap" data-testid={`text-avgprofit-${index}`}>
                          <span className={`font-medium ${item.avgProfit >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {item.avgProfit.toFixed(2)} ₽
                          </span>
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-totalsales-${index}`}>
                          <span className="font-medium">{item.totalSales}</span>
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap" data-testid={`text-margin-${index}`}>
                          <span className={`font-medium ${item.profitMargin >= 0 ? "text-green-600" : "text-red-600"}`}>
                            {item.profitMargin.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className="text-right" data-testid={`text-stock-${index}`}>
                          <span className={item.currentStock > 0 ? "" : "text-muted-foreground"}>
                            {item.currentStock}
                          </span>
                        </TableCell>
                        {mode === "combined" && (
                          <TableCell className="text-right" data-testid={`text-score-${index}`}>
                            <span className="font-medium text-primary">
                              {item.combinedScore?.toFixed(1)}
                            </span>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </Page>
  );
}
