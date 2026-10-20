const jwt = require('jsonwebtoken');
const { q } = require('./db');

const secret = () => {
  const s = process.env.JWT_SECRET;
  if (!s || s.length < 24) throw new Error('Define JWT_SECRET (mínimo 24 caracteres) en .env');
  return s;
};

const sign = u => jwt.sign({ uid: u.id }, secret(), { expiresIn: process.env.JWT_EXPIRES || '12h' });

// Verifica el token, recarga al usuario desde la BD (rol/estado siempre actuales) y valida roles permitidos.
function requireAuth(roles) {
  return async (req, res, next) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (!token) return res.status(401).json({ error: 'No autenticado' });
      let payload;
      try { payload = jwt.verify(token, secret()); }
      catch { return res.status(401).json({ error: 'Sesión inválida o expirada' }); }

      const rows = await q(
        `SELECT u.id, u.business_id, u.name, u.email, u.role, u.active,
                b.name AS business_name, b.active AS business_active
           FROM users u LEFT JOIN businesses b ON b.id = u.business_id WHERE u.id = ?`, [payload.uid]);
      const u = rows[0];
      if (!u || !u.active) return res.status(401).json({ error: 'Usuario inactivo' });
      if (u.business_id && !u.business_active) return res.status(401).json({ error: 'Negocio suspendido' });

      req.user = { id: u.id, name: u.name, email: u.email, role: u.role, businessId: u.business_id };
      req.business = u.business_id ? { id: u.business_id, name: u.business_name } : null;
      if (roles && !roles.includes(u.role)) return res.status(403).json({ error: 'No tienes permiso' });
      next();
    } catch (e) { next(e); }
  };
}

module.exports = { sign, requireAuth };
