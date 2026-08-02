const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const { parseXlsxCommandWorkbook } = require('./xlsx-parser')

const SCHEMA_VERSION = 1
const TOKENIZER_VERSION = 'zh-cli-ngrams-v1'
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
const SENSITIVE_PATTERN = /(?:password|passwd|private\s*key|\btoken\b|用户名|密码|密钥|口令)/i
const GENERIC_QUERY_TOKENS = new Set(['查看', '设备', '状态', '信息', '命令', '查询'])

function tokenize (input) {
  const value = String(input || '').toLowerCase()
  const tokens = new Set()
  const asciiTokens = value.match(/[a-z0-9][a-z0-9_./:-]*/g) || []
  asciiTokens.forEach(token => tokens.add(token))

  const chineseRuns = value.match(/[\u3400-\u9fff]+/g) || []
  for (const run of chineseRuns) {
    if (run.length < 2) {
      tokens.add(run)
      continue
    }
    for (let size = 2; size <= Math.min(3, run.length); size++) {
      for (let index = 0; index <= run.length - size; index++) {
        tokens.add(run.slice(index, index + size))
      }
    }
  }
  const specificTokens = [...tokens].filter(token => !GENERIC_QUERY_TOKENS.has(token))
  return specificTokens.length ? specificTokens : [...tokens]
}

function isCliToken (token) {
  return /[a-z0-9]/i.test(token)
}

function unitContent (unit) {
  return [
    `命令:\n${unit.command}`,
    unit.commandView && `命令视图: ${unit.commandView}`,
    unit.description && `说明: ${unit.description}`,
    unit.usageScope && `使用范围: ${unit.usageScope}`,
    unit.example && `实例: ${unit.example}`,
    unit.expertNotes && `专家解读: ${unit.expertNotes}`
  ].filter(Boolean).join('\n')
}

function sanitizeUnit (unit) {
  const sanitized = { ...unit }
  const warnings = []
  if (SENSITIVE_PATTERN.test(String(unit.command || ''))) {
    return { unit: null, warnings: ['command'] }
  }
  for (const field of ['commandView', 'description', 'usageScope', 'example', 'expertNotes']) {
    if (SENSITIVE_PATTERN.test(String(unit[field] || ''))) {
      sanitized[field] = ''
      warnings.push(field)
    }
  }
  return { unit: sanitized, warnings }
}

function buildIndex (units) {
  const index = new Map()
  for (const unit of units) {
    const fields = [
      ['command', unit.command, 4],
      ['description', unit.description, 3],
      ['commandView', unit.commandView, 2],
      ['usageScope', unit.usageScope, 1],
      ['example', unit.example, 1],
      ['expertNotes', unit.expertNotes, 1]
    ]
    for (const [field, value, weight] of fields) {
      for (const token of tokenize(value)) {
        if (!index.has(token)) index.set(token, new Map())
        const posting = index.get(token)
        const current = posting.get(unit.id) || { score: 0, fields: new Set() }
        current.score += weight
        current.fields.add(field)
        posting.set(unit.id, current)
      }
    }
  }
  return index
}

