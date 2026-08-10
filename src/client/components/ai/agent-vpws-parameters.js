const IP_ADDRESS = '(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)(?:\\.(?:25[0-5]|2[0-4]\\d|1?\\d?\\d)){3}'
const VPWS_NAME = /\bvpws(?:[_-][a-z0-9]+)+\b/i

function escapePattern (value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function requestedVpwsName (prompt) {
  return String(prompt || '').match(VPWS_NAME)?.[0]?.toLowerCase() || null
}

function l2vcParameters (terminalOutput, serviceName) {
  const row = new RegExp(
    `\\b(${IP_ADDRESS})\\s+(\\d+)\\s+\\S+.*?\\b${escapePattern(serviceName)}\\b`,
    'i'
  ).exec(String(terminalOutput || ''))
  if (!row) return null
  return { peerIp: row[1], vcid: row[2] }
}

export function resolveVpwsPingTemplate ({ prompt, terminalOutput, commandTemplate } = {}) {
  const serviceName = requestedVpwsName(prompt)
  const template = String(commandTemplate || '')
  if (!serviceName || !template.includes('<VCID>') || !template.includes('<对端IP>')) {
    return null
  }
  const parameters = l2vcParameters(terminalOutput, serviceName)
  if (!parameters) return null
  return template
    .replaceAll('<VCID>', parameters.vcid)
    .replaceAll('<对端IP>', parameters.peerIp)
}
