const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function loadTerminalContext () {
  const filePath = path.resolve(__dirname, '../../src/client/common/fiberhome-terminal-context.js')
  const source = await fs.readFile(filePath, 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

describe('FiberHome terminal context', () => {
  it('recognizes Linux, ACE user and ACE diagnose prompts from fictional terminal lines', async () => {
    const { buildTerminalContextSnapshot } = await loadTerminalContext()

    assert.deepEqual(
      buildTerminalContextSnapshot({
        tabId: 'tab-demo',
        terminalInstanceId: 'term-demo',
        transport: 'ssh',
        output: 'operator@demo-node:~$ ',
        capturedAt: 100
      }),
      {
        tabId: 'tab-demo',
        terminalInstanceId: 'term-demo',
        transport: 'ssh',
        shellFamily: 'linux',
        cliMode: 'linux-shell',
        interactionState: 'ready',
        promptKind: 'linux',
        deviceModel: null,
        confidence: 'high',
        capturedAt: 100
      }
    )

    assert.equal(buildTerminalContextSnapshot({ output: '<DEMO-ACE>' }).cliMode, 'ace-user')
    assert.deepEqual(
      buildTerminalContextSnapshot({
        tabId: 'tab-telnet',
        terminalInstanceId: 'term-telnet',
        transport: 'telnet',
        output: 'ACE#',
        capturedAt: 200
      }),
      {
        tabId: 'tab-telnet',
        terminalInstanceId: 'term-telnet',
        transport: 'telnet',
        shellFamily: 'fiberhome-ace',
        cliMode: 'ace-user',
        interactionState: 'ready',
        promptKind: 'ace',
        deviceModel: null,
        confidence: 'high',
        capturedAt: 200
      }
    )
    assert.equal(buildTerminalContextSnapshot({ output: '[DEMO-ACE-diagnose]' }).cliMode, 'ace-diagnose')
  })

  it('recognizes a generic device-name hash prompt only after a FiberHome login banner', async () => {
    const { buildTerminalContextSnapshot } = await loadTerminalContext()
    const recognized = buildTerminalContextSnapshot({
      tabId: 'tab-telnet',
      terminalInstanceId: 'term-telnet',
      transport: 'telnet',
      output: 'Welcome to IP Transport Network Platform of FiberHome Corporation\nDEMO-650#'
    })

    assert.equal(recognized.shellFamily, 'fiberhome-ace')
    assert.equal(recognized.cliMode, 'ace-user')
    assert.equal(recognized.promptKind, 'fiberhome-user')
    assert.equal(recognized.confidence, 'high')
    assert.equal(buildTerminalContextSnapshot({
      transport: 'telnet',
      output: 'unrelated-device#'
    }).cliMode, 'unknown')
  })

  it('retains enough recent terminal history to recheck a generic FiberHome prompt', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../src/client/store/mcp-handler.js'),
      'utf8'
    )

    assert.match(source, /mcpGetTerminalOutput\(\{ tabId, lines: 100 \}\)/)
  })

  it('treats pager, password and unrecognized terminal state as non-ready', async () => {
    const { buildTerminalContextSnapshot } = await loadTerminalContext()

    assert.equal(buildTerminalContextSnapshot({ output: '<DEMO-ACE>\n--More--' }).interactionState, 'paged')
    assert.equal(buildTerminalContextSnapshot({ output: '<DEMO-ACE>\nPassword:' }).interactionState, 'password')
    assert.deepEqual(
      buildTerminalContextSnapshot({ output: 'unrecognized output' }),
      {
        tabId: null,
        terminalInstanceId: null,
        transport: 'unknown',
        shellFamily: 'unknown',
        cliMode: 'unknown',
        interactionState: 'unknown',
        promptKind: 'unknown',
        deviceModel: null,
        confidence: 'low',
        capturedAt: null
      }
    )
  })

  it('creates a model-safe context without local identifiers or terminal text', async () => {
    const { buildModelTerminalContext } = await loadTerminalContext()
    const modelContext = buildModelTerminalContext({
      tabId: 'tab-private',
      terminalInstanceId: 'term-private',
      transport: 'ssh',
      shellFamily: 'fiberhome-ace',
      cliMode: 'ace-user',
      interactionState: 'ready',
      promptKind: 'ace',
      deviceModel: null,
      confidence: 'high',
      capturedAt: 100
    })

    assert.deepEqual(modelContext, {
      transport: 'ssh',
      shellFamily: 'fiberhome-ace',
      cliMode: 'ace-user',
      interactionState: 'ready',
      promptKind: 'ace',
      deviceModel: null,
      confidence: 'high'
    })
    assert.doesNotMatch(JSON.stringify(modelContext), /tab-private|term-private/)
  })
})
