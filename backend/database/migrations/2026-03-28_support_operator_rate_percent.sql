-- Compatible with MySQL versions that do not support
-- "ADD COLUMN IF NOT EXISTS" in ALTER TABLE.
SET @db_name = DATABASE();

SET @has_rate_percent = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'supports'
    AND column_name = 'rate_percent'
);
SET @sql = IF(
  @has_rate_percent = 0,
  'ALTER TABLE supports ADD COLUMN rate_percent DECIMAL(6,2) NOT NULL DEFAULT 0.00 AFTER active_limit',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
