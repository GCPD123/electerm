const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const { parseXlsxCommandWorkbook } = require('./xlsx-parser')

const SCHEMA_VERSION = 1
const TOKENIZER_VERSION = 'zh-cli-ngrams-v2'
const PARSER_VERSION = 'xlsx-reference-workflow-v2'
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
const SENSITIVE_PATTERN = /(?:password|passwd|private\s*key|\btoken\b|用户名|密码|密钥|口令)/i
const GENERIC_QUERY_TOKENS = new Set(['查看', '设备', '状态', '信息', '命令', '查询'])
const GENERIC_CHINESE_PHRASES = /查看|设备|状态|信息|命令|查询/g

function tokenize (input) {
  const value = String(input || '').toLowerCase()
  const tokens = new Set()
  const specificTokens = new Set()
  const asciiTokens = value.match(/[a-z0-9][a-z0-9_./:-]*/g) || []
  asciiTokens.forEach(token => {
    tokens.add(token)
    specificTokens.add(token)
  })

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
    const specificRun = run.replace(GENERIC_CHINESE_PHRASES, '')
    for (let size = 2; size <= Math.min(3, specificRun.length); size++) {
      for (let index = 0; index <= specificRun.length - size; index++) {
        specificTokens.add(specificRun.slice(index, index + size))
      }
    }
  }
  const filteredTokens = [...specificTokens].filter(token => !GENERIC_QUERY_TOKENS.has(token))
  return filteredTokens.length ? filteredTokens : [...tokens]
}

function isCliToken (token) {
  return /[a-z0-9]/i.test(token)
}

function normalizeCommandCli (commandView) {
  const value = String(commandView || '').trim().toLowerCase()
  if (/(?:diagnose|diagnostic|诊断)/i.test(value)) return 'ace-diagnose'
  if (/(?:linux|shell)/i.test(value)) return 'linux-shell'
  if (/(?:user|normal|普通|用户)/i.test(value)) return 'ace-user'
  return 'unknown'
}

function classifyOperation (command) {
  const firstLine = String(command || '').trim().split(/\r?\n/)[0].toLowerCase()
  if (/(?:running-config|current-configuration|show\s+configuration|display\s+configuration|password|passwd|secret|private\s*key|\btoken\b)/i.test(firstLine)) {
    return 'sensitive-read'
  }
  if (/^(?:configure|config\b|interface\b|set\b|no\b|commit\b|save\b|write\b|delete\b|remove\b|reset\b|reboot\b)/i.test(firstLine)) {
    return 'configuration'
  }
  if (/^(?:display|show|ping|tracert|traceroute)\b/i.test(firstLine)) {
    return 'status-query'
  }
  return 'unknown'
}

function resolveRequestedCliMode (context) {
  const cliMode = context.cliMode || normalizeCommandCli(context.commandView)
  return ['linux-shell', 'ace-user', 'ace-diagnose'].includes(cliMode) ? cliMode : 'unknown'
}

function workflowGroupKey (unit) {
  if (unit?.kind !== 'troubleshooting') return ''
  return [unit.documentId, unit.source?.worksheet, unit.source?.section].join(':')
}

function compareWorkflowSteps (left, right) {
  const leftStep = Number(left.unit.workflowStep)
  const rightStep = Number(right.unit.workflowStep)
  if (Number.isFinite(leftStep) && Number.isFinite(rightStep) && leftStep !== rightStep) {
    return leftStep - rightStep
  }
  return left.unit.id.localeCompare(right.unit.id)
}

