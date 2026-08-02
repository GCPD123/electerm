const fs = require('node:fs/promises')
const path = require('node:path')
const yauzl = require('yauzl')
const sax = require('sax')

const MAX_WORKBOOK_BYTES = 20 * 1024 * 1024
const MAX_ENTRY_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_XML_BYTES = 20 * 1024 * 1024

function localName (name) {
  return name.split(':').pop()
}

function columnIndex (reference) {
  const column = /^([A-Z]+)/i.exec(reference || '')
  if (!column) return 0
  return [...column[1].toUpperCase()].reduce(
    (value, char) => value * 26 + char.charCodeAt(0) - 64,
    0
  ) - 1
}

function parseXml (content, handlers) {
  return new Promise((resolve, reject) => {
    const parser = sax.parser(true, { trim: false, normalize: false })
    parser.onerror = reject
    parser.onopentag = handlers.open || (() => {})
    parser.ontext = handlers.text || (() => {})
    parser.onclosetag = handlers.close || (() => {})
    parser.onend = resolve
    try {
      parser.write(content).close()
    } catch (error) {
      reject(error)
    }
  })
}

function readRelevantEntries (filePath) {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, {
      autoClose: true,
      lazyEntries: true,
      validateEntrySizes: true
    }, (openError, zipfile) => {
      if (openError) return reject(openError)

      const entries = new Map()
      let totalBytes = 0
      let settled = false
      const fail = (error) => {
        if (settled) return
        settled = true
        zipfile.close()
        reject(error)
      }

      zipfile.on('error', fail)
      zipfile.on('end', () => {
        if (!settled) {
          settled = true
          resolve(entries)
        }
      })
      zipfile.on('entry', (entry) => {
        const name = entry.fileName
        const relevant = name === 'xl/workbook.xml' ||
          name === 'xl/_rels/workbook.xml.rels' ||
          name === 'xl/sharedStrings.xml' ||
          /^xl\/worksheets\/[^/]+\.xml$/i.test(name)
        if (!relevant) {
          return zipfile.readEntry()
        }
        if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
          return fail(new Error(`XLSX entry exceeds ${MAX_ENTRY_BYTES} byte limit: ${name}`))
        }
        zipfile.openReadStream(entry, (streamError, stream) => {
          if (streamError) return fail(streamError)
          const chunks = []
          let size = 0
          stream.on('data', chunk => {
            size += chunk.length
            totalBytes += chunk.length
            if (size > MAX_ENTRY_BYTES || totalBytes > MAX_TOTAL_XML_BYTES) {
              stream.destroy(new Error('XLSX XML content exceeds configured size limits'))
              return
            }
            chunks.push(chunk)
          })
          stream.on('error', fail)
          stream.on('end', () => {
            if (settled) return
            entries.set(name, Buffer.concat(chunks).toString('utf8'))
            zipfile.readEntry()
          })
        })
      })
      zipfile.readEntry()
    })
  })
}

async function parseSharedStrings (xml) {
  if (!xml) return []
  const values = []
  let inString = false
  let inText = false
  let value = ''
  await parseXml(xml, {
    open: tag => {
      const name = localName(tag.name)
      if (name === 'si') {
        inString = true
        value = ''
      }
      if (inString && name === 't') inText = true
    },
    text: text => {
      if (inText) value += text
    },
    close: name => {
      name = localName(name)
      if (name === 't') inText = false
      if (name === 'si') {
        values.push(value)
        inString = false
      }
    }
  })
  return values
}

async function parseWorkbook (xml) {
  const sheets = []
  await parseXml(xml, {
    open: tag => {
      if (localName(tag.name) !== 'sheet') return
      const attributes = tag.attributes
      sheets.push({
        name: attributes.name,
        relationshipId: attributes['r:id'] || attributes.id
      })
    }
  })
  return sheets
}

async function parseRelationships (xml) {
  const relationships = new Map()
  await parseXml(xml, {
    open: tag => {
      if (localName(tag.name) !== 'Relationship') return
      const attributes = tag.attributes
      if (/\/worksheet$/.test(attributes.Type || '')) {
        relationships.set(attributes.Id, `xl/${attributes.Target.replace(/^\//, '')}`)
      }
    }
  })
  return relationships
}

