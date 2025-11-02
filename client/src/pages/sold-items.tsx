import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Movement } from "@shared/schema";

export default function SoldItems() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: movements = [], isLoading } = useQuery<Movement[]>({
    queryKey: ["/api/movements"],
  });

  const markAsShippedMutation = useMutation({
    mutationFn: async (movementId: number) => {
      const response = await apiRequest("PATCH", `/api/movements/${movementId}/ship`, {});
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      toast({
        title: "Статус обновлен",
        description: "Товар помечен как отправленный",
      });
    },
    onError: (error) => {
      toast({
        title: "Ошибка обновления статуса",
        description: error instanceof Error ? error.message : "Произошла ошибка",
        variant: "destructive",
      });
    },
  });

  const returnToInventoryMutation = useMutation({
    mutationFn: async (movementId: number) => {
      console.log("Calling return API for movement:", movementId);
      const response = await apiRequest("POST", `/api/movements/${movementId}/return`, {});
      console.log("Return API response received");
      return response.json();
    },
    onSuccess: () => {
      console.log("Return mutation SUCCESS");
      queryClient.invalidateQueries({ queryKey: ["/api/movements"] });
      toast({
        title: "Товар возвращен",
        description: "Товар возвращен на склад",
      });
    },
    onError: (error) => {
      console.log("Return mutation ERROR:", error);
      const message = error instanceof Error ? error.message : "Произошла ошибка";
      toast({
        title: "Ошибка возврата товара",
        description: message,
        variant: "destructive",
      });
    },
  });

  // Filter movements by status
  const awaitingShipment = movements.filter(m => 
    m.reason === "sale" && m.saleStatus === "awaiting_shipment"
  );
  const shipped = movements.filter(m => 
    m.reason === "sale" && m.saleStatus === "shipped"
  );

  const formatPrice = (price: string | null) => {
    if (!price) return "—";
    return new Intl.NumberFormat('ru-RU', {
      style: 'currency',
      currency: 'RUB',
    }).format(parseFloat(price));
  };

  const formatDate = (dateString: Date | string) => {
    return new Date(dateString).toLocaleString('ru-RU', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <header className="bg-card border-b border-border sticky top-0 z-10">
        <div className="px-8 py-4">
          <h2 className="text-2xl font-bold text-foreground">Проданные товары</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Управление отправкой и возвратом проданных товаров
          </p>
        </div>
      </header>

      <div className="p-8">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Awaiting Shipment */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-foreground">Ожидает отправки</div>
                  <CardDescription>
                    Товары готовы к отправке покупателю
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="text-sm">
                  {awaitingShipment.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <p>Загрузка...</p>
                </div>
              ) : awaitingShipment.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <i className="fas fa-box-open text-4xl mb-4"></i>
                  <p>Нет товаров ожидающих отправки</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {awaitingShipment.map((movement) => (
                    <div
                      key={movement.id}
                      className="border border-border rounded-lg p-4 bg-card hover:bg-accent/5 transition-colors"
                      data-testid={`item-awaiting-${movement.id}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="font-mono font-semibold text-sm text-foreground mb-1">
                            {movement.smart}
                          </div>
                          <div className="text-xs text-muted-foreground break-words">
                            {movement.article}
                          </div>
                        </div>
                        <Badge variant="outline" className="ml-2">
                          <i className="fas fa-clock mr-1"></i>
                          Ожидает
                        </Badge>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                        <div>
                          <span className="text-muted-foreground">Количество:</span>
                          <span className="font-mono font-semibold ml-2">
                            {Math.abs(movement.qtyDelta)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Цена продажи:</span>
                          <span className="font-semibold ml-2">
                            {formatPrice(movement.salePrice)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Доставка:</span>
                          <span className="font-semibold ml-2">
                            {formatPrice(movement.deliveryPrice)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Дата:</span>
                          <span className="text-xs ml-2">
                            {formatDate(movement.createdAt)}
                          </span>
                        </div>
                      </div>

                      {movement.trackNumber && (
                        <div className="text-xs text-muted-foreground mb-3">
                          <i className="fas fa-truck mr-1"></i>
                          Трек: {movement.trackNumber}
                        </div>
                      )}

                      <Button
                        size="sm"
                        className="w-full"
                        onClick={() => markAsShippedMutation.mutate(movement.id)}
                        disabled={markAsShippedMutation.isPending}
                        data-testid={`button-ship-${movement.id}`}
                      >
                        <i className="fas fa-shipping-fast mr-2"></i>
                        Отправлено
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Shipped */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-foreground">Отправлено</div>
                  <CardDescription>
                    Товары отправленные покупателю
                  </CardDescription>
                </div>
                <Badge variant="secondary" className="text-sm">
                  {shipped.length}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="text-center py-8 text-muted-foreground">
                  <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
                  <p>Загрузка...</p>
                </div>
              ) : shipped.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <i className="fas fa-shipping-fast text-4xl mb-4"></i>
                  <p>Нет отправленных товаров</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {shipped.map((movement) => (
                    <div
                      key={movement.id}
                      className="border border-success/30 rounded-lg p-4 bg-success/5"
                      data-testid={`item-shipped-${movement.id}`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="font-mono font-semibold text-sm text-foreground mb-1">
                            {movement.smart}
                          </div>
                          <div className="text-xs text-muted-foreground break-words">
                            {movement.article}
                          </div>
                        </div>
                        <Badge className="bg-success text-success-foreground ml-2">
                          <i className="fas fa-check mr-1"></i>
                          Отправлено
                        </Badge>
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                        <div>
                          <span className="text-muted-foreground">Количество:</span>
                          <span className="font-mono font-semibold ml-2">
                            {Math.abs(movement.qtyDelta)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Цена продажи:</span>
                          <span className="font-semibold ml-2">
                            {formatPrice(movement.salePrice)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Доставка:</span>
                          <span className="font-semibold ml-2">
                            {formatPrice(movement.deliveryPrice)}
                          </span>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Дата отправки:</span>
                          <span className="text-xs ml-2">
                            {formatDate(movement.createdAt)}
                          </span>
                        </div>
                      </div>

                      {movement.trackNumber && (
                        <div className="text-xs text-muted-foreground mb-3">
                          <i className="fas fa-truck mr-1"></i>
                          Трек: {movement.trackNumber}
                        </div>
                      )}

                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full"
                        onClick={() => returnToInventoryMutation.mutate(movement.id)}
                        disabled={returnToInventoryMutation.isPending}
                        data-testid={`button-return-${movement.id}`}
                      >
                        <i className="fas fa-undo mr-2"></i>
                        Вернуть на склад
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
