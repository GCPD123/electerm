const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function loadVpwsParameters () {
  const filePath = path.resolve(__dirname, '../../src/client/components/ai/agent-vpws-parameters.js')
  const source = await fs.readFile(filePath, 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

const l2vcOutput = `PeerIp Pw_Id Pw_Status VPWS_Name
198.51.100.10 42 down vpws_demo-a`

describe('Agent VPWS command parameters', () => {
  it('fills a retrieved PW ping template only for an explicitly named VPWS service', async () => {
    const { resolveVpwsPingTemplate } = await loadVpwsParameters()
    const command = resolveVpwsPingTemplate({
      prompt: 'Execute PW ping for VPWS_DEMO-A',
      terminalOutput: l2vcOutput,
      commandTemplate: 'ping vc raw <VCID> s 100 m 1000 t 1000 remote <对端IP>'
    })

    assert.equal(command, 'ping vc raw 42 s 100 m 1000 t 1000 remote 198.51.100.10')
  })

  it('does not pick a service or fill a template when the target is not explicit', async () => {
    const { resolveVpwsPingTemplate } = await loadVpwsParameters()

    assert.equal(resolveVpwsPingTemplate({
      prompt: 'Execute the VPWS ping',
      terminalOutput: l2vcOutput,
      commandTemplate: 'ping vc raw <VCID> remote <对端IP>'
    }), null)
  })
})
