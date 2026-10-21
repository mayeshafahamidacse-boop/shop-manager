import test from 'node:test'
import assert from 'node:assert/strict'
import { strFromU8, unzipSync } from 'fflate'
import { salesWorkbook } from './salesWorkbook.js'

test('Excel export includes sale items and invoice totals in separate sheets', () => {
  const archive = unzipSync(salesWorkbook([{
    invoiceNo: 'INV-2026-00001',
    date: '2026-10-21',
    customerName: 'Rina & Sons',
    customerPhone: '+880 123456789',
    lines: [
      { name: 'Blue shirt', size: 'M', color: 'Blue', qty: 2, unitPrice: 1500, discount: 100 },
      { name: 'Cap', size: 'One size', color: 'Black', qty: 1, unitPrice: 500, discount: 0 },
    ],
    subtotal: 3400,
    discount: 200,
    total: 3200,
    returned: 500,
    paid: 2000,
    refunded: 0,
    status: 'partial',
  }]))
  const workbook = strFromU8(archive['xl/workbook.xml'])
  const items = strFromU8(archive['xl/worksheets/sheet1.xml'])
  const invoices = strFromU8(archive['xl/worksheets/sheet2.xml'])

  assert.match(workbook, /name="Sale items"/)
  assert.match(workbook, /name="Invoices"/)
  assert.match(items, /INV-2026-00001/)
  assert.match(items, /Rina &amp; Sons/)
  assert.match(items, /\+880 123456789/)
  assert.match(items, /Blue shirt/)
  assert.match(items, /<v>29<\/v>/)
  assert.match(invoices, /<v>34<\/v>/)
  assert.match(invoices, /<v>32<\/v>/)
  assert.match(invoices, /<v>7<\/v>/)
  assert.match(invoices, /partial/)
  assert.match(invoices, /\+880 123456789/)
})

test('Excel export handles no sales with valid worksheet headers', () => {
  const archive = unzipSync(salesWorkbook([]))
  assert.match(strFromU8(archive['xl/worksheets/sheet1.xml']), /Invoice/)
  assert.match(strFromU8(archive['xl/worksheets/sheet2.xml']), /Due \/ credit/)
})
