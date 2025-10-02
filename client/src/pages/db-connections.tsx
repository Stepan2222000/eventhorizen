import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertDbConnectionSchema, type InsertDbConnection, type SafeDbConnection, type DbConnectionTest, type DbTablesResult } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Database, Trash2, TestTube, Table2, Loader2, CheckCircle, XCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export default function DbConnections() {
  const { toast } = useToast();
  const [testingId, setTestingId] = useState<number | null>(null);
  const [viewTablesId, setViewTablesId] = useState<number | null>(null);

  const { data: connections = [], isLoading } = useQuery<SafeDbConnection[]>({
    queryKey: ["/api/db-connections"],
  });

  const form = useForm<InsertDbConnection>({
    resolver: zodResolver(insertDbConnectionSchema),
    defaultValues: {
      name: "",
      host: "",
      port: 5432,
      database: "",
      username: "",
      password: "",
      ssl: null,
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: InsertDbConnection) => {
      const res = await apiRequest("POST", "/api/db-connections", data);
      return await res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-connections"] });
      toast({ description: "Подключение создано" });
      form.reset();
    },
    onError: (error: Error) => {
      toast({ 
        variant: "destructive", 
        description: error.message || "Ошибка создания подключения" 
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/db-connections/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-connections"] });
      toast({ description: "Подключение удалено" });
    },
    onError: (error: Error) => {
      toast({ 
        variant: "destructive", 
        description: error.message || "Ошибка удаления" 
      });
    },
  });

  const testMutation = useMutation({
    mutationFn: async (data: InsertDbConnection) => {
      const res = await apiRequest("POST", "/api/db-connections/test", data);
      return await res.json() as DbConnectionTest;
    },
    onSuccess: (data) => {
      if (data.success) {
        toast({ 
          description: `${data.message}${data.version ? ` (${data.version})` : ''}` 
        });
      } else {
        toast({ 
          variant: "destructive", 
          description: data.message 
        });
      }
    },
  });

  const tablesMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/db-connections/${id}/tables`);
      return await res.json() as DbTablesResult;
    },
    onSuccess: (data) => {
      setViewTablesId(null);
      toast({ 
        description: `Найдено таблиц: ${data.tables.length}` 
      });
    },
  });

  const handleTest = () => {
    const values = form.getValues();
    testMutation.mutate(values);
  };

  const handleViewTables = async (connection: SafeDbConnection) => {
    setViewTablesId(connection.id);
    tablesMutation.mutate(connection.id);
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Database className="h-8 w-8" />
        <div>
          <h1 className="text-3xl font-bold" data-testid="text-page-title">Подключения БД</h1>
          <p className="text-muted-foreground" data-testid="text-page-description">
            Управление подключениями к внешним базам данных PostgreSQL
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle data-testid="text-form-title">Добавить подключение</CardTitle>
          <CardDescription data-testid="text-form-description">
            Настройте параметры подключения к внешней базе данных
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((data) => createMutation.mutate(data))} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Название</FormLabel>
                      <FormControl>
                        <Input placeholder="Моя БД" {...field} data-testid="input-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="host"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Хост</FormLabel>
                      <FormControl>
                        <Input placeholder="localhost" {...field} data-testid="input-host" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Порт</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          {...field} 
                          onChange={(e) => field.onChange(parseInt(e.target.value) || 5432)}
                          data-testid="input-port"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="database"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>База данных</FormLabel>
                      <FormControl>
                        <Input placeholder="my_database" {...field} data-testid="input-database" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="username"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Имя пользователя</FormLabel>
                      <FormControl>
                        <Input placeholder="postgres" {...field} data-testid="input-username" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="password"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Пароль</FormLabel>
                      <FormControl>
                        <Input type="password" placeholder="••••••••" {...field} data-testid="input-password" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="ssl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>SSL режим</FormLabel>
                      <Select 
                        onValueChange={field.onChange} 
                        value={field.value || undefined}
                      >
                        <FormControl>
                          <SelectTrigger data-testid="select-ssl">
                            <SelectValue placeholder="Не использовать" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="disable">Отключен</SelectItem>
                          <SelectItem value="prefer">Предпочтительно</SelectItem>
                          <SelectItem value="require">Обязательно</SelectItem>
                          <SelectItem value="verify-ca">Проверка CA</SelectItem>
                          <SelectItem value="verify-full">Полная проверка</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <div className="flex gap-2">
                <Button 
                  type="button" 
                  variant="outline" 
                  onClick={handleTest}
                  disabled={testMutation.isPending}
                  data-testid="button-test"
                >
                  {testMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <TestTube className="h-4 w-4 mr-2" />
                  )}
                  Тест подключения
                </Button>
                <Button 
                  type="submit" 
                  disabled={createMutation.isPending}
                  data-testid="button-create"
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Database className="h-4 w-4 mr-2" />
                  )}
                  Сохранить подключение
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle data-testid="text-connections-title">Сохраненные подключения</CardTitle>
          <CardDescription data-testid="text-connections-description">
            Список настроенных подключений к базам данных
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center p-8">
              <Loader2 className="h-8 w-8 animate-spin" data-testid="loader-connections" />
            </div>
          ) : connections.length === 0 ? (
            <p className="text-center text-muted-foreground p-8" data-testid="text-no-connections">
              Нет сохраненных подключений
            </p>
          ) : (
            <div className="space-y-4">
              {connections.map((conn) => (
                <Card key={conn.id} data-testid={`card-connection-${conn.id}`}>
                  <CardContent className="pt-6">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1 flex-1">
                        <h3 className="font-semibold text-lg" data-testid={`text-connection-name-${conn.id}`}>
                          {conn.name}
                        </h3>
                        <div className="text-sm text-muted-foreground space-y-0.5">
                          <p data-testid={`text-connection-host-${conn.id}`}>
                            <span className="font-medium">Хост:</span> {conn.host}:{conn.port}
                          </p>
                          <p data-testid={`text-connection-database-${conn.id}`}>
                            <span className="font-medium">БД:</span> {conn.database}
                          </p>
                          <p data-testid={`text-connection-username-${conn.id}`}>
                            <span className="font-medium">Пользователь:</span> {conn.username}
                          </p>
                          {conn.ssl && (
                            <p data-testid={`text-connection-ssl-${conn.id}`}>
                              <span className="font-medium">SSL:</span> {conn.ssl}
                            </p>
                          )}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleViewTables(conn)}
                          disabled={tablesMutation.isPending && viewTablesId === conn.id}
                          data-testid={`button-view-tables-${conn.id}`}
                        >
                          {tablesMutation.isPending && viewTablesId === conn.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Table2 className="h-4 w-4" />
                          )}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => deleteMutation.mutate(conn.id)}
                          disabled={deleteMutation.isPending}
                          data-testid={`button-delete-${conn.id}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={tablesMutation.isSuccess && viewTablesId !== null} onOpenChange={(open) => {
        if (!open) {
          setViewTablesId(null);
          tablesMutation.reset();
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-dialog-title">
              Таблицы: {tablesMutation.data?.connectionName}
            </DialogTitle>
            <DialogDescription data-testid="text-dialog-description">
              Список таблиц в базе данных
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {tablesMutation.data?.tables.map((table, idx) => (
              <div 
                key={`${table.schema}.${table.name}`} 
                className="flex items-center justify-between p-3 border rounded-lg"
                data-testid={`table-item-${idx}`}
              >
                <div className="flex-1">
                  <p className="font-medium" data-testid={`text-table-name-${idx}`}>
                    {table.schema}.{table.name}
                  </p>
                  <p className="text-sm text-muted-foreground" data-testid={`text-table-type-${idx}`}>
                    {table.type}
                  </p>
                </div>
              </div>
            ))}
            {tablesMutation.data?.tables.length === 0 && (
              <p className="text-center text-muted-foreground p-8" data-testid="text-no-tables">
                Таблицы не найдены
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
