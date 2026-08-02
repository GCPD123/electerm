const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

describe('Ask RAG boundary', () => {
  it('retrieves knowledge without adding a terminal or Agent execution call', async () => {
    const source = await fs.readFile(path.resolve(
      __dirname,
      '../../src/client/components/ai/ai-chat-history-item.jsx'
    ), 'utf8')
    const askRequest = source.slice(
      source.indexOf('const startRequest'),
      source.indexOf('const startAgentRequest')
    )

    assert.match(askRequest, /runGlobalAsync\('searchKnowledge'/)
    assert.doesNotMatch(askRequest, /runCommandInTerminal|executeToolCall|send_terminal_command/)
  })
})
