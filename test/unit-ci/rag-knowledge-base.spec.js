const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { createKnowledgeBase, tokenize } = require('../../src/app/lib/knowledge/knowledge-base')

async function createTempKnowledgeBase () {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fiberterm-kb-'))
  const sourcePath = path.join(root, 'spn-fixture.xlsx')
  await fs.writeFile(sourcePath, 'fixture workbook')
  const parser = async () => ({
    worksheets: [{
      name: 'SPN Commands',
      sections: [{ title: 'Protocol queries', row: 1 }]
    }],
    units: [{
      command: 'show interface GE1/1/1',
      commandView: '用户视图',
      description: '查看接口状态和端口简要状态',
      usageScope: '一线',
      example: '',
      expertNotes: '',
      source: { worksheet: 'SPN Commands', section: 'Protocol queries', row: 2 }
    }, {
      command: 'show clock\nshow ntp status',
      commandView: 'diagnose',
      description: '查看设备时钟同步状态',
      usageScope: '二线',
      example: '',
      expertNotes: '密码字段不得进入知识库',
      source: { worksheet: 'SPN Commands', section: 'Protocol queries', row: 3 }
    }]
  })
  return {
    sourcePath,
    dataDirectory: path.join(root, 'knowledge-data'),
    parser
  }
}

async function createTempWorkflowKnowledgeBase () {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fiberterm-kb-workflow-'))
  const sourcePath = path.join(root, 'vpws-troubleshooting.xlsx')
  await fs.writeFile(sourcePath, 'fixture workbook')
  const parser = async () => ({
    worksheets: [{
      name: 'VPWS Workflow',
      sections: [{ title: 'VPWS Workflow troubleshooting workflow', row: 1 }]
    }],
    units: [1, 2, 3, 4, 5].map(step => ({
      kind: 'troubleshooting',
      workflowStep: String(step),
      command: step === 2 ? 'ping lsp <peer-ip>' : '',
      commandView: '',
      description: step === 2
        ? 'Check the VPWS LSP path before continuing to the next step.'
        : `Workflow step ${step}.`,
      usageScope: 'Troubleshooting workflow',
      example: '',
      expertNotes: '',
      configurationReference: step === 4
        ? 'vpws <service-name>\npeer <peer-ip> vcid <vcid> encapsulation raw'
        : '',
      requiresParameters: step === 2,
      source: {
        worksheet: 'VPWS Workflow',
        section: 'VPWS Workflow troubleshooting workflow',
        row: step
      }
    }))
  })
  return {
    sourcePath,
    dataDirectory: path.join(root, 'knowledge-data'),
    parser
  }
}

