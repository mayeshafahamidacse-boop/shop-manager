import { openDB } from 'idb'
import { useCallback, useEffect, useState } from 'react'
import { paymentStatus, returnCredits, saleTotals, validateReturn, validateSale } from './lib/calc.js'

export const COLLECTIONS = ['customers', 'products', 'sales', 'payments', 'returns', 'stockMovements', 'refunds']
const USER_COLLECTIONS = new Set(['customers', 'products'])
const DB_NAME = 'shop-manager'
const DB_VERSION = 1

const database = openDB(DB_NAME, DB_VERSION, {
  upgrade(db) {
    const records = db.createObjectStore('records', { keyPath: ['collection', 'id'] })
    records.createIndex('collection', 'collection')
    db.createObjectStore('settings', { keyPath: 'key' })
  },
})

function recordKey(id) {
  if (typeof id !== 'string' || !id) throw new Error('Invalid record id')
  return id
}

async function getRecord(tx, collection, id) {
  return tx.objectStore('records').get([collection, recordKey(id)])
}

function abort(tx) {
  tx.done.catch(() => undefined)
  try {
    tx.abort()
  } catch (error) {
    if (error.name !== 'InvalidStateError') throw error
  }
}

export function useCol(name) {
  const [rows, setRows] = useState(null)
  const [error, setError] = useState('')
  const reload = useCallback(async () => {
    try {
      const db = await database
      const records = await db.getAllFromIndex('records', 'collection', name)
      records.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
      setRows(records)
      setError('')
    } catch (e) {
      setRows(null)
      setError(e.message)
    }
  }, [name])
  useEffect(() => {
    reload()
    window.addEventListener('focus', reload)
    const channel = new BroadcastChannel(`${DB_NAME}-${name}`)
    channel.addEventListener('message', reload)
    return () => {
      window.removeEventListener('focus', reload)
      channel.close()
    }
  }, [reload, name])
  return { rows, error, reload }
}

function notify(collection) {
  const channel = new BroadcastChannel(`${DB_NAME}-${collection}`)
  channel.postMessage('changed')
  channel.close()
}

export async function add(collection, data) {
  if (!USER_COLLECTIONS.has(collection)) throw new Error('Unknown collection')
  const db = await database
  const row = { ...data, collection, id: crypto.randomUUID(), createdAt: new Date().toISOString() }
  await db.add('records', row)
  notify(collection)
  return row
}

export async function save(collection, id, data) {
  if (!USER_COLLECTIONS.has(collection)) throw new Error('Unknown collection')
  const db = await database
  const tx = db.transaction('records', 'readwrite')
  const store = tx.objectStore('records')
  const current = await store.get([collection, recordKey(id)])
  if (!current) {
    abort(tx)
    throw new Error('Record not found')
  }
  const row = {
    ...current, ...data, collection, id,
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  }
  await store.put(row)
  await tx.done
  notify(collection)
  return row
}

export async function remove(collection, id) {
  if (!USER_COLLECTIONS.has(collection)) throw new Error('Unknown collection')
  const db = await database
  const tx = db.transaction('records', 'readwrite')
  await tx.objectStore('records').delete([collection, recordKey(id)])
  await tx.done
  notify(collection)
}

