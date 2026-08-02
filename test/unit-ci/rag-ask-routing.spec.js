const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function loadKnowledgeRouting () {
  const filePath = path.resolve(__dirname, '../../src/client/components/ai/knowledge-routing.js')
  const source = await fs.readFile(filePath, 'utf8')
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
  return import(moduleUrl)
}

describe('Ask knowledge routing', () => {
  it('exports the browser-loadable routing function and leaves weak matches to normal AI', async () => {
    const { selectReliableEvidence } = await loadKnowledgeRouting()
    const evidence = [
      { chunkId: 'port', score: 9 },
      { chunkId: 'clock', score: 6 },
      { chunkId: 'weak', score: 3 }
    ]

    assert.deepEqual(selectReliableEvidence(evidence).map(item => item.chunkId), ['port'])
    assert.deepEqual(selectReliableEvidence([{ chunkId: 'single', score: 3 }]), [])
    assert.deepEqual(selectReliableEvidence([]), [])
  })
})
