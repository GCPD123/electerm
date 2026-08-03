const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

describe('FiberTerm default watermark', () => {
  it('changes only the terminal background image and never the prompt content layer', () => {
    const source = fs.readFileSync(
      path.join(root, 'src/client/components/bg/css-overwrite.jsx'),
      'utf8'
    )
    const match = source.match(
      /async function createGlobalStyle[\s\S]*?const styles = \[\]/
    )

    assert.ok(match, 'default terminal background rule should exist')
    const defaultRule = match[0]
    assert.match(defaultRule, /background-image/)
    assert.match(defaultRule, /FiberHome/)
    assert.doesNotMatch(defaultRule, /content:/)
    assert.doesNotMatch(defaultRule, /display:/)
    assert.doesNotMatch(defaultRule, /align-items:/)
    assert.doesNotMatch(defaultRule, /justify-content:/)
  })

  it('does not add a content pseudo-element over the empty state', () => {
    const styles = fs.readFileSync(
      path.join(root, 'src/client/components/tabs/no-session.styl'),
      'utf8'
    )

    assert.match(styles, /\.fiberhome-logo-bg/)
    assert.match(styles, /background-image/)
    assert.doesNotMatch(styles, /\.fiberhome-logo-bg::before/)
  })

  it('keeps the internal Electron identity separate from the display name', () => {
    const packageInfo = JSON.parse(
      fs.readFileSync(path.join(root, 'package.json'), 'utf8')
    )

    assert.strictEqual(packageInfo.name, 'electerm')
    assert.strictEqual(packageInfo.displayName, 'FiberTerm')
    assert.strictEqual(packageInfo.productName, undefined)
  })
})
