// All money is integer minor units (poisha). Convert at the UI edge only.
export const toMinor = (v) => Math.round(Number(v) * 100)
export const fromMinor = (m) => (m / 100).toFixed(2)

export function lineTotal({ qty, unitPrice, discount = 0 }) {
  return qty * unitPrice - discount
}
export function saleTotals(lines, saleDiscount = 0) {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0)
  return { subtotal, discount: saleDiscount, total: subtotal - saleDiscount }
}
export const balance = (total, paid) => total - paid // >0 owed, <0 overpaid
export function paymentStatus(total, paid) {
  if (paid <= 0) return total === 0 ? 'paid' : 'unpaid'
  if (paid < total) return 'partial'
  return paid === total ? 'paid' : 'overpaid'
}
export function validateSale(lines, stockById, saleDiscount = 0) {
  if (!lines.length) throw new Error('Add at least one product')
  const need = {}
  for (const l of lines) {
    if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error('Quantity must be a whole number above 0')
    if (!(l.unitPrice >= 0)) throw new Error('Invalid price')
    if (l.discount < 0 || l.discount > l.qty * l.unitPrice) throw new Error('Invalid line discount')
    if (l.productId) need[l.productId] = (need[l.productId] || 0) + l.qty
  }
  for (const [id, q] of Object.entries(need))
    if ((stockById[id] ?? 0) < q) throw new Error('Not enough stock for a selected product')
  if (saleDiscount < 0 || saleDiscount > saleTotals(lines).subtotal) throw new Error('Invalid discount')
}
export const monthOf = (iso) => iso.slice(0, 7)

// Net amount customer still owes on an invoice after returns and refunds (<0 = shop owes customer).
export const netDue = (s) => s.total - (s.returned || 0) - (s.paid - (s.refunded || 0))

// Credit for returning k units of a line: line net (after line discount) pro-rated, then sale discount pro-rated.
// Cumulative form telescopes, so many partial returns sum exactly to the full-line credit.
export function creditForQty(sale, lineIndex, k) {
  const l = sale.lines[lineIndex], rate = sale.subtotal ? sale.total / sale.subtotal : 0
  return Math.round(Math.round(((l.qty * l.unitPrice - l.discount) * k) / l.qty) * rate)
}
// items: [{lineIndex, qty, disposition:'restock'|'damaged'}]
export function returnCredits(sale, items) {
  return items.map((it) => {
    const prev = (sale.returnedQty || [])[it.lineIndex] || 0
    return creditForQty(sale, it.lineIndex, prev + it.qty) - creditForQty(sale, it.lineIndex, prev)
  })
}
export function validateReturn(sale, items, refund) {
  if (!items.length) throw new Error('Select at least one item to return')
  const seen = {}
  for (const it of items) {
    const l = sale.lines[it.lineIndex]
    if (!l) throw new Error('Invalid line')
    if (!['restock', 'damaged'].includes(it.disposition)) throw new Error('Choose restock or damaged')
    seen[it.lineIndex] = (seen[it.lineIndex] || 0) + it.qty
    if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error('Return quantity must be a whole number above 0')
    if (seen[it.lineIndex] > l.qty - ((sale.returnedQty || [])[it.lineIndex] || 0)) throw new Error('Cannot return more than was sold')
  }
  if (!Number.isInteger(refund) || refund < 0) throw new Error('Invalid refund amount')
  if (refund > sale.paid - (sale.refunded || 0)) throw new Error('Refund is more than the customer paid')
}

// sales: {date, total, lines:[{qty,unitCost}]}; payments: {date, amount}; returns: {date, credit, refund, items:[{qty,unitCost,disposition}]}
// Returns reduce revenue in the month they happen. Restocked items return their cost; damaged items keep it (a loss).
export function monthlySummary(sales, payments, month, returns = []) {
  const s = sales.filter((x) => monthOf(x.date) === month)
  const r = returns.filter((x) => monthOf(x.date) === month)
  const credits = r.reduce((a, x) => a + x.credit, 0), refunded = r.reduce((a, x) => a + x.refund, 0)
  const restored = r.reduce((a, x) => a + x.items.filter((i) => i.disposition === 'restock').reduce((c, i) => c + i.qty * i.unitCost, 0), 0)
  const revenue = s.reduce((a, x) => a + x.total, 0) - credits
  const cost = s.reduce((a, x) => a + x.lines.reduce((c, l) => c + l.qty * l.unitCost, 0), 0) - restored
  return {
    returns: credits,
    transactions: s.length,
    unitsSold: s.reduce((a, x) => a + x.lines.reduce((c, l) => c + l.qty, 0), 0),
    revenue, cost, grossProfit: revenue - cost,
    cashReceived: payments.filter((p) => monthOf(p.date) === month).reduce((a, p) => a + p.amount, 0) - refunded,
  }
}
export function csv(rows) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  return '\ufeff' + rows.map((r) => r.map(q).join(',')).join('\r\n')
}
