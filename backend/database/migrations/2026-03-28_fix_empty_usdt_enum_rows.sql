-- Fix legacy enum fallback rows where unsupported values were stored as empty string.
-- Safe to run multiple times.

-- rates has UNIQUE(coin), so if USDT already exists we should drop empty fallback rows first.
DELETE r_empty
FROM rates r_empty
JOIN rates r_usdt ON r_usdt.coin = 'USDT'
WHERE r_empty.coin = '';

UPDATE rates
SET coin = 'USDT'
WHERE coin = '';

-- fees has UNIQUE(bot_id, coin), so avoid collisions for bots that already have USDT row.
DELETE f_empty
FROM fees f_empty
JOIN fees f_usdt
  ON f_usdt.coin = 'USDT'
 AND (
      f_usdt.bot_id = f_empty.bot_id
      OR (f_usdt.bot_id IS NULL AND f_empty.bot_id IS NULL)
 )
WHERE f_empty.coin = '';

UPDATE fees
SET coin = 'USDT'
WHERE coin = '';

UPDATE rate_fee_tiers
SET coin = 'USDT'
WHERE coin = '';

UPDATE orders
SET coin = 'USDT'
WHERE coin = '';

UPDATE requisites
SET kind = 'USDT'
WHERE kind = '';

UPDATE bot_requisites
SET type = 'USDT'
WHERE type = '';

UPDATE bot_fee_tiers
SET coin = 'USDT'
WHERE coin = '';
