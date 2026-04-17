-- Operator <-> manager chat and assignment
-- Compatible with MySQL versions without "IF NOT EXISTS" for some ALTER operations.
SET @db_name = DATABASE();

-- supports.manager_id
SET @has_manager_id = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = @db_name
    AND table_name = 'supports'
    AND column_name = 'manager_id'
);
SET @sql = IF(
  @has_manager_id = 0,
  'ALTER TABLE supports ADD COLUMN manager_id BIGINT NULL AFTER role',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- supports.manager_id index
SET @has_manager_idx = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = @db_name
    AND table_name = 'supports'
    AND index_name = 'idx_supports_manager_id'
);
SET @sql = IF(
  @has_manager_idx = 0,
  'ALTER TABLE supports ADD INDEX idx_supports_manager_id (manager_id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- supports.manager_id FK
SET @has_manager_fk = (
  SELECT COUNT(*)
  FROM information_schema.table_constraints
  WHERE constraint_schema = @db_name
    AND table_name = 'supports'
    AND constraint_name = 'fk_supports_manager_id'
    AND constraint_type = 'FOREIGN KEY'
);
SET @sql = IF(
  @has_manager_fk = 0,
  'ALTER TABLE supports ADD CONSTRAINT fk_supports_manager_id FOREIGN KEY (manager_id) REFERENCES supports(id) ON DELETE SET NULL ON UPDATE CASCADE',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS operator_manager_messages (
  id BIGINT NOT NULL AUTO_INCREMENT,
  operator_id BIGINT NOT NULL,
  manager_id BIGINT NOT NULL,
  sender_type ENUM('OPERATOR', 'MANAGER', 'SUPERADMIN') NOT NULL,
  sender_id BIGINT NOT NULL,
  message TEXT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  is_read_by_operator TINYINT(1) NOT NULL DEFAULT 0,
  is_read_by_manager TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  KEY idx_omm_operator_manager_created (operator_id, manager_id, created_at, id),
  KEY idx_omm_manager_unread (manager_id, is_read_by_manager, created_at),
  KEY idx_omm_operator_unread (operator_id, is_read_by_operator, created_at),
  CONSTRAINT fk_omm_operator FOREIGN KEY (operator_id) REFERENCES supports(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_omm_manager FOREIGN KEY (manager_id) REFERENCES supports(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_omm_sender FOREIGN KEY (sender_id) REFERENCES supports(id) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
