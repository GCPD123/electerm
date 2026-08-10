const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')

describe('Knowledge base modal', () => {
  it('uses the desktop file-picker API when importing an XLSX workbook', async () => {
    const modalPath = path.resolve(__dirname, '../../src/client/components/ai/knowledge-base-modal.jsx')
    const source = await fs.readFile(modalPath, 'utf8')

    assert.equal(source.includes('window.api.openDialog'), true)
    assert.equal(source.includes('window.pre.openDialog'), false)
    assert.equal(source.includes('knowledge units from'), true)
    assert.equal(source.includes('Skipped unchanged documents'), true)
  })
})
