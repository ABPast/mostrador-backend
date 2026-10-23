const router = require('express').Router();
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { q } = require('../db');
const { sign, requireAuth } = require('../auth');
const { bad, h, hash } = require('../util');

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, limit: 15, standardHeaders: true, legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos.' }
});

const publicUser = (u, b) => ({
  user: { id: u.id, name: u.name, email: u.email, role: u.role },
  business: b ? { id: b.id, name: b.name } : null,
  impersonating: u.realRole === 'superadmin' // superadministrador trabajando dentro de un negocio
});

router.post('/login', loginLimiter, h(async (req, res) => {
  const { email, password } = req.body || {};
  const rows = await q(
    `SELECT u.*, b.name AS business_name, b.active AS business_active
       FROM users u LEFT JOIN businesses b ON b.id = u.business_id WHERE u.email = ?`,
    [String(email || '').trim().toLowerCase()]);
  const u = rows[0];
  if (!u || !bcrypt.compareSync(String(password || ''), u.password_hash)) throw bad('Correo o contraseña incorrectos', 401);
  if (!u.active) throw bad('Tu usuario está desactivado. Contacta a tu administrador.', 403);
  if (u.business_id && !u.business_active) throw bad('El negocio está suspendido.', 403);
  res.json({ token: sign(u), ...publicUser(u, u.business_id ? { id: u.business_id, name: u.business_name } : null) });
}));

router.get('/me', requireAuth(), (req, res) => res.json(publicUser(req.user, req.business)));

router.post('/password', requireAuth(), h(async (req, res) => {
  const { current, next } = req.body || {};
  if (String(next || '').length < 8) throw bad('La contraseña nueva debe tener al menos 8 caracteres');
  const [u] = await q('SELECT password_hash FROM users WHERE id=?', [req.user.id]);
  if (!bcrypt.compareSync(String(current || ''), u.password_hash)) throw bad('La contraseña actual no es correcta', 400);
  await q('UPDATE users SET password_hash=? WHERE id=?', [hash(String(next)), req.user.id]);
  res.json({ ok: true });
}));

module.exports = router;
