const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function loadKnowledgeAction () {
  const filePath = path.resolve(__dirname, '../../src/client/components/ai/agent-knowledge-action.js')
  const source = await fs.readFile(filePath, 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

async function loadVpwsParameters () {
  const filePath = path.resolve(__dirname, '../../src/client/components/ai/agent-vpws-parameters.js')
  const source = await fs.readFile(filePath, 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

describe('Agent direct knowledge execution', () => {
  it('selects the highest-ranked status query for a direct Chinese view request', async () => {
    const { selectDirectStatusQuery } = await loadKnowledgeAction()
    const command = selectDirectStatusQuery('查看 ISIS 路由表', [
      {
        command: 'show isis ip route',
        score: 20,
        applicability: { operationClass: 'status-query' }
      },
      {
        command: 'show route isis all-path',
        score: 20,
        applicability: { operationClass: 'status-query' }
      }
    ])

    assert.equal(command, 'show isis ip route')
  })

  it('does not turn explanation-only or non-status knowledge into a terminal action', async () => {
    const { selectDirectStatusQuery, selectParameterizedStatusQuery } = await loadKnowledgeAction()

    assert.equal(selectDirectStatusQuery('这个命令是什么意思', [{
      command: 'show isis ip route',
      score: 20,
      applicability: { operationClass: 'status-query' }
    }]), null)
    assert.equal(selectDirectStatusQuery('查看接口', [{
      command: 'interface ge1/1/1',
      score: 20,
      applicability: { operationClass: 'configuration' }
    }]), null)
    assert.equal(selectDirectStatusQuery('排查 VPWS 业务', [{
      command: 'ping vc raw <VCID> remote <对端IP>',
      score: 20,
      applicability: { operationClass: 'status-query' },
      actionability: { requiresParameters: true }
    }]), null)
    assert.equal(selectParameterizedStatusQuery('Execute VPWS_DEMO-A ping', [{
      command: 'ping vc raw <VCID> remote <对端IP>',
      score: 20,
      applicability: { operationClass: 'status-query' },
      actionability: { requiresParameters: true }
    }])?.command, 'ping vc raw <VCID> remote <对端IP>')
  })

  it('uses a named VPWS and current terminal output to fill a retrieved template', async () => {
    const { resolveVpwsPingTemplate } = await loadVpwsParameters()

    assert.equal(resolveVpwsPingTemplate({
      prompt: 'Execute VPWS_DEMO-A ping',
      terminalOutput: '198.51.100.10 42 down vpws_demo-a',
      commandTemplate: 'ping vc raw <VCID> remote <对端IP>'
    }), 'ping vc raw 42 remote 198.51.100.10')
  })

  it('dispatches the selected knowledge command before asking the model to analyze results', async () => {
    const source = await fs.readFile(
      path.resolve(__dirname, '../../src/client/components/ai/agent.js'),
      'utf8'
    )

    assert.match(source, /selectDirectStatusQuery/)
    assert.match(source, /resolveVpwsPingTemplate/)
    assert.equal(
      source.indexOf("executeToolCall('get_terminal_output'") <
        source.indexOf("executeToolCall('send_terminal_command'"),
      true
    )
    assert.equal(
      source.indexOf("executeToolCall('send_terminal_command'") <
        source.indexOf('callBackendAIchatWithTools(messages, config)'),
      true
    )
  })
})
