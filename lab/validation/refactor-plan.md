# EventHorizon — План огромного рефакторинга (на основе `specification.md`)

> **Дата:** 2026-02-07  
> **Основа/истина:** `lab/validation/specification.md`  
> **Скоуп анализа реализации:** `server/`, `shared/`, `migrations/`, `client/`

Этот документ фиксирует концепцию системы и поэтапный план приведения текущего кода к философии из `specification.md`. Формулировки намеренно “архитектурные”, но каждый блок содержит конкретные места в коде, которые нужно менять/удалять/переписывать.

---

## 0. Северная звезда (как должно быть)

1. **Две фиксированные базы данных**
   - **SMART-справочник** (`parts_info`): только чтение, фиксированная таблица/структура: SMART-код, массив артикулов, название, бренд, описание. При старте сервера справочник загружается целиком в память и кэшируется. Все обращения к справочнику идут через кэш.
   - **inventory** (складской учет): таблицы движений, причины операций, способы доставки, VIEW остатков. Приложение само создаёт/мигрирует эти структуры.

2. **Никакого multi-DB и UI управления подключениями**
   - Удаляется весь функционал подключения к БД через интерфейс, удаляется `db-connections.json`, удаляются эндпоинты API, удаляется динамическое создание пулов на каждый запрос, удаляется `fieldMapping` и вся инфраструктура вокруг.

3. **SMART-код — единственный идентификатор товара для учёта**
   - Остатки, аналитика, сопоставление покупок/продаж, проверка достаточности остатков — всё по SMART-коду.
   - В `inventory.movements` **нет** колонки `article`. Артикулы живут только в SMART-справочнике и нужны лишь для поиска/отображения.

4. **Пулы соединений**
   - Для каждой из двух БД создаётся ровно один `pg.Pool` при старте процесса, который живёт весь lifecycle. Разумные таймауты подключения. Если БД недоступна или схема не может быть обеспечена — сервер обязан остановиться.

5. **Кэширование UI**
   - Допустимо `staleTime: Infinity`, но тогда после любого действия инвалидация кэшей должна быть полной (все затронутые страницы/запросы получают свежие данные).

---

## 1. Что есть сейчас (инвентаризация файлов и зон ответственности)

### `server/`
- `server/index.ts` — старт Express + Vite/Static. Сейчас не реализует fail-fast старт по наличию двух БД и кэша.
- `server/routes.ts` — API. Сейчас содержит: лимиты 50/1000, multi-DB init, маскирование инфраструктурных ошибок как 400, наивный CSV импорт, endpoints управления подключениями.
- `server/storage.ts` — слой данных. Сейчас создаёт и закрывает `pg.Pool` на каждый метод, берёт “активные подключения” из JSON, использует `article` в movements и в аналитике, делает N+1 запросы в SMART БД, глотает ошибки в `getTotalStockBySmartBatch`.
- `server/db.ts` — `ensureExternalDbSchema(connectionDetails)`. Сейчас создаёт/ожидает `article`, выполняет миграцию `adjust -> purchase` и удаляет `adjust`, определяет VIEW, добавляет колонки. Конфликтует со `specification.md`.
- `server/connections-storage.ts` — хранилище `db-connections.json` + дефолтные креды. По спецификации должно быть удалено.

### `shared/`
- `shared/schema.ts` — контракт таблиц и DTO/валидаторов. Сейчас: `inventory.movements` содержит `article`, `insertMovementSchema` требует `article` и не знает про `adjust`, плюс содержит весь multi-DB контракт (`dbConnections`, `fieldMapping`).
- `shared/normalization.ts` — нормализация артикулов. Сейчас дублируется на клиенте (`client/src/lib/normalization.ts`), по спецификации нужна единая реализация.

### `migrations/`
- `migrations/meta/_journal.json` — миграций фактически нет. Схема обеспечивается runtime-скриптами в двух местах (`server/db.ts`, `server/storage.ts`) и даже с разными определениями VIEW.

