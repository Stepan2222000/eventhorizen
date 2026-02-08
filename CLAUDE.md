# EventHorizon - Файловая структура проекта

Этот документ описывает структуру проекта EventHorizon (SMART-справочник + складской учет).

Источник истины по бизнес-логике и философии системы: `lab/validation/specification.md`.

## Корневая директория

```
EventHorizon/
├── client/              # Frontend React приложение
├── server/              # Backend Express сервер
├── shared/              # Общий код между клиентом и сервером
├── migrations/          # Исторически (сейчас схема inventory обеспечивается при старте сервера)
├── lab/                 # Документация по валидации/рефакторингу (spec + plan)
├── attached_assets/     # Статические ресурсы и файлы
├── .claude/            # Конфигурация Claude Code
├── package.json        # Зависимости проекта
├── tsconfig.json       # Конфигурация TypeScript
├── vite.config.ts      # Конфигурация Vite
├── tailwind.config.ts  # Конфигурация Tailwind CSS
├── components.json     # Конфигурация shadcn/ui компонентов
├── design_guidelines.md # Руководство по дизайну
└── README.md           # Документация проекта
```

## Описание основных директорий

### `/client` - Frontend приложение

Директория содержит React приложение, построенное с использованием Vite, TypeScript, и shadcn/ui компонентов.

#### `/client/src` - Исходный код клиента

**Главные файлы:**
- `main.tsx` - Точка входа приложения, настройка React Query
- `App.tsx` - Главный компонент приложения с роутингом (Wouter)

#### `/client/src/pages` - Страницы приложения

- `dashboard.tsx` - Главная панель с основной статистикой
- `article-search.tsx` - Поиск по SMART/артикулам в SMART-справочнике
- `add-movement.tsx` - Добавление складских операций (purchase/sale/writeoff/adjust)
- `stock-levels.tsx` - Текущие уровни запасов
- `stock-details.tsx` - Детали товара по SMART-коду + аналитика покупок/продаж
- `movement-history.tsx` - История всех операций
- `sold-items.tsx` - История проданных товаров
- `sold-out.tsx` - Список товаров с нулевым остатком и историей продаж
- `top-parts.tsx` - Рейтинг лучших товаров по прибыльности и продажам
- `bulk-import.tsx` - Массовый импорт данных из Excel/CSV
- `not-found.tsx` - Страница 404

#### `/client/src/components` - React компоненты

**Кастомные компоненты:**
- `sidebar.tsx` - Боковая панель навигации
- `disambiguation-modal.tsx` - Модальное окно для выбора из нескольких вариантов артикулов

**`/client/src/components/ui` - UI библиотека (shadcn/ui):**

Переиспользуемые UI компоненты на базе Radix UI и Tailwind CSS:
- `button.tsx` - Кнопки
- `input.tsx` - Поля ввода
- `form.tsx` - Формы с валидацией
- `table.tsx` - Таблицы
- `card.tsx` - Карточки
- `dialog.tsx` - Модальные окна
- `select.tsx` - Выпадающие списки
- `toast.tsx`, `toaster.tsx` - Уведомления
- `badge.tsx` - Значки
- `chart.tsx` - Графики (Recharts)
- `calendar.tsx` - Календарь
- `tabs.tsx` - Вкладки
- `alert-dialog.tsx` - Диалоги подтверждения
- `dropdown-menu.tsx` - Выпадающие меню
- `scroll-area.tsx` - Области прокрутки
- `separator.tsx` - Разделители
- `skeleton.tsx` - Скелетоны загрузки
- `tooltip.tsx` - Подсказки
- `checkbox.tsx` - Чекбоксы
- `radio-group.tsx` - Радио кнопки
- `switch.tsx` - Переключатели
- `slider.tsx` - Слайдеры
- `progress.tsx` - Индикаторы прогресса
- `avatar.tsx` - Аватары
- `accordion.tsx` - Аккордеоны
- `sheet.tsx` - Боковые панели
- `drawer.tsx` - Выдвижные панели
- `popover.tsx` - Всплывающие окна
- `command.tsx` - Командная палитра
- `navigation-menu.tsx` - Навигационное меню
- `menubar.tsx` - Панель меню
- `context-menu.tsx` - Контекстное меню
- `breadcrumb.tsx` - Хлебные крошки
- `carousel.tsx` - Карусель
- `collapsible.tsx` - Сворачиваемые блоки
- `hover-card.tsx` - Карточки при наведении
- `aspect-ratio.tsx` - Контейнеры с фиксированным соотношением сторон
- `resizable.tsx` - Изменяемые панели
- `toggle.tsx`, `toggle-group.tsx` - Переключатели
- `input-otp.tsx` - Ввод OTP кодов
- `pagination.tsx` - Пагинация
- `sidebar.tsx` - Компонент боковой панели
- `alert.tsx` - Алерты
- `textarea.tsx` - Многострочные поля ввода

#### `/client/src/hooks` - React хуки

- `use-toast.ts` - Хук для отображения уведомлений
- `use-mobile.tsx` - Хук для определения мобильного устройства

#### `/client/src/lib` - Вспомогательные библиотеки

- `utils.ts` - Утилитные функции (cn для классов)
- `queryClient.ts` - Конфигурация TanStack Query
  - Нормализация артикулов берется из `shared/normalization.ts` (единая реализация)

### `/server` - Backend приложение

Express.js сервер на TypeScript с поддержкой ESM модулей.