function unitContent (unit) {
  return [
    unit.kind && `知识类型: ${unit.kind === 'troubleshooting' ? '排障流程' : unit.kind}`,
    unit.workflowStep && `排障步骤: ${unit.workflowStep}`,
    unit.command && `命令:\n${unit.command}`,
    unit.requiresParameters && '命令参数: 必须使用当前设备或业务的实际参数，不能直接执行示例模板',
    unit.configurationReference && `配置核对模板 / Configuration reference (redacted; review only, do not execute):\n${unit.configurationReference}`,
    unit.referenceText && `知识参考 / Reference:\n${unit.referenceText}`,
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
  for (const field of ['commandView', 'description', 'usageScope', 'example', 'expertNotes', 'configurationReference', 'referenceText']) {
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
      ['description', unit.description, 4],
      ['commandView', unit.commandView, 2],
      ['usageScope', unit.usageScope, 1],
      ['example', unit.example, 1],
      ['expertNotes', unit.expertNotes, 1],
      ['configurationReference', unit.configurationReference, 3],
      ['referenceText', unit.referenceText, 3],
      ['workflowStep', unit.workflowStep, 1]
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
    const existingByPath = state.documents.find(document => document.sourcePath === filePath)
    const existingByHash = state.documents.find(document => document.sha256 === sha256)
    if (existingByPath?.sha256 === sha256 && existingByPath.parserVersion === PARSER_VERSION) {
      return { duplicate: existingByPath }
    }
    if (!existingByPath && existingByHash?.parserVersion === PARSER_VERSION) {
      return { duplicate: existingByHash }
    }
    const existing = existingByPath || existingByHash

    const parsed = await parser(filePath)
    const parsedUnits = Array.isArray(parsed.units) ? parsed.units : []
    const sanitizedUnits = parsedUnits.map(sanitizeUnit)
    const safeUnits = sanitizedUnits.map(result => result.unit).filter(Boolean)
    const warnings = sanitizedUnits.flatMap((result, index) => result.warnings.map(field => ({
      row: parsedUnits[index].source.row,
      field
    })))
    if (!safeUnits.length) throw new Error('No safe command units were found in the XLSX document')

    if (existing) {
      state.documents = state.documents.filter(document => document.id !== existing.id)
      state.units = state.units.filter(unit => unit.documentId !== existing.id)
    }

    const id = `doc-${sha256.slice(0, 24)}`
    const document = {
      id,
      title: path.basename(filePath),
      sourcePath: filePath,
      sha256,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      importedAt: new Date().toISOString(),
      indexVersion: TOKENIZER_VERSION,
      parserVersion: PARSER_VERSION,
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
    const queryTokens = tokenize(query)
    for (const token of queryTokens) {
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

    for (const document of state.documents) {
      const matchingTitleTokens = queryTokens.filter(token => tokenize(document.title).includes(token))
      if (!matchingTitleTokens.length) continue
      for (const unit of state.units) {
        if (unit.documentId !== document.id || unit.kind !== 'troubleshooting') continue
        const current = matches.get(unit.id) || { score: 0, reasons: new Set() }
        current.score += matchingTitleTokens.length * 4
        for (const token of matchingTitleTokens) current.reasons.add(`document:${token}`)
        matches.set(unit.id, current)
      }
    }

    const workflowScores = new Map()
    for (const [unitId, match] of matches) {
      const unit = state.units.find(value => value.id === unitId)
      const group = workflowGroupKey(unit)
      if (!group) continue
      workflowScores.set(group, Math.max(workflowScores.get(group) || 0, match.score))
    }
    for (const unit of state.units) {
      const group = workflowGroupKey(unit)
      const score = workflowScores.get(group)
      if (!score) continue
      const current = matches.get(unit.id) || { score: 0, reasons: new Set() }
      current.score = Math.max(current.score, score)
      current.reasons.add('workflow:related-step')
      matches.set(unit.id, current)
    }

    const requestedModels = new Set(context.deviceModels || (context.deviceModel ? [context.deviceModel] : []))
    const requestedCliMode = resolveRequestedCliMode(context)
    return [...matches.entries()]
      .map(([unitId, match]) => ({ unit: state.units.find(value => value.id === unitId), match }))
      .filter(({ unit }) => unit)
      .filter(({ unit }) => {
        if (!requestedModels.size) return true
        const document = state.documents.find(value => value.id === unit.documentId)
        return !document.deviceModels.length || document.deviceModels.some(model => requestedModels.has(model))
      })
      .filter(({ unit }) => {
        if (requestedCliMode === 'unknown') return true
        const unitCliMode = normalizeCommandCli(unit.commandView)
        return unitCliMode === 'unknown' || unitCliMode === requestedCliMode
      })
      .sort((left, right) => right.match.score - left.match.score || compareWorkflowSteps(left, right))
      .slice(0, 8)
      .map(({ unit, match }) => {
        const document = state.documents.find(value => value.id === unit.documentId)
        return {
          chunkId: unit.id,
          command: unit.command,
          commandView: unit.commandView || '',
          knowledgeType: unit.kind || 'command',
          workflowStep: unit.workflowStep || '',
          description: unit.description || '',
          configurationReference: unit.configurationReference || '',
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
            softwareVersions: document.softwareVersions,
            commandView: unit.commandView || '',
            cliModes: [normalizeCommandCli(unit.commandView)],
            operationClass: classifyOperation(unit.command)
          },
          actionability: {
            requiresParameters: Boolean(unit.requiresParameters),
            canAutoExecute: Boolean(unit.command) && !unit.requiresParameters &&
              classifyOperation(unit.command) === 'status-query'
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
  PARSER_VERSION,
  TOKENIZER_VERSION,
  createKnowledgeBase,
  tokenize
}
