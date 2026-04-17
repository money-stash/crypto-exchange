-- Compatible with MySQL versions that do not support
-- "ADD COLUMN IF NOT EXISTS" in ALTER TABLE.
SET @db_name = DATABASE();

-- supports.can_write_chat
SET @has_can_write_chat = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'supports'
    AND column_name = 'can_write_chat'
);
SET @sql = IF(
  @has_can_write_chat = 0,
  'ALTER TABLE supports ADD COLUMN can_write_chat TINYINT(1) NOT NULL DEFAULT 1 AFTER chat_language',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- supports.can_cancel_order
SET @has_can_cancel_order = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'supports'
    AND column_name = 'can_cancel_order'
);
SET @sql = IF(
  @has_can_cancel_order = 0,
  'ALTER TABLE supports ADD COLUMN can_cancel_order TINYINT(1) NOT NULL DEFAULT 1 AFTER can_write_chat',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE supports
SET can_write_chat = 1
WHERE can_write_chat IS NULL;

UPDATE supports
SET can_cancel_order = 1
WHERE can_cancel_order IS NULL;
