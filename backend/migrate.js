const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mysql = require('mysql2/promise');
require('dotenv').config();

const migrationsDir = path.join(__dirname, 'database', 'migrations');
const migrationsTable = 'schema_migrations';
const canonicalNameColumn = 'filename';
const legacyNameColumn = 'file_name';
const CHECKSUM_ALIASES = {
  // Legacy checksums before MySQL-compat rewrites.
  '2026-03-05_supports_dual_deposit.sql': [
    'baff217d45c943fe52ca634b18ecaaba4697f1f96019755414f5edd312dc4129'
  ],
  '2026-03-09_manual_rates_and_global_fee_tiers.sql': [
    '555141c4695b628744bf10083c713c80f30dea3127bfeb3eced21a1e2339b481'
  ],
  '2026-03-18_add_review_columns.sql': [
    '492dd9e3110cb9c8e9f27cbe9dfe040636efd7f372f13111ce45327bb4edc819'
  ],
  '2026-03-28_support_operator_rate_percent.sql': [
    '4705f4f952f36967dafede6fb0aa1ec12b70cf55f17317155300c2bef9cb8e9a'
  ],
  // Legacy checksum before MySQL-compat rewrite of this migration.
  '2026-04-01_order_chat_operator_language_and_translation.sql': [
    '2bb9c83e29e69ae5477fe321a23409bd8a8f4e6bb17007d9287c93e49eb55346'
  ]
};

function normalizeMigrationContent(content) {
  // Keep checksum stable across OS-specific line endings (LF/CRLF).
  return String(content || '').replace(/\r\n/g, '\n');
}

function getChecksum(content) {
  const normalized = normalizeMigrationContent(content);
  return crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
}

function getRawChecksum(content) {
  return crypto.createHash('sha256').update(String(content || ''), 'utf8').digest('hex');
}

function getRequestedMigrationFile() {
  const argEq = process.argv.find((arg) => arg.startsWith('--file='));
  if (argEq) {
    return argEq.slice('--file='.length).trim();
  }

  const argIndex = process.argv.findIndex((arg) => arg === '--file');
  if (argIndex >= 0 && process.argv[argIndex + 1]) {
    return String(process.argv[argIndex + 1]).trim();
  }

  if (process.env.MIGRATION_FILE) {
    return String(process.env.MIGRATION_FILE).trim();
  }

  return '';
}

function isIgnorableMigrationError(error) {
  // 1060 = ER_DUP_FIELDNAME ("Duplicate column name ...")
  // This means schema change already exists, so migration can be marked as applied.
  return error && (error.code === 'ER_DUP_FIELDNAME' || Number(error.errno) === 1060);
}

function isCompatibleChecksum(file, appliedChecksum, currentChecksum, extraChecksums = []) {
  if (!appliedChecksum) return false;
  if (appliedChecksum === currentChecksum) return true;
  if (Array.isArray(extraChecksums) && extraChecksums.includes(appliedChecksum)) return true;
  const aliases = CHECKSUM_ALIASES[file] || [];
  return aliases.includes(appliedChecksum);
}

async function getMigrationColumns(connection, dbName) {
  const [rows] = await connection.execute(
    `SELECT COLUMN_NAME
       FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = ?`,
    [dbName, migrationsTable]
  );

  return new Set(rows.map((row) => row.COLUMN_NAME));
}

