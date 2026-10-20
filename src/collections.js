const { bad } = require('./util');

const METHODS = ['efectivo', 'tarjeta', 'transferencia'];
const num = v => { const x = Number(v); if (!Number.isFinite(x)) throw bad('Número inválido'); return x; };

// Cada tipo: w = normaliza lo que llega del cliente, r = convierte lo que viene de MySQL.
const TYPES = {
  str: max => ({ w: v => String(v == null ? '' : v).trim().slice(0, max), r: v => (v == null ? '' : String(v)) }),
  money: {
    w: v => { const x = num(v); if (x < 0 || x > 1e9) throw bad('Monto fuera de rango'); return Math.round(x * 100) / 100; },
    r: Number
  },
  nint: {
    w: v => { const x = Math.round(num(v)); if (x < 0 || x > 1e9) throw bad('Cantidad fuera de rango'); return x; },
    r: Number
  },
  bool: { w: v => (v ? 1 : 0), r: v => !!v },
  date: {
    w: v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw bad('Fecha inválida'); return String(v); },
    r: v => String(v).slice(0, 10)
  },
  method: {
    w: v => { if (!METHODS.includes(v)) throw bad('Forma de pago inválida'); return v; },
    r: String
  },
  ts: {
    w: v => { const x = Math.round(num(v)); if (x <= 0) throw bad('Fecha inválida'); return x; },
    r: Number
  },
  items: {
    w: v => {
      if (!Array.isArray(v) || !v.length || v.length > 200) throw bad('La venta necesita entre 1 y 200 artículos');
      return JSON.stringify(v.map(i => {
        const qty = num(i.qty), price = num(i.price), cost = num(i.cost);
        if (qty <= 0 || price < 0 || cost < 0) throw bad('Artículo inválido');
        return { pid: String(i.pid || '').slice(0, 64), name: String(i.name || '').slice(0, 120), qty, price, cost };
      }));
    },
    r: v => (typeof v === 'string' ? JSON.parse(v) : v)
  }
};
const S = TYPES.str;

// key = nombre que usa el frontend; col = columna MySQL (si es distinta); req = obligatorio al crear.
const COLLECTIONS = {
  products: {
    table: 'products',
    fields: {
      name: { t: S(120), req: 1 }, sku: { t: S(60) }, cat: { t: S(60) },
      cost: { t: TYPES.money }, price: { t: TYPES.money, req: 1 },
      stock: { t: TYPES.nint }, min: { col: 'min_stock', t: TYPES.nint }, ejemplo: { t: TYPES.bool }
    }
  },
  customers: {
    table: 'customers',
    fields: { name: { t: S(120), req: 1 }, phone: { t: S(40) }, notes: { t: S(1000) }, ejemplo: { t: TYPES.bool } }
  },
  suppliers: {
    table: 'suppliers',
    fields: { name: { t: S(120), req: 1 }, phone: { t: S(40) }, notes: { t: S(1000) }, ejemplo: { t: TYPES.bool } }
  },
  expenses: {
    table: 'expenses',
    fields: {
      concept: { t: S(200), req: 1 }, amount: { t: TYPES.money, req: 1 }, cat: { t: S(40) },
      date: { t: TYPES.date, req: 1 }, ejemplo: { t: TYPES.bool }
    }
  },
  sales: {
    table: 'sales',
    fields: {
      ts: { t: TYPES.ts, req: 1 }, day: { t: S(10) }, items: { t: TYPES.items, req: 1 },
      subtotal: { t: TYPES.money }, discount: { t: TYPES.money }, total: { t: TYPES.money, req: 1 }, cost: { t: TYPES.money },
      method: { t: TYPES.method }, customerId: { col: 'customer_id', t: S(36) }, customerName: { col: 'customer_name', t: S(120) },
      ejemplo: { t: TYPES.bool }
    }
  }
};

// Qué puede hacer cada rol: r=leer, c=crear, u=editar, d=borrar
const PERM = {
  admin: { products: 'rcud', customers: 'rcud', suppliers: 'rcud', sales: 'rcud', expenses: 'rcud' },
  user: { products: 'ru', customers: 'rcu', suppliers: 'r', sales: 'rc', expenses: 'r' }
};

const colOf = (c, k) => c.fields[k].col || k;

function clean(c, body, partial) {
  const out = {};
  for (const [k, d] of Object.entries(c.fields)) {
    if (body[k] === undefined) {
      if (!partial && d.req) throw bad('Falta el campo ' + k);
      continue;
    }
    const v = d.t.w(body[k]);
    if (d.req && v === '') throw bad('Falta el campo ' + k);
    out[k] = v;
  }
  return out;
}

function toDoc(c, row) {
  const doc = { id: row.id };
  for (const [k, d] of Object.entries(c.fields)) doc[k] = d.t.r(row[colOf(c, k)]);
  return doc;
}

module.exports = { COLLECTIONS, PERM, colOf, clean, toDoc };
