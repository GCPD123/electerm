export function selectReliableEvidence (evidence) {
  if (!Array.isArray(evidence) || !evidence.length) return []
  const scores = evidence.map(item => Number(item.score) || 0)
  const bestScore = Math.max(...scores)
  const threshold = Math.max(4, bestScore * 0.8)
  const reliable = evidence.filter(item => (Number(item.score) || 0) >= threshold)
  const workflows = reliable.filter(item => item.knowledgeType === 'troubleshooting')
  if (!workflows.length) return reliable.slice(0, 4)

  return workflows
    .sort((left, right) => Number(left.workflowStep) - Number(right.workflowStep) ||
      Number(left.source?.row) - Number(right.source?.row))
    .slice(0, 8)
}
