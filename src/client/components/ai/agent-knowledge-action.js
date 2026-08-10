const DIRECT_STATUS_REQUEST = /(?:查看|查询|检查|获取|执行|\bshow\b|\bdisplay\b|\bping\b|\btracert\b|\btraceroute\b)/i
const EXPLANATION_ONLY_REQUEST = /(?:什么意思|解释|说明|原理|为什么|如何使用|怎么使用)/i

export function selectDirectStatusQuery (prompt, evidence) {
  const request = String(prompt || '')
  if (!DIRECT_STATUS_REQUEST.test(request) || EXPLANATION_ONLY_REQUEST.test(request)) {
    return null
  }
  if (!Array.isArray(evidence)) return null

  const candidates = evidence
    .filter(entry => Number(entry.score) >= 4)
    .filter(entry => entry.applicability?.operationClass === 'status-query')
    .filter(entry => !entry.actionability?.requiresParameters)
    .filter(entry => String(entry.command || '').trim())
    .sort((left, right) => Number(right.score) - Number(left.score))

  return candidates[0]?.command || null
}

export function selectParameterizedStatusQuery (prompt, evidence) {
  const request = String(prompt || '')
  if (!DIRECT_STATUS_REQUEST.test(request) || EXPLANATION_ONLY_REQUEST.test(request)) {
    return null
  }
  if (!Array.isArray(evidence)) return null

  const candidates = evidence
    .filter(entry => Number(entry.score) >= 4)
    .filter(entry => entry.applicability?.operationClass === 'status-query')
    .filter(entry => entry.actionability?.requiresParameters)
    .filter(entry => String(entry.command || '').trim())
    .sort((left, right) => Number(right.score) - Number(left.score))

  return candidates[0] || null
}
