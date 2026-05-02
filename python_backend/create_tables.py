"""
create_tables.py — создаёт все таблицы БД с нуля.

Использование:
    source venv/bin/activate
    python create_tables.py
"""
import asyncio
import logging

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.config import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

SQL = """
-- ─────────────────────────────────────────────
--  1. users
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    tg_id         BIGINT UNIQUE,
    username      VARCHAR(64),
    phone         VARCHAR(32),
    ref_code      VARCHAR(32),
    has_ref       TINYINT(1) DEFAULT 0,
    discount_v    DECIMAL(5,4) DEFAULT 0,
    is_blocked    TINYINT(1) DEFAULT 0,
    created_at    DATETIME DEFAULT NOW(),
    last_activity DATETIME DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  2. supports  (операторы / менеджеры / кассиры / суперадмины)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS supports (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    login               VARCHAR(120) UNIQUE,
    pass_hash           VARCHAR(255) NOT NULL,
    role                VARCHAR(12),          -- SUPERADMIN | MANAGER | EX_ADMIN | OPERATOR | CASHIER
    manager_id          BIGINT,               -- FK supports.id
    chat_language       VARCHAR(2) DEFAULT 'RU',
    can_write_chat      TINYINT(1) DEFAULT 1,
    can_cancel_order    TINYINT(1) DEFAULT 1,
    can_edit_requisites TINYINT(1) DEFAULT 1,
    is_active           TINYINT(1) DEFAULT 1,
    active_limit        INT DEFAULT 4,
    rate_percent        DECIMAL(6,2) DEFAULT 0,
    rating              INT DEFAULT 100,
    shift_duration_min  INT DEFAULT 480,
    penalty_per_hour    DECIMAL(10,2) DEFAULT 0,
    deposit             DECIMAL(14,2) DEFAULT 0,
    deposit_paid        DECIMAL(14,2) DEFAULT 0,
    deposit_work        DECIMAL(14,2) DEFAULT 0,
    tg_id               BIGINT NULL,               -- Telegram user ID (cashier notifications)
    team_id             BIGINT NULL,               -- FK cashier_teams.id
    created_at          DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  3. bots
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bots (
    id                INT AUTO_INCREMENT PRIMARY KEY,
    name              VARCHAR(100) UNIQUE NOT NULL,
    identifier        VARCHAR(50) UNIQUE NOT NULL,
    token             VARCHAR(255) NOT NULL,
    description       TEXT,
    is_active         TINYINT(1) DEFAULT 1,
    exchange_chat_link VARCHAR(255),
    reviews_chat_link VARCHAR(255),
    reviews_chat_id   VARCHAR(255),
    owner_id          BIGINT,               -- FK supports.id
    start_message     TEXT,
    contacts_message  TEXT,
    created_at        DATETIME DEFAULT NOW(),
    updated_at        DATETIME DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  4. user_bots  (пользователь в конкретном боте)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_bots (
    id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id               BIGINT NOT NULL,   -- FK users.id
    bot_id                INT NOT NULL,      -- FK bots.id
    tg_id                 BIGINT NOT NULL,
    username              VARCHAR(100),
    phone                 VARCHAR(20),
    ref_code              VARCHAR(50),
    has_ref               TINYINT(1) DEFAULT 0,
    discount_v            DECIMAL(5,4) DEFAULT 0,
    referral_code         VARCHAR(20),
    invited_by            BIGINT,            -- FK user_bots.id
    referral_level        VARCHAR(20) DEFAULT 'BASIC',
    referral_bonus_balance DECIMAL(15,2) DEFAULT 0,
    captcha_passed        TINYINT(1) DEFAULT 1,
    captcha_passed_at     DATETIME,
    created_at            DATETIME DEFAULT NOW(),
    updated_at            DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_user_id (user_id),
    INDEX idx_bot_id  (bot_id),
    INDEX idx_tg_bot  (tg_id, bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  5. bot_requisites
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_requisites (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    bot_id      INT NOT NULL,
    support_id  BIGINT,
    type        VARCHAR(6) NOT NULL,          -- CARD | SBP | CRYPTO | BTC | XMR | LTC | USDT
    address     TEXT NOT NULL,
    bank_name   VARCHAR(100),
    holder_name VARCHAR(100),
    label       VARCHAR(256),
    is_active   TINYINT(1) DEFAULT 1,
    is_default  TINYINT(1) DEFAULT 0,
    created_at  DATETIME DEFAULT NOW(),
    updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_bot_id (bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  6. bot_fee_tiers
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bot_fee_tiers (
    id         INT AUTO_INCREMENT PRIMARY KEY,
    bot_id     INT NOT NULL,
    coin       VARCHAR(4) NOT NULL,
    min_amount DECIMAL(15,2) DEFAULT 0,
    max_amount DECIMAL(15,2),
    buy_fee    DECIMAL(6,4) DEFAULT 0,
    sell_fee   DECIMAL(6,4) DEFAULT 0,
    created_at DATETIME DEFAULT NOW(),
    updated_at DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_bot_coin (bot_id, coin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  7. rates
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rates (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    coin            VARCHAR(4) UNIQUE NOT NULL,
    rate_rub        DECIMAL(20,8) NOT NULL,
    manual_rate_rub DECIMAL(20,8),
    is_manual       TINYINT(1) DEFAULT 0,
    src             VARCHAR(32),
    updated_at      DATETIME DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  8. rate_fee_tiers
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_fee_tiers (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    coin        VARCHAR(4) NOT NULL,
    dir         VARCHAR(4) NOT NULL,          -- BUY | SELL
    min_amount  DECIMAL(15,2) DEFAULT 0,
    max_amount  DECIMAL(15,2),
    fee_percent DECIMAL(6,4) DEFAULT 0,
    created_at  DATETIME DEFAULT NOW(),
    updated_at  DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_coin_dir (coin, dir)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  9. fees  (legacy global fees)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fees (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    coin       VARCHAR(4) NOT NULL,
    bot_id     INT,
    buy_fee    DECIMAL(6,4) NOT NULL,
    sell_fee   DECIMAL(6,4) NOT NULL,
    updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  10. requisites  (реквизиты пользователей, зашифрованы AES)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS requisites (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id          BIGINT NOT NULL,
    kind             VARCHAR(4) NOT NULL,     -- CARD | BTC | LTC | XMR | USDT
    value_cipher     VARBINARY(1024) NOT NULL,
    transaction_type VARCHAR(4) NOT NULL,     -- BUY | SELL
    label            VARCHAR(64),
    is_display       TINYINT(1) DEFAULT 1,
    bot_id           INT,
    created_at       DATETIME DEFAULT NOW(),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  11. orders
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
    id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    unique_id             INT UNIQUE,
    user_id               BIGINT NOT NULL,
    bot_id                INT,
    dir                   VARCHAR(4) NOT NULL,   -- BUY | SELL
    coin                  VARCHAR(4) NOT NULL,
    amount_coin           DECIMAL(30,10) NOT NULL,
    rate_rub              DECIMAL(20,8) NOT NULL,
    fee                   DECIMAL(6,4) NOT NULL,
    ref_percent           DECIMAL(5,4) DEFAULT 0,
    user_discount         DECIMAL(5,4) DEFAULT 0,
    sum_rub               DECIMAL(20,2) NOT NULL,
    status                VARCHAR(20) DEFAULT 'CREATED',
    -- CREATED | AWAITING_CONFIRM | QUEUED | PAYMENT_PENDING | AWAITING_HASH | COMPLETED | CANCELLED
    req_id                BIGINT,
    user_requisite_id     BIGINT,
    user_card_number      VARCHAR(19),
    user_card_holder      VARCHAR(255),
    user_bank_name        VARCHAR(255),
    user_crypto_address   VARCHAR(255),
    exch_card_number      VARCHAR(19),
    exch_card_holder      VARCHAR(255),
    exch_bank_name        VARCHAR(255),
    exch_crypto_address   VARCHAR(255),
    exch_sbp_phone        VARCHAR(20),
    exch_req_id           BIGINT,
    cashier_card_id       BIGINT,              -- FK cashier_cards.id
    support_id            BIGINT,              -- FK supports.id
    support_note          VARCHAR(255),
    shift_id              BIGINT,              -- FK operator_shifts.id
    cancel_reason         VARCHAR(512),
    hash                  TEXT,
    receipt_path          VARCHAR(512),
    operator_received_usdt DECIMAL(20,8),
    operator_rate_rub     DECIMAL(20,8),
    operator_profit_rub   DECIMAL(14,2),
    sla_started_at        DATETIME,
    sla_requisites_setup_at DATETIME,
    sla_user_paid_at      DATETIME,
    sla_deadline_at       DATETIME,
    completed_at          DATETIME,
    complaint_count       INT DEFAULT 0,
    user_bot_id           INT,
    created_at            DATETIME DEFAULT NOW(),
    updated_at            DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_status    (status),
    INDEX idx_support   (support_id),
    INDEX idx_bot_id    (bot_id),
    INDEX idx_user_id   (user_id),
    INDEX idx_created   (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  12. deal_messages
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deal_messages (
    id                 BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id           BIGINT NOT NULL,
    sender_type        VARCHAR(8) NOT NULL,    -- USER | OPERATOR
    sender_id          BIGINT,
    message            TEXT,
    original_message   TEXT,
    translated_message TEXT,
    source_lang        VARCHAR(8),
    translated_at      DATETIME,
    attachments_path   TEXT,
    is_read            TINYINT(1) DEFAULT 0,
    created_at         DATETIME DEFAULT NOW(),
    INDEX idx_order_id (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  13. complaints
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS complaints (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id   BIGINT NOT NULL,
    reason     VARCHAR(255),
    justified  TINYINT(1) DEFAULT 0,
    created_at DATETIME DEFAULT NOW(),
    INDEX idx_order_id (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  14. order_service_messages
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS order_service_messages (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    order_id   BIGINT NOT NULL,
    message    TEXT NOT NULL,
    created_at DATETIME DEFAULT NOW(),
    INDEX idx_order_id (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  15. support_chats
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_chats (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    user_id         BIGINT NOT NULL,
    bot_id          INT NOT NULL,
    last_message_at DATETIME,
    unread_count    INT DEFAULT 0,
    created_at      DATETIME DEFAULT NOW(),
    updated_at      DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_user_bot (user_id, bot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  16. support_chat_messages
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_chat_messages (
    id               BIGINT AUTO_INCREMENT PRIMARY KEY,
    chat_id          BIGINT NOT NULL,
    sender_type      VARCHAR(8) NOT NULL,   -- USER | OPERATOR
    sender_id        BIGINT,
    message          TEXT,
    attachments_path TEXT,
    is_read          TINYINT(1) DEFAULT 0,
    created_at       DATETIME DEFAULT NOW(),
    INDEX idx_chat_id (chat_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  17. operator_manager_messages
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_manager_messages (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    operator_id         BIGINT NOT NULL,
    manager_id          BIGINT NOT NULL,
    sender_type         VARCHAR(12) NOT NULL,  -- OPERATOR | MANAGER | SUPERADMIN
    sender_id           BIGINT NOT NULL,
    order_id            BIGINT,
    order_unique_id     INT,
    order_sum_rub       DECIMAL(20,2),
    message             TEXT NOT NULL,
    is_read_by_operator TINYINT(1) DEFAULT 0,
    is_read_by_manager  TINYINT(1) DEFAULT 0,
    created_at          DATETIME DEFAULT NOW(),
    INDEX idx_operator (operator_id),
    INDEX idx_manager  (manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  18. reviews
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reviews (
    id           INT AUTO_INCREMENT PRIMARY KEY,
    order_id     INT NOT NULL,
    user_raiting VARCHAR(1),
    created_at   DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  19. support_reviews
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS support_reviews (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    support_id BIGINT NOT NULL,
    user_id    BIGINT NOT NULL,
    order_id   BIGINT,
    rating     SMALLINT NOT NULL,
    comment    TEXT,
    created_at DATETIME DEFAULT NOW(),
    updated_at DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_support_id (support_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  20. referral_bonuses
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_bonuses (
    id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
    referrer_userbot_id  BIGINT NOT NULL,
    referred_userbot_id  BIGINT NOT NULL,
    order_id             BIGINT NOT NULL,
    bot_id               INT NOT NULL,
    bonus_amount         DECIMAL(15,2) NOT NULL,
    bonus_percentage     DECIMAL(5,4) NOT NULL,
    referrer_level       VARCHAR(20) NOT NULL,
    created_at           DATETIME DEFAULT NOW(),
    INDEX idx_referrer (referrer_userbot_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  21. referrals_withdraw
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referrals_withdraw (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    userbot_id     BIGINT NOT NULL,
    amount_rub     DECIMAL(15,2) NOT NULL,
    amount_crypto  DECIMAL(20,8) NOT NULL,
    currency       VARCHAR(3) NOT NULL,
    wallet_address TEXT NOT NULL,
    status         VARCHAR(12) DEFAULT 'CREATED',  -- CREATED | COMPLETED | CANCELLED
    created_at     DATETIME DEFAULT NOW(),
    completed_at   DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  22. mailings
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS mailings (
    id               INT AUTO_INCREMENT PRIMARY KEY,
    status           VARCHAR(6) DEFAULT 'active',  -- active | end | cancel
    bot_id           INT NOT NULL,
    text             TEXT NOT NULL,
    total_count      INT NOT NULL,
    send_count       INT DEFAULT 0,
    error_send_count INT DEFAULT 0,
    attachments      TEXT,
    created_at       DATETIME DEFAULT NOW(),
    end_at           DATETIME
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  23. audit_logs
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
    id         BIGINT AUTO_INCREMENT PRIMARY KEY,
    actor      VARCHAR(64),
    action     VARCHAR(64),
    meta       JSON,
    created_at DATETIME DEFAULT NOW(),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  24. system_settings
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS system_settings (
    `key`      VARCHAR(128) PRIMARY KEY,
    value      TEXT,
    updated_at DATETIME DEFAULT NOW() ON UPDATE NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  25. cashier_teams
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cashier_teams (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    name        VARCHAR(128) NOT NULL,
    bot_token   VARCHAR(255),
    deposit             DECIMAL(14,2) DEFAULT 0,
    deposit_work        DECIMAL(14,2) DEFAULT 0,
    deposit_paid        DECIMAL(14,2) DEFAULT 0,
    created_at  DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  26. cashier_cards
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cashier_cards (
    id                     BIGINT AUTO_INCREMENT PRIMARY KEY,
    cashier_id             BIGINT NOT NULL,
    card_number            VARCHAR(19) NOT NULL,
    card_holder            VARCHAR(255),
    bank_name              VARCHAR(255),
    min_amount             DECIMAL(10,2) DEFAULT 0,
    max_amount             DECIMAL(10,2) DEFAULT 999999,
    total_volume_limit     DECIMAL(14,2) DEFAULT 0,
    current_volume         DECIMAL(14,2) DEFAULT 0,
    interval_minutes       INT DEFAULT 0,
    last_used_at           DATETIME,
    is_active              TINYINT(1) DEFAULT 1,
    limit_reached_notified TINYINT(1) DEFAULT 0,
    created_at             DATETIME DEFAULT NOW(),
    INDEX idx_cashier_id (cashier_id),
    INDEX idx_is_active  (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  27. cashier_members  (team members per cashier account)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cashier_members (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    cashier_id  BIGINT NOT NULL,
    tg_id       BIGINT NOT NULL,
    username    VARCHAR(128),
    joined_at   DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_cashier_tg (cashier_id, tg_id),
    INDEX idx_cashier_id (cashier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  28. cashier_deposits
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cashier_deposits (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    cashier_id    BIGINT NOT NULL,
    tx_hash       VARCHAR(255) NOT NULL,
    coin          VARCHAR(10) NOT NULL DEFAULT 'BTC',
    amount_coin   DECIMAL(20,8) NOT NULL,
    btc_rate_rub  DECIMAL(20,4) NOT NULL,
    amount_rub    DECIMAL(14,2) NOT NULL,
    status        VARCHAR(20) NOT NULL DEFAULT 'PENDING',  -- PENDING | CONFIRMED | REJECTED
    reject_reason VARCHAR(255),
    confirmed_at  DATETIME,
    created_at    DATETIME DEFAULT NOW(),
    UNIQUE KEY uq_tx_hash (tx_hash),
    INDEX idx_cashier_id (cashier_id),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  27. operator_shifts
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_shifts (
    id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
    support_id           BIGINT NOT NULL,
    status               VARCHAR(10) DEFAULT 'active',  -- active | closed
    planned_duration_min INT,
    actual_duration_min  INT,
    orders_completed     INT DEFAULT 0,
    total_volume_rub     DECIMAL(20,2) DEFAULT 0,
    total_profit_rub     DECIMAL(14,2) DEFAULT 0,
    early_close_penalty  DECIMAL(14,2) DEFAULT 0,
    notes                TEXT,
    started_at           DATETIME,
    ended_at             DATETIME,
    created_at           DATETIME DEFAULT NOW(),
    INDEX idx_support_id (support_id),
    INDEX idx_status     (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  28. operator_usdt_debts
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_usdt_debts (
    id             BIGINT AUTO_INCREMENT PRIMARY KEY,
    support_id     BIGINT NOT NULL,
    order_id       BIGINT NOT NULL UNIQUE,
    sum_rub_locked DECIMAL(20,2) NOT NULL,
    rapira_rate_rub DECIMAL(20,8) NOT NULL,
    markup_rub     DECIMAL(20,8) DEFAULT 4,
    usdt_due       DECIMAL(20,6) NOT NULL,
    usdt_paid      DECIMAL(20,6) DEFAULT 0,
    rub_released   DECIMAL(20,2) DEFAULT 0,
    status         VARCHAR(15) DEFAULT 'OPEN',  -- OPEN | PARTIALLY_PAID | PAID
    created_at     DATETIME DEFAULT NOW(),
    updated_at     DATETIME DEFAULT NOW() ON UPDATE NOW(),
    INDEX idx_support_id (support_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  29. operator_usdt_payment_intents
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_usdt_payment_intents (
    id              BIGINT AUTO_INCREMENT PRIMARY KEY,
    support_id      BIGINT NOT NULL,
    requested_usdt  DECIMAL(20,6) NOT NULL,
    exact_usdt      DECIMAL(20,6) NOT NULL,
    company_wallet  VARCHAR(128) NOT NULL,
    status          VARCHAR(10) DEFAULT 'OPEN',  -- OPEN | CONSUMED | EXPIRED | CANCELLED
    expires_at      DATETIME NOT NULL,
    created_at      DATETIME DEFAULT NOW(),
    consumed_at     DATETIME,
    INDEX idx_support_id (support_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  30. operator_usdt_payments
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_usdt_payments (
    id                   BIGINT AUTO_INCREMENT PRIMARY KEY,
    support_id           BIGINT NOT NULL,
    intent_id            BIGINT NOT NULL,
    tx_hash              VARCHAR(128) UNIQUE NOT NULL,
    declared_amount_usdt DECIMAL(20,6),
    actual_amount_usdt   DECIMAL(20,6),
    confirmations        INT DEFAULT 0,
    to_address           VARCHAR(128),
    from_address         VARCHAR(128),
    status               VARCHAR(10) DEFAULT 'PENDING',  -- PENDING | CONFIRMED | REJECTED
    reject_reason        VARCHAR(255),
    network              VARCHAR(5) DEFAULT 'TRC20',
    created_at           DATETIME DEFAULT NOW(),
    confirmed_at         DATETIME,
    INDEX idx_support_id (support_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  31. operator_usdt_payment_allocations
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operator_usdt_payment_allocations (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    payment_id   BIGINT NOT NULL,
    debt_id      BIGINT NOT NULL,
    usdt_applied DECIMAL(20,6) NOT NULL,
    rub_released DECIMAL(20,2) NOT NULL,
    created_at   DATETIME DEFAULT NOW(),
    INDEX idx_payment_id (payment_id),
    INDEX idx_debt_id    (debt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  Начальные данные
-- ─────────────────────────────────────────────
INSERT IGNORE INTO system_settings (`key`, value) VALUES
    ('cashier_order_interval', '0'),
    ('cashier_order_counter',  '0');

INSERT IGNORE INTO rates (coin, rate_rub) VALUES
    ('BTC',  0),
    ('LTC',  0),
    ('XMR',  0),
    ('USDT', 0);

-- ─────────────────────────────────────────────
--  32. referral_level_tiers  (конфигурируемые уровни реф. программы)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS referral_level_tiers (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    min_sum_rub   DECIMAL(20,2) NOT NULL DEFAULT 0,
    max_sum_rub   DECIMAL(20,2),       -- NULL = нет верхнего предела (топ-уровень)
    bonus_percent DECIMAL(6,2) NOT NULL DEFAULT 0,
    label         VARCHAR(64),
    sort_order    INT NOT NULL DEFAULT 0,
    created_at    DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO referral_level_tiers (id, min_sum_rub, max_sum_rub, bonus_percent, label, sort_order) VALUES
    (1,       100,    10000,  20, 'Базовый',      1),
    (2,     10000,   100000,  25, 'Продвинутый',  2),
    (3,    100000,  1000000,  30, 'VIP',          3),
    (4,   1000000,     NULL,  40, 'VIP+',         4);

INSERT IGNORE INTO system_settings (`key`, value) VALUES ('referral_first_bonus_rub', '0');

-- ─────────────────────────────────────────────
--  33. coupons  (промокоды)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupons (
    id                    BIGINT AUTO_INCREMENT PRIMARY KEY,
    code                  VARCHAR(64) UNIQUE NOT NULL,
    brand                 VARCHAR(32) NOT NULL DEFAULT 'promo',
    discount_rub          DECIMAL(14,2) NOT NULL DEFAULT 0,
    min_order_rub         DECIMAL(14,2) NOT NULL DEFAULT 0,
    max_uses              INT NOT NULL DEFAULT 1,
    used_count            INT NOT NULL DEFAULT 0,
    assigned_user_id      BIGINT,
    assigned_tg_id        BIGINT,
    created_by_support_id BIGINT,
    is_active             TINYINT(1) DEFAULT 1,
    expires_at            DATETIME,
    created_at            DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  33. coupon_usages
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coupon_usages (
    id          BIGINT AUTO_INCREMENT PRIMARY KEY,
    coupon_id   BIGINT NOT NULL,
    user_id     BIGINT,
    order_id    BIGINT,
    used_at     DATETIME DEFAULT NOW(),
    INDEX idx_coupon_id (coupon_id),
    INDEX idx_user_id   (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ─────────────────────────────────────────────
--  crypto_purchases  (закупки крипты)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crypto_purchases (
    id                  BIGINT AUTO_INCREMENT PRIMARY KEY,
    coin                VARCHAR(10) NOT NULL DEFAULT 'BTC',
    amount_coin         DECIMAL(30,10) NOT NULL,
    amount_usdt         DECIMAL(14,2) NOT NULL,
    usdt_rate_rub       DECIMAL(20,8) NOT NULL DEFAULT 0,
    coin_rate_rub       DECIMAL(20,8) NOT NULL,
    cost_rub            DECIMAL(20,2) GENERATED ALWAYS AS (amount_usdt * usdt_rate_rub) STORED,
    note                TEXT,
    created_at          DATETIME DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
"""


