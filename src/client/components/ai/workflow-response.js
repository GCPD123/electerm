const WORKFLOW_ONLY_REQUEST = /(?:只(?:需要|要|说).{0,12}(?:步骤|思路|流程)|(?:不需要|不要|无需).{0,8}(?:执行|下发|命令)|(?:没有|没).{0,8}(?:接(?:入|上)?设备|连接设备)|only\s+(?:the\s+)?(?:steps|workflow)|do\s+not\s+(?:execute|run)|not\s+connected\s+to\s+(?:a\s+)?device)/i
const EXECUTION_REQUEST = /(?:请|帮我|自动|立即|开始|直接).{0,8}(?:执行|下发|运行)|(?:执行|下发|运行).{0,8}(?:命令|检查)|\brun\s+(?:the\s+)?(?:commands?|checks?)/i
const CONFIGURATION_REQUEST = /(?:配置|配置模板|vlan\s*action|configuration|config)/i

function compareSteps (left, right) {
  const leftStep = Number(left.workflowStep)
  const rightStep = Number(right.workflowStep)
  if (Number.isFinite(leftStep) && Number.isFinite(rightStep) && leftStep !== rightStep) {
    return leftStep - rightStep
  }
  return Number(left.source?.row) - Number(right.source?.row)
}

function isChineseRequest (prompt) {
  return /[\u3400-\u9fff]/.test(String(prompt || ''))
}

export function buildWorkflowOnlyResponse (prompt, evidence) {
  if (!WORKFLOW_ONLY_REQUEST.test(String(prompt || '')) || EXECUTION_REQUEST.test(String(prompt || ''))) {
    return null
  }
  const steps = (Array.isArray(evidence) ? evidence : [])
    .filter(entry => entry.knowledgeType === 'troubleshooting' && entry.description)
    .sort(compareSteps)
  if (!steps.length) return null

  const chinese = isChineseRequest(prompt)
  const heading = chinese
    ? '以下仅依据知识库中的排障流程说明，不执行命令：'
    : 'The following steps come only from the troubleshooting workflow in the knowledge base; no commands are executed:'
  const renderedSteps = steps.map(entry => {
    const source = `${entry.source?.title || 'knowledge base'} / ${entry.source?.worksheet || ''} / row ${entry.source?.row || ''}`
    return chinese
      ? `${entry.workflowStep}. ${entry.description}（来源：${source}）`
      : `Step ${entry.workflowStep}: ${entry.description} (Source: ${source})`
  })
  const note = chinese
    ? '说明：带业务参数的诊断命令属于模板；未连接设备时不会生成或执行额外的厂商命令。'
    : 'Note: diagnostics that need service parameters remain templates; no additional vendor command is generated or run without a device.'
  return [heading, ...renderedSteps, note].join('\n\n')
}

export function buildWorkflowConfigurationResponse (prompt, evidence) {
  if (!CONFIGURATION_REQUEST.test(String(prompt || '')) || EXECUTION_REQUEST.test(String(prompt || ''))) {
    return null
  }
  const references = (Array.isArray(evidence) ? evidence : [])
    .filter(entry => entry.knowledgeType === 'troubleshooting' && entry.configurationReference)
    .sort(compareSteps)
  if (!references.length) return null

  const chinese = isChineseRequest(prompt)
  const heading = chinese
    ? '以下是知识库中用于核对 VPWS 配置的脱敏模板，不是可直接下发的配置：'
    : 'The following are redacted VPWS configuration references from the knowledge base. They are for review, not direct execution:'
  const renderedReferences = references.map(entry => {
    const source = `${entry.source?.title || 'knowledge base'} / ${entry.source?.worksheet || ''} / row ${entry.source?.row || ''}`
    return chinese
      ? `步骤 ${entry.workflowStep}：${entry.description}\n\n${entry.configurationReference}\n\n来源：${source}`
      : `Step ${entry.workflowStep}: ${entry.description}\n\nConfiguration reference:\n${entry.configurationReference}\n\nSource: ${source}`
  })
  const note = chinese
    ? '核对时重点比较两端的业务关联、接入接口、对端、VCID、封装方式、VLAN 动作及承载隧道；占位符必须替换为当前业务的实际值，系统不会自动执行这些配置。'
    : 'Compare service association, access interface, peer, VCID, encapsulation, VLAN action and transport tunnel on both ends. Replace placeholders with current values; the system will not execute this configuration.'
  return [heading, ...renderedReferences, note].join('\n\n')
}
