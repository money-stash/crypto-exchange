const axios = require('axios');
const config = require('../config');

const SUPPORTED_LANGUAGES = new Set(['RU', 'EN']);
const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_TEXT_LENGTH = 4000;
const TRANSLATION_SYSTEM_PROMPT =
  'You are a professional chat translator for a cryptocurrency exchange support chat between an operator and a client. ' +
  'Translate with context of payments, transfers, rates, commissions, orders, and requisites. ' +
  'Correctly interpret Russian slang/short forms in this domain, including: "реки", "рек", "реквы" => "реквизиты" (payment details). ' +
  'Also correctly interpret common Russian internet slang and colloquial phrases, for example: "ору" => "I am laughing hard", "жиза" => "so relatable", "кринж" => "cringe", "имба" => "overpowered/amazing", "изи" => "easy", "щас" => "now". ' +
  'Use polite, respectful form in Russian and English (address the person as "Вы/Вас" and "you", avoid rude or overly casual imperatives). Prefer "подождите" over "подожди". Prefer "здравствуйте" over "привет" when translating neutral "hello". ' +
  'Use these exact glossary mappings when applicable: "Full name" => "ФИО", "Долго ждать?" => "How long to wait?", "пришли?" => "did you receive it?", "Sender s name please" => "Имя отправителя, пожалуйста", "Little time, trying to fing a perfect payment details" => "Немного времени, пытаюсь подобрать реквизиты". ' +
  'Also handle terms like: "СБП", "карта", "кошелек", "хеш", "чек", "заявка", "курс", "комиссия". ' +
  'Do not add explanations, do not change meaning, and preserve tone (including informal speech). ' +
  'Preserve all numbers, currency amounts, percentages, links, usernames, card numbers, wallet addresses, tx hashes, order ids, and emojis exactly. ' +
  'If text is already in target language, return equivalent natural phrasing without extra commentary. ' +
  'Return only strict JSON: {"source_lang":"RU|EN|OTHER","translated_text":"..."}';

class ChatTranslationService {
  constructor() {
    this.apiUrl = 'https://api.openai.com/v1/chat/completions';
    this.maxTextLength = DEFAULT_MAX_TEXT_LENGTH;
  }

  isEnabled() {
    return Boolean(config.openai?.apiKey);
  }

  normalizeLanguage(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return SUPPORTED_LANGUAGES.has(normalized) ? normalized : '';
  }

  parseStructuredResponse(content) {
    if (!content || typeof content !== 'string') return null;

    try {
      return JSON.parse(content);
    } catch (error) {
      const match = content.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch (nestedError) {
        return null;
      }
    }
  }

  async translateText({ text, targetLanguage }) {
    const sourceText = String(text || '').trim();
    const target = this.normalizeLanguage(targetLanguage);

    if (!sourceText) {
      return { success: false, reason: 'empty_text' };
    }

    if (!target) {
      return { success: false, reason: 'invalid_target_language' };
    }

    if (sourceText.length > this.maxTextLength) {
      return { success: false, reason: 'text_too_long' };
    }

    if (!this.isEnabled()) {
      return { success: false, reason: 'openai_not_configured' };
    }

    const timeoutMsRaw = Number(config.openai?.translationTimeoutMs);
    const timeoutMs = Number.isFinite(timeoutMsRaw) && timeoutMsRaw > 0
      ? timeoutMsRaw
      : DEFAULT_TIMEOUT_MS;

    const model = config.openai?.translationModel || 'gpt-5.4-mini';

    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model,
          temperature: 0,
          messages: [
            {
              role: 'system',
              content: TRANSLATION_SYSTEM_PROMPT
            },
            {
              role: 'user',
              content: `Target language: ${target}\nText:\n${sourceText}`
            }
          ]
        },
        {
          headers: {
            Authorization: `Bearer ${config.openai.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: timeoutMs
        }
      );

      const content = response?.data?.choices?.[0]?.message?.content;
      const parsed = this.parseStructuredResponse(content);
      const translatedText = String(parsed?.translated_text || '').trim();
      const sourceLang = String(parsed?.source_lang || '').trim().toUpperCase() || 'OTHER';

      if (!translatedText) {
        return { success: false, reason: 'empty_translation' };
      }

      return {
        success: true,
        sourceLang,
        translatedText
      };
    } catch (error) {
      return {
        success: false,
        reason: 'request_failed',
        error: error.message || 'OpenAI request failed'
      };
    }
  }
}

module.exports = new ChatTranslationService();
