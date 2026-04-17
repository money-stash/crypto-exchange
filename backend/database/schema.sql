-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--

-- --------------------------------------------------------

--

CREATE TABLE `audit_logs` (
  `id` bigint NOT NULL,
  `actor` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `action` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `meta` json DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `bots` (
  `id` int NOT NULL,
  `name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `identifier` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `token` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `is_active` tinyint(1) DEFAULT '1',
  `exchange_chat_link` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviews_chat_link` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `reviews_chat_id` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `owner_id` bigint DEFAULT NULL,
  `start_message` text COLLATE utf8mb4_unicode_ci,
  `contacts_message` text COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `bot_fee_tiers` (
  `id` int NOT NULL,
  `bot_id` int NOT NULL,
  `coin` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `min_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `max_amount` decimal(15,2) DEFAULT NULL,
  `buy_fee` decimal(6,4) NOT NULL DEFAULT '0.0000',
  `sell_fee` decimal(6,4) NOT NULL DEFAULT '0.0000',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `bot_requisites` (
  `id` bigint NOT NULL,
  `bot_id` int NOT NULL,
  `support_id` bigint DEFAULT NULL,
  `type` enum('CARD','SBP','CRYPTO','BTC','XMR','LTC','USDT') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bank_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `holder_name` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `label` varchar(256) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `is_default` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `complaints` (
  `id` bigint NOT NULL,
  `order_id` bigint NOT NULL,
  `reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `justified` tinyint(1) DEFAULT '0',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `deal_messages` (
  `id` bigint NOT NULL,
  `order_id` bigint NOT NULL,
  `sender_type` enum('USER','OPERATOR') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sender_id` bigint DEFAULT NULL,
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `original_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `translated_message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `source_lang` varchar(8) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `translated_at` timestamp NULL DEFAULT NULL,
  `attachments_path` text COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `is_read` tinyint(1) DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `fees` (
  `id` bigint NOT NULL,
  `coin` enum('BTC','LTC','XMR','USDT') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `bot_id` int DEFAULT NULL,
  `buy_fee` decimal(6,4) NOT NULL,
  `sell_fee` decimal(6,4) NOT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `mailings` (
  `id` int NOT NULL,
  `status` enum('end','active','cancel') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'active',
  `bot_id` int NOT NULL,
  `text` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `total_count` int NOT NULL,
  `send_count` int NOT NULL DEFAULT '0',
  `error_send_count` int NOT NULL DEFAULT '0',
  `attachments` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `end_at` timestamp NULL DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `orders` (
  `id` bigint NOT NULL,
  `unique_id` int DEFAULT NULL,
  `user_id` bigint NOT NULL,
  `bot_id` int DEFAULT NULL,
  `dir` enum('BUY','SELL') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `coin` enum('BTC','LTC','XMR','USDT') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `amount_coin` decimal(30,10) NOT NULL,
  `rate_rub` decimal(20,8) NOT NULL,
  `fee` decimal(6,4) NOT NULL,
  `ref_percent` decimal(5,4) DEFAULT '0.0000',
  `user_discount` decimal(5,4) DEFAULT '0.0000',
  `sum_rub` decimal(20,2) NOT NULL,
  `status` enum('CREATED','AWAITING_CONFIRM','QUEUED','PAYMENT_PENDING','COMPLETED','CANCELLED','AWAITING_HASH') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'CREATED',
  `req_id` bigint DEFAULT NULL,
  `user_requisite_id` bigint DEFAULT NULL,
  `user_card_number` varchar(19) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_card_holder` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_bank_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `user_crypto_address` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exch_card_number` varchar(19) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exch_card_holder` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exch_bank_name` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exch_crypto_address` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exch_sbp_phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `exch_req_id` bigint DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `user_bot_id` int DEFAULT NULL,
  `support_id` bigint DEFAULT NULL,
  `support_note` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `hash` text COLLATE utf8mb4_unicode_ci,
  `receipt_path` varchar(512) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sla_started_at` timestamp NULL DEFAULT NULL,
  `sla_requisites_setup_at` timestamp NULL DEFAULT NULL,
  `sla_user_paid_at` timestamp NULL DEFAULT NULL,
  `completed_at` timestamp NULL DEFAULT NULL,
  `complaint_count` int DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `rates` (
  `id` bigint NOT NULL,
  `coin` enum('BTC','LTC','XMR','USDT') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `rate_rub` decimal(20,8) NOT NULL,
  `manual_rate_rub` decimal(20,8) DEFAULT NULL,
  `is_manual` tinyint(1) NOT NULL DEFAULT '0',
  `src` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Структура таблицы `rate_fee_tiers`
--

CREATE TABLE `rate_fee_tiers` (
  `id` bigint NOT NULL,
  `coin` enum('BTC','LTC','XMR','USDT') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `dir` enum('BUY','SELL') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `min_amount` decimal(15,2) NOT NULL DEFAULT '0.00',
  `max_amount` decimal(15,2) DEFAULT NULL,
  `fee_percent` decimal(6,4) NOT NULL DEFAULT '0.0000',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `referrals_withdraw` (
  `id` bigint NOT NULL,
  `userbot_id` bigint NOT NULL COMMENT '',
  `amount_rub` decimal(15,2) NOT NULL COMMENT '',
  `amount_crypto` decimal(20,8) NOT NULL COMMENT '',
  `currency` enum('BTC','LTC','XMR') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '',
  `wallet_address` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '',
  `status` enum('CREATED','COMPLETED','CANCELLED') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'CREATED' COMMENT '',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP COMMENT '',
  `completed_at` timestamp NULL DEFAULT NULL COMMENT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='';

-- --------------------------------------------------------

--

CREATE TABLE `referral_bonuses` (
  `id` bigint NOT NULL,
  `referrer_userbot_id` bigint NOT NULL,
  `referred_userbot_id` bigint NOT NULL,
  `order_id` bigint NOT NULL,
  `bot_id` int NOT NULL,
  `bonus_amount` decimal(15,2) NOT NULL,
  `bonus_percentage` decimal(5,4) NOT NULL,
  `referrer_level` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `requisites` (
  `id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `kind` enum('CARD','BTC','LTC','XMR','USDT') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `value_cipher` varbinary(1024) NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `transaction_type` enum('BUY','SELL') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `label` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_display` tinyint(1) NOT NULL DEFAULT '1',
  `bot_id` int DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `reviews` (
  `id` int NOT NULL,
  `order_id` int NOT NULL,
  `user_raiting` enum('1','2','3','4','5') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `supports` (
  `id` bigint NOT NULL,
  `login` varchar(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pass_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('MANAGER','OPERATOR','EX_ADMIN','SUPERADMIN') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `manager_id` bigint DEFAULT NULL,
  `chat_language` enum('RU','EN') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'RU',
  `can_write_chat` tinyint(1) NOT NULL DEFAULT '1',
  `can_cancel_order` tinyint(1) NOT NULL DEFAULT '1',
  `can_edit_requisites` tinyint(1) NOT NULL DEFAULT '1',
  `is_active` tinyint(1) DEFAULT '1',
  `active_limit` int DEFAULT '4',
  `rate_percent` decimal(6,2) NOT NULL DEFAULT '0.00',
  `rating` int DEFAULT '100',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `deposit` decimal(14,2) NOT NULL DEFAULT '0.00',
  `deposit_paid` decimal(14,2) NOT NULL DEFAULT '0.00',
  `deposit_work` decimal(14,2) NOT NULL DEFAULT '0.00'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--

INSERT INTO `supports` (`id`, `login`, `pass_hash`, `role`, `manager_id`, `chat_language`, `can_write_chat`, `can_cancel_order`, `can_edit_requisites`, `is_active`, `active_limit`, `rate_percent`, `rating`, `created_at`, `deposit`, `deposit_paid`, `deposit_work`) VALUES
(1, 'superadmin', '$2a$10$cH7jvKJp5jzTc1oYQLsWBexngX5P0G2qLcyajOxcbJlskmv3W2Nzi', 'SUPERADMIN', NULL, 'RU', 1, 1, 1, 1, 4, 0.00, 50, '2025-10-29 23:09:18', 0.00, 0.00, 0.00);

-- --------------------------------------------------------

--

CREATE TABLE `support_chats` (
  `id` bigint NOT NULL,
  `user_id` bigint NOT NULL COMMENT '',
  `bot_id` int NOT NULL COMMENT '',
  `last_message_at` timestamp NULL DEFAULT NULL COMMENT '',
  `unread_count` int DEFAULT '0' COMMENT '',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='';

-- --------------------------------------------------------

--

CREATE TABLE `support_chat_messages` (
  `id` bigint NOT NULL,
  `chat_id` bigint NOT NULL COMMENT '',
  `sender_type` enum('USER','OPERATOR') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT '',
  `sender_id` bigint DEFAULT NULL COMMENT '',
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT '',
  `attachments_path` text COLLATE utf8mb4_unicode_ci COMMENT '',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `is_read` tinyint(1) DEFAULT '0' COMMENT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='';

-- --------------------------------------------------------

--
-- Структура таблицы `operator_manager_messages`
--

CREATE TABLE `operator_manager_messages` (
  `id` bigint NOT NULL,
  `operator_id` bigint NOT NULL,
  `manager_id` bigint NOT NULL,
  `sender_type` enum('OPERATOR','MANAGER','SUPERADMIN') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `sender_id` bigint NOT NULL,
  `order_id` bigint DEFAULT NULL,
  `order_unique_id` int DEFAULT NULL,
  `order_sum_rub` decimal(20,2) DEFAULT NULL,
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `is_read_by_operator` tinyint(1) NOT NULL DEFAULT '0',
  `is_read_by_manager` tinyint(1) NOT NULL DEFAULT '0'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `support_reviews` (
  `id` bigint NOT NULL,
  `support_id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `order_id` bigint DEFAULT NULL,
  `rating` tinyint NOT NULL,
  `comment` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `users` (
  `id` bigint NOT NULL,
  `tg_id` bigint DEFAULT NULL,
  `username` varchar(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ref_code` varchar(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `has_ref` tinyint(1) DEFAULT '0',
  `discount_v` decimal(5,4) DEFAULT '0.0000',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `is_blocked` tinyint(1) DEFAULT '0',
  `last_activity` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--

CREATE TABLE `user_bots` (
  `id` bigint NOT NULL,
  `user_id` bigint NOT NULL,
  `bot_id` int NOT NULL,
  `tg_id` bigint NOT NULL,
  `username` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `phone` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ref_code` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `has_ref` tinyint(1) DEFAULT '0',
  `discount_v` decimal(5,4) DEFAULT '0.0000',
  `created_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `referral_code` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `invited_by` bigint DEFAULT NULL,
  `referral_level` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT 'BASIC',
  `referral_bonus_balance` decimal(15,2) DEFAULT '0.00',
  `captcha_passed` tinyint(1) NOT NULL DEFAULT '1',
  `captcha_passed_at` datetime DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--

--
ALTER TABLE `audit_logs`
  ADD PRIMARY KEY (`id`);

--
ALTER TABLE `bots`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `name` (`name`),
  ADD UNIQUE KEY `identifier` (`identifier`),
  ADD KEY `idx_identifier` (`identifier`),
  ADD KEY `idx_is_active` (`is_active`),
  ADD KEY `bots_owner_fk` (`owner_id`);

--
ALTER TABLE `bot_fee_tiers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_bot_coin_range` (`bot_id`,`coin`,`min_amount`),
  ADD KEY `idx_bot_coin_amount` (`bot_id`,`coin`,`min_amount`,`max_amount`);

--
ALTER TABLE `bot_requisites`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_bot_type` (`bot_id`,`type`),
  ADD KEY `idx_bot_active` (`bot_id`,`is_active`),
  ADD KEY `bot_requisites_support_fk` (`support_id`);

--
ALTER TABLE `complaints`
  ADD PRIMARY KEY (`id`),
  ADD KEY `order_id` (`order_id`);

--
ALTER TABLE `deal_messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_order_messages` (`order_id`,`created_at`),
  ADD KEY `idx_deal_messages_order_unread` (`order_id`,`is_read`);

--
ALTER TABLE `fees`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_bot_coin` (`bot_id`,`coin`),
  ADD KEY `idx_fees_bot_coin` (`bot_id`,`coin`);

--
ALTER TABLE `mailings`
  ADD PRIMARY KEY (`id`);

--
ALTER TABLE `orders`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_order_id` (`unique_id`),
  ADD KEY `user_id` (`user_id`),
  ADD KEY `idx_bot_orders` (`bot_id`),
  ADD KEY `user_requisite_id` (`user_requisite_id`);

--
ALTER TABLE `rates`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `coin` (`coin`);

--
-- Индексы таблицы `rate_fee_tiers`
--
ALTER TABLE `rate_fee_tiers`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_coin_dir_min` (`coin`,`dir`,`min_amount`),
  ADD KEY `idx_coin_dir_range` (`coin`,`dir`,`min_amount`,`max_amount`);

--
ALTER TABLE `referrals_withdraw`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_userbot_id` (`userbot_id`),
  ADD KEY `idx_status` (`status`),
  ADD KEY `idx_created_at` (`created_at`);

--
ALTER TABLE `referral_bonuses`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_referral_bonuses_referrer` (`referrer_userbot_id`),
  ADD KEY `idx_referral_bonuses_referred` (`referred_userbot_id`),
  ADD KEY `idx_referral_bonuses_order` (`order_id`),
  ADD KEY `idx_referral_bonuses_bot` (`bot_id`);

--
ALTER TABLE `requisites`
  ADD PRIMARY KEY (`id`),
  ADD KEY `user_id` (`user_id`);

--
ALTER TABLE `reviews`
  ADD PRIMARY KEY (`id`);

--
ALTER TABLE `supports`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`login`),
  ADD KEY `idx_supports_manager_id` (`manager_id`);

--
ALTER TABLE `support_chats`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_user_bot_chat` (`user_id`,`bot_id`),
  ADD KEY `idx_bot_id` (`bot_id`),
  ADD KEY `idx_last_message` (`last_message_at` DESC),
  ADD KEY `idx_unread` (`unread_count`);

--
ALTER TABLE `support_chat_messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_chat_created` (`chat_id`,`created_at` DESC),
  ADD KEY `idx_chat_unread` (`chat_id`,`is_read`);

--
-- Индексы таблицы `operator_manager_messages`
--
ALTER TABLE `operator_manager_messages`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_omm_operator_manager_created` (`operator_id`,`manager_id`,`created_at`,`id`),
  ADD KEY `idx_omm_manager_unread` (`manager_id`,`is_read_by_manager`,`created_at`),
  ADD KEY `idx_omm_operator_unread` (`operator_id`,`is_read_by_operator`,`created_at`),
  ADD KEY `idx_omm_order_id` (`order_id`);

--
ALTER TABLE `support_reviews`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_support_id` (`support_id`),
  ADD KEY `idx_user_id` (`user_id`),
  ADD KEY `idx_order_id` (`order_id`),
  ADD KEY `idx_rating` (`rating`),
  ADD KEY `idx_created_at` (`created_at`);

--
ALTER TABLE `users`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `tg_id` (`tg_id`);

--
ALTER TABLE `user_bots`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `unique_user_bot` (`user_id`,`bot_id`),
  ADD UNIQUE KEY `unique_tg_bot` (`tg_id`,`bot_id`),
  ADD UNIQUE KEY `unique_referral_code_bot` (`referral_code`,`bot_id`),
  ADD KEY `bot_id` (`bot_id`),
  ADD KEY `idx_tg_bot` (`tg_id`,`bot_id`),
  ADD KEY `idx_user_bot` (`user_id`,`bot_id`),
  ADD KEY `idx_userbot_referral_code` (`referral_code`),
  ADD KEY `idx_userbot_invited_by` (`invited_by`),
  ADD KEY `idx_user_bots_captcha_passed` (`captcha_passed`);

--

--
ALTER TABLE `audit_logs`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `bots`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `bot_fee_tiers`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `bot_requisites`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `complaints`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `deal_messages`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `fees`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `mailings`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `orders`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `rates`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `rate_fee_tiers`
--
ALTER TABLE `rate_fee_tiers`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `referrals_withdraw`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `referral_bonuses`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `requisites`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `reviews`
  MODIFY `id` int NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `supports`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
ALTER TABLE `support_chats`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `support_chat_messages`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT для таблицы `operator_manager_messages`
--
ALTER TABLE `operator_manager_messages`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `support_reviews`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `users`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--
ALTER TABLE `user_bots`
  MODIFY `id` bigint NOT NULL AUTO_INCREMENT;

--

--
ALTER TABLE `bots`
  ADD CONSTRAINT `bots_owner_fk` FOREIGN KEY (`owner_id`) REFERENCES `supports` (`id`);

--
ALTER TABLE `bot_fee_tiers`
  ADD CONSTRAINT `bot_fee_tiers_ibfk_1` FOREIGN KEY (`bot_id`) REFERENCES `bots` (`id`) ON DELETE CASCADE;

--
ALTER TABLE `bot_requisites`
  ADD CONSTRAINT `bot_requisites_ibfk_1` FOREIGN KEY (`bot_id`) REFERENCES `bots` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `bot_requisites_support_fk` FOREIGN KEY (`support_id`) REFERENCES `supports` (`id`);

--
ALTER TABLE `complaints`
  ADD CONSTRAINT `complaints_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`);

--
ALTER TABLE `deal_messages`
  ADD CONSTRAINT `deal_messages_ibfk_1` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE;

--
ALTER TABLE `orders`
  ADD CONSTRAINT `orders_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`),
  ADD CONSTRAINT `orders_ibfk_2` FOREIGN KEY (`bot_id`) REFERENCES `bots` (`id`) ON DELETE SET NULL,
  ADD CONSTRAINT `orders_ibfk_3` FOREIGN KEY (`user_requisite_id`) REFERENCES `requisites` (`id`);

--
ALTER TABLE `referrals_withdraw`
  ADD CONSTRAINT `referrals_withdraw_ibfk_1` FOREIGN KEY (`userbot_id`) REFERENCES `user_bots` (`id`) ON DELETE CASCADE;

--
ALTER TABLE `referral_bonuses`
  ADD CONSTRAINT `referral_bonuses_ibfk_1` FOREIGN KEY (`referrer_userbot_id`) REFERENCES `user_bots` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `referral_bonuses_ibfk_2` FOREIGN KEY (`referred_userbot_id`) REFERENCES `user_bots` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `referral_bonuses_ibfk_3` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `referral_bonuses_ibfk_4` FOREIGN KEY (`bot_id`) REFERENCES `bots` (`id`) ON DELETE CASCADE;

--
ALTER TABLE `requisites`
  ADD CONSTRAINT `requisites_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`);

--
-- Ограничения внешнего ключа таблицы `supports`
--
ALTER TABLE `supports`
  ADD CONSTRAINT `fk_supports_manager_id` FOREIGN KEY (`manager_id`) REFERENCES `supports` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
ALTER TABLE `support_chats`
  ADD CONSTRAINT `support_chats_bot_fk` FOREIGN KEY (`bot_id`) REFERENCES `bots` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `support_chats_user_fk` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE;

--
ALTER TABLE `support_chat_messages`
  ADD CONSTRAINT `support_chat_messages_chat_fk` FOREIGN KEY (`chat_id`) REFERENCES `support_chats` (`id`) ON DELETE CASCADE;

--
-- Ограничения внешнего ключа таблицы `operator_manager_messages`
--
ALTER TABLE `operator_manager_messages`
  ADD CONSTRAINT `fk_omm_operator` FOREIGN KEY (`operator_id`) REFERENCES `supports` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_omm_manager` FOREIGN KEY (`manager_id`) REFERENCES `supports` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_omm_sender` FOREIGN KEY (`sender_id`) REFERENCES `supports` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT `fk_omm_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;

--
ALTER TABLE `support_reviews`
  ADD CONSTRAINT `support_reviews_ibfk_1` FOREIGN KEY (`support_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `support_reviews_ibfk_2` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `support_reviews_ibfk_3` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE SET NULL;

--
ALTER TABLE `user_bots`
  ADD CONSTRAINT `user_bots_ibfk_1` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  ADD CONSTRAINT `user_bots_ibfk_2` FOREIGN KEY (`bot_id`) REFERENCES `bots` (`id`) ON DELETE CASCADE;

-- --------------------------------------------------------

--
-- Структура таблицы `system_settings`
--

CREATE TABLE IF NOT EXISTS `system_settings` (
  `key` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `value` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Структура таблицы `operator_usdt_debts`
--

CREATE TABLE IF NOT EXISTS `operator_usdt_debts` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `support_id` bigint NOT NULL,
  `order_id` bigint NOT NULL,
  `sum_rub_locked` decimal(20,2) NOT NULL,
  `rapira_rate_rub` decimal(20,8) NOT NULL,
  `markup_rub` decimal(20,8) NOT NULL DEFAULT '4.00000000',
  `usdt_due` decimal(20,6) NOT NULL,
  `usdt_paid` decimal(20,6) NOT NULL DEFAULT '0.000000',
  `rub_released` decimal(20,2) NOT NULL DEFAULT '0.00',
  `status` enum('OPEN','PARTIALLY_PAID','PAID') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_operator_usdt_debts_order_id` (`order_id`),
  KEY `idx_operator_usdt_debts_support_status` (`support_id`,`status`),
  CONSTRAINT `fk_operator_usdt_debts_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_operator_usdt_debts_support` FOREIGN KEY (`support_id`) REFERENCES `supports` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Структура таблицы `operator_usdt_payment_intents`
--

CREATE TABLE IF NOT EXISTS `operator_usdt_payment_intents` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `support_id` bigint NOT NULL,
  `requested_usdt` decimal(20,6) NOT NULL,
  `exact_usdt` decimal(20,6) NOT NULL,
  `company_wallet` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` enum('OPEN','CONSUMED','EXPIRED','CANCELLED') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'OPEN',
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `consumed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_operator_usdt_payment_intents_support_status_expires` (`support_id`,`status`,`expires_at`),
  CONSTRAINT `fk_operator_usdt_payment_intents_support` FOREIGN KEY (`support_id`) REFERENCES `supports` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Структура таблицы `operator_usdt_payments`
--

CREATE TABLE IF NOT EXISTS `operator_usdt_payments` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `support_id` bigint NOT NULL,
  `intent_id` bigint NOT NULL,
  `tx_hash` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `declared_amount_usdt` decimal(20,6) DEFAULT NULL,
  `actual_amount_usdt` decimal(20,6) DEFAULT NULL,
  `confirmations` int NOT NULL DEFAULT '0',
  `to_address` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `from_address` varchar(128) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `status` enum('PENDING','CONFIRMED','REJECTED') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'PENDING',
  `reject_reason` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `network` enum('TRC20') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'TRC20',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `confirmed_at` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_operator_usdt_payments_tx_hash` (`tx_hash`),
  KEY `idx_operator_usdt_payments_support_status` (`support_id`,`status`),
  KEY `idx_operator_usdt_payments_intent` (`intent_id`),
  CONSTRAINT `fk_operator_usdt_payments_intent` FOREIGN KEY (`intent_id`) REFERENCES `operator_usdt_payment_intents` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_operator_usdt_payments_support` FOREIGN KEY (`support_id`) REFERENCES `supports` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Структура таблицы `operator_usdt_payment_allocations`
--

CREATE TABLE IF NOT EXISTS `operator_usdt_payment_allocations` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `payment_id` bigint NOT NULL,
  `debt_id` bigint NOT NULL,
  `usdt_applied` decimal(20,6) NOT NULL,
  `rub_released` decimal(20,2) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_operator_usdt_payment_allocations_payment_debt` (`payment_id`,`debt_id`),
  KEY `idx_operator_usdt_payment_allocations_payment` (`payment_id`),
  KEY `idx_operator_usdt_payment_allocations_debt` (`debt_id`),
  CONSTRAINT `fk_operator_usdt_payment_allocations_debt` FOREIGN KEY (`debt_id`) REFERENCES `operator_usdt_debts` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_operator_usdt_payment_allocations_payment` FOREIGN KEY (`payment_id`) REFERENCES `operator_usdt_payments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Структура таблицы `order_service_messages`
--

CREATE TABLE IF NOT EXISTS `order_service_messages` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `order_id` bigint NOT NULL,
  `message` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_order_service_messages_order_created` (`order_id`,`created_at`,`id`),
  CONSTRAINT `fk_order_service_messages_order` FOREIGN KEY (`order_id`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
