-- Add dedicated operator permission for sending/updating requisites.
-- Compatible with MySQL versions without "ADD COLUMN IF NOT EXISTS".
SET @db_name = DATABASE();

SET @has_can_edit_requisites = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'supports'
    AND column_name = 'can_edit_requisites'
);

SET @sql = IF(
  @has_can_edit_requisites = 0,
  'ALTER TABLE supports ADD COLUMN can_edit_requisites TINYINT(1) NOT NULL DEFAULT 1 AFTER can_cancel_order',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

UPDATE supports
SET can_edit_requisites = 1
WHERE can_edit_requisites IS NULL;
