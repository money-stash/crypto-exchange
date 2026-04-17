const CHAT_QUICK_REPLIES_KEY = 'operator_chat_quick_replies';

const CHAT_QUICK_REPLY_MAX_ITEMS = 20;
const CHAT_QUICK_REPLY_MAX_LENGTH = 160;

const DEFAULT_CHAT_QUICK_REPLIES = [
  'Ожидаю перевод',
  'Уточните банк.',
  'Проверьте, пожалуйста, отправку',
  'Пришлите, пожалуйста, подтверждение перевода',
  'Пожалуйста, подождите 1-2 минуты',
  'Платежные данные отправлены, проверьте'
];

function normalizeQuickReplyItem(value) {
  return String(value == null ? '' : value).trim().slice(0, CHAT_QUICK_REPLY_MAX_LENGTH);
}

function parseRawQuickReplies(value) {
  if (Array.isArray(value)) return value;

  const raw = String(value == null ? '' : value).trim();
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
  } catch (error) {
    // fallback below
  }

  return raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function normalizeChatQuickReplies(value) {
  const parsed = parseRawQuickReplies(value);
  const seen = new Set();
  const result = [];

  parsed.forEach((item) => {
    const normalized = normalizeQuickReplyItem(item);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    result.push(normalized);
  });

  if (result.length > 0) {
    return result.slice(0, CHAT_QUICK_REPLY_MAX_ITEMS);
  }

  return [...DEFAULT_CHAT_QUICK_REPLIES];
}

function serializeChatQuickReplies(value) {
  return JSON.stringify(normalizeChatQuickReplies(value));
}

module.exports = {
  CHAT_QUICK_REPLIES_KEY,
  CHAT_QUICK_REPLY_MAX_ITEMS,
  CHAT_QUICK_REPLY_MAX_LENGTH,
  DEFAULT_CHAT_QUICK_REPLIES,
  normalizeChatQuickReplies,
  serializeChatQuickReplies
};

