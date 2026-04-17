const SystemSetting = require('../models/SystemSetting');
const {
  OPERATOR_TAKE_START_MESSAGE_1_KEY,
  OPERATOR_TAKE_START_MESSAGE_2_KEY,
  OPERATOR_TAKE_MESSAGE_KEYS,
  buildOperatorTakeSettings
} = require('../constants/operatorAutoMessages');
const {
  CHAT_QUICK_REPLIES_KEY,
  normalizeChatQuickReplies,
  serializeChatQuickReplies
} = require('../constants/chatQuickReplies');

class SettingsController {
  async getFinanceSettings(req, res) {
    try {
      const [companyWallet, operatorTakeRawValues] = await Promise.all([
        SystemSetting.getValue('company_usdt_wallet_trc20', ''),
        SystemSetting.getValues(OPERATOR_TAKE_MESSAGE_KEYS)
      ]);
      const operatorTakeSettings = buildOperatorTakeSettings(operatorTakeRawValues);

      res.json({
        company_usdt_wallet_trc20: companyWallet || '',
        ...operatorTakeSettings
      });
    } catch (error) {
      console.error('Get finance settings error:', error);
      res.status(500).json({ error: 'Failed to load finance settings' });
    }
  }

  async updateFinanceSettings(req, res) {
    try {
      const wallet = String(req.body.company_usdt_wallet_trc20 || '').trim();
      const providedRawValues = {
        [OPERATOR_TAKE_START_MESSAGE_1_KEY]: req.body?.operator_take_start_message_1,
        [OPERATOR_TAKE_START_MESSAGE_2_KEY]: req.body?.operator_take_start_message_2
      };

      const currentRawValues = await SystemSetting.getValues(OPERATOR_TAKE_MESSAGE_KEYS);
      const mergedRawValues = {
        [OPERATOR_TAKE_START_MESSAGE_1_KEY]:
          providedRawValues[OPERATOR_TAKE_START_MESSAGE_1_KEY] === undefined
            ? currentRawValues[OPERATOR_TAKE_START_MESSAGE_1_KEY]
            : providedRawValues[OPERATOR_TAKE_START_MESSAGE_1_KEY],
        [OPERATOR_TAKE_START_MESSAGE_2_KEY]:
          providedRawValues[OPERATOR_TAKE_START_MESSAGE_2_KEY] === undefined
            ? currentRawValues[OPERATOR_TAKE_START_MESSAGE_2_KEY]
            : providedRawValues[OPERATOR_TAKE_START_MESSAGE_2_KEY]
      };

      const operatorTakeSettings = buildOperatorTakeSettings(mergedRawValues);

      await Promise.all([
        SystemSetting.setValue('company_usdt_wallet_trc20', wallet),
        SystemSetting.setValue(
          OPERATOR_TAKE_START_MESSAGE_1_KEY,
          operatorTakeSettings.operator_take_start_message_1
        ),
        SystemSetting.setValue(
          OPERATOR_TAKE_START_MESSAGE_2_KEY,
          operatorTakeSettings.operator_take_start_message_2
        )
      ]);

      res.json({
        message: 'Finance settings updated',
        company_usdt_wallet_trc20: wallet,
        ...operatorTakeSettings
      });
    } catch (error) {
      console.error('Update finance settings error:', error);
      res.status(500).json({ error: 'Failed to update finance settings' });
    }
  }

  async getChatQuickReplies(req, res) {
    try {
      const rawValue = await SystemSetting.getValue(CHAT_QUICK_REPLIES_KEY, '');
      const quickReplies = normalizeChatQuickReplies(rawValue);

      res.json({
        operator_chat_quick_replies: quickReplies
      });
    } catch (error) {
      console.error('Get chat quick replies error:', error);
      res.status(500).json({ error: 'Failed to load chat quick replies' });
    }
  }

  async updateChatQuickReplies(req, res) {
    try {
      const normalizedQuickReplies = normalizeChatQuickReplies(req.body?.operator_chat_quick_replies || []);

      await SystemSetting.setValue(
        CHAT_QUICK_REPLIES_KEY,
        serializeChatQuickReplies(normalizedQuickReplies)
      );

      res.json({
        message: 'Chat quick replies updated',
        operator_chat_quick_replies: normalizedQuickReplies
      });
    } catch (error) {
      console.error('Update chat quick replies error:', error);
      res.status(500).json({ error: 'Failed to update chat quick replies' });
    }
  }
}

module.exports = new SettingsController();

