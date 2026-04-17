# Kazah Exchange — Python Rewrite Reference

## Контекст проекта

Криптовалютный обменник (RUB ↔ BTC/LTC/XMR/USDT).
**Задача:** полностью переписать с Node.js (Express + Telegraf) на **Python (FastAPI + aiogram 3.x)**.
Фронтенд (React + Vite) остаётся без изменений — он работает с тем же REST API и Socket.IO.

---

## Текущий стек (Node.js — источник правды)

| Слой | Технология | Расположение |
|---|---|---|
| HTTP API | Express.js | `backend/src/routes/`, `backend/src/controllers/` |
| Telegram бот | Telegraf (~6700 строк) | `backend/src/bot/MultiTelegramBotManager.js` |
| База данных | MySQL + mysql2 (raw SQL) | `backend/src/models/` |
| Real-time | Socket.IO | `backend/src/services/SocketService.js` |
| Бизнес-логика | Services | `backend/src/services/` |
| Фоновые задачи | node-cron | `backend/src/services/CronJobs.js` |
| Валидация | Joi | `backend/src/middleware/validation.js` |
| JWT Auth | jsonwebtoken | `backend/src/middleware/auth.js` |
| Шифрование реквизитов | AES (Node crypto) | в models/Requisite.js |

---

## Целевой стек (Python)

| Задача | Библиотека | Аналог из Node.js |
|---|---|---|
| HTTP API | **FastAPI** | Express.js |
| Telegram бот | **aiogram 3.x** | Telegraf |
| ORM | **SQLAlchemy 2.x async** | mysql2 raw SQL |
| MySQL драйвер | **aiomysql** | mysql2 |
| Миграции | **Alembic** | ручные SQL файлы |
| Pydantic v2 | валидация схем | Joi |
| WebSocket/realtime | **python-socketio[asyncio]** | Socket.IO |
| JWT | **python-jose** + **passlib** | jsonwebtoken |
| Шифрование | **cryptography** (AES/Fernet) | Node crypto |
| Фоновые задачи | **APScheduler** | node-cron |
| HTTP клиент | **httpx** (async) | axios/fetch |
| OpenAI переводы | **openai** (тот же API) | openai |
| Переменные окружения | **pydantic-settings** | dotenv |

---

## Структура нового Python-проекта

