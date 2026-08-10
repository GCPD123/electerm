const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function loadPolicy () {
  const filePath = path.resolve(__dirname, '../../src/client/components/ai/agent-execution-policy.js')
  const source = await fs.readFile(filePath, 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

describe('FiberHome Agent execution policy', () => {
  it('allows every requested command in the MVP unrestricted mode', async () => {
    const { AGENT_EXECUTION_POLICY_MODE, evaluateFiberhomeCommandExecution } = await loadPolicy()
    for (const command of [
      'show running-config',
      'configure terminal',
      'ping vc raw <VCID> remote <对端IP>',
      'vendor-specific-command'
    ]) {
      const decision = evaluateFiberhomeCommandExecution({
        prompt: 'run this command',
        evidence: [],
        command,
        executionTarget: null,
        terminalContext: { cliMode: 'unknown' }
      })
      assert.equal(decision.allowed, true)
      assert.equal(decision.mode, AGENT_EXECUTION_POLICY_MODE)
    }
  })

  it('keeps the policy seam immediately before the terminal write tool', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
      'utf8'
    )
    const toolStart = source.indexOf("case 'send_terminal_command':")
    const toolEnd = source.indexOf('\n    case ', toolStart + 1)
    const terminalTool = source.slice(toolStart, toolEnd)

    assert.equal(terminalTool.indexOf('evaluateFiberhomeCommandExecution') < terminalTool.indexOf('mcpSendTerminalCommand'), true)
    assert.match(terminalTool, /tabId: executionTarget\.tabId/)
  })

  it('shows the unrestricted Agent mode in the chat UI', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../src/client/components/ai/ai-chat.jsx'),
      'utf8'
    )

    assert.match(source, /Agent command execution is unrestricted in this MVP/)
  })

  it('shows only the sanitized Agent target state in history', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'),
      'utf8'
    )

    assert.match(source, /Agent target locked/)
    assert.match(source, /FiberHome user CLI/)
    assert.doesNotMatch(source, /terminalContext\.tabId/)
  })
})
