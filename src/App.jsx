import { useState } from 'react'
import { useCol, add, save, remove, createSale, addPayment, createReturn, getBackup, restoreBackup } from './db'
import { Btn, Field, Modal, Table, Search, useToast } from './ui'
import { toMinor, fromMinor as f, returnCredits, saleTotals, monthlySummary, monthOf, csv, balance, netDue } from './lib/calc'
import { salesWorkbook } from './lib/salesWorkbook'

const today = () => new Date().toISOString().slice(0, 10)
const METHODS = ['Cash', 'bKash', 'Nagad', 'Bank transfer', 'Other']
const download = (name, text, type = 'text/csv') => { const a = document.createElement('a'), url = URL.createObjectURL(new Blob([text], { type })); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
const MAX_PHOTO_BYTES = 1024 * 1024

async function resizePhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 15 * 1024 * 1024) throw new Error('Choose a photo smaller than 15 MB.')
  const image = await createImageBitmap(file)
  try {
    let scale = Math.min(1, 1280 / Math.max(image.width, image.height))
    while (scale >= 0.25) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(image.width * scale))
      canvas.height = Math.max(1, Math.round(image.height * scale))
      canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.82, 0.7, 0.58]) {
        const photo = canvas.toDataURL('image/jpeg', quality)
        if (Math.ceil((photo.length - photo.indexOf(',') - 1) * 3 / 4) <= MAX_PHOTO_BYTES) return photo
      }
      scale *= 0.75
    }
    throw new Error('Could not shrink this photo enough. Try a smaller image.')
  } finally {
    image.close()
  }
}

function Photo({ src, alt, className = '' }) {
  return src ? <img className={`photo ${className}`} src={src} alt={alt} loading="lazy" /> : <span className={`photo-placeholder ${className}`} aria-label="No photo">No photo</span>
}

function PhotoUpload({ onChange, disabled = false, hasPhoto = false, subject = 'product' }) {
  return <div className={`photo-upload${disabled ? ' disabled' : ''}`}>
    <span>{hasPhoto ? `Change ${subject} photo` : `Add ${subject} photo`}</span>
    <input aria-label={`${hasPhoto ? 'Change' : 'Add'} ${subject} photo`} type="file" accept="image/*" capture="environment" onChange={onChange} disabled={disabled} />
  </div>
}

function Dashboard({ sales, payments, customers, returns }) {
  const m = monthOf(today()), s = monthlySummary(sales, payments, m, returns)
  const total = sales.reduce((a, x) => a + x.total, 0) - returns.reduce((a, x) => a + x.credit, 0), units = sales.reduce((a, x) => a + x.lines.reduce((c, l) => c + l.qty, 0), 0) - returns.reduce((a, x) => a + x.items.reduce((c, i) => c + i.qty, 0), 0)
  const byMonth = {}; sales.forEach((x) => { byMonth[monthOf(x.date)] = (byMonth[monthOf(x.date)] || 0) + x.total })
  const keys = Object.keys(byMonth).sort().slice(-6), max = Math.max(1, ...keys.map((k) => byMonth[k]))
  return <>
    <div className="stats">{[['Net sales', f(total)], ['Customers', customers.length], ['Products sold', units], [`${m} sales`, f(s.revenue)]].map(([l, v]) =>
      <div key={l} className="stat"><span>{l}</span><strong>{v}</strong></div>)}</div>
    <h2>Sales by month</h2>
    <svg className="chart" viewBox="0 0 300 100" role="img" aria-label="Monthly sales">{keys.map((k, i) => { const h = (byMonth[k] / max) * 80
      return <g key={k}><rect x={i * 50 + 10} y={85 - h} width="30" height={h} /><text x={i * 50 + 25} y="97" textAnchor="middle">{k.slice(2)}</text></g> })}</svg>
    <h2>Recent transactions</h2>
    <Table cols={[{ h: 'Invoice', r: (r) => r.invoiceNo }, { h: 'Date', r: (r) => r.date }, { h: 'Customer', r: (r) => r.customerName }, { h: 'Total', n: 1, r: (r) => f(r.total) }]} rows={sales.slice(0, 6)} />
  </>
}

