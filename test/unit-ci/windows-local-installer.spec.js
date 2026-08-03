const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const path = require('node:path')
const packageJson = require('../../package.json')

describe('Windows local installer', () => {
  it('uses a local-only script that preserves existing distribution files', async () => {
    assert.equal(packageJson.scripts['package:win-local'], 'npm run b && node build/bin/build-win-nsis-local.js')

    const scriptPath = path.resolve(__dirname, '../../build/bin/build-win-nsis-local.js')
    const source = await fs.readFile(scriptPath, 'utf8')
    assert.equal(source.includes('uploadToR2'), false)
    assert.equal(source.includes("rm('-rf', 'dist')"), false)
    assert.equal(source.includes('dist/fiberterm-local'), true)

    const preparePath = path.resolve(__dirname, '../../build/bin/prepare.js')
    const prepareSource = await fs.readFile(preparePath, 'utf8')
    assert.equal(prepareSource.includes("resolve(cwd, '.cache', 'npm-packaging')"), true)
    assert.equal(prepareSource.includes("throw new Error('Production dependency install failed')"), true)
  })
})
