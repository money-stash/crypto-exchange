const Mailing = require('../models/Mailing');
const { Bot } = require('../models/Bot');
const { logUserAction } = require('../utils/logger');
const MailingService = require('../services/MailingService');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { getConnection } = require('../config/database');

class MailingController {
  static buildHttpError(message, statusCode = 400) {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
  }

  static parseBotIdOrNull(value) {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw MailingController.buildHttpError('Invalid bot_id', 400);
    }
    return parsed;
  }

  static async resolveTargetBotId({ userRole, userId, requestedBotId, allowAllForSuperadmin = true }) {
    const role = String(userRole || '').toUpperCase();
    const parsedBotId = MailingController.parseBotIdOrNull(requestedBotId);

    if (role === 'SUPERADMIN') {
      if (parsedBotId === null) {
        return allowAllForSuperadmin ? 0 : null;
      }

      if (parsedBotId === 0) {
        if (!allowAllForSuperadmin) {
          throw MailingController.buildHttpError('bot_id=0 is not allowed for this action', 400);
        }
        return 0;
      }

      const bot = await Bot.findById(parsedBotId);
      if (!bot) {
        throw MailingController.buildHttpError('Bot not found', 404);
      }

      return parsedBotId;
    }

    if (role === 'EX_ADMIN') {
      const ownedBotIds = (await Bot.getBotIdsByOwner(userId)).map((id) => Number(id));
      if (ownedBotIds.length === 0) {
        throw MailingController.buildHttpError('No bot found for this user', 400);
      }

      if (parsedBotId === null) {
        return ownedBotIds[0];
      }

      if (parsedBotId === 0 || !ownedBotIds.includes(parsedBotId)) {
        throw MailingController.buildHttpError('Access denied for selected bot', 403);
      }

      return parsedBotId;
    }

    throw MailingController.buildHttpError('Access denied', 403);
  }

  // get mailings list
  async getMailings(req, res) {
    try {
      const filters = { ...req.query };
      const userRole = req.user.role;
      const userId = req.user.id;

      if (userRole === 'EX_ADMIN') {
        const botIds = await Bot.getBotIdsByOwner(userId);
        if (botIds.length === 0) {
          return res.json({ 
            data: { 
              mailings: [], 
              total: 0, 
              pages: 0, 
              page: 1, 
              limit: parseInt(filters.limit) || 10 
            } 
          });
        }

        const requestedBotId = MailingController.parseBotIdOrNull(filters.bot_id);
        if (requestedBotId !== null) {
          if (!botIds.map(Number).includes(requestedBotId)) {
            return res.status(403).json({ error: 'Access denied for selected bot' });
          }
          filters.bot_id = requestedBotId;
        } else {
          filters.bot_ids = botIds.map(Number);
          delete filters.bot_id;
        }
      } else if (String(userRole || '').toUpperCase() === 'SUPERADMIN') {
        const requestedBotId = MailingController.parseBotIdOrNull(filters.bot_id);
        if (requestedBotId === null) {
          delete filters.bot_id;
        } else {
          filters.bot_id = requestedBotId;
        }
      }

      const result = await Mailing.getAll(filters);
      res.json({ data: result });
    } catch (error) {
      console.error('Error getting mailings:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Failed to get mailings' });
    }
  }

  // get specific mailing
  async getMailing(req, res) {
    try {
      const { id } = req.params;
      const userRole = req.user.role;
      const userId = req.user.id;

      const mailing = await Mailing.findById(parseInt(id));
      if (!mailing) {
        return res.status(404).json({ error: 'Mailing not found' });
      }

      const canAccess = await Mailing.canUserAccess(parseInt(id), userId, userRole);
      if (!canAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      res.json(mailing);
    } catch (error) {
      console.error('Error getting mailing:', error);
      res.status(500).json({ error: 'Failed to get mailing' });
    }
  }

  // attachments
  static async processAttachments(attachments) {
    if (!attachments || !Array.isArray(attachments)) {
      return [];
    }

    const processedAttachments = [];
    const uploadsDir = path.join(__dirname, '../../uploads/mailings');

    try {
      await fs.mkdir(uploadsDir, { recursive: true });
    } catch (error) {
      console.error('Error creating uploads directory:', error);
      throw new Error('Failed to create uploads directory');
    }

    for (const attachment of attachments) {
      try {
        if (!attachment.data || !attachment.name) {
          console.log('Skipping invalid attachment:', attachment);
          continue;
        }

        console.log(`Processing attachment: ${attachment.name}, type: ${attachment.type}`);
        console.log(`Data length: ${attachment.data.length}`);
        console.log(`Data starts with: ${attachment.data.substring(0, 50)}...`);

        const timestamp = Date.now();
        const randomString = crypto.randomBytes(8).toString('hex');
        const { fileType, extension } = this.getFileInfo(attachment.name, attachment.type);
        const filename = `${timestamp}-${randomString}${extension}`;
        const filePath = path.join(uploadsDir, filename);

        let base64Data = attachment.data;
        if (base64Data.includes(',')) {
          const parts = base64Data.split(',');
          if (parts.length === 2 && parts[0].includes('base64')) {
            base64Data = parts[1];
            console.log(`Removed data URL prefix, new length: ${base64Data.length}`);
          }
        }

        let buffer;
        try {
          buffer = Buffer.from(base64Data, 'base64');
          console.log(`Buffer created, size: ${buffer.length} bytes`);
        } catch (decodeError) {
          console.error(`Error decoding base64 for ${attachment.name}:`, decodeError);
          continue;
        }

        await fs.writeFile(filePath, buffer);
        console.log(`File saved to: ${filePath}`);

        try {
          const stats = await fs.stat(filePath);
          console.log(`File size on disk: ${stats.size} bytes`);
        } catch (statError) {
          console.error(`Error checking file stats for ${filename}:`, statError);
        }

        const relativePath = `mailings/${filename}`;
        
        processedAttachments.push({
          name: attachment.name,
          type: fileType, 
          mimeType: attachment.type,
          path: relativePath,
          size: buffer.length
        });

        console.log(`Saved attachment: ${attachment.name} as ${filename} (type: ${fileType})`);
      } catch (error) {
        console.error(`Error processing attachment ${attachment.name}:`, error);
      }
    }

    return processedAttachments;
  }  
  // derive file info
  static getFileInfo(filename, mimeType) {

    const extFromName = path.extname(filename).toLowerCase();
    

    let fileType = 'document'; 
    let extension = extFromName;
    
    console.log(`getFileInfo: filename=${filename}, extFromName=${extFromName}, mimeType=${mimeType}`);
    

    if (['.mp4', '.avi', '.mov', '.mkv', '.webm'].includes(extFromName) || 
        mimeType?.startsWith('video/')) {
      fileType = 'video';
      if (!extension) extension = '.mp4'; 
    }

    else if ((extFromName === '.gif' && mimeType !== 'video/mp4') || 
             mimeType === 'image/gif' || 
             mimeType === 'gif') {
      fileType = 'animation';
      extension = '.gif';
    }

    else if (['.jpg', '.jpeg', '.png', '.webp', '.bmp'].includes(extFromName) || 
        (mimeType?.startsWith('image/') && mimeType !== 'image/gif')) {
      fileType = 'image';
      if (!extension) extension = '.jpg'; 
    }

    else if (['.mp3', '.wav', '.ogg', '.m4a'].includes(extFromName) || 
             mimeType?.startsWith('audio/')) {
      fileType = 'audio';
      if (!extension) extension = '.mp3'; 
    }
    
    if (!extension) {
      const mimeToExt = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'audio/mp3': '.mp3',
        'application/pdf': '.pdf',
        'text/plain': '.txt'
      };
      extension = mimeToExt[mimeType] || '.bin';
    }
    
    console.log(`getFileInfo result: fileType=${fileType}, extension=${extension}`);
    return { fileType, extension };
  }

  // parse raffle recipients
  static parseRaffleRecipients(recipientsText = '') {
    const lines = String(recipientsText || '').split(/\r?\n/);
    const recipients = [];
    const skipped = [];
    let raffleNumber = 1;

    for (let index = 0; index < lines.length; index += 1) {
      const rawLine = String(lines[index] || '').trim();
      if (!rawLine) continue;

      let explicitRaffleNumber = null;
      let token = rawLine;
      const explicitNumberMatch = rawLine.match(/^(\d{1,9})\s*[\)\].\-:]*\s+(.+)$/);
      if (explicitNumberMatch) {
        explicitRaffleNumber = Number(explicitNumberMatch[1]);
        token = String(explicitNumberMatch[2] || '').trim();
      }

      const tMeMatch = token.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{3,64})/i);
      if (tMeMatch && tMeMatch[1]) {
        token = `@${tMeMatch[1]}`;
      }

      token = token.split(/\s+/)[0].trim().replace(/^[,;]+|[,;]+$/g, '');
      if (!token) {
        skipped.push({
          line: index + 1,
          raw: rawLine,
          reason: 'Empty identifier'
        });
        continue;
      }

      if (/^@[A-Za-z0-9_]{3,64}$/.test(token)) {
        const finalRaffleNumber = Number.isInteger(explicitRaffleNumber) && explicitRaffleNumber > 0
          ? explicitRaffleNumber
          : raffleNumber;
        recipients.push({
          line: index + 1,
          raw: rawLine,
          type: 'username',
          value: token.slice(1).toLowerCase(),
          display: token,
          raffleNumber: finalRaffleNumber
        });
        if (finalRaffleNumber >= raffleNumber) {
          raffleNumber = finalRaffleNumber + 1;
        } else {
          raffleNumber += 1;
        }
        continue;
      }

      if (/^\d{5,20}$/.test(token)) {
        const finalRaffleNumber = Number.isInteger(explicitRaffleNumber) && explicitRaffleNumber > 0
          ? explicitRaffleNumber
          : raffleNumber;
        recipients.push({
          line: index + 1,
          raw: rawLine,
          type: 'tg_id',
          value: token,
          display: token,
          raffleNumber: finalRaffleNumber
        });
        if (finalRaffleNumber >= raffleNumber) {
          raffleNumber = finalRaffleNumber + 1;
        } else {
          raffleNumber += 1;
        }
        continue;
      }

      skipped.push({
        line: index + 1,
        raw: rawLine,
        reason: 'Invalid format. Use @username or tg_id'
      });
    }

    return {
      totalLines: lines.length,
      recipients,
      skipped
    };
  }

  static async resolveRaffleRecipient(recipient, botId = 0) {
    const db = getConnection();
    const isSpecificBot = Number(botId) > 0;
    let query = '';
    let params = [];

    if (recipient.type === 'tg_id') {
      if (isSpecificBot) {
        query = `
          SELECT
            u.id AS user_id,
            u.tg_id,
            u.username,
            ub.bot_id,
            ub.username AS user_bot_username
          FROM users u
          INNER JOIN user_bots ub ON ub.user_id = u.id
          WHERE u.is_blocked = 0
            AND u.tg_id = ?
            AND ub.bot_id = ?
          ORDER BY ub.updated_at DESC, ub.id DESC
          LIMIT 1
        `;
        params = [recipient.value, Number(botId)];
      } else {
        query = `
          SELECT
            u.id AS user_id,
            u.tg_id,
            u.username,
            ub.bot_id,
            ub.username AS user_bot_username
          FROM users u
          LEFT JOIN user_bots ub ON ub.user_id = u.id
          WHERE u.is_blocked = 0
            AND u.tg_id = ?
          ORDER BY (ub.bot_id IS NULL), ub.updated_at DESC, ub.id DESC
          LIMIT 1
        `;
        params = [recipient.value];
      }
    } else {
      if (isSpecificBot) {
        query = `
          SELECT
            u.id AS user_id,
            u.tg_id,
            u.username,
            ub.bot_id,
            ub.username AS user_bot_username
          FROM users u
          INNER JOIN user_bots ub ON ub.user_id = u.id
          WHERE u.is_blocked = 0
            AND ub.bot_id = ?
            AND (
              LOWER(u.username) = ?
              OR LOWER(ub.username) = ?
            )
          ORDER BY ub.updated_at DESC, ub.id DESC
          LIMIT 1
        `;
        params = [Number(botId), recipient.value, recipient.value];
      } else {
        query = `
          SELECT
            u.id AS user_id,
            u.tg_id,
            u.username,
            ub.bot_id,
            ub.username AS user_bot_username
          FROM users u
          LEFT JOIN user_bots ub ON ub.user_id = u.id
          WHERE u.is_blocked = 0
            AND (
              LOWER(u.username) = ?
              OR LOWER(ub.username) = ?
            )
          ORDER BY (ub.bot_id IS NULL), ub.updated_at DESC, ub.id DESC
          LIMIT 1
        `;
        params = [recipient.value, recipient.value];
      }
    }

    const [rows] = await db.execute(query, params);
    const row = rows && rows[0];
    if (!row || !row.tg_id) return null;

    return {
      userId: Number(row.user_id),
      tgId: String(row.tg_id),
      botId: Number(row.bot_id || botId || 0),
      username: row.username || row.user_bot_username || null
    };
  }

  async createRaffleMailing(req, res) {
    try {
      const { raffle_name, recipients_text, bot_id: requestedBotId } = req.body;
      const userRole = req.user.role;
      const userId = req.user.id;
      const raffleName = String(raffle_name || 'Машрум').trim() || 'Машрум';

      const botId = await MailingController.resolveTargetBotId({
        userRole,
        userId,
        requestedBotId,
        allowAllForSuperadmin: true
      });

      const parsed = MailingController.parseRaffleRecipients(recipients_text);
      if (!parsed.recipients.length) {
        return res.status(400).json({
          error: 'Recipients list is empty or invalid',
          data: {
            total_lines: parsed.totalLines,
            invalid_lines: parsed.skipped
          }
        });
      }

      const results = [];
      let sentCount = 0;
      let failedCount = 0;

      for (const skipped of parsed.skipped) {
        results.push({
          line: skipped.line,
          input: skipped.raw,
          status: 'failed',
          reason: skipped.reason
        });
        failedCount += 1;
      }

      for (const recipient of parsed.recipients) {
        try {
          const resolved = await MailingController.resolveRaffleRecipient(recipient, botId);
          if (!resolved) {
            results.push({
              line: recipient.line,
              input: recipient.raw,
              status: 'failed',
              reason: 'User not found'
            });
            failedCount += 1;
            continue;
          }

          const targetBotId = Number(resolved.botId || botId || 0);
          const botManager = await MailingService.getBotManager(targetBotId);
          if (!botManager) {
            results.push({
              line: recipient.line,
              input: recipient.raw,
              status: 'failed',
              reason: 'Bot is unavailable'
            });
            failedCount += 1;
            continue;
          }

          const message = `Ваш номер в розыгрыше ${raffleName}: ${recipient.raffleNumber}`;
          const sent = await MailingService.sendMessageToUser(botManager, resolved.tgId, message, null);

          if (sent) {
            results.push({
              line: recipient.line,
              input: recipient.raw,
              status: 'sent',
              raffle_number: recipient.raffleNumber,
              tg_id: resolved.tgId,
              username: resolved.username ? `@${resolved.username}` : null
            });
            sentCount += 1;
          } else {
            results.push({
              line: recipient.line,
              input: recipient.raw,
              status: 'failed',
              reason: 'Telegram rejected the message'
            });
            failedCount += 1;
          }
        } catch (recipientError) {
          console.error('Raffle recipient send error:', recipientError);
          results.push({
            line: recipient.line,
            input: recipient.raw,
            status: 'failed',
            reason: 'Send error'
          });
          failedCount += 1;
        }
      }

      await logUserAction(userId, 'raffle_mailing_sent', {
        raffle_name: raffleName,
        bot_id: botId,
        total_lines: parsed.totalLines,
        valid_targets: parsed.recipients.length,
        sent_count: sentCount,
        failed_count: failedCount
      });

      return res.json({
        message: 'Raffle mailing processed',
        data: {
          raffle_name: raffleName,
          bot_id: botId,
          total_lines: parsed.totalLines,
          valid_targets: parsed.recipients.length,
          sent_count: sentCount,
          failed_count: failedCount,
          results
        }
      });
    } catch (error) {
      console.error('Error creating raffle mailing:', error);
      return res.status(error.statusCode || 500).json({ error: error.message || 'Failed to send raffle mailing' });
    }
  }
  async createMailing(req, res) {
    try {
      const { text, attachments, bot_id: requestedBotId } = req.body;
      const userRole = req.user.role;
      const userId = req.user.id;

      if (!text || text.trim().length === 0) {
        return res.status(400).json({ error: 'Text is required' });
      }

      const bot_id = await MailingController.resolveTargetBotId({
        userRole,
        userId,
        requestedBotId,
        allowAllForSuperadmin: true
      });

      const total_count = bot_id === 0
        ? await MailingController.getTotalUserCount()
        : await MailingController.getBotUserCount(bot_id);

      let processedAttachments = null;
      if (attachments && Array.isArray(attachments) && attachments.length > 0) {
        try {
          processedAttachments = await MailingController.processAttachments(attachments);
          console.log(`Processed ${processedAttachments.length} attachments for mailing`);
        } catch (error) {
          console.error('Error processing attachments:', error);
          return res.status(400).json({ error: 'Ошибка обработки вложений' });
        }
      }

      const mailing = await Mailing.create({
        bot_id,
        text,
        total_count,
        attachments: processedAttachments
      });

      await logUserAction(userId, 'mailing_created', { 
        mailing_id: mailing.id,
        bot_id: bot_id,
        total_count: total_count
      });


      try {
        await MailingService.startMailing(mailing.id);
        console.log(`Mailing ${mailing.id} started successfully`);
      } catch (mailingError) {
        console.error(`Error starting mailing ${mailing.id}:`, mailingError);

      }

      res.status(201).json(mailing);
    } catch (error) {
      console.error('Error creating mailing:', error);
      res.status(error.statusCode || 500).json({ error: error.message || 'Failed to create mailing' });
    }
  }

  // cancel mailing
  async cancelMailing(req, res) {
    try {
      const { id } = req.params;
      const userRole = req.user.role;
      const userId = req.user.id;

      const mailing = await Mailing.findById(parseInt(id));
      if (!mailing) {
        return res.status(404).json({ error: 'Mailing not found' });
      }

      if (mailing.status !== 'active') {
        return res.status(400).json({ error: 'Only active mailings can be cancelled' });
      }

      const canAccess = await Mailing.canUserAccess(parseInt(id), userId, userRole);
      if (!canAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const cancelledMailing = await Mailing.cancel(parseInt(id));

      await logUserAction(userId, 'mailing_cancelled', { 
        mailing_id: parseInt(id),
        sent_count: mailing.send_count,
        total_count: mailing.total_count
      });

      res.json(cancelledMailing);
    } catch (error) {
      console.error('Error cancelling mailing:', error);
      res.status(500).json({ error: 'Failed to cancel mailing' });
    }
  }

  // update sent messages counter
  async updateSendCount(req, res) {
    try {
      const { id } = req.params;
      const { increment } = req.body;

      const mailing = await Mailing.findById(parseInt(id));
      if (!mailing) {
        return res.status(404).json({ error: 'Mailing not found' });
      }

      const updatedMailing = await Mailing.updateSendCount(parseInt(id), increment || 1);
      res.json(updatedMailing);
    } catch (error) {
      console.error('Error updating send count:', error);
      res.status(500).json({ error: 'Failed to update send count' });
    }
  }

  // get mailing statistics
  async getStatistics(req, res) {
    try {
      const userRole = req.user.role;


      if (!['SUPERADMIN', 'EX_ADMIN'].includes(userRole)) {
        return res.status(403).json({ error: 'Access denied' });
      }

      const stats = await Mailing.getStatistics();
      res.json(stats);
    } catch (error) {
      console.error('Error getting mailing statistics:', error);
      res.status(500).json({ error: 'Failed to get mailing statistics' });
    }
  }

  // get active mailings
  async getActiveMailings(req, res) {
    try {
      const activeMailings = await Mailing.getActive();
      res.json(activeMailings);
    } catch (error) {
      console.error('Error getting active mailings:', error);
      res.status(500).json({ error: 'Failed to get active mailings' });
    }
  }

  // delete mailing
  async deleteMailing(req, res) {
    try {
      const { id } = req.params;
      const userRole = req.user.role;
      const userId = req.user.id;

      const mailing = await Mailing.findById(parseInt(id));
      if (!mailing) {
        return res.status(404).json({ error: 'Mailing not found' });
      }

      const canAccess = await Mailing.canUserAccess(parseInt(id), userId, userRole);
      if (!canAccess) {
        return res.status(403).json({ error: 'Access denied' });
      }

      if (mailing.status === 'active') {
        return res.status(400).json({ error: 'Cannot delete active mailing. Cancel it first.' });
      }

      const deleted = await Mailing.delete(parseInt(id));
      if (!deleted) {
        return res.status(500).json({ error: 'Failed to delete mailing' });
      }

      await logUserAction(userId, 'mailing_deleted', { 
        mailing_id: parseInt(id),
        status: mailing.status
      });

      res.json({ message: 'Mailing deleted successfully' });
    } catch (error) {
      console.error('Error deleting mailing:', error);
      res.status(500).json({ error: 'Failed to delete mailing' });
    }
  }

  // get total users count
  static async getTotalUserCount() {
    const { getConnection } = require('../config/database');
    const db = getConnection();
    
    try {

      const [rows] = await db.execute(`
        SELECT COUNT(*) as count 
        FROM user_bots ub 
        JOIN users u ON ub.user_id = u.id 
        WHERE u.is_blocked = 0 AND u.tg_id IS NOT NULL
      `);
      return rows[0].count;
    } catch (error) {
      console.error('Error getting total user count:', error);
      return 0;
    }
  }

  // get user count for specific bot
  static async getBotUserCount(botId) {
    const { getConnection } = require('../config/database');
    const db = getConnection();
    
    try {
      const [rows] = await db.execute(
        'SELECT COUNT(*) as count FROM user_bots ub JOIN users u ON ub.user_id = u.id WHERE ub.bot_id = ? AND u.is_blocked = 0',
        [botId]
      );
      return rows[0].count;
    } catch (error) {
      console.error('Error getting bot user count:', error);
      return 0;
    }
  }
}

module.exports = new MailingController();