export async function createSale({ saleId, customer, lines, discount, payment, date }) {
  const db = await database
  const tx = db.transaction(['records', 'settings'], 'readwrite')
  try {
    const sales = tx.objectStore('records')
    if (await sales.get(['sales', recordKey(saleId)])) {
      await tx.done
      return saleId
    }
    if (!Array.isArray(lines)) throw new Error('Invalid sale lines')
    const products = new Map()
    for (const line of lines) {
      if (line.productId && !products.has(line.productId)) {
        const product = await getRecord(tx, 'products', line.productId)
        if (!product) throw new Error('Product no longer exists')
        products.set(line.productId, product)
      }
    }
    const stock = Object.fromEntries([...products].map(([id, product]) => [id, product.quantity]))
    validateSale(lines, stock, discount)
    const settings = tx.objectStore('settings')
    const counter = ((await settings.get('invoice_counter'))?.value || 0) + 1
    const invoiceNo = `INV-${date.slice(0, 4)}-${String(counter).padStart(5, '0')}`
    const snapLines = lines.map((line) => {
      const product = products.get(line.productId)
      return {
        ...line, name: product?.name || line.name, size: product?.size || line.size || '', color: product?.color || line.color || '',
        photo: line.photo === undefined ? product?.photo || null : line.photo, unitCost: product?.cost ?? line.unitCost ?? 0,
      }
    })
    const totals = saleTotals(snapLines, discount)
    const paid = payment?.amount || 0
    const sale = {
      collection: 'sales', id: saleId, invoiceNo, date,
      customerId: customer?.id || null, customerName: customer?.name || 'Walk-in',
      customerPhone: customer?.phone || '',
      lines: snapLines, ...totals, paid, status: paymentStatus(totals.total, paid),
      createdAt: new Date().toISOString(),
    }
    await settings.put({ key: 'invoice_counter', value: counter })
    await sales.put(sale)
    const quantities = new Map()
    lines.forEach((line) => {
      if (line.productId) quantities.set(line.productId, (quantities.get(line.productId) || 0) + line.qty)
    })
    for (const [id, quantity] of quantities) {
      const product = products.get(id)
      await sales.put({ ...product, quantity: product.quantity - quantity, updatedAt: new Date().toISOString() })
      await sales.put({
        collection: 'stockMovements', id: `${saleId}_${id}`, productId: id,
        change: -quantity, reason: 'sale', ref: invoiceNo, date, createdAt: new Date().toISOString(),
      })
    }
    if (paid > 0) {
      await sales.put({
        collection: 'payments', id: `${saleId}_p0`, saleId, invoiceNo,
        customerId: customer?.id || null, amount: paid, method: payment.method,
        date, createdAt: new Date().toISOString(),
      })
    }
    await tx.done
    for (const collection of ['sales', 'products', 'payments', 'stockMovements']) notify(collection)
    return saleId
  } catch (error) {
    abort(tx)
    throw error
  }
}

export async function addPayment({ sale, amount, method, date }) {
  const db = await database
  const tx = db.transaction('records', 'readwrite')
  try {
    const store = tx.objectStore('records')
    const current = await store.get(['sales', recordKey(sale?.id)])
    if (!current) throw new Error('Invoice not found')
    const paid = current.paid + amount
    await store.put({
      ...current, paid, status: paymentStatus(current.total - (current.returned || 0), paid - (current.refunded || 0)),
    })
    await store.put({
      collection: 'payments', id: crypto.randomUUID(), saleId: sale.id, invoiceNo: current.invoiceNo,
      customerId: current.customerId, amount, method, date, createdAt: new Date().toISOString(),
    })
    await tx.done
    notify('sales')
    notify('payments')
  } catch (error) {
    abort(tx)
    throw error
  }
}

