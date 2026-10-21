import test from 'node:test'
import assert from 'node:assert/strict'
import 'fake-indexeddb/auto'

const database = await import('../db.js')
const photo = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0xff, 0xd9]).toString('base64')}`
const salePhoto = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0x02, 0x03, 0xff, 0xd9]).toString('base64')}`

test('browser database records sales, keeps photo snapshots, and restores backups', async () => {
  const product = await database.add('products', {
    name: 'Blue shirt', size: 'M', color: 'Blue', cost: 2500,
    price: 5000, quantity: 2, lowStock: 1, photo,
  })
  const customer = await database.add('customers', { name: 'Rina', phone: '1234567' })

  await database.createSale({
    saleId: 'browser-sale-1', date: '2026-10-21',
    customer, discount: 0,
    lines: [{ productId: product.id, qty: 1, unitPrice: product.price, discount: 0, photo: salePhoto }],
    payment: { amount: 5000, method: 'Cash' },
  })
  await database.createSale({
    saleId: 'browser-sale-1', date: '2026-10-21', discount: 0,
    lines: [{ productId: product.id, qty: 1, unitPrice: product.price, discount: 0 }],
    payment: { amount: 5000, method: 'Cash' },
  })

  const backup = await database.getBackup()
  assert.equal(backup.collections.products.length, 1)
  assert.equal(backup.collections.products[0].quantity, 1)
  assert.equal(backup.collections.sales.length, 1)
  assert.equal(backup.collections.sales[0].customerName, 'Rina')
  assert.equal(backup.collections.sales[0].customerPhone, '1234567')
  assert.equal(backup.collections.sales[0].lines[0].photo, salePhoto)
  assert.equal(backup.collections.payments.length, 1)
  assert.equal(backup.invoiceCounter, 1)

  await assert.rejects(() => database.createSale({
    saleId: 'browser-sale-failed', date: '2026-10-21', discount: 0,
    lines: [{ productId: product.id, qty: 2, unitPrice: product.price, discount: 0 }],
    payment: { amount: 0 },
  }), /stock/)
  assert.equal((await database.getBackup()).collections.products[0].quantity, 1)

  await database.restoreBackup(backup)
  const restored = await database.getBackup()
  assert.equal(restored.collections.sales[0].invoiceNo, 'INV-2026-00001')
  assert.equal(restored.collections.sales[0].lines[0].photo, salePhoto)
})

test('manual sale items save their name and photo without changing product stock', async () => {
  const before = (await database.getBackup()).collections.products[0].quantity
  await database.createSale({
    saleId: 'browser-manual-sale', date: '2026-10-21', discount: 0,
    lines: [{
      productId: null, name: 'Handmade scarf', qty: 1, unitPrice: 3200,
      unitCost: 0, discount: 0, photo: salePhoto,
    }],
    payment: { amount: 3200, method: 'Cash' },
  })

  const backup = await database.getBackup()
  const sale = backup.collections.sales.find((record) => record.id === 'browser-manual-sale')
  assert.equal(sale.lines[0].name, 'Handmade scarf')
  assert.equal(sale.lines[0].photo, salePhoto)
  assert.equal(backup.collections.products[0].quantity, before)
})