### `client/`
Ключевые файлы, которые точно затрагиваются:
- `client/src/App.tsx` — роут `/db-connections` под удаление.
- `client/src/components/sidebar.tsx` — пункт “Подключения БД” под удаление.
- `client/src/lib/queryClient.ts` — хрупкий `queryKey.join("/")`.
- `client/src/hooks/use-toast.ts` — подписка пересоздаётся из-за `[state]` зависимости.
- `client/src/lib/normalization.ts` — дубликат `shared/normalization.ts`.
- `client/src/pages/add-movement.tsx` — автокомплит без отмены устаревших запросов, скрытые поля не очищаются, prefill требует `smart+article`, неполная инвалидация кэшей, `saleStatus` устанавливает клиент.
- `client/src/pages/stock-levels.tsx` — запрос остатков без limit/offset, но сервер режет 50.
- `client/src/pages/article-search.tsx` — модалка не сбрасывается при новом поиске, переход на форму передаёт `article`.
- `client/src/pages/sold-items.tsx` — отладочные `console.log`, NULL saleStatus не отображаются.
- `client/src/pages/movement-history.tsx`, `client/src/pages/stock-details.tsx` — показывают `movement.article`, но по спецификации статья не хранится в движениях.

---

## 2. Ключевые несоответствия спецификации (корни багов)

1. **Multi-DB функционал** существует во всех слоях (server/shared/client) и прямо противоречит spec (нужно удалить).
   - Места: `server/connections-storage.ts`, `server/storage.ts` (active connections, fieldMapping), `server/routes.ts` (`/api/db-connections*`), `shared/schema.ts` (dbConnections + mapping types), `client/src/pages/db-connections.tsx`, `client/src/App.tsx`, `client/src/components/sidebar.tsx`, `db-connections.json`.

2. **`article` в `inventory.movements`** используется повсеместно, хотя по spec его быть не должно.
   - Места: `shared/schema.ts` (таблица + insert schema), `server/db.ts` (DDL), `server/storage.ts` (insert/select/map), большинство страниц клиента.

3. **Нет полноценного SMART-кэша** и из-за этого N+1 + создание пулов на каждый lookup.
   - Места: `server/storage.ts:getStockLevels()` обогащает данные вызовами `getSmartByCode()`; сам `getSmartByCode()` создаёт/закрывает пул.

4. **Лимиты обрезают данные**
   - Остатки: `server/routes.ts` (`limit=50`) + `server/storage.ts` (`LIMIT/OFFSET`) + `client/src/pages/stock-levels.tsx`.
   - Дашборд: `server/routes.ts` жёстко использует `getMovements(1000, 0)` и `getStockLevels(1000, 0)`.

5. **Аналитика/рейтинг считают по SMART+article**
   - Места: `server/storage.ts:getTopParts()` с `m.article` и фильтрацией `AND p.article = s.article`, плюс мёртвый `ORDER BY ... LIMIT 10` в подзапросе AVG.

6. **Ошибки БД маскируются**
   - `POST /api/movements`: почти любой `Error` возвращает 400 (должно быть 500 для инфраструктуры).
   - `getTotalStockBySmartBatch`: ловит ошибку и возвращает нули (опасно).

7. **Импорт противоречит spec**
   - SMART должен быть обязательным, но сейчас используется `article` как обязательный и есть “угадывание SMART по артикулу”.
   - CSV парсится `split(',')`.
   - Excel может падать на пустом файле, строки могут исчезать молча из-за `.filter(...)`.

---

## 3. План рефакторинга (фазами)

### Фаза 1. Полный демонтаж multi-DB (самый высокий приоритет)
Цель: убрать всё, что запрещено `specification.md`.

1. Удалить API управления подключениями:
   - `server/routes.ts` блок `/api/db-connections*` целиком.
2. Удалить хранение подключений:
   - удалить `server/connections-storage.ts`;
   - удалить `db-connections.json` (содержит пароли).
3. Удалить UI “Подключения БД”:
   - удалить `client/src/pages/db-connections.tsx`;
   - удалить маршрут `/db-connections` из `client/src/App.tsx`;
   - удалить пункт навигации из `client/src/components/sidebar.tsx`.
4. Убрать концепт “active connection”:
   - удалить/переписать в `server/storage.ts` методы `getActiveConnection`, `createDefaultConnections`, `testDbConnection`, `getDbTables`, `configureConnection`, `getTableColumns`.
5. Немедленные организационные шаги безопасности:
   - ротация паролей, т.к. секреты уже лежат в репозитории (`db-connections.json`, `.env`).

### Фаза 2. Две фиксированные БД и два пула на процесс
Цель: реализовать spec 1 (две БД), spec 1 (пулы, таймауты), spec 1 (fail-fast).