async function parseRows (xml, sharedStrings) {
  const rows = []
  let currentRow = null
  let currentCell = null
  let inValue = false
  let inInlineText = false
  let text = ''

  await parseXml(xml, {
    open: tag => {
      const name = localName(tag.name)
      if (name === 'row') {
        currentRow = { number: Number(tag.attributes.r), cells: [] }
      } else if (name === 'c' && currentRow) {
        currentCell = {
          column: columnIndex(tag.attributes.r),
          type: tag.attributes.t || '',
          style: tag.attributes.s || '',
          value: ''
        }
      } else if (name === 'v' && currentCell) {
        inValue = true
        text = ''
      } else if (name === 't' && currentCell && currentCell.type === 'inlineStr') {
        inInlineText = true
        text = ''
      }
    },
    text: value => {
      if (inValue || inInlineText) text += value
    },
    close: name => {
      name = localName(name)
      if (name === 'v' && currentCell) {
        currentCell.value = currentCell.type === 's'
          ? (sharedStrings[Number(text)] || '')
          : text
        inValue = false
      } else if (name === 't' && currentCell && currentCell.type === 'inlineStr') {
        currentCell.value += text
        inInlineText = false
      } else if (name === 'c' && currentCell && currentRow) {
        currentRow.cells.push(currentCell)
        currentCell = null
      } else if (name === 'row' && currentRow) {
        rows.push(currentRow)
        currentRow = null
      }
    }
  })
  return rows
}

function toValues (row) {
  const values = []
  const styles = []
  for (const cell of row.cells) {
    values[cell.column] = cell.value || ''
    styles[cell.column] = cell.style
  }
  return { values, styles }
}

function headerStartColumn (values) {
  const commandViewColumn = values.findIndex(value => String(value || '').trim() === '命令视图')
  return commandViewColumn > 0 ? commandViewColumn - 1 : -1
}

function isSectionHeader (values, startColumn) {
  const labels = values.slice(startColumn + 1, startColumn + 4)
    .map(value => String(value || '').trim())
  return labels[0] === '命令视图' && labels[1] === '说明' &&
    (labels[2] === '范围' || labels[2] === '使用范围')
}

function buildUnits (worksheetName, rows) {
  const units = []
  const sections = []
  let section = ''
  let startColumn = -1

  for (const row of rows) {
    const { values } = toValues(row)
    if (startColumn === -1) {
      startColumn = headerStartColumn(values)
      if (startColumn === -1) continue
    }

    const command = String(values[startColumn] || '')
    if (!command.trim()) continue

    if (isSectionHeader(values, startColumn)) {
      section = command
      sections.push({ title: section, row: row.number })
      continue
    }

    if (!section) {
      section = command
      sections.push({ title: section, row: row.number })
      continue
    }

    units.push({
      command,
      commandView: String(values[startColumn + 1] || ''),
      description: String(values[startColumn + 2] || ''),
      usageScope: String(values[startColumn + 3] || ''),
      example: String(values[startColumn + 4] || ''),
      expertNotes: String(values[startColumn + 5] || ''),
      source: {
        worksheet: worksheetName,
        section,
        row: row.number
      }
    })
  }

  return { sections, units }
}

async function parseXlsxCommandWorkbook (filePath) {
  if (path.extname(filePath).toLowerCase() !== '.xlsx') {
    throw new Error('Only .xlsx files are supported')
  }
  const stats = await fs.stat(filePath)
  if (stats.size > MAX_WORKBOOK_BYTES) {
    throw new Error(`XLSX file exceeds ${MAX_WORKBOOK_BYTES} byte limit`)
  }

  const entries = await readRelevantEntries(filePath)
  const workbookXml = entries.get('xl/workbook.xml')
  const relationshipsXml = entries.get('xl/_rels/workbook.xml.rels')
  if (!workbookXml || !relationshipsXml) {
    throw new Error('XLSX workbook metadata is incomplete')
  }

  const [sharedStrings, sheets, relationships] = await Promise.all([
    parseSharedStrings(entries.get('xl/sharedStrings.xml')),
    parseWorkbook(workbookXml),
    parseRelationships(relationshipsXml)
  ])
  const worksheets = []
  const units = []

  for (const sheet of sheets) {
    const worksheetXml = entries.get(relationships.get(sheet.relationshipId))
    if (!worksheetXml) continue
    const parsed = buildUnits(sheet.name, await parseRows(worksheetXml, sharedStrings))
    worksheets.push({ name: sheet.name, sections: parsed.sections })
    units.push(...parsed.units)
  }

  return { worksheets, units }
}

module.exports = {
  parseXlsxCommandWorkbook
}
