// Panel del superadministrador: alta y gestión de negocios y de sus usuarios.
const router = require('express').Router();
const { q, tx } = require('../db');
const { requireAuth } = require('../auth');
const { bad, h, hash, checkUser, applyUserPatch } = require('../util');

router.use(requireAuth(['superadmin']));

router.get('/businesses', h(async (req, res) => {
  res.json(await q(
    `SELECT b.id, b.name, b.active, b.created_at,
            (SELECT COUNT(*) FROM users WHERE business_id = b.id) AS users,
            (SELECT email FROM users WHERE business_id = b.id AND role = 'admin' ORDER BY id LIMIT 1) AS admin_email
       FROM businesses b ORDER BY b.name`));
}));

// Crea el negocio y su administrador en una sola transacción.
router.post('/businesses', h(async (req, res) => {
  const name = String((req.body || {}).name || '').trim().slice(0, 120);
  if (!name) throw bad('Falta el nombre del negocio');
  const a = checkUser({
    name: req.body.adminName, email: req.body.adminEmail, password: req.body.adminPassword
  }, false);
  const id = await tx(async run => {
    const r = await run('INSERT INTO businesses (name, active, created_at) VALUES (?,1,?)', [name, Date.now()]);
    await run(
      `INSERT INTO users (business_id, name, email, password_hash, role, active, created_at) VALUES (?,?,?,?,?,1,?)`,
      [r.insertId, a.name, a.email, hash(a.password), 'admin', Date.now()]);
    return r.insertId;
  });
  res.status(201).json({ id });
}));

router.patch('/businesses/:id', h(async (req, res) => {
  const rows = await q('SELECT * FROM businesses WHERE id=?', [req.params.id]);
  if (!rows.length) throw bad('Negocio no encontrado', 404);
  const b = rows[0];
  const { name, active } = req.body || {};
  const newName = name === undefined ? b.name : String(name).trim().slice(0, 120);
  if (!newName) throw bad('Falta el nombre del negocio');
  await q('UPDATE businesses SET name=?, active=? WHERE id=?', [newName, active === undefined ? b.active : (active ? 1 : 0), b.id]);
  res.json({ ok: true });
}));

// Borra el negocio y TODOS sus datos (usuarios, productos, ventas, etc.).
router.delete('/businesses/:id', h(async (req, res) => {
  await q('DELETE FROM businesses WHERE id=?', [req.params.id]);
  res.json({ ok: true });
}));

router.get('/businesses/:id/users', h(async (req, res) => {
  res.json(await q(
    'SELECT id, name, email, role, active, created_at FROM users WHERE business_id=? ORDER BY role, name', [req.params.id]));
}));

// Restablecer contraseña / activar / desactivar a cualquier usuario de un negocio.
router.patch('/users/:id', h(async (req, res) => {
  const [u] = await q('SELECT * FROM users WHERE id=? AND business_id IS NOT NULL', [req.params.id]);
  if (!u) throw bad('Usuario no encontrado', 404);
  await applyUserPatch(u, req.body);
  res.json({ ok: true });
}));

module.exports = router;
