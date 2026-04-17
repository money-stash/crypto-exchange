ALTER TABLE orders
  ADD COLUMN order_log_message_id BIGINT NULL AFTER support_note;