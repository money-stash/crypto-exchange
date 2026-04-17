ALTER TABLE rates
  MODIFY COLUMN coin ENUM('BTC','LTC','XMR','USDT')
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE fees
  MODIFY COLUMN coin ENUM('BTC','LTC','XMR','USDT')
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE orders
  MODIFY COLUMN coin ENUM('BTC','LTC','XMR','USDT')
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE rate_fee_tiers
  MODIFY COLUMN coin ENUM('BTC','LTC','XMR','USDT')
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE requisites
  MODIFY COLUMN kind ENUM('CARD','BTC','LTC','XMR','USDT')
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

ALTER TABLE bot_requisites
  MODIFY COLUMN type ENUM('CARD','SBP','CRYPTO','BTC','XMR','LTC','USDT')
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;

INSERT INTO rates (coin, rate_rub, src, is_manual, manual_rate_rub)
VALUES ('USDT', 100.00000000, 'default', 0, NULL)
ON DUPLICATE KEY UPDATE coin = VALUES(coin);

INSERT INTO fees (coin, bot_id, buy_fee, sell_fee)
SELECT 'USDT', b.id, 0.0200, -0.0200
FROM bots b
LEFT JOIN fees f ON f.bot_id = b.id AND f.coin = 'USDT'
WHERE f.id IS NULL;
