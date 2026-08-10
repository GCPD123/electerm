const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function loadTerminalReadControl () {
  const filePath = path.resolve(__dirname, '../../src/client/components/ai/agent-terminal-read-control.js')
  const source = await fs.readFile(filePath, 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

describe('Agent terminal read control', () => {
  it('turns an unresolved Agent operation into a visible timeout instead of waiting forever', async () => {
    const { runWithTimeout } = await loadTerminalReadControl()

    await assert.rejects(
      runWithTimeout(new Promise(() => {}), 20, 'Reading terminal output'),
      /Reading terminal output timed out/
    )
  })

  it('stops repeated reads when the same terminal output does not change', async () => {
    const { createTerminalReadGuard, recordTerminalRead } = await loadTerminalReadControl()
    const guard = createTerminalReadGuard()
    const first = recordTerminalRead(guard, { tabId: 'tab-demo', output: 'demo output' })
    const second = recordTerminalRead(guard, { tabId: 'tab-demo', output: 'demo output' })
    const third = recordTerminalRead(guard, { tabId: 'tab-demo', output: 'demo output' })

    assert.equal(first.allowed, true)
    assert.equal(second.allowed, true)
    assert.deepEqual(third, {
      allowed: false,
      reason: 'Terminal output did not change after repeated reads.'
    })
  })

  it('keeps output reading on the submitted target even when CLI context is unknown', async () => {
    const agentSource = await fs.readFile(
      path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
      'utf8'
    )
    const toolsSource = await fs.readFile(
      path.resolve(__dirname, '../../src/client/components/ai/agent-tools.js'),
      'utf8'
    )
    const outputCase = toolsSource.slice(
      toolsSource.indexOf("case 'get_terminal_output':"),
      toolsSource.indexOf("case 'open_local_terminal':")
    )

    assert.match(agentSource, /remains allowed even when CLI context is unknown/)
    assert.match(outputCase, /tabId: terminalReadTarget\.tabId/)
    assert.match(outputCase, /mcpGetTerminalOutput\(readArgs\)/)
  })
})
