const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

let pool = null;

const cfg = () => ({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'mostrador'
});

async function init() {
  const c = cfg();
  // Intenta crear la base si no existe (si el usuario no tiene permiso, se asume que ya existe).
  try {
    const conn = await mysql.createConnection({ host: c.host, port: c.port, user: c.user, password: c.password });
    await conn.query('CREATE DATABASE IF NOT EXISTS `' + c.database.replace(/`/g, '') + '` CHARACTER SET utf8mb4');
    await conn.end();
  } catch (e) {
    if (e.code === 'ECONNREFUSED' || e.code === 'ER_ACCESS_DENIED_ERROR') throw e;
  }
  pool = mysql.createPool({
    ...c,
    waitForConnections: true,
    connectionLimit: 10,
    charset: 'utf8mb4',
    dateStrings: true
  });
  const sql = fs.readFileSync(path.join(__dirname, '..', 'sql', 'schema.sql'), 'utf8');
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) await pool.query(stmt);
  await migrate();
}

// Actualiza bases creadas con versiones anteriores (se puede ejecutar muchas veces sin efecto).
async function colType(table, column) {
  const rows = await q(
    'SELECT DATA_TYPE AS t FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [table, column]);
  return rows.length ? String(rows[0].t).toLowerCase() : null;
}
async function migrate() {
  if (!(await colType('products', 'sale_type')))
    await pool.query("ALTER TABLE products ADD COLUMN sale_type ENUM('unidad','kg') NOT NULL DEFAULT 'unidad' AFTER cat");
  for (const c of ['stock', 'min_stock'])
    if ((await colType('products', c)) !== 'decimal')
      await pool.query('ALTER TABLE products MODIFY COLUMN ' + c + ' DECIMAL(12,3) NOT NULL DEFAULT 0');
  if (!(await colType('sales', 'user_id')))
    await pool.query("ALTER TABLE sales ADD COLUMN user_id INT UNSIGNED NULL, ADD COLUMN user_name VARCHAR(100) NOT NULL DEFAULT ''");
}

const q = (sql, params) => pool.query(sql, params).then(([rows]) => rows);

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const out = await fn((sql, params) => conn.query(sql, params).then(([rows]) => rows));
    await conn.commit();
    return out;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

module.exports = { init, q, tx };