function createKnowledgeBase ({ dataDirectory, parser = parseXlsxCommandWorkbook }) {
  const statePath = path.join(dataDirectory, 'knowledge-base-v1.json')
  let state = null
  let index = new Map()
  let initPromise = null

  async function ensureInitialized () {
    if (state) return
    if (!initPromise) {
      initPromise = (async () => {
        try {
          const content = await fs.readFile(statePath, 'utf8')
          const loaded = JSON.parse(content)
          if (loaded.schemaVersion !== SCHEMA_VERSION || loaded.tokenizerVersion !== TOKENIZER_VERSION) {
            throw new Error('Knowledge index version requires rebuild')
          }
          state = {
            documents: Array.isArray(loaded.documents) ? loaded.documents : [],
            units: Array.isArray(loaded.units) ? loaded.units : []
          }
        } catch (error) {
          if (error.code !== 'ENOENT') throw error
          state = { documents: [], units: [] }
        }
        index = buildIndex(state.units)
      })()
    }
    await initPromise
  }

  async function persist () {
    await fs.mkdir(dataDirectory, { recursive: true })
    const temporaryPath = `${statePath}.${process.pid}.tmp`
    const serialized = JSON.stringify({
      schemaVersion: SCHEMA_VERSION,
      tokenizerVersion: TOKENIZER_VERSION,
      documents: state.documents,
      units: state.units
    })
    await fs.writeFile(temporaryPath, serialized, 'utf8')
    await fs.rename(temporaryPath, statePath)
  }

  async function hashFile (filePath) {
    const content = await fs.readFile(filePath)
    return crypto.createHash('sha256').update(content).digest('hex')
  }

  async function importOne (filePath, options) {
    if (path.extname(filePath).toLowerCase() !== '.xlsx') {
      throw new Error('Only .xlsx knowledge documents are supported')
    }
    const fileStats = await fs.stat(filePath)
    if (fileStats.size > MAX_DOCUMENT_BYTES) {
      throw new Error(`Knowledge document exceeds ${MAX_DOCUMENT_BYTES} byte limit`)
    }
    const sha256 = await hashFile(filePath)
    const existing = state.documents.find(document => document.sha256 === sha256)
    if (existing) return { duplicate: existing }

    const parsed = await parser(filePath)
    const parsedUnits = Array.isArray(parsed.units) ? parsed.units : []
    const sanitizedUnits = parsedUnits.map(sanitizeUnit)
    const safeUnits = sanitizedUnits.map(result => result.unit).filter(Boolean)
    const warnings = sanitizedUnits.flatMap((result, index) => result.warnings.map(field => ({
      row: parsedUnits[index].source.row,
      field
    })))
    if (!safeUnits.length) throw new Error('No safe command units were found in the XLSX document')

    const id = `doc-${sha256.slice(0, 24)}`
    const document = {
      id,
      title: path.basename(filePath),
      sourcePath: filePath,
      sha256,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      importedAt: new Date().toISOString(),
      indexVersion: TOKENIZER_VERSION,
      status: 'ready',
      productFamily: options.productFamily || 'SPN',
      deviceModels: options.deviceModels || [],
      softwareVersions: options.softwareVersions || [],
      worksheets: parsed.worksheets || [],
      unitCount: safeUnits.length,
      warnings
    }
    const units = safeUnits.map((unit, ordinal) => ({
      ...unit,
      id: `${id}:${unit.source.worksheet}:${unit.source.row}:${ordinal}`,
      documentId: id,
      content: unitContent(unit)
    }))
    state.documents.push(document)
    state.units.push(...units)
    index = buildIndex(state.units)
    await persist()
    return { imported: document }
  }

  async function importDocuments (filePaths, options = {}) {
    await ensureInitialized()
    const result = { imported: [], duplicates: [], failed: [] }
    for (const filePath of filePaths || []) {
      try {
        const imported = await importOne(filePath, options)
        if (imported.duplicate) result.duplicates.push(imported.duplicate)
        if (imported.imported) result.imported.push(imported.imported)
      } catch (error) {
        result.failed.push({ filePath, error: error.message })
      }
    }
    return result
  }

  async function searchKnowledge (query, context = {}) {
    await ensureInitialized()
    const matches = new Map()
    for (const token of tokenize(query)) {
      const posting = index.get(token)
      if (!posting) continue
      for (const [unitId, match] of posting) {
        const current = matches.get(unitId) || { score: 0, reasons: new Set() }
        current.score += match.score
        for (const field of match.fields) {
          current.reasons.add(isCliToken(token) && field === 'command'
            ? `cli:${token}`
            : `${field}:${token}`)
        }
        matches.set(unitId, current)
      }
    }

    const requestedModels = new Set(context.deviceModels || (context.deviceModel ? [context.deviceModel] : []))
    return [...matches.entries()]
      .map(([unitId, match]) => ({ unit: state.units.find(value => value.id === unitId), match }))
      .filter(({ unit }) => unit)
      .filter(({ unit }) => {
        if (!requestedModels.size) return true
        const document = state.documents.find(value => value.id === unit.documentId)
        return !document.deviceModels.length || document.deviceModels.some(model => requestedModels.has(model))
      })
      .sort((left, right) => right.match.score - left.match.score || left.unit.id.localeCompare(right.unit.id))
      .slice(0, 8)
      .map(({ unit, match }) => {
        const document = state.documents.find(value => value.id === unit.documentId)
        return {
          chunkId: unit.id,
          content: unit.content,
          score: match.score,
          matchReasons: [...match.reasons].sort(),
          source: {
            documentId: document.id,
            title: document.title,
            worksheet: unit.source.worksheet,
            section: unit.source.section,
            row: unit.source.row
          },
          applicability: {
            productFamily: [document.productFamily].filter(Boolean),
            deviceModels: document.deviceModels,
            softwareVersions: document.softwareVersions
          }
        }
      })
  }

  async function listDocuments () {
    await ensureInitialized()
    return state.documents.map(document => ({ ...document }))
  }

  async function removeDocument (documentId) {
    await ensureInitialized()
    const before = state.documents.length
    state.documents = state.documents.filter(document => document.id !== documentId)
    state.units = state.units.filter(unit => unit.documentId !== documentId)
    index = buildIndex(state.units)
    if (before !== state.documents.length) await persist()
    return { removed: before !== state.documents.length }
  }

  async function rebuildIndex () {
    await ensureInitialized()
    index = buildIndex(state.units)
    await persist()
    return { documentCount: state.documents.length, unitCount: state.units.length }
  }

  async function getKnowledgeStatus () {
    await ensureInitialized()
    return {
      documentCount: state.documents.length,
      unitCount: state.units.length,
      tokenizerVersion: TOKENIZER_VERSION
    }
  }

  return {
    importDocuments,
    searchKnowledge,
    listDocuments,
    removeDocument,
    rebuildIndex,
    getKnowledgeStatus
  }
}

module.exports = {
  TOKENIZER_VERSION,
  createKnowledgeBase,
  tokenize
}
