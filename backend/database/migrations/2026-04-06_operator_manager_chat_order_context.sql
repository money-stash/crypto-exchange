-- Add optional order link metadata to operator_manager_messages.

-- order_id
SET @has_omm_order_id = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'operator_manager_messages'
    AND column_name = 'order_id'
);
SET @sql = IF(
  @has_omm_order_id = 0,
  'ALTER TABLE operator_manager_messages ADD COLUMN order_id BIGINT NULL AFTER sender_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- order_unique_id
SET @has_omm_order_unique_id = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'operator_manager_messages'
    AND column_name = 'order_unique_id'
);
SET @sql = IF(
  @has_omm_order_unique_id = 0,
  'ALTER TABLE operator_manager_messages ADD COLUMN order_unique_id INT NULL AFTER order_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- order_sum_rub
SET @has_omm_order_sum_rub = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'operator_manager_messages'
    AND column_name = 'order_sum_rub'
);
SET @sql = IF(
  @has_omm_order_sum_rub = 0,
  'ALTER TABLE operator_manager_messages ADD COLUMN order_sum_rub DECIMAL(20,2) NULL AFTER order_unique_id',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- index for order_id
SET @has_omm_order_idx = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'operator_manager_messages'
    AND index_name = 'idx_omm_order_id'
);
SET @sql = IF(
  @has_omm_order_idx = 0,
  'ALTER TABLE operator_manager_messages ADD INDEX idx_omm_order_id (order_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- FK operator_manager_messages.order_id -> orders.id
SET @has_omm_order_fk = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE table_schema = DATABASE()
    AND table_name = 'operator_manager_messages'
    AND constraint_type = 'FOREIGN KEY'
    AND constraint_name = 'fk_omm_order'
);
SET @sql = IF(
  @has_omm_order_fk = 0,
  'ALTER TABLE operator_manager_messages ADD CONSTRAINT fk_omm_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