```
project/
├── app/
│   ├── main.py                 # FastAPI app + socketio ASGI mount + lifespan
│   ├── config.py               # pydantic BaseSettings (читает .env)
│   ├── database.py             # SQLAlchemy async engine + session factory
│   │
│   ├── models/                 # SQLAlchemy ORM модели (= backend/src/models/)
│   │   ├── user.py             # users + user_bots таблицы
│   │   ├── order.py            # orders + deal_messages
│   │   ├── bot.py              # bots + bot_requisites + bot_fee_tiers
│   │   ├── support.py          # supports
│   │   ├── support_chat.py     # support_chats + support_chat_messages
│   │   ├── operator_manager_chat.py
│   │   ├── rate.py             # rates + rate_fee_tiers
│   │   ├── fee.py              # fees
│   │   ├── mailing.py          # mailings
│   │   ├── referral.py         # referral_bonuses + referrals_withdraw
│   │   ├── requisite.py        # requisites (с шифрованием)
│   │   ├── review.py           # reviews + support_reviews
│   │   ├── audit_log.py        # audit_logs
│   │   └── system_setting.py   # system_settings
│   │
│   ├── schemas/                # Pydantic схемы (request/response DTOs)
│   │   ├── auth.py
│   │   ├── order.py
│   │   ├── bot.py
│   │   └── ...
│   │
│   ├── routers/                # FastAPI роутеры (= backend/src/routes/)
│   │   ├── auth.py             # POST /auth/login, GET /auth/me, POST /auth/refresh
│   │   ├── orders.py           # GET/POST /orders, PATCH /:id/cancel, ...
│   │   ├── deals.py            # POST /:id/assign, /mark-payment, /complete
│   │   ├── bots.py             # CRUD ботов, реквизиты, статистика
│   │   ├── users.py            # управление пользователями
│   │   ├── supports.py         # управление операторами, долги
│   │   ├── rates.py            # курсы валют, ручные перегазовки
│   │   ├── fees.py             # комиссии
│   │   ├── mailings.py         # массовые рассылки
│   │   ├── support_chats.py    # чат оператор↔пользователь (ключевой!)
│   │   ├── operator_manager_chats.py
│   │   ├── referral_withdrawals.py
│   │   ├── audit_logs.py
│   │   ├── settings.py
│   │   └── uploads.py          # загрузка файлов
│   │
│   ├── services/               # Бизнес-логика (= backend/src/services/)
│   │   ├── order_service.py    # статусы заявок, SLA, расчёт котировок
│   │   ├── rate_service.py     # получение курсов Bybit/Kraken/Rapira
│   │   ├── referral_service.py # бонусы, уровни, вывод
│   │   ├── mailing_service.py  # массовые рассылки через бота
│   │   ├── support_service.py  # рейтинг операторов
│   │   ├── translation_service.py  # OpenAI перевод сообщений
│   │   └── tron_service.py     # проверка транзакций TRON
│   │
│   ├── socket/
│   │   └── socket_service.py   # python-socketio эмиты (= SocketService.js)
│   │
│   ├── middleware/
│   │   └── auth.py             # JWT Depends, RBAC, get_current_user
│   │
│   └── scheduler/
│       └── jobs.py             # APScheduler: обновление курсов, SLA check, cleanup
│
├── bot/
│   ├── manager.py              # BotManager: несколько ботов, старт/стоп
│   ├── routers/                # aiogram Router по фичам
│   │   ├── start.py            # /start, captcha, главное меню
│   │   ├── buy.py              # flow покупки RUB→CRYPTO
│   │   ├── sell.py             # flow продажи CRYPTO→RUB
│   │   ├── cabinet.py          # личный кабинет, история, реквизиты
│   │   ├── support_chat.py     # режим чата с поддержкой
│   │   ├── rates.py            # /course, тарифы
│   │   └── callbacks.py        # общие callback handlers
│   ├── states/
│   │   ├── order_states.py     # FSM для buy/sell flow
│   │   └── support_states.py   # FSM для режима поддержки
│   ├── keyboards/
│   │   ├── reply.py            # reply клавиатуры (главное меню)
│   │   └── inline.py           # inline кнопки (заявки, подтверждения)
│   └── middlewares/
│       └── throttling.py       # rate limiting
│
└── alembic/                    # Миграции (из backend/database/schema.sql)
    ├── env.py
    └── versions/
```

---

## База данных — все таблицы

| Таблица | Назначение | Модель |
|---|---|---|
| `users` | Telegram пользователи (общие) | `app/models/user.py` |
| `user_bots` | Пользователь в конкретном боте (реферальная система, бонусы) | `app/models/user.py` |
| `bots` | Telegram боты в системе | `app/models/bot.py` |
| `bot_requisites` | Реквизиты обменника (CARD/SBP/CRYPTO) | `app/models/bot.py` |
| `bot_fee_tiers` | Ступенчатые комиссии по боту | `app/models/bot.py` |
| `orders` | Заявки на обмен | `app/models/order.py` |
| `deal_messages` | Переписка внутри заявки | `app/models/order.py` |
| `requisites` | Реквизиты пользователей (зашифровано) | `app/models/requisite.py` |
| `rates` | Курсы криптовалют | `app/models/rate.py` |
| `rate_fee_tiers` | Глобальные ступенчатые комиссии | `app/models/rate.py` |
| `fees` | Глобальные комиссии (legacy) | `app/models/fee.py` |
| `supports` | Аккаунты операторов/менеджеров | `app/models/support.py` |
| `support_chats` | Сессии чата оператор↔клиент | `app/models/support_chat.py` |
| `support_chat_messages` | Сообщения в чате поддержки | `app/models/support_chat.py` |
| `operator_manager_messages` | Чат оператор↔менеджер | `app/models/operator_manager_chat.py` |
| `referral_bonuses` | Начисленные реферальные бонусы | `app/models/referral.py` |
| `referrals_withdraw` | Запросы на вывод бонусов | `app/models/referral.py` |
| `reviews` | Оценки пользователей (1-5 звёзд) | `app/models/review.py` |
| `support_reviews` | Оценки операторов | `app/models/review.py` |
| `mailings` | Кампании массовых рассылок | `app/models/mailing.py` |
| `audit_logs` | Лог всех действий | `app/models/audit_log.py` |
| `complaints` | Жалобы на заявки | `app/models/order.py` |
| `system_settings` | Системные настройки | `app/models/system_setting.py` |

