const bcrypt = require('bcryptjs');
const { q } = require('./db');

const bad = (message, status = 400) => Object.assign(new Error(message), { status });
const h = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const hash = p => bcrypt.hashSync(p, 10);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Valida datos de usuario. partial=true: solo valida lo que venga definido.
function checkUser({ name, email, password }, partial) {
  const out = {};
  if (!partial || name !== undefined) {
    out.name = String(name || '').trim().slice(0, 100);
    if (!out.name) throw bad('Falta el nombre');
  }
  if (!partial || email !== undefined) {
    out.email = String(email || '').trim().toLowerCase();
    if (!EMAIL.test(out.email) || out.email.length > 190) throw bad('Correo no válido');
  }
  if (!partial || password !== undefined) {
    if (String(password || '').length < 8) throw bad('La contraseña debe tener al menos 8 caracteres');
    out.password = String(password);
  }
  return out;
}

// Cambia nombre / contraseña / activo de un usuario ya cargado (u).
async function applyUserPatch(u, body) {
  const { name, password, active } = body || {};
  const c = checkUser({ name, password }, true);
  await q('UPDATE users SET name=?, password_hash=?, active=? WHERE id=?', [
    c.name !== undefined ? c.name : u.name,
    c.password ? hash(c.password) : u.password_hash,
    active === undefined ? u.active : (active ? 1 : 0),
    u.id
  ]);
}

module.exports = { bad, h, hash, checkUser, applyUserPatch };
