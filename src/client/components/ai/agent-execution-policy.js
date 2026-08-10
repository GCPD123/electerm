// MVP decision: Agent command execution is intentionally unrestricted.
// Keep this single seam so a future opt-in safety policy can be restored here.
export const AGENT_EXECUTION_POLICY_MODE = 'unrestricted'

export function evaluateFiberhomeCommandExecution () {
  return {
    allowed: true,
    mode: AGENT_EXECUTION_POLICY_MODE
  }
}
