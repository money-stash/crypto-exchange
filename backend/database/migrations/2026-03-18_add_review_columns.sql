-- Compatible with MySQL versions that do not support
-- "ADD COLUMN IF NOT EXISTS" in ALTER TABLE.
SET @db_name = DATABASE();

SET @has_comment = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'reviews'
    AND column_name = 'comment'
);
SET @sql = IF(
  @has_comment = 0,
  'ALTER TABLE reviews ADD COLUMN comment TEXT NULL AFTER user_raiting',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_telegram_message_id = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'reviews'
    AND column_name = 'telegram_message_id'
);
SET @sql = IF(
  @has_telegram_message_id = 0,
  'ALTER TABLE reviews ADD COLUMN telegram_message_id BIGINT NULL AFTER comment',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
