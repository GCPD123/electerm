const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const packageJson = require('../../package.json')

describe('Windows development launcher', () => {
  it('starts the source Electron app without a Unix-only command path', () => {
    assert.equal(packageJson.scripts.t, 'node build/bin/app')
  })
})
