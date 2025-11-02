import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { SoldOutItem } from "@shared/schema";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { PackageX } from "lucide-react";

export default function SoldOut() {
  const { data: items, isLoading } = useQuery<SoldOutItem[]>({
    queryKey: ['/api/sold-out'],
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
        <h1 className="text-3xl font-bold mb-2">Распроданные товары</h1>
        <p className="text-muted-foreground">
          Запчасти с нулевым остатком, которые были проданы ранее
        </p>
      </div>

      {!items || items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16">
            <PackageX className="h-16 w-16 text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-muted-foreground">
              Нет распроданных товаров
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Товары с нулевым остатком появятся здесь после продажи
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Найдено записей: {items.length}</CardTitle>
            <CardDescription>Отсортировано по дате последней продажи</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="relative border rounded-md">
              <table className="w-full">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-4 py-3 text-left text-sm font-medium">SMART код</th>
                    <th className="px-4 py-3 text-left text-sm font-medium">Название</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Средняя цена продажи</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Дата последней продажи</th>
                    <th className="px-4 py-3 text-right text-sm font-medium">Количество продаж</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, index) => (
                    <tr
                      key={item.smart}
                      className="border-b"
                      data-testid={`row-soldout-${index}`}
                    >
                      <td className="px-4 py-4 align-middle whitespace-nowrap" data-testid={`text-smart-${index}`}>
                        <span className="font-mono font-medium">{item.smart}</span>
                      </td>
                      <td className="px-4 py-4 align-middle" data-testid={`text-name-${index}`}>
                        <span className="text-sm text-muted-foreground">
                          {item.name || '—'}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-middle text-right whitespace-nowrap" data-testid={`text-avgprice-${index}`}>
                        <span className="font-medium">{item.avgSalePrice.toFixed(2)} ₽</span>
                      </td>
                      <td className="px-4 py-4 align-middle text-right whitespace-nowrap" data-testid={`text-lastdate-${index}`}>
                        <span className="text-sm text-muted-foreground">
                          {format(new Date(item.lastSaleDate), 'dd.MM.yyyy', { locale: ru })}
                        </span>
                      </td>
                      <td className="px-4 py-4 align-middle text-right" data-testid={`text-totalsales-${index}`}>
                        <span className="font-medium">{item.totalSales}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
