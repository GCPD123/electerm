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

function nonEmptyCells (values) {
  return values
    .map((value, index) => ({ index, value: String(value || '').trim() }))
    .filter(cell => cell.value)
}

function isNumberedStep (value) {
  return /^\d+(?:[.)、]|步骤)?$/.test(String(value || '').trim())
}

function isDiagnosticCommand (value) {
  return /^\s*(?:display|show|ping|tracert|traceroute)\b/i.test(String(value || ''))
}

function redactWorkflowCommand (value) {
  const ipAddress = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}'
  const source = String(value || '').trim()
  return source
    .replace(new RegExp(`\\bremote\\s+${ipAddress}`, 'gi'), 'remote <对端IP>')
    .replace(new RegExp(`\\bsa\\s+${ipAddress}`, 'gi'), 'sa <源IP>')
    .replace(new RegExp(`\\b(?:peer|destination)\\s+${ipAddress}`, 'gi'), match => {
      const field = match.split(/\s+/)[0]
      return `${field} <对端IP>`
    })
    .replace(new RegExp(`\\b${ipAddress}\\b`, 'g'), '<IP地址>')
    .replace(/\bping\s+vc\s+raw\s+\d+\b/gi, 'ping vc raw <VCID>')
    .replace(/\bte\s+tunnel\s+\d+\b/gi, 'te tunnel <隧道ID>')
}

function looksLikeConfigurationReference (value) {
  const source = String(value || '').trim()
  return source.includes('\n') || /^(?:vpws|interface|peer|tunnel|ip\s+address|destination)\b/im.test(source)
}

function redactWorkflowConfiguration (value) {
  const ipAddress = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}'
  return String(value || '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line
      .replace(/^vpws\s+\S+/i, 'vpws <业务名>')
      .replace(/^interface\s+.+$/i, 'interface <接入接口>')
      .replace(new RegExp(`\\bpeer\\s+${ipAddress}`, 'gi'), 'peer <对端IP>')
      .replace(new RegExp(`\\bdestination\\s+${ipAddress}`, 'gi'), 'destination <对端IP>')
      .replace(new RegExp(`\\bip\\s+address\\s+${ipAddress}`, 'gi'), 'ip address <本端IP>')
      .replace(new RegExp(`\\b${ipAddress}\\b`, 'g'), '<IP地址>')
      .replace(/\bvcid\s+\S+/gi, 'vcid <VCID>')
      .replace(/\bin-label\s+\S+/gi, 'in-label <入标签>')
      .replace(/\bout-label\s+\S+/gi, 'out-label <出标签>')
      .replace(/\bpw-class-template\s+\S+/gi, 'pw-class-template <PW类模板>')
      .replace(/\bvlan-id\s+\S+/gi, 'vlan-id <VLAN ID>')
      .replace(/\btunnel-te\s+\S+/gi, 'tunnel-te <隧道ID>')
      .replace(/\b(?:primary|secondary)\s+path\s+\S+/gi, match => {
        const role = match.split(/\s+/)[0]
        return `${role} path <路径标识>`
      })
      .replace(/\bforward-pathid\s+\S+/gi, 'forward-pathid <正向路径ID>')
      .replace(/\breverse-pathid\s+\S+/gi, 'reverse-pathid <反向路径ID>')
      .replace(/\blsp-id\s+\S+/gi, 'lsp-id <LSP ID>')
      .replace(/\btpoam-me\s+\S+/gi, 'tpoam-me <OAM ID>'))
    .join('\n')
}

function buildTroubleshootingUnits (worksheetName, rows) {
  const steps = rows.map(row => {
    const { values } = toValues(row)
    const cells = nonEmptyCells(values)
    if (!isNumberedStep(cells[0]?.value) || !cells[1]?.value) return null
    const commandCell = cells.slice(2).find(cell => isDiagnosticCommand(cell.value))
    const configurationCell = cells.slice(2)
      .find(cell => cell !== commandCell && looksLikeConfigurationReference(cell.value))
    return {
      step: cells[0].value,
      description: cells[1].value,
      command: commandCell?.value || '',
      configurationReference: configurationCell?.value || '',
      row: row.number
    }
  }).filter(Boolean)

  if (steps.length < 2 || !steps.some(step => step.command)) {
    return { sections: [], units: [] }
  }

  const section = `${worksheetName} troubleshooting workflow`
  return {
    sections: [{ title: section, row: steps[0].row }],
    units: steps.map(step => {
      const command = redactWorkflowCommand(step.command)
      const configurationReference = redactWorkflowConfiguration(step.configurationReference)
      return {
        kind: 'troubleshooting',
        workflowStep: step.step,
        command,
        commandView: '',
        description: step.description,
        usageScope: 'Troubleshooting workflow',
        example: '',
        expertNotes: '',
        ...(configurationReference && { configurationReference }),
        requiresParameters: Boolean(configurationReference || (command && command !== step.command)),
        source: {
          worksheet: worksheetName,
          section,
          row: step.row
        }
      }
    })
  }
}

const REFERENCE_COMMAND_STOP_WORDS = new Set(['to', 'find', 'the', 'when', 'for', 'is', 'and', 'then', 'all'])

function extractReferenceCommand (value) {
  const match = String(value || '').match(/\b(?:display|show|ping|tracert|traceroute)\s+[a-z0-9][a-z0-9._/:=-]*(?:\s+[a-z0-9][a-z0-9._/:=-]*){0,8}/i)
  if (!match) return ''
  const words = match[0].trim().split(/\s+/)
  const stopIndex = words.findIndex((word, index) => index > 1 && REFERENCE_COMMAND_STOP_WORDS.has(word.toLowerCase()))
  return words.slice(0, stopIndex === -1 ? words.length : stopIndex).join(' ')
}

function buildReferenceUnits (worksheetName, rows) {
  const units = []
  const section = `${worksheetName} reference`
  for (const row of rows) {
    const cells = nonEmptyCells(toValues(row).values)
    if (!cells.length) continue
    const referenceText = cells.map(cell => cell.value).join('\n')
    const command = extractReferenceCommand(referenceText)
    units.push({
      kind: 'reference',
      command,
      commandView: '',
      description: cells[0].value,
      usageScope: 'Knowledge reference',
      example: '',
      expertNotes: '',
      referenceText,
      requiresParameters: Boolean(command && /<[^>]+>/.test(command)),
      source: {
        worksheet: worksheetName,
        section,
        row: row.number
      }
    })
  }

  return {
    sections: units.length ? [{ title: section, row: units[0].source.row }] : [],
    units
  }
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
    const rows = await parseRows(worksheetXml, sharedStrings)
    const commandWorkbook = buildUnits(sheet.name, rows)
    const troubleshootingWorkbook = buildTroubleshootingUnits(sheet.name, rows)
    const parsed = commandWorkbook.units.length
      ? commandWorkbook
      : troubleshootingWorkbook.units.length
        ? troubleshootingWorkbook
        : buildReferenceUnits(sheet.name, rows)
    worksheets.push({ name: sheet.name, sections: parsed.sections })
    units.push(...parsed.units)
  }

  return { worksheets, units }
}

module.exports = {
  parseXlsxCommandWorkbook
}
