const { getConnection } = require('../config/database');

class Requisite {
  constructor(data) {
    Object.assign(this, data);
  }

  // поиск реквизита по id
  static async findById(id) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM requisites WHERE id = ?',
      [id]
    );
    return rows.length ? new Requisite(rows[0]) : null;
  }

  // получение реквизитов пользователя по типу и виду транзакции
  static async getUserRequisitesByType(userId, kind, transaction_type, limit = 5) {
    const db = getConnection();

    const [rows] = await db.execute(
      `SELECT * FROM requisites WHERE user_id = ? AND kind = ? AND transaction_type = ? AND is_display = 1 ORDER BY created_at DESC LIMIT ${parseInt(limit)}`,
      [parseInt(userId), kind, transaction_type]
    );
    return rows.map(row => new Requisite(row));
  }

  // получение всех реквизитов пользователя
  static async getUserRequisites(userId) {

    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM requisites WHERE user_id = ? AND is_display = 1 ORDER BY kind, created_at DESC',
      [userId]
    );
    return rows.map(row => new Requisite(row));
  }

  // создание нового реквизита
  static async create(data) {
    const db = getConnection();
    const [result] = await db.execute(
      'INSERT INTO requisites (user_id, bot_id, kind, label, value_cipher, transaction_type) VALUES (?, ?, ?, ?, ?, ?)',
      [
        data.user_id, 
        data.bot_id,
        data.kind, 
        data.label || null, 
        data.value_cipher, 
        data.transaction_type || null
      ]
    );
    
    const [rows] = await db.execute(
      'SELECT * FROM requisites WHERE id = ?',
      [result.insertId]
    );
    return new Requisite(rows[0]);
  }

  // поиск реквизита по пользователю, типу и зашифрованному значению
  static async findByUserAndValue(userId, kind, valueCipher) {
    const db = getConnection();
    const [rows] = await db.execute(
      'SELECT * FROM requisites WHERE user_id = ? AND kind = ? AND value_cipher = ? AND is_display = 1',
      [userId, kind, valueCipher]
    );
    return rows.length ? new Requisite(rows[0]) : null;
  }

  // обновление реквизита
  static async update(id, data) {
    const db = getConnection();
    const fields = [];
    const values = [];
    
    if (data.label !== undefined) {
      fields.push('label = ?');
      values.push(data.label);
    }
    
    if (fields.length === 0) return false;
    
    values.push(id);
    const [result] = await db.execute(
      `UPDATE requisites SET ${fields.join(', ')} WHERE id = ?`,
      values
    );
    
    return result.affectedRows > 0;
  }

  // удаление реквизита
  static async delete(id) {
    const db = getConnection();
    const [result] = await db.execute(
      'DELETE FROM requisites WHERE id = ?',
      [id]
    );
    return result.affectedRows > 0;
  }

  // логическое удаление реквизита
  static async softDelete(id) {
    const db = getConnection();
    const [result] = await db.execute(
      'UPDATE requisites SET is_display = 0 WHERE id = ?',
      [id]
    );
    return result.affectedRows > 0;
  }

  // расшифровка значения реквизита
  getDecryptedValue() {
    if (!this.value_cipher) return '';
    return Buffer.from(this.value_cipher).toString('utf8');
  }
}

module.exports = Requisite;