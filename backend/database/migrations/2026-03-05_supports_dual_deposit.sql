-- Compatible with MySQL versions that do not support
-- "ADD COLUMN IF NOT EXISTS" in ALTER TABLE.
SET @db_name = DATABASE();

SET @has_deposit_paid = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'supports'
    AND column_name = 'deposit_paid'
);
SET @sql = IF(
  @has_deposit_paid = 0,
  'ALTER TABLE supports ADD COLUMN deposit_paid DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER deposit',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_deposit_work = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'supports'
    AND column_name = 'deposit_work'
);
SET @sql = IF(
  @has_deposit_work = 0,
  'ALTER TABLE supports ADD COLUMN deposit_work DECIMAL(14,2) NOT NULL DEFAULT 0.00 AFTER deposit_paid',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE supports
SET deposit_work = deposit
WHERE deposit_work = 0;