async function ensureMigrationsTable(connection, dbName) {
  // New installs: create canonical schema with `filename`.
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS ${migrationsTable} (
      ${canonicalNameColumn} VARCHAR(255) NOT NULL PRIMARY KEY,
      checksum VARCHAR(64) NULL,
      applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  const columns = await getMigrationColumns(connection, dbName);

  let nameColumn = null;
  if (columns.has(canonicalNameColumn)) {
    nameColumn = canonicalNameColumn;
  } else if (columns.has(legacyNameColumn)) {
    nameColumn = legacyNameColumn;
  } else {
    throw new Error(
      `Unable to detect migration name column in ${migrationsTable}. Expected '${canonicalNameColumn}' or '${legacyNameColumn}'.`
    );
  }

  if (!columns.has('checksum')) {
    await connection.execute(
      `ALTER TABLE ${migrationsTable}
         ADD COLUMN checksum VARCHAR(64) NULL AFTER ${nameColumn}`
    );
  }

  if (!columns.has('applied_at')) {
    await connection.execute(
      `ALTER TABLE ${migrationsTable}
         ADD COLUMN applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP`
    );
  }

  return { nameColumn };
}

async function run() {
  const mysqlUri = process.env.MYSQL_URI;
  if (!mysqlUri) {
    throw new Error('MYSQL_URI is required');
  }

  const connection = await mysql.createConnection({
    uri: mysqlUri,
    multipleStatements: true
  });

  try {
    const [dbNameRows] = await connection.query('SELECT DATABASE() AS db_name');
    const dbName = dbNameRows[0]?.db_name;
    if (!dbName) {
      throw new Error('Unable to resolve current database name');
    }

    const { nameColumn } = await ensureMigrationsTable(connection, dbName);

    let files = fs
      .readdirSync(migrationsDir)
      .filter((file) => file.toLowerCase().endsWith('.sql'))
      .sort();

    const requestedMigration = getRequestedMigrationFile();
    if (requestedMigration) {
      const exists = files.includes(requestedMigration);
      if (!exists) {
        throw new Error(
          `Requested migration not found: ${requestedMigration}. Available migrations are in ${migrationsDir}`
        );
      }
      files = [requestedMigration];
      console.log(`→ Running single migration mode: ${requestedMigration}`);
    }

    for (const file of files) {
      const fullPath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(fullPath, 'utf8');
      const checksum = getChecksum(sql);
      const rawChecksum = getRawChecksum(sql);
      const compatibilityChecksums = rawChecksum !== checksum ? [rawChecksum] : [];

      const [appliedRows] = await connection.execute(
        `SELECT ${nameColumn}, checksum FROM ${migrationsTable} WHERE ${nameColumn} = ? LIMIT 1`,
        [file]
      );

      if (appliedRows.length) {
        const appliedChecksum = appliedRows[0].checksum;
        if (appliedChecksum && !isCompatibleChecksum(file, appliedChecksum, checksum, compatibilityChecksums)) {
          throw new Error(
            `Migration checksum mismatch for ${file}. Applied: ${appliedChecksum}, current(canonical): ${checksum}`
          );
        }
        if (
          appliedChecksum &&
          appliedChecksum !== checksum &&
          isCompatibleChecksum(file, appliedChecksum, checksum, compatibilityChecksums)
        ) {
          console.warn(`↪ Migration checksum alias matched for ${file}. Updating stored checksum to current.`);
          await connection.execute(
            `UPDATE ${migrationsTable} SET checksum = ? WHERE ${nameColumn} = ?`,
            [checksum, file]
          );
        }
        console.log(`↪ Skipping already applied migration: ${file}`);
        continue;
      }

      console.log(`→ Applying migration: ${file}`);
      await connection.beginTransaction();
      try {
        await connection.query(sql);
        await connection.execute(
          `INSERT INTO ${migrationsTable} (${nameColumn}, checksum, applied_at) VALUES (?, ?, NOW())`,
          [file, checksum]
        );
        await connection.commit();
        console.log(`✓ Applied migration: ${file}`);
      } catch (error) {
        await connection.rollback();
        if (isIgnorableMigrationError(error)) {
          console.warn(`↪ Migration already applied by schema state, marking as applied: ${file} (${error.message})`);
          await connection.execute(
            `INSERT INTO ${migrationsTable} (${nameColumn}, checksum, applied_at) VALUES (?, ?, NOW())`,
            [file, checksum]
          );
          continue;
        }
        throw error;
      }
    }

    console.log('All migrations applied successfully.');
  } finally {
    await connection.end();
  }
}

run().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