1. Ввести конфигурацию окружения:
   - новый модуль (предложение): `server/config.ts`.
   - набор env-переменных для частей:
     - `PARTS_DB_HOST`, `PARTS_DB_PORT`, `PARTS_DB_NAME`, `PARTS_DB_USER`, `PARTS_DB_PASSWORD`, `PARTS_DB_SSL`
     - `INVENTORY_DB_HOST`, `INVENTORY_DB_PORT`, `INVENTORY_DB_NAME`, `INVENTORY_DB_USER`, `INVENTORY_DB_PASSWORD`, `INVENTORY_DB_SSL`
2. Создать два постоянных `pg.Pool` при старте:
   - переписать `server/db.ts` в “пулы + init”.
   - настроить таймауты (`connectionTimeoutMillis`, `idleTimeoutMillis` и др.).
3. `server/index.ts` должен выполнять init до `listen()`:
   - тест/подключение к обеим БД;
   - обеспечение схемы inventory;
   - загрузка SMART-кэша;
   - при ошибке — падение процесса.

### Фаза 3. Схема inventory: одна точка истины, без `article`, с `adjust`
Цель: выполнить spec 2/3/5/15 + устранить “две инициализации VIEW”.

1. Оставить одну инициализацию схемы inventory:
   - удалить `initializeExternalInventoryDb()` из `server/storage.ts` (вторая инициализация + неправильный VIEW без HAVING).
   - переписать `ensureExternalDbSchema(...)` в `server/db.ts` под фиксированный `inventoryPool`.
2. `inventory.movements` привести к spec:
   - удалить колонку `article` (с бэкапом/экспортом при необходимости).
   - оставить/обеспечить поля: qty_delta, reason, note, цены, коробка, доставка, трек, shipping_method_id, sale_status, created_at.
3. Вернуть `adjust`:
   - удалить миграцию `adjust -> purchase` и удаление reason `adjust` из `server/db.ts`.
   - reasons должны содержать `purchase`, `sale`, `return`, `writeoff`, `adjust`.
4. VIEW `inventory.stock` должен быть единым и правильным:
   - `HAVING SUM(qty_delta) > 0`.
   - убрать любые альтернативные определения.
5. Индексы:
   - `movements(smart)`, `movements(reason)`, `movements(created_at)`, `movements(sale_status)`.

### Фаза 4. SMART-справочник: кэш в памяти
Цель: выполнить spec 1/4 и устранить N+1.

1. Ввести `smartCache`:
   - новый модуль (предложение): `server/smart-cache.ts`.
   - загрузка всей таблицы справочника при старте сервера.
   - структуры: `Map<smart, record>`, индекс по нормализованным артикулам.
2. Переписать SMART операции:
   - `server/storage.ts:searchSmart()` и `server/storage.ts:getSmartByCode()` должны работать по кэшу, без `pg.Pool` и без “active connection”.
3. Переписать `/api/articles/search` и `/api/smart/:code`:
   - `server/routes.ts` должен брать данные из кэша и ходить в inventory DB только за остатками (batch).
4. Убрать обогащение stock через DB:
   - `server/storage.ts:getStockLevels()` lookup по кэшу, а не `getSmartByCode()`.

### Фаза 5. SMART-first модель данных: удалить `article` из типов/API/UI
Цель: привести контракт к spec 2/4/8/9.

1. Переписать `shared/schema.ts`:
   - убрать `article` из таблицы `movements` и из `insertMovementSchema`.
   - добавить `adjust` в enum причин.
   - удалить multi-DB контракт (`dbConnections`, mapping types, insertDbConnectionSchema и пр.).
   - переписать импорт: SMART обязателен.
2. Ввести DTO слой:
   - разделить “что хранится в inventory” и “что отдаёт API”.
   - в DTO добавлять `articles/name/brand/description` из кэша при необходимости.
3. Удалить endpoints, завязанные на `:article`:
   - удалить `GET /api/movements/:smart/:article` из `server/routes.ts`;
   - удалить `GET /api/stock/:smart/:article` из `server/routes.ts`;
   - заменить на `GET /api/stock/:smart` (SMART-only).
4. Клиентские страницы перестать читать `movement.article`:
   - `client/src/pages/movement-history.tsx`
   - `client/src/pages/sold-items.tsx`
   - `client/src/pages/stock-details.tsx`

