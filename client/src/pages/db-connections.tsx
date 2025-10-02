import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { 
  insertDbConnectionSchema, 
  type InsertDbConnection, 
  type SafeDbConnection, 
  type DbConnectionTest, 
  type DbTablesResult,
  type ConfigureConnectionResponse,
  type DbColumnsResult,
  type SmartFieldMapping,
  type InventoryFieldMapping,
  type ConnectionRole,
} from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Database, Trash2, TestTube, Table2, Loader2, Settings, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function DbConnections() {
  const { toast } = useToast();
  const [testingId, setTestingId] = useState<number | null>(null);
  const [viewTablesId, setViewTablesId] = useState<number | null>(null);
  const [configureId, setConfigureId] = useState<number | null>(null);
  const [selectedRole, setSelectedRole] = useState<ConnectionRole>(null);
  const [selectedTable, setSelectedTable] = useState<string>("");
  const [tableColumns, setTableColumns] = useState<string[]>([]);
  const [fieldMapping, setFieldMapping] = useState<SmartFieldMapping | InventoryFieldMapping | null>(null);

  const { data: connections = [], isLoading } = useQuery<SafeDbConnection[]>({
    queryKey: ["/api/db-connections"],
  });

  const { data: activeSmartConnection } = useQuery<SafeDbConnection | null>({
    queryKey: ["/api/db-connections/active/smart"],
  });

  const { data: activeInventoryConnection } = useQuery<SafeDbConnection | null>({
    queryKey: ["/api/db-connections/active/inventory"],
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
      queryClient.invalidateQueries({ queryKey: ["/api/db-connections/active/smart"] });
      queryClient.invalidateQueries({ queryKey: ["/api/db-connections/active/inventory"] });
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

  const columnsMutation = useMutation({
    mutationFn: async ({ id, tableName }: { id: number; tableName: string }) => {
      const res = await fetch(`/api/db-connections/${id}/columns?tableName=${encodeURIComponent(tableName)}`);
      if (!res.ok) throw new Error('Failed to fetch columns');
      return await res.json() as DbColumnsResult;
    },
    onSuccess: (data) => {
      setTableColumns(data.columns);
      initializeFieldMapping(data.columns);
    },
  });

  const configureMutation = useMutation({
    mutationFn: async (data: { connectionId: number; role: ConnectionRole; tableName: string; fieldMapping: any }) => {
      const res = await apiRequest("POST", `/api/db-connections/${data.connectionId}/configure`, data);
      return await res.json() as ConfigureConnectionResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/db-connections"] });
      queryClient.invalidateQueries({ queryKey: ["/api/db-connections/active/smart"] });
      queryClient.invalidateQueries({ queryKey: ["/api/db-connections/active/inventory"] });
      toast({ description: "Конфигурация сохранена" });
      handleCloseConfigureDialog();
    },
    onError: (error: Error) => {
      toast({ 
        variant: "destructive", 
        description: error.message || "Ошибка настройки подключения" 
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

  const handleConfigure = (connection: SafeDbConnection) => {
    setConfigureId(connection.id);
    setSelectedRole((connection.role === 'smart' || connection.role === 'inventory') ? connection.role : null);
    setSelectedTable(connection.tableName || "");
    setFieldMapping(connection.fieldMapping as any || null);
    setTableColumns([]);
    
    // Automatically load tables for this connection
    tablesMutation.mutate(connection.id);
  };

  const handleCloseConfigureDialog = () => {
    setConfigureId(null);
    setSelectedRole(null);
    setSelectedTable("");
    setTableColumns([]);
    setFieldMapping(null);
  };

  const handleTableSelect = (tableName: string) => {
    setSelectedTable(tableName);
    if (configureId) {
      columnsMutation.mutate({ id: configureId, tableName });
    }
  };

  const initializeFieldMapping = (columns: string[]) => {
    if (!selectedRole) return;

    if (selectedRole === 'smart') {
      setFieldMapping({
        smart: columns.find(c => c.toLowerCase().includes('smart')) || '',
        articles: columns.find(c => c.toLowerCase().includes('article')) || '',
        name: columns.find(c => c.toLowerCase() === 'name') || undefined,
        brand: columns.find(c => c.toLowerCase() === 'brand') || undefined,
        description: columns.find(c => c.toLowerCase().includes('desc')) || undefined,
      } as SmartFieldMapping);
    } else {
      setFieldMapping({
        id: columns.find(c => c.toLowerCase() === 'id') || '',
        smart: columns.find(c => c.toLowerCase().includes('smart')) || '',
        article: columns.find(c => c.toLowerCase().includes('article')) || '',
        qtyDelta: columns.find(c => c.toLowerCase().includes('qty') || c.toLowerCase().includes('delta')) || '',
        reason: columns.find(c => c.toLowerCase().includes('reason')) || '',
        note: columns.find(c => c.toLowerCase() === 'note') || undefined,
        createdAt: columns.find(c => c.toLowerCase().includes('created')) || '',
      } as InventoryFieldMapping);
    }
  };

  const handleSaveConfigure = () => {
    if (!configureId || !selectedRole || !selectedTable || !fieldMapping) {
      toast({ 
        variant: "destructive", 
        description: "Заполните все обязательные поля" 
      });
      return;
    }

    configureMutation.mutate({
      connectionId: configureId,
      role: selectedRole,
      tableName: selectedTable,
      fieldMapping,
    });
  };

  const updateFieldMapping = (field: string, value: string) => {
    if (!fieldMapping) return;
    setFieldMapping({ ...fieldMapping, [field]: value });
  };

  const configuringConnection = connections.find(c => c.id === configureId);

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

      {/* Active Connections */}
      <Card>
        <CardHeader>
          <CardTitle data-testid="text-active-title">Активные подключения</CardTitle>
          <CardDescription data-testid="text-active-description">
            Текущие активные источники данных для SMART и инвентаря
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-lg" data-testid="card-active-smart">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">SMART Справочник</h3>
                {activeSmartConnection ? (
                  <Badge variant="default" data-testid="badge-smart-active">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Активно
                  </Badge>
                ) : (
                  <Badge variant="secondary" data-testid="badge-smart-inactive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Не настроено
                  </Badge>
                )}
              </div>
              {activeSmartConnection ? (
                <div className="text-sm text-muted-foreground">
                  <p data-testid="text-smart-connection-name">{activeSmartConnection.name}</p>
                  <p data-testid="text-smart-connection-table">
                    Таблица: {activeSmartConnection.tableName}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-smart-not-configured">
                  Нет активного подключения
                </p>
              )}
            </div>

            <div className="p-4 border rounded-lg" data-testid="card-active-inventory">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold">Инвентарь</h3>
                {activeInventoryConnection ? (
                  <Badge variant="default" data-testid="badge-inventory-active">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Активно
                  </Badge>
                ) : (
                  <Badge variant="secondary" data-testid="badge-inventory-inactive">
                    <XCircle className="h-3 w-3 mr-1" />
                    Не настроено
                  </Badge>
                )}
              </div>
              {activeInventoryConnection ? (
                <div className="text-sm text-muted-foreground">
                  <p data-testid="text-inventory-connection-name">{activeInventoryConnection.name}</p>
                  <p data-testid="text-inventory-connection-table">
                    Таблица: {activeInventoryConnection.tableName}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground" data-testid="text-inventory-not-configured">
                  Нет активного подключения
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

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
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-lg" data-testid={`text-connection-name-${conn.id}`}>
                            {conn.name}
                          </h3>
                          {conn.role && (
                            <Badge variant={conn.isActive ? "default" : "secondary"} data-testid={`badge-role-${conn.id}`}>
                              {conn.role === 'smart' ? 'SMART' : 'Инвентарь'}
                              {conn.isActive && ' (Активно)'}
                            </Badge>
                          )}
                        </div>
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
                          {conn.tableName && (
                            <p data-testid={`text-connection-table-${conn.id}`}>
                              <span className="font-medium">Таблица:</span> {conn.tableName}
                            </p>
                          )}
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
                          onClick={() => handleConfigure(conn)}
                          data-testid={`button-configure-${conn.id}`}
                        >
                          <Settings className="h-4 w-4" />
                        </Button>
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

      {/* Tables Dialog */}
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

      {/* Configure Dialog */}
      <Dialog open={configureId !== null} onOpenChange={(open) => {
        if (!open) handleCloseConfigureDialog();
      }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle data-testid="text-configure-title">
              Настройка подключения: {configuringConnection?.name}
            </DialogTitle>
            <DialogDescription data-testid="text-configure-description">
              Назначьте роль, выберите таблицу и настройте маппинг полей
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-6">
            {/* Step 1: Role Selection */}
            <div className="space-y-3">
              <label className="text-sm font-medium">Шаг 1: Выберите роль подключения</label>
              <Select value={selectedRole || undefined} onValueChange={(value) => setSelectedRole((value === 'smart' || value === 'inventory') ? value : null)}>
                <SelectTrigger data-testid="select-role">
                  <SelectValue placeholder="Выберите роль" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="smart">SMART Справочник</SelectItem>
                  <SelectItem value="inventory">Инвентарь</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Step 2: Table Selection */}
            {selectedRole && tablesMutation.data && (
              <div className="space-y-3">
                <label className="text-sm font-medium">Шаг 2: Выберите таблицу</label>
                <Select value={selectedTable} onValueChange={handleTableSelect}>
                  <SelectTrigger data-testid="select-table">
                    <SelectValue placeholder="Выберите таблицу" />
                  </SelectTrigger>
                  <SelectContent>
                    {tablesMutation.data.tables.map((table) => (
                      <SelectItem 
                        key={`${table.schema}.${table.name}`} 
                        value={`${table.schema}.${table.name}`}
                      >
                        {table.schema}.{table.name} ({table.type})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!tablesMutation.data.tables.length && (
                  <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>
                      Сначала загрузите список таблиц нажав кнопку "Просмотр таблиц"
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            )}

            {/* Step 3: Field Mapping */}
            {selectedTable && tableColumns.length > 0 && fieldMapping && (
              <div className="space-y-3">
                <label className="text-sm font-medium">Шаг 3: Сопоставьте поля</label>
                <div className="border rounded-lg p-4 space-y-3">
                  {selectedRole === 'smart' ? (
                    <>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">SMART код (обязательно):</label>
                        <Select 
                          value={(fieldMapping as SmartFieldMapping).smart} 
                          onValueChange={(v) => updateFieldMapping('smart', v)}
                        >
                          <SelectTrigger data-testid="select-field-smart">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">Артикулы (обязательно):</label>
                        <Select 
                          value={(fieldMapping as SmartFieldMapping).articles} 
                          onValueChange={(v) => updateFieldMapping('articles', v)}
                        >
                          <SelectTrigger data-testid="select-field-articles">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">Название (опционально):</label>
                        <Select 
                          value={(fieldMapping as SmartFieldMapping).name || ''} 
                          onValueChange={(v) => updateFieldMapping('name', v)}
                        >
                          <SelectTrigger data-testid="select-field-name">
                            <SelectValue placeholder="Не выбрано" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Не выбрано</SelectItem>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">Бренд (опционально):</label>
                        <Select 
                          value={(fieldMapping as SmartFieldMapping).brand || ''} 
                          onValueChange={(v) => updateFieldMapping('brand', v)}
                        >
                          <SelectTrigger data-testid="select-field-brand">
                            <SelectValue placeholder="Не выбрано" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Не выбрано</SelectItem>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">Описание (опционально):</label>
                        <Select 
                          value={(fieldMapping as SmartFieldMapping).description || ''} 
                          onValueChange={(v) => updateFieldMapping('description', v)}
                        >
                          <SelectTrigger data-testid="select-field-description">
                            <SelectValue placeholder="Не выбрано" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Не выбрано</SelectItem>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">ID (обязательно):</label>
                        <Select 
                          value={(fieldMapping as InventoryFieldMapping).id} 
                          onValueChange={(v) => updateFieldMapping('id', v)}
                        >
                          <SelectTrigger data-testid="select-field-id">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">SMART код (обязательно):</label>
                        <Select 
                          value={(fieldMapping as InventoryFieldMapping).smart} 
                          onValueChange={(v) => updateFieldMapping('smart', v)}
                        >
                          <SelectTrigger data-testid="select-field-smart">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">Артикул (обязательно):</label>
                        <Select 
                          value={(fieldMapping as InventoryFieldMapping).article} 
                          onValueChange={(v) => updateFieldMapping('article', v)}
                        >
                          <SelectTrigger data-testid="select-field-article">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">Изменение кол-ва (обязательно):</label>
                        <Select 
                          value={(fieldMapping as InventoryFieldMapping).qtyDelta} 
                          onValueChange={(v) => updateFieldMapping('qtyDelta', v)}
                        >
                          <SelectTrigger data-testid="select-field-qty-delta">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">Причина (обязательно):</label>
                        <Select 
                          value={(fieldMapping as InventoryFieldMapping).reason} 
                          onValueChange={(v) => updateFieldMapping('reason', v)}
                        >
                          <SelectTrigger data-testid="select-field-reason">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">Примечание (опционально):</label>
                        <Select 
                          value={(fieldMapping as InventoryFieldMapping).note || ''} 
                          onValueChange={(v) => updateFieldMapping('note', v)}
                        >
                          <SelectTrigger data-testid="select-field-note">
                            <SelectValue placeholder="Не выбрано" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="">Не выбрано</SelectItem>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 items-center">
                        <label className="text-sm">Дата создания (обязательно):</label>
                        <Select 
                          value={(fieldMapping as InventoryFieldMapping).createdAt} 
                          onValueChange={(v) => updateFieldMapping('createdAt', v)}
                        >
                          <SelectTrigger data-testid="select-field-created-at">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {tableColumns.map(col => (
                              <SelectItem key={col} value={col}>{col}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-4">
              <Button 
                variant="outline" 
                onClick={handleCloseConfigureDialog}
                data-testid="button-cancel-configure"
              >
                Отмена
              </Button>
              <Button 
                onClick={handleSaveConfigure}
                disabled={configureMutation.isPending || !selectedRole || !selectedTable || !fieldMapping}
                data-testid="button-save-configure"
              >
                {configureMutation.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Settings className="h-4 w-4 mr-2" />
                )}
                Сохранить конфигурацию
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
