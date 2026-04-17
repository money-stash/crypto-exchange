const mysql = require('mysql2/promise');
const config = require('../config');

let connection = null;

async function initDatabase() {
  try {
    connection = await mysql.createConnection(config.mysql.uri);
    console.log('✅ Database connected successfully');
    return connection;
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    throw error;
  }
}

function getConnection() {
  if (!connection) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return connection;
}

module.exports = {
  initDatabase,
  getConnection
};