### Фаза 6. Валидация движений + серверная санитизация
Цель: гарантировать корректность данных независимо от UI/импорта.

1. Матрица обязательных полей по типу операции:
   - purchase: qtyDelta > 0, обязательны purchasePrice + boxNumber.
   - sale: qtyDelta < 0, обязательны salePrice + deliveryPrice, server force saleStatus=awaiting_shipment.
   - return: qtyDelta > 0, создаётся только через sold-items, note генерит сервер, фин.поля игнорировать.
   - writeoff: qtyDelta < 0, фин.поля игнорировать.
   - adjust: qtyDelta +/- допускается, note обязателен, цена за единицу опциональна.
2. Реализовать правила на клиенте и сервере:
   - `client/src/pages/add-movement.tsx` (zod `.superRefine()`).
   - `server/routes.ts` перед `storage.createMovement`.
3. Серверная санитизация:
   - игнорировать/обнулять нерелевантные поля, даже если клиент прислал.
4. `saleStatus` только на сервере:
   - `server/routes.ts` в `POST /api/movements`.

### Фаза 7. Форма движения (UI): автокомплит, abort, очистка скрытых полей, prefill
Цель: выполнить spec 4.

1. Одно поле поиска принимает и SMART, и артикулы (поиск по кэшу):
   - `client/src/pages/add-movement.tsx` переосмыслить поле `article` как “поисковое”.
2. Race condition в автокомплите:
   - `client/src/pages/add-movement.tsx` добавить `AbortController` или requestId guard.
3. Очистка скрытых полей при смене reason:
   - `client/src/pages/add-movement.tsx` useEffect на `selectedReason`.
4. Prefill только по `smart`:
   - исправить `client/src/pages/add-movement.tsx` (не требовать `article` в URL).
5. Полная инвалидация кэшей после успешного создания:
   - `client/src/pages/add-movement.tsx` добавить инвалидацию `/api/stock/${smart}/purchases`, `/api/stock/${smart}/sales`, `/api/top-parts`, `/api/sold-out` и др. затронутых.

### Фаза 8. Остатки и детали: “всё загрузить”, BIGINT->number, 0-остаток не 404
Цель: выполнить spec 5/9/10.

1. Убрать лимит 50 на stock:
   - `server/routes.ts` перестать дефолтить `limit=50`;
   - `server/storage.ts:getStockLevels()` убрать `LIMIT/OFFSET` по умолчанию.
2. BIGINT как строка:
   - `server/storage.ts` приводить `total_qty` к `Number(...)` (или каст в SQL).
3. Нулевой остаток:
   - реализовать `GET /api/stock/:smart` так, чтобы `totalQty=0` возвращался как валидный объект, если движения были.
4. Обогащение деталей товара из кэша SMART, без `movement.article`.

### Фаза 9. Аналитика: группировка по SMART, правильный AVG закупа, правильная прибыль
Цель: выполнить spec 6.

1. Переписать `server/storage.ts:getTopParts()`:
   - убрать `article` из SQL;
   - считать avg_purchase_price по всем покупкам smart;
   - убрать `ORDER BY ... LIMIT 10` из AVG.
2. Переписать `/api/stock/:smart/sales`:
   - убрать сопоставление покупок/продаж по `article`;
   - прибыль: `salePrice - avgPurchasePrice - deliveryPrice`.

### Фаза 10. Проданные товары: статусы, NULL-совместимость, защита updateStatus
Цель: выполнить spec 7.

1. Сервер force `awaiting_shipment` при создании продажи.
2. Клиент показывает NULL saleStatus вместе с awaiting.
   - `client/src/pages/sold-items.tsx` фильтры.
3. `updateMovementSaleStatus` только для `reason='sale'`:
   - `server/storage.ts:updateMovementSaleStatus()`.
   - `server/routes.ts` PATCH status.
4. Удалить `console.log` из `client/src/pages/sold-items.tsx`.

### Фаза 11. Импорт: SMART обязателен, CSV RFC4180, Excel guards, лимит размера
Цель: выполнить spec 12.

1. Контракт импорта:
   - `shared/schema.ts` и UI `client/src/pages/bulk-import.tsx` обновить тексты/валидации (SMART обязателен).
