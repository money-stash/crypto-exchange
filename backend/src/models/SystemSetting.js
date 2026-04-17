const { getConnection } = require('../config/database');

class SystemSetting {
  static async getValue(key, defaultValue = null) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT `value` FROM system_settings WHERE `key` = ? LIMIT 1',
      [key]
    );
    if (!rows.length) return defaultValue;
    return rows[0].value;
  }

  static async setValue(key, value) {
    const db = getConnection();
    await db.execute(
      `INSERT INTO system_settings (\`key\`, \`value\`, updated_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE \`value\` = VALUES(\`value\`), updated_at = NOW()`,
      [key, value]
    );
    return true;
  }

  static async getValues(keys = []) {
    if (!Array.isArray(keys) || !keys.length) return {};
    const db = getConnection();
    const placeholders = keys.map(() => '?').join(',');
    const [rows] = await db.execute(
      `SELECT \`key\`, \`value\` FROM system_settings WHERE \`key\` IN (${placeholders})`,
      keys
    );
    const result = {};
    rows.forEach((row) => {
      result[row.key] = row.value;
    });
    return result;
  }
}

module.exports = SystemSetting;
