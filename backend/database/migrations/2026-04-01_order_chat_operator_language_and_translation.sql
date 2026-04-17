-- Compatible with MySQL versions that do not support
-- "ADD COLUMN IF NOT EXISTS" in ALTER TABLE.
SET @db_name = DATABASE();

-- supports.chat_language
SET @has_chat_language = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'supports'
    AND column_name = 'chat_language'
);
SET @sql = IF(
  @has_chat_language = 0,
  'ALTER TABLE supports ADD COLUMN chat_language ENUM(''RU'', ''EN'') NOT NULL DEFAULT ''RU'' AFTER role',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE supports
SET chat_language = 'RU'
WHERE chat_language IS NULL OR chat_language = '';

-- deal_messages.original_message
SET @has_original_message = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'deal_messages'
    AND column_name = 'original_message'
);
SET @sql = IF(
  @has_original_message = 0,
  'ALTER TABLE deal_messages ADD COLUMN original_message TEXT NULL AFTER message',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- deal_messages.translated_message
SET @has_translated_message = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'deal_messages'
    AND column_name = 'translated_message'
);
SET @sql = IF(
  @has_translated_message = 0,
  'ALTER TABLE deal_messages ADD COLUMN translated_message TEXT NULL AFTER original_message',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- deal_messages.source_lang
SET @has_source_lang = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'deal_messages'
    AND column_name = 'source_lang'
);
SET @sql = IF(
  @has_source_lang = 0,
  'ALTER TABLE deal_messages ADD COLUMN source_lang VARCHAR(8) NULL AFTER translated_message',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- deal_messages.translated_at
SET @has_translated_at = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'deal_messages'
    AND column_name = 'translated_at'
);
SET @sql = IF(
  @has_translated_at = 0,
  'ALTER TABLE deal_messages ADD COLUMN translated_at TIMESTAMP NULL DEFAULT NULL AFTER source_lang',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE deal_messages
SET original_message = message
WHERE original_message IS NULL;
