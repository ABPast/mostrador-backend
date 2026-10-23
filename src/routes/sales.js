// Ventas. El servidor calcula precios y costos desde los productos, descuenta existencias en una transacción
// y registra al usuario que vendió. El empleado solo ve sus propias ventas; el administrador ve todas.
const router = require('express').Router();
const crypto = require('crypto');
const { q, tx } = require('../db');
const { requireAuth } = require('../auth');
const { bad, h } = require('../util');
const { buildSale } = require('../saleCalc');

const METHODS = ['efectivo', 'tarjeta', 'transferencia'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const pad = n => String(n).padStart(2, '0');
const dayKey = ms => { const d = new Date(ms); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };

function toDoc(row, isAdmin) {
  const items = typeof row.items === 'string' ? JSON.parse(row.items) : row.items || [];
  const doc = {
    id: row.id,
    ts: Number(row.ts),
    day: row.day,
    items: items.map(i => {
      const it = { pid: i.pid, name: i.name, qty: Number(i.qty), unit: i.unit || 'unidad', cat: i.cat || '', price: Number(i.price) };
      if (isAdmin) it.cost = Number(i.cost || 0); // el empleado no ve costos
      return it;
    }),
    subtotal: Number(row.subtotal),
    discount: Number(row.discount),
    total: Number(row.total),
    method: row.method,
    customerId: row.customer_id,
    customerName: row.customer_name,
    userId: row.user_id,
    userName: row.user_name,
    ejemplo: !!row.ejemplo
  };
  if (isAdmin) doc.cost = Number(row.cost);
  return doc;
}

const FILTERABLE = { ejemplo: 'ejemplo', method: 'method', customerId: 'customer_id', userId: 'user_id' };

router.get('/sales', requireAuth(['admin', 'user']), h(async (req, res) => {
  const params = [req.user.businessId];
  let sql = 'SELECT * FROM sales WHERE business_id=?';
  if (req.user.role === 'user') { sql += ' AND user_id=?'; params.push(req.user.id); } // regla: empleado solo ve lo suyo
  const { where, orderBy, dir, limit } = req.query;
  if (where) {
    const w = String(where), i = w.indexOf(':'), k = w.slice(0, i);
    if (!FILTERABLE[k]) throw bad('Campo no válido');
    let v;
    try { v = JSON.parse(w.slice(i + 1)); } catch { throw bad('Filtro no válido'); }
    sql += ' AND `' + FILTERABLE[k] + '`=?';
    params.push(k === 'ejemplo' ? (v ? 1 : 0) : v);
  }
  if (orderBy && !['ts', 'created_at'].includes(orderBy)) throw bad('Orden no válido');
  sql += ' ORDER BY `' + (orderBy || 'created_at') + '` ' + (dir === 'desc' ? 'DESC' : 'ASC');
  const n = parseInt(limit, 10);
  if (n > 0) { sql += ' LIMIT ?'; params.push(Math.min(n, 5000)); }
  const rows = await q(sql, params);
  res.json(rows.map(r => toDoc(r, req.user.role === 'admin')));
}));

router.post('/sales', requireAuth(['admin', 'user']), h(async (req, res) => {
  const body = req.body || {};
  const demo = !!body.ejemplo;
  if (demo && req.user.role !== 'admin') throw bad('No tienes permiso para esta acción', 403);
  const method = body.method === undefined ? 'efectivo' : body.method;
  if (!METHODS.includes(method)) throw bad('Forma de pago inválida');
  const lines = Array.isArray(body.items) ? body.items.map(i => ({ pid: i && i.pid, qty: i && i.qty })) : null;

  const now = Date.now();
  let ts = now;
  if (demo && Number.isFinite(Number(body.ts)) && Number(body.ts) > 0 && Number(body.ts) <= now) ts = Math.round(Number(body.ts));
  let day = dayKey(ts);
  // El día lo calcula el navegador (su zona horaria); se acepta si es razonable (±36 h de ahora, o cualquiera en ejemplos).
  if (typeof body.day === 'string' && DAY.test(body.day) &&
      (demo || Math.abs(Date.parse(body.day + 'T12:00:00Z') - ts) <= 36 * 3600 * 1000)) day = body.day;

  const bid = req.user.businessId;
  const id = crypto.randomUUID();
  const out = await tx(async run => {
    if (!Array.isArray(lines) || !lines.length) throw bad('La venta necesita al menos un artículo');
    const pids = [...new Set(lines.map(l => String(l.pid || '')))].filter(Boolean).sort();
    if (!pids.length) throw bad('Artículo inválido');
    const products = await run(
      'SELECT * FROM products WHERE business_id=? AND id IN (' + pids.map(() => '?').join(',') + ') ORDER BY id FOR UPDATE',
      [bid, ...pids]);
    const sale = buildSale(lines, products, { discount: body.discount, checkStock: !demo });

    let customerId = '', customerName = '';
    if (body.customerId) {
      const c = await run('SELECT id, name FROM customers WHERE id=? AND business_id=?', [String(body.customerId), bid]);
      if (!c.length) throw bad('Cliente no encontrado', 404);
      customerId = c[0].id; customerName = c[0].name;
    }
    if (!demo) // los datos de ejemplo no mueven existencias
      for (const ch of sale.stockChanges)
        await run('UPDATE products SET stock = stock - ?, updated_at = ? WHERE id = ? AND business_id = ?', [ch.qty, now, ch.pid, bid]);

    await run(
      `INSERT INTO sales (id, business_id, ts, day, items, subtotal, discount, total, cost, method, customer_id, customer_name,
                          user_id, user_name, ejemplo, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [id, bid, ts, day, JSON.stringify(sale.items), sale.subtotal, sale.discount, sale.total, sale.cost, method,
       customerId, customerName, req.user.id, String(req.user.name || '').slice(0, 100), demo ? 1 : 0, now, now]);
    return sale;
  });
  res.status(201).json({ id, total: out.total });
}));

// Anular una venta (solo administrador): regresa las existencias al inventario.
router.delete('/sales/:id', requireAuth(['admin']), h(async (req, res) => {
  await tx(async run => {
    const rows = await run('SELECT * FROM sales WHERE id=? AND business_id=? FOR UPDATE', [req.params.id, req.user.businessId]);
    if (!rows.length) throw bad('No encontrado', 404);
    const s = rows[0];
    if (!s.ejemplo) {
      const items = typeof s.items === 'string' ? JSON.parse(s.items) : s.items || [];
      const now = Date.now();
      for (const i of items)
        await run('UPDATE products SET stock = stock + ?, updated_at = ? WHERE id = ? AND business_id = ?',
          [Number(i.qty), now, i.pid, req.user.businessId]);
    }
    await run('DELETE FROM sales WHERE id=?', [s.id]);
  });
  res.json({ ok: true });
}));

module.exports = router;
