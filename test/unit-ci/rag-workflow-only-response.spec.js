const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

async function loadWorkflowResponse () {
  const filePath = path.resolve(__dirname, '../../src/client/components/ai/workflow-response.js')
  const source = await fs.readFile(filePath, 'utf8')
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)
}

const workflowEvidence = [1, 2, 3].map(step => ({
  knowledgeType: 'troubleshooting',
  workflowStep: String(step),
  description: `Workflow step ${step}`,
  source: {
    title: 'vpws-troubleshooting.xlsx',
    worksheet: 'VPWS Workflow',
    row: step
  }
}))

const configurationEvidence = [{
  knowledgeType: 'troubleshooting',
  workflowStep: '4',
  description: 'Verify that the VPWS VLAN action is correct on both ends.',
  configurationReference: 'vpws <service-name>\npeer <peer-ip> vcid <vcid> encapsulation raw',
  source: {
    title: 'vpws-troubleshooting.xlsx',
    worksheet: 'VPWS Workflow',
    row: 4
  }
}]

describe('Workflow-only knowledge response', () => {
  it('returns only ordered source-backed workflow steps when no device execution is requested', async () => {
    const { buildWorkflowOnlyResponse } = await loadWorkflowResponse()
    const response = buildWorkflowOnlyResponse(
      'VPWS is unavailable. I am not connected to a device; only explain the steps and do not execute.',
      workflowEvidence
    )

    assert.match(response, /Step 1: Workflow step 1/)
    assert.match(response, /Step 2: Workflow step 2/)
    assert.match(response, /Step 3: Workflow step 3/)
    assert.equal(response.includes('display '), false)
    assert.equal(response.includes('show '), false)
    assert.equal(response.indexOf('Step 1') < response.indexOf('Step 2'), true)
  })

  it('does not intercept a request that asks for commands or terminal execution', async () => {
    const { buildWorkflowOnlyResponse } = await loadWorkflowResponse()

    assert.equal(buildWorkflowOnlyResponse('Run the VPWS commands on the device.', workflowEvidence), null)
  })

  it('returns a source-backed, redacted configuration reference for a configuration question', async () => {
    const { buildWorkflowConfigurationResponse } = await loadWorkflowResponse()
    const response = buildWorkflowConfigurationResponse('What does the VPWS configuration look like?', configurationEvidence)

    assert.match(response, /Configuration reference/)
    assert.match(response, /peer <peer-ip> vcid <vcid>/)
    assert.equal(response.includes('display '), false)
    assert.equal(response.includes('show '), false)
  })

  it('recognizes the Chinese no-device, steps-only request used in the VPWS report', async () => {
    const { buildWorkflowOnlyResponse } = await loadWorkflowResponse()
    const response = buildWorkflowOnlyResponse(
      '\u6211\u73b0\u5728\u6ca1\u63a5\u8bbe\u5907\uff0c\u53ea\u9700\u8981\u8bf4\u6b65\u9aa4\uff0c\u4e0d\u9700\u8981\u6267\u884c',
      workflowEvidence
    )

    assert.match(response, /\u4ee5\u4e0b\u4ec5\u4f9d\u636e\u77e5\u8bc6\u5e93/)
    assert.equal(response.includes('display '), false)
  })

  it('uses the deterministic workflow response before either chat mode calls a model', async () => {
    const [agent, ask] = await Promise.all([
      fs.readFile(path.resolve(__dirname, '../../src/client/components/ai/agent.js'), 'utf8'),
      fs.readFile(path.resolve(__dirname, '../../src/client/components/ai/ai-chat-history-item.jsx'), 'utf8')
    ])

    const agentWorkflowResponse = agent.indexOf('buildWorkflowOnlyResponse')
    const agentModelCall = agent.indexOf('callBackendAIchatWithTools(messages, config)')
    const askWorkflowResponse = ask.indexOf('buildWorkflowOnlyResponse')
    const askModelCall = ask.indexOf("'AIchat'")

    assert.notEqual(agentWorkflowResponse, -1)
    assert.notEqual(askWorkflowResponse, -1)
    assert.equal(agentWorkflowResponse < agentModelCall, true)
    assert.equal(askWorkflowResponse < askModelCall, true)
  })
})