---

## Роли и права (RBAC)

| Роль | Права |
|---|---|
| `SUPERADMIN` | Полный доступ ко всему |
| `MANAGER` | Управление операторами, все боты, поддержка |
| `EX_ADMIN` | Только свои боты |
| `OPERATOR` | Обработка заявок, чат (ограничено флагами) |

Флаги в `supports`: `can_write_chat`, `can_cancel_order`, `can_edit_requisites`

JWT payload: `{id, login, role, manager_id, chat_language, can_write_chat, can_cancel_order, can_edit_requisites}`

---

## Socket.IO события (не менять — фронтенд слушает их)

### Комнаты
- `role:SUPERADMIN`, `role:MANAGER`, `role:EX_ADMIN` — по роли
- `operators` — все операторы
- `user:{userId}` — конкретный пользователь
- `bot:{botId}` — владелец конкретного бота (EX_ADMIN)

### События → фронтенд

| Событие | Когда |
|---|---|
| `order:created` | Новая заявка |
| `order:updated` | Изменение данных заявки |
| `order:status-changed` | Смена статуса |
| `order:taken` | Оператор взял заявку |
| `order:deleted` | Удаление заявки |
| `order:message` | Новое сообщение в чате заявки |
| `user:payment-confirmation` | Клиент подтвердил оплату |
| `support-chat:message` | Сообщение в чате поддержки |
| `support-chat:read` | Прочитано |
| `support-chat:typing` | Печатает |
| `support-chat:deleted` | Чат удалён |
| `operator-manager-chat:message` | Сообщение оператор↔менеджер |
| `operator-manager-chat:read` | Прочитано |
| `operator-manager-chat:assignment-updated` | Переназначение менеджера |

---

## Telegram бот — ключевые сценарии

### Команды
- `/start` — регистрация, captcha (emoji picker), главное меню
- `💸 Обмен RUB → CRYPTO` — flow покупки
- `💵 Обмен CRYPTO → RUB` — flow продажи
- `👤 Личный раздел` — история, реквизиты, рефералы
- `📊 Тарифы` — курсы и комиссии
- `💬 Поддержка` — вход в режим чата

### FSM состояния (OrderStates)
```
choosing_coin → entering_amount → entering_requisite → confirming_order
→ waiting_payment → [done]
```

### FSM состояния (SupportChatStates)
```
in_support_chat  ← пользователь в режиме переписки с оператором
```

### Несколько ботов
- `BotManager.bots: dict[int, Bot]` — ключ = `bot.id` из БД
- Каждый бот стартует отдельной `asyncio.Task` с polling
- При отправке сообщения оператором: `bots[bot_id].send_message(tg_id, text)`

---

## Чат поддержки — полный цикл