export async function createReturn({ returnId, saleId, items, refund, method, reason, date }) {
  const db = await database
  const tx = db.transaction('records', 'readwrite')
  try {
    const store = tx.objectStore('records')
    if (await store.get(['returns', recordKey(returnId)])) {
      await tx.done
      return returnId
    }
    const sale = await store.get(['sales', recordKey(saleId)])
    if (!sale) throw new Error('Invoice not found')
    validateReturn(sale, items, refund)
    const productIds = [...new Set(items.map((item) => sale.lines[item.lineIndex].productId))]
    const products = new Map()
    for (const id of productIds) products.set(id, await store.get(['products', id]) || null)
    items.forEach((item) => {
      if (item.disposition === 'restock' && !products.get(sale.lines[item.lineIndex].productId)) {
        throw new Error('Product no longer exists, mark as damaged instead')
      }
    })
    const credits = returnCredits(sale, items)
    const credit = credits.reduce((sum, value) => sum + value, 0)
    const returnedQty = sale.lines.map((_, index) => (sale.returnedQty || [])[index] || 0)
    items.forEach((item) => { returnedQty[item.lineIndex] += item.qty })
    const returned = (sale.returned || 0) + credit
    const refunded = (sale.refunded || 0) + refund
    const rows = items.map((item, index) => {
      const line = sale.lines[item.lineIndex]
      return {
        lineIndex: item.lineIndex, productId: line.productId, name: line.name, qty: item.qty,
        disposition: item.disposition, credit: credits[index], unitCost: line.unitCost,
      }
    })
    await store.put({
      collection: 'returns', id: returnId, saleId, invoiceNo: sale.invoiceNo,
      customerId: sale.customerId, customerName: sale.customerName,
      items: rows, credit, refund, method, reason, date, createdAt: new Date().toISOString(),
    })
    await store.put({
      ...sale, returnedQty, returned, refunded,
      status: paymentStatus(sale.total - returned, sale.paid - refunded),
    })
    const movements = new Map()
    rows.forEach((row) => {
      const quantities = movements.get(row.productId) || { restock: 0, damaged: 0 }
      quantities[row.disposition] += row.qty
      movements.set(row.productId, quantities)
    })
    for (const [id, quantities] of movements) {
      const product = products.get(id)
      if (!product) continue
      await store.put({
        ...product, quantity: product.quantity + quantities.restock,
        damaged: (product.damaged || 0) + quantities.damaged, updatedAt: new Date().toISOString(),
      })
      if (quantities.restock) {
        await store.put({
          collection: 'stockMovements', id: `${returnId}_${id}_r`, productId: id,
          change: quantities.restock, reason: 'return-restock', ref: sale.invoiceNo,
          date, createdAt: new Date().toISOString(),
        })
      }
      if (quantities.damaged) {
        await store.put({
          collection: 'stockMovements', id: `${returnId}_${id}_d`, productId: id, change: 0,
          damaged: quantities.damaged, reason: 'return-damaged', ref: sale.invoiceNo,
          date, createdAt: new Date().toISOString(),
        })
      }
    }
    if (refund > 0) {
      await store.put({
        collection: 'refunds', id: returnId, returnId, saleId,
        invoiceNo: sale.invoiceNo, amount: refund, method, date, createdAt: new Date().toISOString(),
      })
    }
    await tx.done
    for (const collection of ['sales', 'products', 'returns', 'stockMovements', 'refunds']) notify(collection)
    return returnId
  } catch (error) {
    abort(tx)
    throw error
  }
}

export async function getBackup() {
  const db = await database
  const tx = db.transaction(['records', 'settings'], 'readonly')
  const records = await tx.objectStore('records').getAll()
  const counter = (await tx.objectStore('settings').get('invoice_counter'))?.value || 0
  await tx.done
  const collections = Object.fromEntries(COLLECTIONS.map((collection) => [
    collection,
    records.filter((record) => record.collection === collection)
      .map(({ collection: _collection, ...record }) => record)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))),
  ]))
  return { format: 'shop-manager-backup', version: 1, generatedAt: new Date().toISOString(), invoiceCounter: counter, collections }
}

export async function restoreBackup(backup) {
  if (!backup || backup.format !== 'shop-manager-backup' ||
      ![1, 2].includes(backup.version) || !backup.collections ||
      typeof backup.collections !== 'object' || Array.isArray(backup.collections)) {
    throw new Error('This is not a supported Shop Manager backup')
  }
  const records = []
  for (const collection of COLLECTIONS) {
    const rows = backup.collections[collection]
    if (!Array.isArray(rows)) throw new Error(`Backup is missing the ${collection} collection`)
    for (const record of rows) {
      if (!record || typeof record.id !== 'string' || !record.id || Array.isArray(record)) {
        throw new Error(`Invalid record in ${collection}`)
      }
      records.push({ ...record, collection })
    }
  }
  const counter = backup.invoiceCounter || 0
  if (!Number.isSafeInteger(counter) || counter < 0) throw new Error('Invalid invoice counter')
  const db = await database
  const tx = db.transaction(['records', 'settings'], 'readwrite')
  const store = tx.objectStore('records')
  await store.clear()
  for (const record of records) await store.put(record)
  await tx.objectStore('settings').put({ key: 'invoice_counter', value: counter })
  await tx.done
  COLLECTIONS.forEach(notify)
}
