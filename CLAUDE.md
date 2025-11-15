# EventHorizon - Файловая структура проекта

Этот документ описывает структуру проекта SMART Inventory Management System, разработанного с помощью Claude Code.

## Корневая директория

```
EventHorizon/
├── client/              # Frontend React приложение
├── server/              # Backend Express сервер
├── shared/              # Общий код между клиентом и сервером
├── attached_assets/     # Статические ресурсы и файлы
├── .claude/            # Конфигурация Claude Code
├── package.json        # Зависимости проекта
├── tsconfig.json       # Конфигурация TypeScript
├── vite.config.ts      # Конфигурация Vite
├── tailwind.config.ts  # Конфигурация Tailwind CSS
├── drizzle.config.ts   # Конфигурация Drizzle ORM
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
- `article-search.tsx` - Поиск артикулов в базе SMART
- `add-movement.tsx` - Добавление складских операций (поступление, продажа, списание)
- `stock-levels.tsx` - Текущие уровни запасов
- `stock-details.tsx` - Детальная информация по конкретному артикулу с аналитикой
- `movement-history.tsx` - История всех операций
- `sold-items.tsx` - История проданных товаров
- `sold-out.tsx` - Список товаров с нулевым остатком и историей продаж
- `top-parts.tsx` - Рейтинг лучших товаров по прибыльности и продажам
- `bulk-import.tsx` - Массовый импорт данных из Excel/CSV
- `db-connections.tsx` - Управление подключениями к базам данных
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
- `normalization.ts` - Функции нормализации артикулов (клиентская версия)

### `/server` - Backend приложение

Express.js сервер на TypeScript с поддержкой ESM модулей.

**Основные файлы:**
- `index.ts` - Точка входа сервера, настройка Express, middleware, запуск
- `routes.ts` - Определение всех API эндпоинтов
- `storage.ts` - Бизнес-логика и взаимодействие с БД (Repository паттерн)
- `db.ts` - Подключение к PostgreSQL через Drizzle ORM
- `vite.ts` - Интеграция Vite для разработки

**API эндпоинты (примеры):**
- `GET /api/articles/search` - Поиск артикулов
- `POST /api/movements` - Добавление операции
- `GET /api/stock` - Получение уровней запасов
- `GET /api/stock/:smartCode` - Детали по артикулу
- `GET /api/movements` - История операций
- `POST /api/bulk-import` - Массовый импорт
- `GET /api/db-connections` - Список подключений БД
- `POST /api/db-connections` - Добавление подключения

### `/shared` - Общий код

Код, используемый и на клиенте, и на сервере.

**Файлы:**
- `schema.ts` - Drizzle ORM схемы базы данных, типы данных, Zod схемы валидации
- `normalization.ts` - Функции нормализации артикулов (общие)

**Основные схемы БД:**
- `reasons` - Типы операций (поступление, продажа, списание)
- `movements` - Журнал всех операций
- `stock` - View для текущих остатков
- `shippingMethods` - Способы доставки
- `dbConnections` - Настройки подключений к БД

### `/attached_assets` - Ресурсы

Статические файлы, изображения, документы.

### Конфигурационные файлы

#### `package.json`
Описание проекта и зависимостей:
- **Зависимости:** React, Express, Drizzle ORM, TanStack Query, shadcn/ui компоненты, Zod, и др.
- **Scripts:**
  - `dev` - Запуск в режиме разработки
  - `build` - Сборка production версии
  - `start` - Запуск production сервера
  - `check` - Проверка типов TypeScript
  - `db:push` - Применение миграций БД

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

#### `drizzle.config.ts`
Конфигурация Drizzle ORM:
- Путь к схемам
- Настройки подключения к БД
- Директория миграций

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
- `public.smart` - Внешняя база SMART (read-only)
- `inventory.*` - Локальная база складского учета

**Ключевые таблицы:**
- `inventory.reasons` - Справочник типов операций
- `inventory.movements` - Журнал операций (источник истины)
- `inventory.stock` (view) - Агрегированные остатки
- `inventory.shipping_methods` - Способы доставки
- `inventory.db_connections` - Подключения к БД

### Потоки данных

1. **Поиск артикула:** Client → API → SMART DB → Fuzzy Match → Client
2. **Добавление операции:** Client → API → Validation → Transaction → DB → Client
3. **Просмотр остатков:** Client → API → Stock View (aggregation) → Client
4. **Аналитика:** Client → API → Complex Queries → Client

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
- **ORM:** Drizzle ORM
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
- Двухфазный процесс продаж (резервирование → отгрузка)
- Автоматический retry при конфликтах сериализации
- Расчет прибыльности на основе FIFO/средневзвешенной стоимости

### Безопасность
- Prepared statements (защита от SQL injection через Drizzle ORM)
- Валидация входных данных (Zod схемы)
- Контроль доступа к внешним БД (read-only пул для SMART)

### Производительность
- Batch запросы для минимизации обращений к БД
- Connection pooling (pg.Pool)
- Server-side агрегация (SQL views)
- Client-side кэширование (TanStack Query)
- Debounced поиск

## Разработано с помощью Claude Code

Этот проект был разработан с использованием Claude Code - интерактивного инструмента разработки на основе Claude AI от Anthropic.
