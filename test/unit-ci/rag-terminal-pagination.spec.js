const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

describe('Agent terminal pagination boundary', () => {
  it('marks pager and password waits incomplete without sending a continuation key', async () => {
    const source = await fs.readFile(path.resolve(
      __dirname,
      '../../src/client/store/mcp-handler.js'
    ), 'utf8')
    const waitForIdle = source.slice(
      source.indexOf('Store.prototype.mcpWaitForTerminalIdle'),
      source.indexOf('// ==================== Terminal Status')
    )

    assert.match(waitForIdle, /terminalContext\.interactionState === 'paged'/)
    assert.match(waitForIdle, /completed: false/)
    assert.doesNotMatch(waitForIdle, /_sendData\('\\x20'\)|_sendData\(' '\)/)
  })
})
