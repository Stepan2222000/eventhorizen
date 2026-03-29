import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Page } from "@/components/page";
import type { SoldOutItem } from "@shared/schema";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { PackageX } from "lucide-react";

export default function SoldOut() {
  const { data: items, isLoading, isError, error } = useQuery<SoldOutItem[]>({
    queryKey: ['/api/sold-out'],
  });

  if (isLoading) {
    return (
      <Page title="Распроданные товары" description="Товары с нулевым остатком">
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
      <Page title="Распроданные товары" description="Товары с нулевым остатком">
        <Card>
          <CardContent className="py-10 text-sm text-destructive">
            {error instanceof Error ? error.message : "Ошибка загрузки распроданных товаров"}
          </CardContent>
        </Card>
      </Page>
    );
  }

  return (
    <Page title="Распроданные товары" description="Товары с нулевым остатком">
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
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow>
                  <TableHead>SMART код</TableHead>
                  <TableHead>Название</TableHead>
                  <TableHead className="text-right">Средняя цена продажи</TableHead>
                  <TableHead className="text-right">Дата последней продажи</TableHead>
                  <TableHead className="text-right">Количество продаж</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow
                    key={item.smart}
                    data-testid={`row-soldout-${index}`}
                  >
                    <TableCell className="whitespace-nowrap" data-testid={`text-smart-${index}`}>
                      <span className="font-mono font-medium">{item.smart}</span>
                    </TableCell>
                    <TableCell data-testid={`text-name-${index}`}>
                      <span className="text-sm text-muted-foreground">
                        {item.name || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap" data-testid={`text-avgprice-${index}`}>
                      <span className="font-medium">{item.avgSalePrice.toFixed(2)} ₽</span>
                    </TableCell>
                    <TableCell className="text-right whitespace-nowrap" data-testid={`text-lastdate-${index}`}>
                      <span className="text-sm text-muted-foreground">
                        {format(new Date(item.lastSaleDate), "dd.MM.yyyy", { locale: ru })}
                      </span>
                    </TableCell>
                    <TableCell className="text-right" data-testid={`text-totalsales-${index}`}>
                      <span className="font-medium">{item.totalSales}</span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </Page>
  );
}
