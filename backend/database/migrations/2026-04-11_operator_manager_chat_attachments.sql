-- Add optional attachments_path to operator_manager_messages.
SET @db_name = DATABASE();

SET @has_attachments_path = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'operator_manager_messages'
    AND column_name = 'attachments_path'
);

SET @sql = IF(
  @has_attachments_path = 0,
  'ALTER TABLE operator_manager_messages ADD COLUMN attachments_path TEXT NULL AFTER message',
  'SELECT 1'
);

PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

