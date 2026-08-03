const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function readAiSource (name) {
  return fs.readFile(path.resolve(__dirname, '../../src/client/components/ai', name), 'utf8')
}

describe('Agent knowledge preflight', () => {
  it('registers a read-only FiberHome knowledge tool without terminal execution', async () => {
    const source = await readAiSource('agent-tools.js')
    const toolStart = source.indexOf("name: 'search_fiberhome_knowledge'")
    const toolEnd = source.indexOf("case 'search_fiberhome_knowledge':")
    const nextCase = source.indexOf('\n    case ', toolEnd + 1)

    assert.notEqual(toolStart, -1)
    assert.notEqual(toolEnd, -1)
    assert.equal(source.slice(toolEnd, nextCase === -1 ? undefined : nextCase).includes("runGlobalAsync('searchKnowledge'"), true)
    assert.equal(source.slice(toolEnd, nextCase === -1 ? undefined : nextCase).includes('mcpSendTerminalCommand'), false)
  })

  it('searches the knowledge base before asking the model to choose Agent tools', async () => {
    const source = await readAiSource('agent.js')
    const preflight = source.indexOf("executeToolCall('search_fiberhome_knowledge'")
    const modelCall = source.indexOf('callBackendAIchatWithTools(messages, config)')

    assert.notEqual(preflight, -1)
    assert.equal(preflight < modelCall, true)
  })
})