**Основные файлы:**
- `index.ts` - Точка входа сервера, настройка Express, middleware, запуск
- `context.ts` - Fail-fast инициализация (подключение к двум БД, схема inventory, SMART-кэш)
- `routes.ts` - Определение всех API эндпоинтов
- `storage.ts` - Бизнес-логика и взаимодействие с БД (Repository паттерн)
- `config.ts` - Чтение конфигурации из env (PARTS_DB_*, INVENTORY_DB_*)
- `db.ts` - Создание двух `pg.Pool` на процесс (parts + inventory)
- `smart-cache.ts` - Загрузка SMART-справочника в память (кэш) при старте
- `inventory-schema.ts` - Idempotent обеспечение схемы `inventory.*` и VIEW `inventory.stock`
- `vite.ts` - Интеграция Vite для разработки

**API эндпоинты (примеры):**
- `GET /api/articles/search` - Поиск артикулов
- `POST /api/movements` - Добавление операции
- `GET /api/stock` - Получение уровней запасов
- `GET /api/stock/:smart` - Детали по SMART (возвращает `totalQty: 0`, если товар был в истории)
- `GET /api/movements` - История операций
- `POST /api/bulk-import` - Массовый импорт

### `/shared` - Общий код

Код, используемый и на клиенте, и на сервере.

**Файлы:**
- `schema.ts` - Типы данных + Zod схемы валидации (без ORM)
- `normalization.ts` - Функции нормализации артикулов (общие)

**Основные схемы БД:**
- `reasons` - Типы операций (поступление, продажа, списание)
- `movements` - Журнал всех операций
- `stock` - View для текущих остатков
- `shippingMethods` - Способы доставки

### `/attached_assets` - Ресурсы

Статические файлы, изображения, документы.

### Конфигурационные файлы

#### `package.json`
Описание проекта и зависимостей:
- **Зависимости:** React, Express, TanStack Query, shadcn/ui компоненты, Zod, pg, и др.
- **Scripts:**
  - `dev` - Запуск в режиме разработки
  - `build` - Сборка production версии
  - `start` - Запуск production сервера
  - `check` - Проверка типов TypeScript

#### `tsconfig.json`
Конфигурация TypeScript компилятора для всего проекта.

#### `vite.config.ts`
Конфигурация Vite:
- React плагин
- Алиасы путей (@, @shared, @assets)
- Настройки сборки
- Dev сервер

#### `tailwind.config.ts`
Настройки Tailwind CSS:
- Цветовая схема
- Кастомные утилиты
- Плагины (typography, animations)

#### `components.json`
Конфигурация shadcn/ui:
- Стили компонентов
- Пути к компонентам
- Алиасы

#### `design_guidelines.md`
Руководство по дизайну и стилю кодирования проекта.

## Архитектура данных

### База данных PostgreSQL

**Схемы:**
- `public.smart` - SMART-справочник (read-only, загружается целиком в память сервера)
- `inventory.*` - Складской учет (создается/обеспечивается приложением в inventory DB)

**Ключевые таблицы:**
- `inventory.reasons` - Справочник типов операций
- `inventory.movements` - Журнал операций (источник истины, хранит только `smart`, без `article`)
- `inventory.stock` (view) - Агрегированные остатки
- `inventory.shipping_methods` - Способы доставки

### Потоки данных

1. **Поиск:** Client → API → поиск по SMART-кэшу (в памяти) → batch-остатки из inventory → Client
2. **Добавление операции:** Client → API → валидация/санитизация → SERIALIZABLE txn → inventory DB → Client
3. **Остатки:** Client → API → VIEW `inventory.stock` (агрегация) → Client
4. **Аналитика:** Client → API → агрегации по SMART → Client

## Технологический стек

### Frontend
- **Framework:** React 18 + TypeScript
- **Build Tool:** Vite
- **Routing:** Wouter
- **State Management:** TanStack Query
- **UI Library:** shadcn/ui (Radix UI + Tailwind CSS)
- **Forms:** React Hook Form + Zod
- **Charts:** Recharts
- **Icons:** Lucide React

### Backend
- **Runtime:** Node.js (ESM)
- **Framework:** Express.js
- **Database:** PostgreSQL
- **DB driver:** `pg` (`pg.Pool`)
- **Validation:** Zod
- **File Upload:** Multer
- **Spreadsheets:** XLSX

### Development
- **Language:** TypeScript
- **Package Manager:** npm
- **Linting:** TypeScript Compiler
- **CSS:** Tailwind CSS v4

## Особенности реализации

### Бизнес-логика
- Fuzzy matching артикулов (нормализация, удаление разделителей, транслитерация)
- Предотвращение отрицательных остатков через валидацию и SERIALIZABLE транзакции
- Статусы продаж (ожидает отправки → отправлено) применимы только к операциям `sale`
- Автоматический retry при конфликтах сериализации
- Расчет прибыльности на основе средней цены закупки по SMART (средневзвешенная по количеству)

### Безопасность
- Parameterized queries (защита от SQL injection через параметры `pg`)
- Валидация входных данных (Zod схемы)
- Контроль доступа к внешним БД (SMART DB используется только для чтения)

### Производительность
- Batch запросы для минимизации обращений к БД
- Connection pooling (pg.Pool)
- Server-side агрегация (SQL views)
- Client-side кэширование (TanStack Query)
- Debounced поиск

## Разработано с помощью Claude Code

Этот проект был разработан с использованием Claude Code - интерактивного инструмента разработки на основе Claude AI от Anthropic.
