const FIBERHOME_REQUEST = /(?:fiberhome|spn|烽火)/i
const READ_ONLY_COMMAND = /^\s*(?:display|show|ping|tracert|traceroute)\b/i

export function evaluateFiberhomeCommandExecution ({ prompt, evidence, command }) {
  const request = String(prompt || '')
  const hasEvidence = Array.isArray(evidence) && evidence.length > 0
  const isFiberhomeRequest = FIBERHOME_REQUEST.test(request) || hasEvidence

  if (!isFiberhomeRequest) {
    return { allowed: true }
  }
  if (!hasEvidence) {
    return {
      allowed: false,
      reason: 'FiberHome command execution needs reliable knowledge evidence.'
    }
  }
  if (!READ_ONLY_COMMAND.test(String(command || ''))) {
    return {
      allowed: false,
      reason: 'Only read-only FiberHome commands can run automatically. Configuration or other changes need an explicit review step.'
    }
  }
  return { allowed: true }
}
