-- Add captcha gate fields for first launch per bot-user relation.

-- captcha_passed
SET @has_user_bots_captcha_passed = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'user_bots'
    AND column_name = 'captcha_passed'
);
SET @sql = IF(
  @has_user_bots_captcha_passed = 0,
  'ALTER TABLE user_bots ADD COLUMN captcha_passed TINYINT(1) NOT NULL DEFAULT 1 AFTER referral_bonus_balance',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- captcha_passed_at
SET @has_user_bots_captcha_passed_at = (
  SELECT COUNT(*)
  FROM information_schema.columns
  WHERE table_schema = DATABASE()
    AND table_name = 'user_bots'
    AND column_name = 'captcha_passed_at'
);
SET @sql = IF(
  @has_user_bots_captcha_passed_at = 0,
  'ALTER TABLE user_bots ADD COLUMN captcha_passed_at DATETIME NULL AFTER captcha_passed',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Optional index for filtering/debugging by captcha status.
SET @has_user_bots_captcha_passed_idx = (
  SELECT COUNT(*)
  FROM information_schema.statistics
  WHERE table_schema = DATABASE()
    AND table_name = 'user_bots'
    AND index_name = 'idx_user_bots_captcha_passed'
);
SET @sql = IF(
  @has_user_bots_captcha_passed_idx = 0,
  'ALTER TABLE user_bots ADD INDEX idx_user_bots_captcha_passed (captcha_passed)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
