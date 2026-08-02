function selectReliableEvidence (evidence) {
  if (!Array.isArray(evidence) || !evidence.length) return []
  const scores = evidence.map(item => Number(item.score) || 0)
  const bestScore = Math.max(...scores)
  const threshold = Math.max(4, bestScore * 0.8)
  return evidence.filter(item => (Number(item.score) || 0) >= threshold).slice(0, 4)
}

module.exports = {
  selectReliableEvidence
}
