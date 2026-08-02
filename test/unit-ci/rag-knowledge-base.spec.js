const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { createKnowledgeBase } = require('../../src/app/lib/knowledge/knowledge-base')

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
      expertNotes: '',
      source: { worksheet: 'SPN Commands', section: 'Protocol queries', row: 3 }
    }]
  })
  return {
    sourcePath,
    dataDirectory: path.join(root, 'knowledge-data'),
    parser
  }
}

describe('KnowledgeBase', () => {
  it('persists structured XLSX units, searches Chinese/CLI tokens, deduplicates and removes', async () => {
    const { sourcePath, dataDirectory, parser } = await createTempKnowledgeBase()
    const knowledge = createKnowledgeBase({ dataDirectory, parser })

    const firstImport = await knowledge.importDocuments([sourcePath])
    assert.equal(firstImport.imported.length, 1)
    assert.equal(firstImport.imported[0].unitCount, 2)

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

    const duplicate = await knowledge.importDocuments([sourcePath])
    assert.equal(duplicate.duplicates.length, 1)
    assert.equal((await knowledge.getKnowledgeStatus()).unitCount, 2)

    const restored = createKnowledgeBase({ dataDirectory, parser })
    assert.equal((await restored.searchKnowledge('时钟状态'))[0].source.row, 3)

    await restored.removeDocument(firstImport.imported[0].id)
    assert.equal((await restored.getKnowledgeStatus()).unitCount, 0)
    assert.deepEqual(await restored.searchKnowledge('GE1/1/1'), [])
  })
})
