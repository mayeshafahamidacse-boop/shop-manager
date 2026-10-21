import { strToU8, zipSync } from 'fflate'

const columns = (index) => {
  let value = index + 1
  let name = ''
  while (value) {
    const digit = (value - 1) % 26
    name = String.fromCharCode(65 + digit) + name
    value = Math.floor((value - 1) / 26)
  }
  return name
}

const xmlText = (value) => String(value ?? '')
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;')

function worksheet(rows) {
  const sheetRows = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => {
      const cell = `${columns(colIndex)}${rowIndex + 1}`
      if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${cell}"><v>${value}</v></c>`
      const text = xmlText(value)
      return `<c r="${cell}" t="inlineStr"><is><t xml:space="preserve">${text}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`
}

export function salesWorkbook(sales) {
  const itemRows = [[
    'Invoice', 'Date', 'Customer', 'Customer phone', 'Product', 'Size', 'Color',
    'Quantity', 'Unit price', 'Line discount', 'Line total',
  ]]
  const invoiceRows = [[
    'Invoice', 'Date', 'Customer', 'Customer phone', 'Item lines', 'Units',
    'Subtotal', 'Discount', 'Total', 'Returned', 'Paid', 'Refunded', 'Due / credit', 'Status',
  ]]

  for (const sale of sales) {
    let units = 0
    for (const line of sale.lines) {
      units += line.qty
      itemRows.push([
        sale.invoiceNo, sale.date, sale.customerName, sale.customerPhone || '',
        line.name, line.size, line.color, line.qty, line.unitPrice / 100,
        line.discount / 100, (line.qty * line.unitPrice - line.discount) / 100,
      ])
    }
    invoiceRows.push([
      sale.invoiceNo, sale.date, sale.customerName, sale.customerPhone || '',
      sale.lines.length, units, sale.subtotal / 100, sale.discount / 100, sale.total / 100,
      (sale.returned || 0) / 100, sale.paid / 100, (sale.refunded || 0) / 100,
      (sale.total - (sale.returned || 0) - (sale.paid - (sale.refunded || 0))) / 100, sale.status,
    ])
  }

  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'),
    '_rels/.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'),
    'xl/workbook.xml': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sale items" sheetId="1" r:id="rId1"/><sheet name="Invoices" sheetId="2" r:id="rId2"/></sheets></workbook>'),
    'xl/_rels/workbook.xml.rels': strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'),
    'xl/worksheets/sheet1.xml': strToU8(worksheet(itemRows)),
    'xl/worksheets/sheet2.xml': strToU8(worksheet(invoiceRows)),
  }
  return zipSync(files, { level: 6 })
}