# Columns to add if missing: (table, column, definition)
MIGRATIONS = [
    ("supports", "team_id",              "BIGINT NULL"),
    ("supports", "tg_id",                "BIGINT NULL"),
    ("supports", "shift_duration_min",   "INT DEFAULT 480"),
    ("supports", "penalty_per_hour",     "DECIMAL(10,2) DEFAULT 0"),
    ("supports", "deposit",              "DECIMAL(14,2) DEFAULT 0"),
    ("supports", "deposit_paid",         "DECIMAL(14,2) DEFAULT 0"),
    ("supports", "deposit_work",         "DECIMAL(14,2) DEFAULT 0"),
    ("orders",   "cashier_card_id",      "BIGINT"),
    ("orders",   "user_bot_id",          "INT"),
    ("orders",   "operator_received_usdt", "DECIMAL(20,8)"),
    ("orders",   "operator_rate_rub",    "DECIMAL(20,8)"),
    ("orders",   "operator_profit_rub",  "DECIMAL(14,2)"),
    ("orders",   "shift_id",             "BIGINT"),
    ("orders",   "complaint_count",      "INT DEFAULT 0"),
    ("orders",   "ref_percent",          "DECIMAL(5,4) DEFAULT 0"),
    ("orders",   "user_discount",        "DECIMAL(5,4) DEFAULT 0"),
    ("operator_manager_messages", "order_id",         "BIGINT"),
    ("operator_manager_messages", "order_unique_id",  "INT"),
    ("operator_manager_messages", "order_sum_rub",    "DECIMAL(20,2)"),
    ("cashier_teams", "deposit",                      "DECIMAL(14,2) DEFAULT 0"),
    ("cashier_teams", "deposit_work",                 "DECIMAL(14,2) DEFAULT 0"),
    ("cashier_teams", "deposit_paid",                 "DECIMAL(14,2) DEFAULT 0"),
    ("supports", "daily_rate_usd",       "DECIMAL(10,2) DEFAULT 0"),
    ("supports", "per_order_rate_usd",   "DECIMAL(10,2) DEFAULT 0"),
    ("operator_shifts", "actual_duration_min", "INT"),
    ("supports",        "can_use_coupons",           "TINYINT(1) DEFAULT 0"),
    ("user_bots",       "custom_referral_percent",   "DECIMAL(6,2) NULL"),
    ("user_bots",       "custom_referral_set_at",    "DATETIME NULL"),
    ("user_bots",       "first_bonus_paid",          "TINYINT(1) DEFAULT 0"),
    ("orders",          "coupon_id",             "BIGINT"),
    ("orders",          "coupon_discount_rub",   "DECIMAL(14,2) DEFAULT 0"),
]


