const { getConnection } = require('../config/database');

class AuditLogController {
  parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    const normalized = Math.trunc(parsed);
    if (normalized < min) return fallback;
    if (normalized > max) return max;
    return normalized;
  }

  normalizeDateStart(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 00:00:00`;
    return text;
  }

  normalizeDateEnd(value) {
    if (!value) return null;
    const text = String(value).trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return `${text} 23:59:59`;
    return text;
  }

  parseMeta(metaValue) {
    if (!metaValue) return {};
    if (typeof metaValue === 'object') return metaValue;
    try {
      return JSON.parse(metaValue);
    } catch (error) {
      return {};
    }
  }

  buildFilters(query = {}) {
    const where = ['1=1'];
    const params = [];

    const actor = String(query.actor || '').trim();
    const action = String(query.action || '').trim();
    const search = String(query.search || '').trim();
    const source = String(query.source || '').trim();
    const from = this.normalizeDateStart(query.from);
    const to = this.normalizeDateEnd(query.to);

    if (actor) {
      where.push('actor LIKE ?');
      params.push(`%${actor}%`);
    }

    if (action) {
      where.push('action LIKE ?');
      params.push(`%${action}%`);
    }

    if (search) {
      where.push('(actor LIKE ? OR action LIKE ? OR CAST(meta AS CHAR) LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (source) {
      where.push(`JSON_UNQUOTE(JSON_EXTRACT(meta, '$.source')) = ?`);
      params.push(source);
    }

    if (from) {
      where.push('created_at >= ?');
      params.push(from);
    }

    if (to) {
      where.push('created_at <= ?');
      params.push(to);
    }

    return {
      whereSql: where.join(' AND '),
      params
    };
  }

  mapRow(row) {
    const meta = this.parseMeta(row.meta);
    return {
      id: row.id,
      actor: row.actor,
      action: row.action,
      meta,
      created_at: row.created_at
    };
  }

  escapeCsv(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (!/[",\n\r]/.test(text)) return text;
    return `"${text.replace(/"/g, '""')}"`;
  }

  buildCsv(logs = []) {
    const headers = [
      'created_at',
      'actor',
      'action',
      'source',
      'bot_id',
      'bot_identifier',
      'tg_id',
      'username',
      'chat_id',
      'update_type',
      'message_type',
      'command',
      'callback_data',
      'text',
      'caption',
      'meta_json'
    ];

    const rows = logs.map((log) => {
      const meta = log.meta || {};
      return [
        log.created_at,
        log.actor,
        log.action,
        meta.source || '',
        meta.bot_id || '',
        meta.bot_identifier || '',
        meta.tg_id || '',
        meta.username || '',
        meta.chat_id || '',
        meta.update_type || '',
        meta.message_type || '',
        meta.command || '',
        meta.callback_data || '',
        meta.text || '',
        meta.caption || '',
        JSON.stringify(meta || {})
      ].map((value) => this.escapeCsv(value)).join(',');
    });

    return [headers.join(','), ...rows].join('\n');
  }

  async list(req, res) {
    const db = getConnection();
    const page = this.parsePositiveInt(req.query.page, 1, { min: 1, max: 100000 });
    const limit = this.parsePositiveInt(req.query.limit, 50, { min: 1, max: 200 });
    const offset = (page - 1) * limit;

    const { whereSql, params } = this.buildFilters(req.query);
    const [countRows] = await db.execute(
      `SELECT COUNT(*) AS total
       FROM audit_logs
       WHERE ${whereSql}`,
      params
    );

    const total = Number(countRows?.[0]?.total || 0);
    const [rows] = await db.execute(
      `SELECT id, actor, action, meta, created_at
       FROM audit_logs
       WHERE ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params
    );

    const logs = rows.map((row) => this.mapRow(row));
    res.json({
      logs,
      total,
      page,
      limit,
      pages: Math.ceil(total / limit)
    });
  }

  async download(req, res) {
    const db = getConnection();
    const limit = this.parsePositiveInt(req.query.limit, 5000, { min: 1, max: 50000 });

    const { whereSql, params } = this.buildFilters(req.query);
    const [rows] = await db.execute(
      `SELECT id, actor, action, meta, created_at
       FROM audit_logs
       WHERE ${whereSql}
       ORDER BY created_at DESC, id DESC
       LIMIT ${limit}`,
      params
    );

    const logs = rows.map((row) => this.mapRow(row));
    const csv = this.buildCsv(logs);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename=\"audit_logs_${timestamp}.csv\"`);
    res.status(200).send(`\uFEFF${csv}`);
  }
}

module.exports = new AuditLogController();