describe('KnowledgeBase', () => {
  it('keeps specific Chinese terms while ignoring boilerplate query wording', () => {
    const tokens = tokenize('查看设备时钟状态')

    assert.equal(tokens.includes('时钟'), true)
    assert.equal(tokens.includes('查看设'), false)
    assert.equal(tokens.includes('设备'), false)
    assert.equal(tokens.includes('状态'), false)
  })

  it('persists structured XLSX units, searches Chinese/CLI tokens, deduplicates and removes', async () => {
    const { sourcePath, dataDirectory, parser } = await createTempKnowledgeBase()
    const knowledge = createKnowledgeBase({ dataDirectory, parser })

    const firstImport = await knowledge.importDocuments([sourcePath])
    assert.equal(firstImport.imported.length, 1)
    assert.equal(firstImport.imported[0].unitCount, 2)
    assert.equal(firstImport.imported[0].warnings.length, 1)

    const chineseResults = await knowledge.searchKnowledge('查看端口状态')
    assert.equal(chineseResults.length > 0, true)
    assert.equal(chineseResults[0].content.includes('show interface GE1/1/1'), true)
    assert.deepEqual(chineseResults[0].source, {
      documentId: firstImport.imported[0].id,
      title: 'spn-fixture.xlsx',
      worksheet: 'SPN Commands',
      section: 'Protocol queries',
      row: 2
    })

    const cliResults = await knowledge.searchKnowledge('GE1/1/1')
    assert.equal(cliResults[0].matchReasons.includes('cli:ge1/1/1'), true)
    assert.deepEqual(await knowledge.searchKnowledge('密码字段'), [])

    const duplicate = await knowledge.importDocuments([sourcePath])
    assert.equal(duplicate.duplicates.length, 1)
    assert.equal((await knowledge.getKnowledgeStatus()).unitCount, 2)

    const restored = createKnowledgeBase({ dataDirectory, parser })
    assert.equal((await restored.searchKnowledge('时钟状态'))[0].source.row, 3)

    await restored.removeDocument(firstImport.imported[0].id)
    assert.equal((await restored.getKnowledgeStatus()).unitCount, 0)
    assert.deepEqual(await restored.searchKnowledge('GE1/1/1'), [])
  })

  it('derives CLI applicability from commandView without invalidating an existing index', async () => {
    const { sourcePath, dataDirectory, parser } = await createTempKnowledgeBase()
    const knowledge = createKnowledgeBase({ dataDirectory, parser })
    await knowledge.importDocuments([sourcePath])

    const diagnoseResults = await knowledge.searchKnowledge('clock', { cliMode: 'ace-diagnose' })
    assert.equal(diagnoseResults.length, 1)
    assert.deepEqual(diagnoseResults[0].applicability.cliModes, ['ace-diagnose'])
    assert.equal(diagnoseResults[0].applicability.operationClass, 'status-query')

    assert.deepEqual(await knowledge.searchKnowledge('clock', { cliMode: 'ace-user' }), [])

    const restored = createKnowledgeBase({ dataDirectory, parser })
    const unknownContextResults = await restored.searchKnowledge('clock', { cliMode: 'unknown' })
    assert.equal(unknownContextResults.length, 1)
    assert.equal(unknownContextResults[0].commandView, 'diagnose')
  })

  it('expands a matching troubleshooting step into its complete ordered workflow', async () => {
    const { sourcePath, dataDirectory, parser } = await createTempWorkflowKnowledgeBase()
    const knowledge = createKnowledgeBase({ dataDirectory, parser })
    await knowledge.importDocuments([sourcePath])

    const results = await knowledge.searchKnowledge('L2VPN VPWS service is unavailable')

    assert.equal(results.length, 5)
    assert.deepEqual(results.map(result => result.workflowStep), ['1', '2', '3', '4', '5'])
    assert.equal(results.every(result => result.knowledgeType === 'troubleshooting'), true)
    assert.equal(results.every(result => result.source.title === 'vpws-troubleshooting.xlsx'), true)
    assert.equal(results[3].configurationReference.includes('<peer-ip>'), true)
    assert.equal(results[3].content.includes('Configuration reference'), true)
  })

  it('refreshes a legacy reimport so new configuration references become available', async () => {
    const { sourcePath, dataDirectory, parser } = await createTempWorkflowKnowledgeBase()
    const knowledge = createKnowledgeBase({ dataDirectory, parser })
    await knowledge.importDocuments([sourcePath])

    const statePath = path.join(dataDirectory, 'knowledge-base-v1.json')
    const legacyState = JSON.parse(await fs.readFile(statePath, 'utf8'))
    legacyState.documents[0].parserVersion = 'xlsx-workflow-config-v1'
    delete legacyState.units[3].configurationReference
    await fs.writeFile(statePath, JSON.stringify(legacyState), 'utf8')

    const restored = createKnowledgeBase({ dataDirectory, parser })
    const refreshed = await restored.importDocuments([sourcePath])
    const results = await restored.searchKnowledge('VPWS configuration')

    assert.equal(refreshed.imported.length, 1)
    assert.equal(refreshed.duplicates.length, 0)
    assert.equal(results[3].configurationReference.includes('<peer-ip>'), true)
  })

  it('replaces the previous index when the same workbook path is uploaded with changed content', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fiberterm-kb-refresh-'))
    const sourcePath = path.join(root, 'vpws-troubleshooting.xlsx')
    const dataDirectory = path.join(root, 'knowledge-data')
    let parseCount = 0
    const parser = async () => ({
      worksheets: [{ name: parseCount ? 'vpws与tunnel的对应关系' : 'Sheet1', sections: [] }],
      units: [{
        kind: 'reference',
        command: '',
        commandView: '',
        description: parseCount++ ? 'tunnel mapping updated' : 'old workflow',
        usageScope: 'Knowledge reference',
        example: '',
        expertNotes: '',
        referenceText: parseCount > 1 ? 'find the managed tunnel' : 'old workflow text',
        source: { worksheet: 'Sheet1', section: 'reference', row: 1 }
      }]
    })
    await fs.writeFile(sourcePath, 'original workbook')
    const knowledge = createKnowledgeBase({ dataDirectory, parser })

    await knowledge.importDocuments([sourcePath])
    await fs.writeFile(sourcePath, 'updated workbook with an extra sheet')
    const refreshed = await knowledge.importDocuments([sourcePath])

    assert.equal(refreshed.imported.length, 1)
    assert.equal((await knowledge.getKnowledgeStatus()).documentCount, 1)
    assert.equal((await knowledge.getKnowledgeStatus()).unitCount, 1)
    assert.deepEqual(await knowledge.searchKnowledge('old workflow'), [])
    assert.equal((await knowledge.searchKnowledge('tunnel mapping updated')).length, 1)
  })
})
