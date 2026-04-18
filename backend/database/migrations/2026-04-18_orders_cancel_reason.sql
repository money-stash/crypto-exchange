-- Add cancel_reason column to orders table.
SET @db_name = DATABASE();

SET @has_cancel_reason = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'orders'
    AND column_name = 'cancel_reason'
);

SET @sql = IF(
  @has_cancel_reason = 0,
  'ALTER TABLE orders ADD COLUMN cancel_reason VARCHAR(500) NULL AFTER status',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
