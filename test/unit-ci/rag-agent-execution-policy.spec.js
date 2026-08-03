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
  it('allows a read-only query with reliable knowledge in Agent mode', async () => {
    const { evaluateFiberhomeCommandExecution } = await loadPolicy()
    const decision = evaluateFiberhomeCommandExecution({
      prompt: '烽火设备时钟状态怎么查看',
      evidence: [{ command: 'display clock' }],
      command: 'display clock'
    })

    assert.equal(decision.allowed, true)
  })

  it('blocks a FiberHome command without evidence or with a changing form', async () => {
    const { evaluateFiberhomeCommandExecution } = await loadPolicy()

    assert.match(
      evaluateFiberhomeCommandExecution({
        prompt: '请执行烽火设备状态查询',
        evidence: [],
        command: 'display clock'
      }).reason,
      /reliable knowledge/
    )
    assert.match(
      evaluateFiberhomeCommandExecution({
        prompt: '烽火设备配置怎么做',
        evidence: [{ command: 'configure terminal' }],
        command: 'configure terminal'
      }).reason,
      /read-only/
    )
  })

  it('enforces the policy before the terminal write tool runs', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
      'utf8'
    )
    const toolStart = source.indexOf("case 'send_terminal_command':")
    const toolEnd = source.indexOf('\n    case ', toolStart + 1)
    const terminalTool = source.slice(toolStart, toolEnd)

    assert.equal(terminalTool.indexOf('evaluateFiberhomeCommandExecution') < terminalTool.indexOf('mcpSendTerminalCommand'), true)
  })
})
