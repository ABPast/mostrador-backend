// El administrador de un negocio gestiona a los usuarios (empleados) de SU negocio.
const router = require('express').Router();
const { q } = require('../db');
const { requireAuth } = require('../auth');
const { bad, h, hash, checkUser, applyUserPatch } = require('../util');

router.use(requireAuth(['admin']));

router.get('/', h(async (req, res) => {
  res.json(await q(
    'SELECT id, name, email, role, active, created_at FROM users WHERE business_id=? ORDER BY role, name',
    [req.user.businessId]));
}));

router.post('/', h(async (req, res) => {
  const u = checkUser(req.body || {}, false);
  const r = await q(
    `INSERT INTO users (business_id, name, email, password_hash, role, active, created_at) VALUES (?,?,?,?,?,1,?)`,
    [req.user.businessId, u.name, u.email, hash(u.password), 'user', Date.now()]);
  res.status(201).json({ id: r.insertId });
}));

// Solo puede modificar empleados (rol "user") de su propio negocio.
async function target(req) {
  const [u] = await q('SELECT * FROM users WHERE id=? AND business_id=? AND role=?', [req.params.id, req.user.businessId, 'user']);
  if (!u) throw bad('Usuario no encontrado', 404);
  return u;
}

router.patch('/:id', h(async (req, res) => {
  await applyUserPatch(await target(req), req.body);
  res.json({ ok: true });
}));

router.delete('/:id', h(async (req, res) => {
  const u = await target(req);
  await q('DELETE FROM users WHERE id=?', [u.id]);
  res.json({ ok: true });
}));

module.exports = router;