async def _run_migrations(conn) -> None:
    for table, column, definition in MIGRATIONS:
        # Check if column exists
        result = await conn.execute(
            text("SELECT COUNT(*) FROM information_schema.COLUMNS "
                 "WHERE TABLE_SCHEMA = DATABASE() "
                 "AND TABLE_NAME = :t AND COLUMN_NAME = :c"),
            {"t": table, "c": column},
        )
        exists = result.scalar()
        if not exists:
            try:
                await conn.execute(
                    text(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {definition}")
                )
                log.info(f"MIGRATE  ALTER TABLE {table} ADD COLUMN {column}")
            except Exception as e:
                log.error(f"MIGRATE FAIL — {table}.{column}: {e}")
                raise


async def main() -> None:
    engine = create_async_engine(settings.DATABASE_URL, echo=False)

    statements = [s.strip() for s in SQL.split(";") if s.strip()]

    async with engine.begin() as conn:
        # 1. Create missing tables
        for stmt in statements:
            if not stmt:
                continue
            try:
                await conn.execute(text(stmt))
                first_line = stmt.split("\n")[0].strip()
                log.info(f"OK  {first_line[:80]}")
            except Exception as e:
                log.error(f"FAIL — {e}\n  SQL: {stmt[:120]}")
                raise

        # 2. Add missing columns to existing tables
        await _run_migrations(conn)

    await engine.dispose()
    log.info("\n✅  База данных обновлена успешно.")


if __name__ == "__main__":
    asyncio.run(main())
