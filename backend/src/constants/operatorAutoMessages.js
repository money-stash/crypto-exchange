const OPERATOR_TAKE_START_MESSAGE_1_KEY = 'operator_take_start_message_1';
const OPERATOR_TAKE_START_MESSAGE_2_KEY = 'operator_take_start_message_2';

const DEFAULT_OPERATOR_TAKE_START_MESSAGE_1 =
  '\u0417\u0434\u0440\u0430\u0432\u0441\u0442\u0432\u0443\u0439\u0442\u0435! \u042f \u0432\u0430\u0448 \u043e\u043f\u0435\u0440\u0430\u0442\u043e\u0440, \u043f\u043e\u043c\u043e\u0433\u0443 \u0431\u044b\u0441\u0442\u0440\u043e \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044c \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u044e.';
const DEFAULT_OPERATOR_TAKE_START_MESSAGE_2 = '\u0423\u0442\u043e\u0447\u043d\u0438\u0442\u0435 \u0431\u0430\u043d\u043a, \u043f\u043e\u0436\u0430\u043b\u0443\u0439\u0441\u0442\u0430.';

const OPERATOR_TAKE_MESSAGE_DELAY_MS = 1000;
const OPERATOR_TAKE_MESSAGE_MAX_LENGTH = 1000;

const OPERATOR_TAKE_MESSAGE_KEYS = [
  OPERATOR_TAKE_START_MESSAGE_1_KEY,
  OPERATOR_TAKE_START_MESSAGE_2_KEY
];

function normalizeOperatorTakeMessage(value, fallback) {
  const normalizedFallback = String(fallback == null ? '' : fallback).trim();
  const normalizedValue = String(value == null ? '' : value).trim();
  if (!normalizedValue) return normalizedFallback.slice(0, OPERATOR_TAKE_MESSAGE_MAX_LENGTH);
  return normalizedValue.slice(0, OPERATOR_TAKE_MESSAGE_MAX_LENGTH);
}

function sanitizeOperatorTakeMessageForOperator(text) {
  const normalized = String(text == null ? '' : text)
    .trim()
    .replace(/\s+\u043d\u0430\s+(?:\u043f\u043b\u0430\u0442\u0444\u043e\u0440\u043c\u0435|\u0441\u0435\u0440\u0432\u0438\u0441\u0435)\.?/gi, '.')
    .replace(/\s+(?:to|at)\s+(?:platform|service)\.?/gi, '.')
    .replace(/\b(?:platform|service)\b/gi, '')
    .replace(/\s+\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return normalized.slice(0, OPERATOR_TAKE_MESSAGE_MAX_LENGTH);
}

function buildOperatorTakeSettings(rawValues = {}) {
  return {
    operator_take_start_message_1: normalizeOperatorTakeMessage(
      rawValues?.[OPERATOR_TAKE_START_MESSAGE_1_KEY],
      DEFAULT_OPERATOR_TAKE_START_MESSAGE_1
    ),
    operator_take_start_message_2: normalizeOperatorTakeMessage(
      rawValues?.[OPERATOR_TAKE_START_MESSAGE_2_KEY],
      DEFAULT_OPERATOR_TAKE_START_MESSAGE_2
    )
  };
}

function buildOperatorTakeMessageSequence(rawValues = {}) {
  const settings = buildOperatorTakeSettings(rawValues);
  return [settings.operator_take_start_message_1, settings.operator_take_start_message_2]
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

module.exports = {
  OPERATOR_TAKE_START_MESSAGE_1_KEY,
  OPERATOR_TAKE_START_MESSAGE_2_KEY,
  DEFAULT_OPERATOR_TAKE_START_MESSAGE_1,
  DEFAULT_OPERATOR_TAKE_START_MESSAGE_2,
  OPERATOR_TAKE_MESSAGE_DELAY_MS,
  OPERATOR_TAKE_MESSAGE_MAX_LENGTH,
  OPERATOR_TAKE_MESSAGE_KEYS,
  normalizeOperatorTakeMessage,
  sanitizeOperatorTakeMessageForOperator,
  buildOperatorTakeSettings,
  buildOperatorTakeMessageSequence
};
