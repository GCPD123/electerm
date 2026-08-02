const { describe, it } = require('node:test')
const assert = require('node:assert/strict')

const { selectReliableEvidence } = require('../../src/client/components/ai/knowledge-routing')

describe('Ask knowledge routing', () => {
  it('uses only strong private-knowledge matches and leaves weak matches to normal AI', () => {
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
