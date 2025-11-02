import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { TopPart } from "@shared/schema";
import { TrendingUp, ShoppingCart, Award } from "lucide-react";

type RankingMode = 'profit' | 'sales' | 'combined';

export default function TopParts() {
  const [mode, setMode] = useState<RankingMode>('combined');

  const { data: items, isLoading } = useQuery<TopPart[]>({
    queryKey: ['/api/top-parts', { mode }],
  });

  if (isLoading) {
    return (
      <div className="p-8">
        <div className="animate-pulse">
          <div className="h-8 bg-muted rounded w-64 mb-2"></div>
          <div className="h-4 bg-muted rounded w-96 mb-8"></div>
          <div className="h-64 bg-muted rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Топ запчастей</h1>
        <p className="text-muted-foreground">
          Рейтинг самых ликвидных и прибыльных запчастей
        </p>
      </div>

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
                <div className="relative border rounded-md">
                  <table className="w-full">
                    <thead className="bg-muted/50">
                      <tr>
                        <th className="px-4 py-3 text-left text-sm font-medium">Место</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">SMART код</th>
                        <th className="px-4 py-3 text-left text-sm font-medium">Название</th>
                        <th className="px-4 py-3 text-right text-sm font-medium">Средняя доходность</th>
                        <th className="px-4 py-3 text-right text-sm font-medium">Количество продаж</th>
                        <th className="px-4 py-3 text-right text-sm font-medium">Процент маржи</th>
                        <th className="px-4 py-3 text-right text-sm font-medium">Текущий остаток</th>
                        {mode === 'combined' && (
                          <th className="px-4 py-3 text-right text-sm font-medium">Коэффициент</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item, index) => (
                        <tr
                          key={item.smart}
                          className="border-b"
                          data-testid={`row-toppart-${index}`}
                        >
                          <td className="px-4 py-4 align-middle" data-testid={`text-rank-${index}`}>
                            <div className="flex items-center justify-center w-8 h-8 rounded-full bg-primary/10 text-primary font-bold">
                              {index + 1}
                            </div>
                          </td>
                          <td className="px-4 py-4 align-middle whitespace-nowrap" data-testid={`text-smart-${index}`}>
                            <span className="font-mono font-medium">{item.smart}</span>
                          </td>
                          <td className="px-4 py-4 align-middle" data-testid={`text-name-${index}`}>
                            <span className="text-sm text-muted-foreground">
                              {item.name || '—'}
                            </span>
                          </td>
                          <td
                            className="px-4 py-4 align-middle text-right whitespace-nowrap"
                            data-testid={`text-avgprofit-${index}`}
                          >
                            <span className={`font-medium ${item.avgProfit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {item.avgProfit.toFixed(2)} ₽
                            </span>
                          </td>
                          <td className="px-4 py-4 align-middle text-right" data-testid={`text-totalsales-${index}`}>
                            <span className="font-medium">{item.totalSales}</span>
                          </td>
                          <td
                            className="px-4 py-4 align-middle text-right whitespace-nowrap"
                            data-testid={`text-margin-${index}`}
                          >
                            <span className={`font-medium ${item.profitMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                              {item.profitMargin.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-4 py-4 align-middle text-right" data-testid={`text-stock-${index}`}>
                            <span className={item.currentStock > 0 ? '' : 'text-muted-foreground'}>
                              {item.currentStock}
                            </span>
                          </td>
                          {mode === 'combined' && (
                            <td className="px-4 py-4 align-middle text-right" data-testid={`text-score-${index}`}>
                              <span className="font-medium text-primary">
                                {item.combinedScore?.toFixed(1)}
                              </span>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
