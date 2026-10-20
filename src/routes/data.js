// CRUD de products, customers, suppliers, expenses y sales.
// Todo se filtra por el negocio del usuario autenticado: nunca se ven datos de otro negocio.
const router = require('express').Router();
const crypto = require('crypto');
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { bad, h } = require('../util');
const { COLLECTIONS, PERM, colOf, clean, toDoc } = require('../collections');

const C = '/:col(products|customers|suppliers|expenses|sales)';
const auth = requireAuth(['admin', 'user']);
const id = x => '`' + x + '`';

function ctx(req, action) {
  const perm = PERM[req.user.role][req.params.col];
  if (!perm.includes(action)) throw bad('No tienes permiso para esta acción', 403);
  return COLLECTIONS[req.params.col];
}

async function mustExist(c, req) {
  const rows = await q(`SELECT id FROM ${id(c.table)} WHERE id=? AND business_id=?`, [req.params.id, req.user.businessId]);
  if (!rows.length) throw bad('No encontrado', 404);
}

router.get(C, auth, h(async (req, res) => {
  const c = ctx(req, 'r');
  const params = [req.user.businessId];
  let sql = `SELECT * FROM ${id(c.table)} WHERE business_id=?`;

  const { where, orderBy, dir, limit } = req.query;
  if (where) {
    const w = String(where), i = w.indexOf(':'), k = w.slice(0, i);
    if (!c.fields[k]) throw bad('Campo no válido');
    let v;
    try { v = JSON.parse(w.slice(i + 1)); } catch { throw bad('Filtro no válido'); }
    sql += ` AND ${id(colOf(c, k))}=?`;
    params.push(c.fields[k].t.w(v));
  }
  if (orderBy) {
    const col = orderBy === 'created_at' ? 'created_at' : (c.fields[orderBy] && colOf(c, orderBy));
    if (!col) throw bad('Orden no válido');
    sql += ` ORDER BY ${id(col)} ${dir === 'desc' ? 'DESC' : 'ASC'}`;
  } else sql += ' ORDER BY created_at ASC';
  const n = parseInt(limit, 10);
  if (n > 0) { sql += ' LIMIT ?'; params.push(Math.min(n, 5000)); }

  const rows = await q(sql, params);
  res.json(rows.map(r => toDoc(c, r)));
}));

router.post(C, auth, h(async (req, res) => {
  const c = ctx(req, 'c');
  const data = clean(c, req.body || {}, false);
  const docId = crypto.randomUUID(), now = Date.now();
  const cols = ['id', 'business_id', 'created_at', 'updated_at'];
  const vals = [docId, req.user.businessId, now, now];
  for (const [k, v] of Object.entries(data)) { cols.push(colOf(c, k)); vals.push(v); }
  await q(`INSERT INTO ${id(c.table)} (${cols.map(id).join(',')}) VALUES (${cols.map(() => '?').join(',')})`, vals);
  res.status(201).json({ id: docId });
}));

router.patch(C + '/:id', auth, h(async (req, res) => {
  const c = ctx(req, 'u');
  await mustExist(c, req);
  let body = req.body || {};
  // Un empleado solo puede ajustar existencias (p. ej. al vender), no precios ni costos.
  if (req.user.role === 'user' && req.params.col === 'products') body = { stock: body.stock };
  const data = clean(c, body, true);
  const keys = Object.keys(data);
  if (keys.length) {
    const sets = keys.map(k => `${id(colOf(c, k))}=?`).concat('`updated_at`=?').join(',');
    await q(`UPDATE ${id(c.table)} SET ${sets} WHERE id=? AND business_id=?`,
      [...keys.map(k => data[k]), Date.now(), req.params.id, req.user.businessId]);
  }
  res.json({ ok: true });
}));

router.delete(C + '/:id', auth, h(async (req, res) => {
  const c = ctx(req, 'd');
  await mustExist(c, req);
  await q(`DELETE FROM ${id(c.table)} WHERE id=? AND business_id=?`, [req.params.id, req.user.businessId]);
  res.json({ ok: true });
}));

module.exports = router;