```
Клиент (Telegram)
  │ пишет сообщение в боте (SupportChatStates.in_support_chat)
  ↓
bot/routers/support_chat.py
  │ сохраняет в support_chat_messages (sender_type=USER)
  │ sio.emit("support-chat:message", ...)
  ↓
Веб-панель оператора (React) — видит сообщение через Socket.IO

Оператор пишет ответ в веб
  │ POST /api/support-chats/{chatId}/messages
  ↓
app/routers/support_chats.py
  │ сохраняет в support_chat_messages (sender_type=OPERATOR)
  │ sio.emit("support-chat:message", ...)
  │ bot_manager.send_support_message_to_user(chat_id, text, operator_login)
  ↓
BotManager.send_support_message_to_user()
  │ SELECT tg_id, bot_id FROM support_chats WHERE id=?
  │ bots[bot_id].send_message(chat_id=tg_id, text=...)
  ↓
Клиент получает сообщение в Telegram
```

---

## Внешние API

| Сервис | Назначение | Где смотреть |
|---|---|---|
| Bybit | Курс USDT/RUB | `app/services/rate_service.py` |
| Kraken | Резервный курс | `app/services/rate_service.py` |
| Rapira | Резервный курс | `app/services/rate_service.py` |
| OpenAI (gpt-4o-mini) | Перевод сообщений для операторов | `app/services/translation_service.py` |
| TronScan API | Верификация TRON транзакций | `app/services/tron_service.py` |
| QR Server API | Генерация QR кодов для долгов | `app/services/support_service.py` |

---

## Переменные окружения (.env)

```env
DATABASE_URL=mysql+aiomysql://user:pass@host:3306/exchange_db
JWT_SECRET=...
AES_KEY_HEX=...              # шифрование реквизитов пользователей
OPENAI_API_KEY=...
ORDER_LOG_BOT_TOKEN=...      # бот для логов заявок в канал
OPERATOR_ALERT_BOT_TOKEN=... # бот для алертов операторам
MANAGER_ALERT_BOT_TOKEN=...
ACTIVATION_ALERT_BOT_TOKEN=...
BYBIT_API_BASE=https://api.bybit.com
KRAKEN_API_URL=https://api.kraken.com/0/public/Ticker
RAPIRA_API_URL=https://api.rapira.net/open/market/rates
CRON_RATES=*/5 * * * *       # частота обновления курсов
SLA_MINUTES=30
PORT=8080
```

---

## Порядок разработки (рекомендуемый)

1. **Alembic + SQLAlchemy модели** — фундамент (`alembic/`, `app/models/`)
   - Взять готовую схему из `backend/database/schema.sql`
2. **FastAPI скелет** — `app/main.py`, `app/config.py`, `app/database.py`
3. **JWT auth** — `app/routers/auth.py`, `app/middleware/auth.py`
4. **Socket.IO** — `app/socket/socket_service.py`, mount в `main.py`
5. **Все REST роутеры** — переносить один за другим из `backend/src/routes/`
6. **aiogram BotManager** — `bot/manager.py` (несколько ботов)
7. **Bot FSM: buy/sell flow** — самая сложная часть
8. **Bot: support chat** — `bot/routers/support_chat.py`
9. **Сервисы** — rates, mailing, referral, scheduler
10. **Тесты + деплой**

---

## Важные особенности при переносе

- **Шифрование реквизитов**: в Node.js — AES через `crypto`. Ключ — `AES_KEY_HEX`. Нужно сохранить совместимость (те же зашифрованные данные в БД должны читаться Python кодом).
- **Captcha**: при `/start` — показывается emoji picker, пользователь должен выбрать правильный фрукт. Хранится в `user_bots.captcha_passed`.
- **Активные лимиты операторов**: `supports.active_limit` — максимум одновременных заявок (1-8). Проверяется при взятии заявки.
- **SLA**: `orders.sla_started_at`, `sla_deadline_at` — отслеживается в cron, влияет на рейтинг операторов.
- **Реферальная система**: 2 уровня. `user_bots.referral_level`, `referral_bonuses` — начисляется при завершении заявки.
- **Форматы квитанций**: jpg, jpeg, png, webp, heic, heif, bmp, tiff, gif, pdf.
- **Перевод чата**: операторы могут иметь `chat_language` ≠ RU — тогда сообщения автоматически переводятся через OpenAI.
