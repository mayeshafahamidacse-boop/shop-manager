import test from 'node:test'
import assert from 'node:assert/strict'
import * as c from './calc.js'

const lines = [
  { productId: 'a', qty: 2, unitPrice: 50000, unitCost: 30000, discount: 5000 },
  { productId: 'b', qty: 1, unitPrice: 120000, unitCost: 70000, discount: 0 },
]
test('money conversion avoids float drift', () => {
  assert.equal(c.toMinor('19.99'), 1999); assert.equal(c.toMinor(0.1 + 0.2), 30)
})
test('totals with line + sale discount', () => {
  assert.deepEqual(c.saleTotals(lines, 10000), { subtotal: 215000, discount: 10000, total: 205000 })
})
test('payment status', () => {
  assert.equal(c.paymentStatus(1000, 0), 'unpaid'); assert.equal(c.paymentStatus(1000, 400), 'partial')
  assert.equal(c.paymentStatus(1000, 1000), 'paid'); assert.equal(c.paymentStatus(1000, 1200), 'overpaid')
  assert.equal(c.balance(1000, 400), 600); assert.equal(c.balance(1000, 1200), -200)
})
test('validation', () => {
  assert.throws(() => c.validateSale([], {}))
  assert.throws(() => c.validateSale(lines, { a: 1, b: 5 }), /stock/)
  assert.throws(() => c.validateSale([{ ...lines[0], qty: 1.5 }], { a: 9 }))
  assert.throws(() => c.validateSale(lines, { a: 9, b: 9 }, 999999))
  assert.doesNotThrow(() => c.validateSale(lines, { a: 2, b: 1 }, 10000))
  // same product on two lines is summed against stock
  assert.throws(() => c.validateSale([lines[0], lines[0]], { a: 3 }), /stock/)
})
test('monthly summary: unpaid sale is revenue but not cash', () => {
  const sales = [
    { date: '2026-10-03', total: 205000, lines },
    { date: '2026-09-30', total: 99999, lines },
  ]
  const pay = [{ date: '2026-10-03', amount: 50000 }, { date: '2026-11-01', amount: 7 }]
  const s = c.monthlySummary(sales, pay, '2026-10')
  assert.deepEqual(s, { returns: 0, transactions: 1, unitsSold: 3, revenue: 205000, cost: 130000, grossProfit: 75000, cashReceived: 50000 })
})
test('csv escapes quotes', () => assert.ok(c.csv([['a"b', 1]]).includes('"a""b","1"')))

const sale = { lines, subtotal: 215000, total: 205000, paid: 205000, refunded: 0, returnedQty: [] }
test('return credit pro-rates line + sale discount, partial returns sum exactly', () => {
  const a = c.returnCredits(sale, [{ lineIndex: 0, qty: 1 }])[0]
  const b = c.returnCredits({ ...sale, returnedQty: [1] }, [{ lineIndex: 0, qty: 1 }])[0]
  assert.equal(a, 45291); assert.equal(b, 45290)
  assert.equal(a + b, c.returnCredits(sale, [{ lineIndex: 0, qty: 2 }])[0]) // 90581
  const all = c.returnCredits(sale, [{ lineIndex: 0, qty: 2 }, { lineIndex: 1, qty: 1 }])
  assert.equal(all[0] + all[1], 205000 - 0) // full return refunds exactly the invoice total
})
test('return validation', () => {
  const ok = [{ lineIndex: 0, qty: 1, disposition: 'restock' }]
  assert.doesNotThrow(() => c.validateReturn(sale, ok, 1000))
  assert.throws(() => c.validateReturn(sale, [{ ...ok[0], qty: 3 }], 0), /more than/)
  assert.throws(() => c.validateReturn({ ...sale, returnedQty: [2] }, ok, 0), /more than/)
  assert.throws(() => c.validateReturn(sale, ok, 205001), /more than the customer paid/)
  assert.throws(() => c.validateReturn(sale, [{ ...ok[0], disposition: 'x' }], 0))
  assert.throws(() => c.validateReturn(sale, [ok[0], ok[0], ok[0]], 0), /more than/)
})
test('netDue after return + refund; unpaid invoice return just lowers balance', () => {
  assert.equal(c.netDue({ total: 1000, paid: 0 }), 1000)
  assert.equal(c.netDue({ total: 1000, paid: 0, returned: 400 }), 600)
  assert.equal(c.netDue({ total: 1000, paid: 1000, returned: 400, refunded: 400 }), 0)
  assert.equal(c.netDue({ total: 1000, paid: 1000, returned: 400, refunded: 0 }), -400) // store credit
})
test('monthly summary with returns', () => {
  const ret = [{ date: '2026-10-05', credit: 45291, refund: 45291, items: [{ qty: 1, unitCost: 30000, disposition: 'restock' }] },
    { date: '2026-10-06', credit: 100, refund: 0, items: [{ qty: 1, unitCost: 500, disposition: 'damaged' }] }]
  const s = c.monthlySummary([{ date: '2026-10-03', total: 205000, lines }], [{ date: '2026-10-03', amount: 205000 }], '2026-10', ret)
  assert.equal(s.revenue, 205000 - 45391); assert.equal(s.cost, 130000 - 30000) // damaged cost stays
  assert.equal(s.cashReceived, 205000 - 45291); assert.equal(s.returns, 45391)
})
