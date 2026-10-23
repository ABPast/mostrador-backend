require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');

const app = express();
if (process.env.TRUST_PROXY && process.env.TRUST_PROXY !== '0') app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

app.use(helmet({
  // En HTTP (red local) no se debe forzar HTTPS: ni HSTS ni upgrade-insecure-requests.
  // Activa HSTS solo si lo sirves por HTTPS definiendo ENABLE_HSTS=1 en .env.
  hsts: process.env.ENABLE_HSTS === '1',
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // la API la consume otro origen (GitHub Pages)
  contentSecurityPolicy: {
    directives: {
      upgradeInsecureRequests: null,
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"]
    }
  }
}));
// CORS: orígenes del frontend (p. ej. GitHub Pages) separados por comas en CORS_ORIGIN.
// Se identifica con el token en el encabezado Authorization, no con cookies, así que no se envían credenciales.
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map(o => o.trim().replace(/\/+$/, '')).filter(Boolean);
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.append('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Business-Id');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: true, legacyHeaders: false }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/users', require('./routes/users'));
app.use('/api', require('./routes/sales'));
app.use('/api', require('./routes/data'));
app.use('/api', (req, res) => res.status(404).json({ error: 'No encontrado' }));

// Frontend estático (public/): app.html es la aplicación; login.html y admin.html completan el acceso.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get(['/', '/Mostrador.html'], (req, res) => res.redirect('/app.html'));

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON no válido' });
  if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'El correo ya está registrado' });
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message });
});

async function seedSuperadmin() {
  const rows = await db.q("SELECT id FROM users WHERE role='superadmin' LIMIT 1");
  if (rows.length) return;
  const { SUPERADMIN_NAME, SUPERADMIN_EMAIL, SUPERADMIN_PASSWORD } = process.env;
  if (!SUPERADMIN_EMAIL || !SUPERADMIN_PASSWORD || SUPERADMIN_PASSWORD.length < 8) {
    throw new Error('Define SUPERADMIN_EMAIL y SUPERADMIN_PASSWORD (mínimo 8 caracteres) en .env para crear el primer usuario.');
  }
  await db.q(
    `INSERT INTO users (business_id, name, email, password_hash, role, active, created_at) VALUES (NULL,?,?,?,?,1,?)`,
    [SUPERADMIN_NAME || 'Administrador general', SUPERADMIN_EMAIL.trim().toLowerCase(), bcrypt.hashSync(SUPERADMIN_PASSWORD, 10), 'superadmin', Date.now()]);
  console.log('Superadministrador creado:', SUPERADMIN_EMAIL);
}

(async () => {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 24) throw new Error('Define JWT_SECRET (mínimo 24 caracteres) en .env');
  await db.init();
  await seedSuperadmin();
  const port = Number(process.env.PORT) || 3000;
  app.listen(port, () => console.log(`Mostrador listo en http://localhost:${port}`));
})().catch(e => {
  console.error('\nNo se pudo iniciar:', e.message);
  process.exit(1);
});
