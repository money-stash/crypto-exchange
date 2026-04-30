-- Migration: add tg_id to supports table for cashier Telegram notifications
ALTER TABLE supports ADD COLUMN IF NOT EXISTS tg_id BIGINT NULL COMMENT 'Telegram user ID for cashier notifications';
