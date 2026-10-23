const { bad } = require('./util');

const num = v => { const x = Number(v); if (!Number.isFinite(x)) throw bad('Número inválido'); return x; };

// Cada tipo: w = normaliza lo que llega del cliente, r = convierte lo que viene de MySQL.
const TYPES = {
  str: max => ({ w: v => String(v == null ? '' : v).trim().slice(0, max), r: v => (v == null ? '' : String(v)) }),
  money: {
    w: v => { const x = num(v); if (x < 0 || x > 1e9) throw bad('Monto fuera de rango'); return Math.round(x * 100) / 100; },
    r: Number
  },
  // Cantidad con hasta 3 decimales (kg). Para productos por unidad el frontend y la API la redondean a entero.
  qty: {
    w: v => { const x = num(v); if (x < 0 || x > 1e9) throw bad('Cantidad fuera de rango'); return Math.round(x * 1000) / 1000; },
    r: Number
  },
  bool: { w: v => (v ? 1 : 0), r: v => !!v },
  date: {
    w: v => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw bad('Fecha inválida'); return String(v); },
    r: v => String(v).slice(0, 10)
  },
  saleType: {
    w: v => { if (v !== 'unidad' && v !== 'kg') throw bad('Tipo de venta inválido'); return v; },
    r: v => (v === 'kg' ? 'kg' : 'unidad')
  }
};
const S = TYPES.str;

// key = nombre que usa el frontend; col = columna MySQL (si es distinta); req = obligatorio al crear.
// Las ventas tienen su propia ruta (routes/sales.js).
const COLLECTIONS = {
  products: {
    table: 'products',
    fields: {
      name: { t: S(120), req: 1 }, sku: { t: S(60) }, cat: { t: S(60) },
      saleType: { col: 'sale_type', t: TYPES.saleType },
      cost: { t: TYPES.money }, price: { t: TYPES.money, req: 1 },
      stock: { t: TYPES.qty }, min: { col: 'min_stock', t: TYPES.qty }, ejemplo: { t: TYPES.bool }
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
  }
};

// Qué puede hacer cada rol: r=leer, c=crear, u=editar, d=borrar.
// El empleado no edita el inventario (las existencias solo bajan al vender) ni ve gastos.
const PERM = {
  admin: { products: 'rcud', customers: 'rcud', suppliers: 'rcud', expenses: 'rcud' },
  user: { products: 'r', customers: 'rcu', suppliers: 'r', expenses: '' }
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