function Customers({ customers, sales, payments, toast }) {
  const [q, setQ] = useState(''), [edit, setEdit] = useState(null), [view, setView] = useState(null)
  const rows = customers.filter((c) => (c.name + c.phone).toLowerCase().includes(q.toLowerCase()))
  const submit = async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target))
    if (!d.name.trim() || !/^[+\d][\d\s-]{6,}$/.test(d.phone)) return toast('Enter a name and a valid phone number.', 1)
    try { edit.id ? await save('customers', edit.id, d) : await add('customers', d); toast('Customer saved.'); setEdit(null) } catch (e) { toast(e.message, 1) } }
  const del = async (c) => { if (sales.some((s) => s.customerId === c.id)) return toast('Customer has invoices and cannot be deleted.', 1)
    if (confirm(`Delete ${c.name}?`)) { await remove('customers', c.id); toast('Customer deleted.') } }
  const bal = (c) => sales.filter((s) => s.customerId === c.id).reduce((a, s) => a + netDue(s), 0)
  return <>
    <div className="bar"><Search placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} /><Btn kind="primary" onClick={() => setEdit({})}>Add customer</Btn></div>
    <Table cols={[{ h: 'Name', r: (c) => c.name }, { h: 'Phone', r: (c) => c.phone }, { h: 'Balance due', n: 1, r: (c) => f(bal(c)) },
      { h: '', r: (c) => <span className="acts"><Btn kind="ghost" onClick={() => setView(c)}>Statement</Btn><Btn kind="ghost" onClick={() => setEdit(c)}>Edit</Btn><Btn kind="ghost" onClick={() => del(c)}>Delete</Btn></span> }]} rows={rows} />
    {edit && <Modal title={edit.id ? 'Edit customer' : 'Add customer'} onClose={() => setEdit(null)}><form onSubmit={submit}>
      <Field label="Name" name="name" defaultValue={edit.name} required /><Field label="Phone" name="phone" defaultValue={edit.phone} required /><Btn kind="primary">Save</Btn></form></Modal>}
    {view && <Modal title={`${view.name} · statement`} onClose={() => setView(null)}>
      <Table cols={[{ h: 'Date', r: (r) => r.date }, { h: 'Invoice', r: (r) => r.invoiceNo }, { h: 'Total', n: 1, r: (r) => f(r.total) }, { h: 'Paid', n: 1, r: (r) => f(r.paid) }, { h: 'Due', n: 1, r: (r) => f(netDue(r)) }]}
        rows={sales.filter((s) => s.customerId === view.id)} empty="No purchases yet." />
      <h4>Payments</h4><Table cols={[{ h: 'Date', r: (r) => r.date }, { h: 'Method', r: (r) => r.method }, { h: 'Amount', n: 1, r: (r) => f(r.amount) }]} rows={payments.filter((p) => p.customerId === view.id)} empty="No payments yet." /></Modal>}
  </>
}