2. Excel:
   - `server/routes.ts` проверять наличие листов;
   - приводить `smart` к строке;
   - не терять строки (никаких `.filter(...)` без записи в errors).
3. CSV:
   - `server/routes.ts` заменить split на полноценный парсер CSV (кавычки/запятые).
4. Запрет “угадывания SMART по артикулу”:
   - удалить из `server/storage.ts:processBulkImport()` ветку поиска smart по article.
5. Ограничение размера файла:
   - `server/routes.ts` `multer` с `limits.fileSize`.

### Фаза 12. Ошибки: инфраструктура != 400, не маскировать 0 остатками
Цель: выполнить spec 13.

1. `POST /api/movements`:
   - 400 только на валидацию/бизнес-ошибки;
   - 409 InsufficientStock;
   - 500 инфраструктурные.
2. `getTotalStockBySmartBatch()`:
   - не возвращать нули при ошибке БД, а пробрасывать ошибку.
3. Ввести единый формат ошибок API (`{ error: { code, message, details? } }`).

### Фаза 13. React Query: устойчивые queryKey + удобная инвалидация
Цель: убрать хрупкость `queryKey.join("/")` и сделать инвалидацию надёжной.

1. `client/src/lib/queryClient.ts`:
   - заменить `queryKey.join("/")` на строгий контракт (например `queryKey[0]` как url string).
2. Централизовать инвалидацию после движений:
   - helper типа `invalidateAfterMovementChange(smart)` в `client/src/lib/...`.

### Фаза 14. Чистка дублей и мёртвого кода
Цель: выполнить spec 14.

1. Удалить дубликат normalizeArticle:
   - удалить `client/src/lib/normalization.ts`;
   - в клиенте импортировать из `shared/normalization.ts`.
2. `useToast`:
   - `client/src/hooks/use-toast.ts` эффект должен подписываться один раз (зависимости `[]`).
3. Вынести маппинг row->Movement/DTO:
   - `server/storage.ts` helper `mapMovementRow(...)`.
4. Удалить неиспользуемые импорты/мёртвые куски кода в `server/storage.ts` и других местах.

### Фаза 15. Миграции как дисциплина
Цель: перестать иметь “две разные схемы в рантайме”.

1. Выбрать стратегию:
   - миграции через drizzle-kit (требует настройки под inventory DB);
   - или один idempotent `ensureInventorySchema()` как единственный источник SQL-истины + отдельные явные миграции.
2. Убрать любые дубли инициализации схемы в коде.

---

## 4. Карта замен (что точно удаляем/переписываем)

Удалить:
- `server/connections-storage.ts`
- `client/src/pages/db-connections.tsx`
- `db-connections.json`

Сильно переписать:
- `server/db.ts`
- `server/storage.ts`
- `server/routes.ts`
- `shared/schema.ts`

Точечно править:
- `client/src/pages/add-movement.tsx`
- `client/src/pages/article-search.tsx`
- `client/src/pages/stock-levels.tsx`
- `client/src/pages/stock-details.tsx`
- `client/src/pages/sold-items.tsx`
- `client/src/pages/movement-history.tsx`
- `client/src/lib/queryClient.ts`
- `client/src/hooks/use-toast.ts`
- `client/src/App.tsx`
- `client/src/components/sidebar.tsx`

---

## 5. Definition of Done (когда считаем “всё работает правильно”)

1. Сервер не стартует без обеих БД, без схемы inventory и без кэша SMART.
2. Нет UI/API/хранилища для подключений БД. Нет `db-connections.json`.
3. В inventory нет колонки `article`, и код нигде её не использует.
4. SMART-справочник кэширован в памяти, поиск и обогащение не ходят в parts DB поштучно.
5. Остатки и дашборд не режутся лимитами, данные корректны.
6. Нулевой остаток на деталях SMART возвращается как `totalQty: 0`, 404 только если движений никогда не было.
7. Рейтинг и аналитика группируются по SMART-коду; средняя цена закупа и прибыль считаются по SMART.
8. После любых действий UI получает свежие данные (полная инвалидация кэшей при `staleTime: Infinity`).
9. Импорт требует SMART, корректно парсит CSV, валидирует Excel, не теряет строки, ограничен по размеру, показывает причины ошибок.
10. Инфраструктурные ошибки БД возвращают корректные HTTP статусы и не превращаются в “нулевые остатки”.

