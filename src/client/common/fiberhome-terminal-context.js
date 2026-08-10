// Terminal escape sequences are deliberately removed before prompt detection.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE = /\u001b\[[0-?]*[ -/]*[@-~]/g
const PAGER_PROMPT = /(?:--\s*more\s*--|press\s+(?:any\s+)?key\s+to\s+continue)/i
const PASSWORD_PROMPT = /(?:password|passphrase|密码|口令)[^\n]{0,32}[:：]\s*$/i
const LINUX_PROMPT = /(?:[\w.-]+@[\w.-]+(?::[~/\w.-]+)?|(?:[\w.-]+:)?[~/][\w./-]*)[$#]\s*$/
const ACE_DIAGNOSE_PROMPT = /^(?:<.*(?:diagnose|diagnostic).*>|\[.*(?:diagnose|diagnostic).*\])\s*$/i
const ACE_PROMPT = /^(?:<.+>|\[.+\])\s*$/
const ACE_HASH_PROMPT = /^ace(?:[-_][a-z0-9]+)?#\s*$/i
const FIBERHOME_USER_PROMPT = /^[a-z0-9][a-z0-9._-]{0,63}#\s*$/i
const FIBERHOME_LOGIN_BANNER = /(?:ip transport network platform of fiberhome|fiberhome corporation)/i
const CONNECTED_TRANSPORTS = new Set(['ssh', 'telnet'])

function normalizedLines (output) {
  return String(output || '')
    .replace(ANSI_ESCAPE, '')
    .replace(/\r/g, '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim())
}

function detectPrompt (lines) {
  const isFiberhomeSession = lines.some(line => FIBERHOME_LOGIN_BANNER.test(line))
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index].trim()
    if (ACE_DIAGNOSE_PROMPT.test(line)) {
      return {
        shellFamily: 'fiberhome-ace',
        cliMode: 'ace-diagnose',
        promptKind: 'ace-diagnose',
        confidence: 'high'
      }
    }
    if (ACE_PROMPT.test(line) || ACE_HASH_PROMPT.test(line)) {
      return {
        shellFamily: 'fiberhome-ace',
        cliMode: 'ace-user',
        promptKind: 'ace',
        confidence: 'high'
      }
    }
    if (isFiberhomeSession && FIBERHOME_USER_PROMPT.test(line)) {
      return {
        shellFamily: 'fiberhome-ace',
        cliMode: 'ace-user',
        promptKind: 'fiberhome-user',
        confidence: 'high'
      }
    }
    if (LINUX_PROMPT.test(line)) {
      return {
        shellFamily: 'linux',
        cliMode: 'linux-shell',
        promptKind: 'linux',
        confidence: 'high'
      }
    }
  }
  return {
    shellFamily: 'unknown',
    cliMode: 'unknown',
    promptKind: 'unknown',
    confidence: 'low'
  }
}

function detectInteractionState (lastLine, stateOverride, promptKind) {
  if (PAGER_PROMPT.test(lastLine)) return 'paged'
  if (PASSWORD_PROMPT.test(lastLine)) return 'password'
  if (stateOverride === 'password') return 'password'
  if (stateOverride === 'running') return 'running'
  return lastLine && promptKind !== 'unknown' ? 'ready' : 'unknown'
}

export function buildTerminalContextSnapshot ({
  tabId = null,
  terminalInstanceId = null,
  transport = 'unknown',
  output = '',
  interactionState: stateOverride,
  capturedAt = null
} = {}) {
  const lines = normalizedLines(output)
  const lastLine = lines[lines.length - 1] || ''
  const prompt = detectPrompt(lines)
  const interactionState = detectInteractionState(lastLine, stateOverride, prompt.promptKind)

  return {
    tabId: tabId || null,
    terminalInstanceId: terminalInstanceId || null,
    transport: CONNECTED_TRANSPORTS.has(transport) ? transport : 'unknown',
    shellFamily: prompt.shellFamily,
    cliMode: prompt.cliMode,
    interactionState,
    promptKind: prompt.promptKind,
    deviceModel: null,
    confidence: prompt.confidence,
    capturedAt: capturedAt || null
  }
}

export function buildModelTerminalContext (snapshot = {}) {
  return {
    transport: CONNECTED_TRANSPORTS.has(snapshot.transport) ? snapshot.transport : 'unknown',
    shellFamily: snapshot.shellFamily || 'unknown',
    cliMode: snapshot.cliMode || 'unknown',
    interactionState: snapshot.interactionState || 'unknown',
    promptKind: snapshot.promptKind || 'unknown',
    deviceModel: null,
    confidence: snapshot.confidence || 'low'
  }
}

export function isReadyFiberhomeExecutionContext (snapshot = {}) {
  return CONNECTED_TRANSPORTS.has(snapshot.transport) &&
    snapshot.shellFamily === 'fiberhome-ace' &&
    (snapshot.cliMode === 'ace-user' || snapshot.cliMode === 'ace-diagnose') &&
    snapshot.interactionState === 'ready' &&
    snapshot.confidence === 'high' &&
    Boolean(snapshot.tabId) &&
    Boolean(snapshot.terminalInstanceId)
}