function Products({ products, toast }) {
  const [q, setQ] = useState(''), [edit, setEdit] = useState(null), [photo, setPhoto] = useState(null), [photoBusy, setPhotoBusy] = useState(false)
  const rows = products.filter((p) => `${p.name}${p.category}${p.color}`.toLowerCase().includes(q.toLowerCase()))
  const submit = async (ev) => { ev.preventDefault(); const d = Object.fromEntries(new FormData(ev.target))
    const data = { name: d.name.trim(), category: d.category, size: d.size, color: d.color, cost: toMinor(d.cost), price: toMinor(d.price), quantity: parseInt(d.quantity, 10), lowStock: parseInt(d.lowStock, 10), photo }
    if (!data.name || !(data.cost >= 0) || !(data.price >= 0) || !(data.quantity >= 0)) return toast('Check name, prices and quantity.', 1)
    try { edit.id ? await save('products', edit.id, data) : await add('products', data); toast('Product saved.'); setEdit(null) } catch (e) { toast(e.message, 1) } }
  const v = (k) => edit && (['cost', 'price'].includes(k) && edit[k] != null ? f(edit[k]) : edit[k])
  const openEdit = (product) => { setPhoto(product.photo || null); setEdit(product) }
  const selectPhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    try { setPhoto(await resizePhoto(file)) } catch (e) { toast(e.message, 1) } finally { setPhotoBusy(false) }
  }
  return <>
    <div className="bar product-toolbar"><Search placeholder="Find your next favorite…" value={q} onChange={(e) => setQ(e.target.value)} /><Btn kind="primary" onClick={() => { setPhoto(null); setEdit({ lowStock: 3 }) }}>＋ Add a piece</Btn></div>
    {rows.length ? <div className="product-grid">{rows.map((p) => <article className="product-card" key={p.id}>
      <div className="product-image-wrap">
        <Photo src={p.photo} alt={p.name} className="pin-photo" />
        <span className={`stock-chip ${p.quantity <= p.lowStock ? 'stock-low' : ''}`}>{p.quantity <= p.lowStock ? 'LOW STOCK' : `${p.quantity} IN STOCK`}</span>
      </div>
      <div className="product-card-info">
        <span className="product-category">{p.category || 'SHOP FAVORITE'}</span>
        <h3>{p.name}</h3>
        <p className="product-variant">{[p.size, p.color].filter(Boolean).join(' · ') || 'One of a kind'}</p>
        <div className="product-card-bottom"><strong>{f(p.price)}</strong><span className="product-cost">Cost {f(p.cost)}</span></div>
        <div className="product-card-actions">
          <Btn kind="ghost" onClick={() => openEdit(p)}>Edit piece</Btn>
          <Btn kind="ghost" onClick={async () => { if (confirm(`Delete ${p.name}?`)) { try { await remove('products', p.id); toast('Product deleted.') } catch (e) { toast(e.message, 1) } } }}>Remove</Btn>
        </div>
      </div>
    </article>)}</div> : <div className="product-empty"><span>✳</span><h3>{q ? 'No pieces found' : 'Your outfit board starts here'}</h3>
      <p>{q ? 'Try searching for a different name or color.' : 'Add a product and its photo to build your visual collection.'}</p>
      {!q && <Btn kind="primary" onClick={() => { setPhoto(null); setEdit({ lowStock: 3 }) }}>＋ Add your first piece</Btn>}
    </div>}
    {edit && <Modal title={edit.id ? 'Edit product' : 'Add product'} onClose={() => setEdit(null)}><form onSubmit={submit} className="grid">
      {[['name', 'Product name', true], ['category', 'Category'], ['size', 'Size'], ['color', 'Color']].map(([k, l, required]) =>
        <Field key={k} label={l} name={k} type="text" placeholder={`Enter ${l.toLowerCase()}`} defaultValue={v(k)} required={Boolean(required)} />)}
      {[['cost', 'Purchase cost'], ['price', 'Selling price']].map(([k, l]) => <Field key={k} label={l} name={k} type="number" min="0" step="0.01" defaultValue={v(k)} required />)}
      <Field label="Quantity" name="quantity" type="number" min="0" step="1" defaultValue={v('quantity')} required /><Field label="Low-stock at" name="lowStock" type="number" min="0" step="1" defaultValue={v('lowStock')} required />
      <div className="field photo-field"><span>Product photo (optional)</span><PhotoUpload onChange={selectPhoto} disabled={photoBusy} hasPhoto={Boolean(photo)} />
        <small>{photoBusy ? 'Preparing photo…' : photo ? 'Photo ready. It will be saved with this product.' : 'Choose a photo from your device or take one with your camera.'}</small></div>
      {photo && <div className="photo-preview"><Photo src={photo} alt="Product preview" className="photo-large" /><Btn kind="ghost" type="button" onClick={() => setPhoto(null)}>Remove photo</Btn></div>}
      <Btn kind="primary" disabled={photoBusy}>{photoBusy ? 'Preparing photo…' : 'Save'}</Btn></form></Modal>}
  </>
}

