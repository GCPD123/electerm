const MAX_UNCHANGED_READS = 3

export function runWithTimeout (operation, timeout, label) {
  let timeoutId
  const timeoutPromise = new Promise((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeout}ms.`))
    }, timeout)
  })
  return Promise.race([operation, timeoutPromise]).finally(() => clearTimeout(timeoutId))
}

export function createTerminalReadGuard () {
  return {
    lastKey: '',
    unchangedReads: 0
  }
}

export function recordTerminalRead (guard, { tabId, output }) {
  const key = `${tabId || ''}\n${String(output || '')}`
  guard.unchangedReads = guard.lastKey === key
    ? guard.unchangedReads + 1
    : 1
  guard.lastKey = key

  if (guard.unchangedReads >= MAX_UNCHANGED_READS) {
    return {
      allowed: false,
      reason: 'Terminal output did not change after repeated reads.'
    }
  }
  return { allowed: true }
}
