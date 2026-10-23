// Cálculo de una venta a partir de los productos del negocio. Función pura (sin base de datos) para poder probarla.
// El precio, el costo y el nombre SIEMPRE salen del producto guardado, nunca de lo que envía el cliente.
const { bad } = require('./util');

const r2 = x => Math.round((x + Number.EPSILON) * 100) / 100;
const r3 = x => Math.round((x + Number.EPSILON) * 1000) / 1000;

// lines: [{ pid, qty }]  ·  products: filas de la tabla products  ·  opts: { discount, checkStock }
function buildSale(lines, products, opts = {}) {
  if (!Array.isArray(lines) || !lines.length || lines.length > 200) throw bad('La venta necesita entre 1 y 200 artículos');
  const merged = new Map(); // un mismo producto en varias líneas se suma
  for (const l of lines) {
    const pid = String((l && l.pid) || '');
    if (!pid) throw bad('Artículo inválido');
    merged.set(pid, (merged.get(pid) || 0) + Number(l.qty));
  }
  const byId = new Map(products.map(p => [p.id, p]));
  const items = [];
  const stockChanges = [];
  let subtotal = 0, cost = 0;
  for (const [pid, rawQty] of [...merged.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const p = byId.get(pid);
    if (!p) throw bad('Un producto de la venta ya no existe', 409);
    if (!Number.isFinite(rawQty) || rawQty <= 0 || rawQty > 1e6) throw bad('Cantidad inválida en "' + p.name + '"');
    const unit = p.sale_type === 'kg' ? 'kg' : 'unidad';
    let qty;
    if (unit === 'unidad') {
      if (!Number.isInteger(rawQty)) throw bad('"' + p.name + '" se vende por unidad: usa cantidades enteras');
      qty = rawQty;
    } else {
      qty = r3(rawQty);
      if (qty <= 0) throw bad('El peso de "' + p.name + '" es demasiado pequeño');
    }
    if (opts.checkStock && qty > Number(p.stock) + 1e-9) throw bad('Existencias insuficientes: ' + p.name, 409);
    const price = Number(p.price), pcost = Number(p.cost);
    items.push({ pid, name: p.name, qty, unit, cat: p.cat || '', price, cost: pcost });
    subtotal += r2(price * qty);
    cost += r2(pcost * qty);
    stockChanges.push({ pid, qty });
  }
  subtotal = r2(subtotal);
  cost = r2(cost);
  let discount = Number(opts.discount || 0);
  if (!Number.isFinite(discount) || discount < 0) throw bad('Descuento inválido');
  discount = Math.min(r2(discount), subtotal);
  return { items, subtotal, discount, total: r2(subtotal - discount), cost, stockChanges };
}

module.exports = { buildSale, r2, r3 };