function NewSale({ customers, products, toast }) {
  const [saleId, setSaleId] = useState(() => crypto.randomUUID()), [date, setDate] = useState(today()), [cust, setCust] = useState('')
  const [lines, setLines] = useState([]), [disc, setDisc] = useState('0'), [paid, setPaid] = useState('0'), [method, setMethod] = useState('Cash'), [busy, setBusy] = useState(false)
  const [productName, setProductName] = useState(''), [unitPrice, setUnitPrice] = useState(''), [qty, setQty] = useState('1'), [photo, setPhoto] = useState(null), [photoBusy, setPhotoBusy] = useState(false)
  const L = lines.map((l) => ({ ...l, qty: l.qty })), t = saleTotals(L, toMinor(disc || 0))
  const productLabel = (product) => `${product.name} · ${product.size || 'One size'}/${product.color || 'No color'}`
  const selectedProduct = products.find((product) => productLabel(product) === productName)
  const addLine = () => {
    const name = productName.trim(), quantity = Number(qty), price = toMinor(unitPrice)
    if (!name || !Number.isInteger(quantity) || quantity < 1 || !(price >= 0)) return toast('Enter a product name, valid quantity, and price.', 1)
    const linked = selectedProduct || null
    const alreadyInSale = lines.filter((line) => line.productId === linked?.id).reduce((sum, line) => sum + line.qty, 0)
    if (linked && alreadyInSale + quantity > linked.quantity) return toast('Quantity is more than available stock.', 1)
    setLines([...lines, {
      productId: linked?.id || null, name: linked ? `${linked.name} ${linked.size}/${linked.color}` : name,
      size: linked?.size || '', color: linked?.color || '', unitCost: linked?.cost || 0,
      photo: photo || linked?.photo || null, qty: quantity, unitPrice: price, discount: 0,
    }])
    setProductName(''); setUnitPrice(''); setQty('1'); setPhoto(null)
  }
  const selectProductPhoto = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setPhotoBusy(true)
    try { setPhoto(await resizePhoto(file)) } catch (e) { toast(e.message, 1) } finally { setPhotoBusy(false) }
  }
  const selectedCustomer = customers.find((c) => c.id === cust)
  const submit = async () => { setBusy(true); try {
    await createSale({ saleId, date, customer: selectedCustomer, lines: L, discount: toMinor(disc || 0), payment: { amount: toMinor(paid || 0), method } })
    toast('Sale recorded.')
    setSaleId(crypto.randomUUID()); setDate(today()); setCust(''); setLines([]); setDisc('0'); setPaid('0'); setProductName(''); setUnitPrice(''); setQty('1'); setPhoto(null)
  } catch (e) { toast(e.message, 1) } setBusy(false) }
  return <section className="sale-entry">
    <div className="sale-entry-heading"><div><span className="sale-customer-label">SALES</span><h2>Record a sale</h2></div></div>
    <div className="grid">
    <Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
    <Field label="Customer" value={cust} onChange={(e) => setCust(e.target.value)} options={[{ v: '', t: 'Walk-in (no customer)' }, ...customers.map((c) => ({ v: c.id, t: `${c.name} · ${c.phone}` }))]} /></div>
    {selectedCustomer && <div className="sale-customer"><span className="sale-customer-label">SOLD TO</span><strong>{selectedCustomer.name}</strong><span>{selectedCustomer.phone}</span></div>}
    <div className="grid sale-product-fields">
      <Field label="Product name" type="text" placeholder="Type product name" value={productName} onChange={(e) => {
        const value = e.target.value, matched = products.find((product) => productLabel(product) === value)
        const previousMatch = products.find((product) => productLabel(product) === productName)
        setProductName(value)
        if (matched) { setUnitPrice(f(matched.price)); setPhoto(matched.photo || null) }
        else if (previousMatch) { setUnitPrice(''); setPhoto(null) }
      }} list="sale-product-suggestions" />
      <datalist id="sale-product-suggestions">{products.filter((product) => product.quantity > 0).map((product) => <option key={product.id} value={productLabel(product)} />)}</datalist>
      <Field label="Qty" type="number" min="1" step="1" value={qty} onChange={(e) => setQty(e.target.value)} />
      <Field label="Unit price" type="number" min="0" step="0.01" placeholder="0.00" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} />
    </div>
    <small className="sale-product-hint">{selectedProduct ? `${selectedProduct.quantity} in stock; stock will update when saved.` : 'Type any product name and price. Choose a catalog suggestion to track stock.'}</small>
    <div className="field photo-field"><span>Product photo (optional)</span><PhotoUpload onChange={selectProductPhoto} disabled={photoBusy} hasPhoto={Boolean(photo)} subject="product" />
      <small>{photoBusy ? 'Preparing photo…' : photo ? 'Photo ready. It will be saved with this sale.' : 'Choose a photo from your device or take one with your camera.'}</small>
      {photo && <div className="photo-preview"><Photo src={photo} alt={`${productName || 'Product'} preview`} className="photo-large" /><Btn kind="ghost" type="button" onClick={() => setPhoto(null)}>Remove photo</Btn></div>}</div>
    <Btn onClick={addLine} disabled={!productName.trim() || unitPrice === '' || photoBusy}>Add to sale</Btn>
    {lines.map((l, i) => <div className="line" key={i}><span className="sale-line-item"><Photo src={l.photo} alt={l.name} />{l.name} × {l.qty}</span><span>{f(l.qty * l.unitPrice)}</span><Btn kind="ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>Remove</Btn></div>)}
    <div className="grid"><Field label="Discount" type="number" min="0" step="0.01" value={disc} onChange={(e) => setDisc(e.target.value)} />
      <Field label="Paid now" type="number" min="0" step="0.01" value={paid} onChange={(e) => setPaid(e.target.value)} />
      <Field label="Method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS.map((m) => ({ v: m, t: m }))} /></div>
    <p className="total">Total {f(t.total)} · Due {f(Math.max(0, balance(t.total, toMinor(paid || 0))))}</p>
    <Btn kind="primary" disabled={busy || photoBusy || !lines.length} onClick={submit}>{busy ? 'Saving sale…' : 'Save sale'}</Btn>
  </section>
}

function ReturnModal({ sale, onClose, toast }) {
  const [returnId] = useState(() => crypto.randomUUID()), [date, setDate] = useState(today()), [busy, setBusy] = useState(false)
  const [qty, setQty] = useState({}), [disp, setDisp] = useState({}), [refund, setRefund] = useState('0'), [method, setMethod] = useState('Cash'), [reason, setReason] = useState('')
  const left = (i) => sale.lines[i].qty - ((sale.returnedQty || [])[i] || 0)
  const items = Object.entries(qty).filter(([, q]) => Number(q) > 0).map(([i, q]) => ({ lineIndex: +i, qty: Number(q), disposition: disp[i] || 'restock' }))
  const credit = items.length ? returnCredits(sale, items).reduce((a, b) => a + b, 0) : 0
  const maxRefund = sale.paid - (sale.refunded || 0)
  const submit = async () => { setBusy(true); try { await createReturn({ returnId, saleId: sale.id, items, refund: toMinor(refund || 0), method, reason, date }); toast('Return recorded.'); onClose() } catch (e) { toast(e.message, 1) } setBusy(false) }
  return <Modal title={`Return · ${sale.invoiceNo}`} onClose={onClose}>
    {sale.lines.map((l, i) => <div className="grid" key={i}><span>{l.name} {l.size}/{l.color}<br /><small className="muted">{left(i)} of {l.qty} returnable</small></span>
      <Field label="Return qty" type="number" min="0" max={left(i)} step="1" disabled={!left(i)} value={qty[i] ?? ''} onChange={(e) => setQty({ ...qty, [i]: e.target.value })} />
      <Field label="Condition" value={disp[i] || 'restock'} onChange={(e) => setDisp({ ...disp, [i]: e.target.value })} options={[{ v: 'restock', t: 'Resellable (restock)' }, { v: 'damaged', t: 'Damaged' }]} /></div>)}
    <div className="grid"><Field label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <Field label={`Refund now (max ${f(maxRefund)})`} type="number" min="0" step="0.01" value={refund} onChange={(e) => setRefund(e.target.value)} />
      <Field label="Method" value={method} onChange={(e) => setMethod(e.target.value)} options={METHODS.map((m) => ({ v: m, t: m }))} /></div>
    <Field label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
    <p className="total">Return credit {f(credit)}</p>
    <Btn kind="primary" disabled={busy || !items.length} onClick={submit}>Record return</Btn></Modal>
}

function SalesRecordDetails({ sale }) {
  return <div className="sales-record-details">
    <div className="sales-customer"><strong>{sale.customerName || 'Walk-in'}</strong>{sale.customerPhone && <small>{sale.customerPhone}</small>}</div>
    <div className="sales-products">{sale.lines.map((line, index) => (
      <span className="sales-product" key={index}>
        <Photo src={line.photo} alt={line.name} />
        <span><strong>{line.name}</strong><small>{line.size}/{line.color} · Qty {line.qty}</small></span>
      </span>
    ))}</div>
  </div>
}

function Sales({ sales, customers, products, returns, toast }) {
  const [ret, setRet] = useState(null), [inv, setInv] = useState(null), [q, setQ] = useState(''), [pay, setPay] = useState('')
  const rows = sales.filter((s) => (s.invoiceNo + s.customerName).toLowerCase().includes(q.toLowerCase()))
  const doPay = async () => { try { await addPayment({ sale: inv, amount: toMinor(pay), method: 'Cash', date: today() }); toast('Payment recorded.'); setInv(null); setPay('') } catch (e) { toast(e.message, 1) } }
  const exportExcel = () => {
    try {
      const workbook = salesWorkbook(rows)
      download(`sales-${today()}.xlsx`, workbook, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      toast(`Exported ${rows.length} sale${rows.length === 1 ? '' : 's'} to Excel.`)
    } catch (e) { toast(`Excel export failed: ${e.message}`, 1) }
  }
  return <>
    <NewSale customers={customers} products={products} toast={toast} />
    <div className="sales-history-heading"><h2>Sales history</h2><Btn onClick={exportExcel} disabled={!rows.length}>Export Excel</Btn></div>
    <div className="bar"><Search placeholder="Search invoice or customer" value={q} onChange={(e) => setQ(e.target.value)} /></div>
    <Table cols={[{ h: 'Invoice', r: (s) => s.invoiceNo }, { h: 'Date', r: (s) => s.date },
      { h: 'Customer & sold products', r: (s) => <SalesRecordDetails sale={s} /> },
      { h: 'Total', n: 1, r: (s) => f(s.total) }, { h: 'Status', r: (s) => <span className={`pill ${s.status}`}>{s.status}</span> },
      { h: '', r: (s) => <Btn kind="ghost" onClick={() => setInv(s)}>Open</Btn> }]} rows={rows} />
    {inv && <Modal title={inv.invoiceNo} onClose={() => setInv(null)}><div id="invoice">
      <div className="invoice-customer"><span className="sale-customer-label">CUSTOMER DETAILS</span><strong>{inv.customerName || 'Walk-in'}</strong>
        {inv.customerPhone && <a href={`tel:${inv.customerPhone}`}>{inv.customerPhone}</a>}
        <span className="muted">Invoice date: {inv.date}</span></div>
      <Table cols={[{ h: 'Item', r: (l) => <span className="sale-line-item"><Photo src={l.photo} alt={l.name} />{l.name} {l.size}/{l.color}</span> },
        { h: 'Qty', n: 1, r: (l) => l.qty }, { h: 'Price', n: 1, r: (l) => f(l.unitPrice) }, { h: 'Total', n: 1, r: (l) => f(l.qty * l.unitPrice - l.discount) }]} rows={inv.lines} />
      <p className="total">Discount {f(inv.discount)} · Total {f(inv.total)} · Returned {f(inv.returned || 0)} · Paid {f(inv.paid)} · Refunded {f(inv.refunded || 0)} · {netDue(inv) < 0 ? 'Credit' : 'Due'} {f(Math.abs(netDue(inv)))}</p>
      {returns.filter((r) => r.saleId === inv.id).map((r) => <p key={r.id} className="muted">Return {r.date}: {r.items.map((i) => `${i.qty}× ${i.name} (${i.disposition})`).join(', ')} · credit {f(r.credit)}</p>)}</div>
      <div className="grid"><Field label="Add payment" type="number" min="0.01" step="0.01" value={pay} onChange={(e) => setPay(e.target.value)} /><Btn onClick={doPay} disabled={!(Number(pay) > 0)}>Record payment</Btn></div>
      <div className="acts"><Btn onClick={() => setRet(inv)} disabled={inv.lines.every((l, i) => l.qty <= ((inv.returnedQty || [])[i] || 0))}>Return items</Btn><Btn onClick={() => window.print()}>Print / save as PDF</Btn></div></Modal>}
    {ret && <ReturnModal sale={ret} toast={toast} onClose={() => { setRet(null); setInv(null) }} />}
  </>
}

function Reports({ sales, payments, returns }) {
  const [m, setM] = useState(monthOf(today())), s = monthlySummary(sales, payments, m, returns)
  const exp = () => download(`report-${m}.csv`, csv([['Invoice', 'Date', 'Customer', 'Units', 'Revenue', 'Cost', 'Gross profit', 'Paid'],
    ...sales.filter((x) => monthOf(x.date) === m).map((x) => { const c = x.lines.reduce((a, l) => a + l.qty * l.unitCost, 0)
      return [x.invoiceNo, x.date, x.customerName, x.lines.reduce((a, l) => a + l.qty, 0), f(x.total), f(c), f(x.total - c), f(x.paid)] }),
    ...returns.filter((r) => monthOf(r.date) === m).map((r) => [`${r.invoiceNo} return`, r.date, r.customerName, -r.items.reduce((a, i) => a + i.qty, 0), f(-r.credit), f(-r.items.filter((i) => i.disposition === 'restock').reduce((a, i) => a + i.qty * i.unitCost, 0)), '', f(-r.refund)]),
    [], ['Totals', '', '', s.unitsSold, f(s.revenue), f(s.cost), f(s.grossProfit), f(s.cashReceived)]]))
  return <><div className="bar"><Field label="Month" type="month" value={m} onChange={(e) => setM(e.target.value)} /><Btn onClick={exp}>Export CSV</Btn></div>
    <div className="stats">{[['Revenue (net of returns)', f(s.revenue)], ['Returns', f(s.returns)], ['Product cost', f(s.cost)], ['Gross profit', f(s.grossProfit)], ['Cash received', f(s.cashReceived)], ['Transactions', s.transactions], ['Products sold', s.unitsSold]].map(([l, v]) =>
      <div key={l} className="stat"><span>{l}</span><strong>{v}</strong></div>)}</div>
    <p className="muted">Unpaid invoices count as revenue, not as cash received.</p></>
}

function Backups({ toast, onRestored }) {
  const [busy, setBusy] = useState(false)
  const exportData = async () => {
    setBusy(true)
    try {
      const backup = await getBackup()
      download(`shop-manager-backup-${today()}.json`, JSON.stringify(backup, null, 2), 'application/json')
      toast('Backup downloaded.')
    } catch (e) { toast(e.message, 1) }
    setBusy(false)
  }
  const importData = async (ev) => {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file || !confirm('Restore this backup? It replaces all shop data saved in this browser.')) return
    setBusy(true)
    try {
      const backup = JSON.parse(await file.text())
      await restoreBackup(backup)
      toast('Backup restored.')
      onRestored()
    } catch (e) { toast(e.message, 1) }
    setBusy(false)
  }
  return <section className="backup">
    <h2>Local data backup</h2>
    <p className="muted">This browser saves its own data on this device. Backups include products, customers, sales, payments, returns and stock history. Restore the backup on another device to copy your data there.</p>
    <Btn kind="primary" onClick={exportData} disabled={busy}>Download backup</Btn>
    <label className="field backup-import"><span>Restore from a backup file (replaces all current data)</span>
      <input type="file" accept="application/json,.json" onChange={importData} disabled={busy} /></label>
  </section>
}

const PAGES = ['Dashboard', 'Sales', 'Customers', 'Products', 'Reports', 'Backup']
function Shell() {
  const [page, setPage] = useState('Dashboard'), [toastEl, toast] = useToast()
  const queries = [useCol('customers'), useCol('products'), useCol('sales'), useCol('payments'), useCol('returns')]
  if (queries.some((query) => query.error)) return <div className="pad"><p className="errtext">Could not load the local database: {queries.find((query) => query.error).error}</p>
    <Btn onClick={() => queries.forEach((query) => query.reload())}>Retry</Btn></div>
  if (queries.some((query) => query.rows === null)) return <p className="muted pad">Loading local database…</p>
  const [customers, products, sales, payments, returns] = queries.map((query) => query.rows)
  const p = { customers, products, sales, payments, returns, toast }
  return <div className="app"><nav><strong>Pinteresty Outfits<small>YOUR SHOP, YOUR STYLE</small></strong>{PAGES.map((n) => <button key={n} className={n === page ? 'on' : ''} onClick={() => setPage(n)}>{n}</button>)}
    </nav>
    <main><header className="page-heading"><p className="eyebrow">PINTERESTY OUTFITS</p><h1>{page === 'Products' ? 'The outfit edit' : page}</h1>
      <p className="page-subtitle">{page === 'Products' ? 'A moodboard of all the lovely pieces in your shop.' : 'A thoughtful look at everything happening in your shop.'}</p></header>
      {{ Dashboard: <Dashboard {...p} />, Sales: <Sales {...p} />, Customers: <Customers {...p} />, Products: <Products {...p} />, Reports: <Reports {...p} />,
      Backup: <Backups toast={toast} onRestored={() => queries.forEach((query) => query.reload())} /> }[page]}</main>{toastEl}</div>
}

export default function App() {
  return <Shell />
}
