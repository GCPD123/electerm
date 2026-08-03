const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '../..')

function readSource (...segments) {
  return fs.readFileSync(path.join(root, ...segments), 'utf8')
}

describe('FiberTerm brand shell', () => {
  it('keeps one title-bar signature in the primary split pane', () => {
    const source = readSource('src', 'client', 'components', 'tabs', 'index.jsx')

    assert.match(source, /const showTitleBrand = batch === 0/)
    assert.match(source, /const brandWidth = showTitleBrand \? 176 : 0/)
    assert.match(source, /showTitleBrand\s*\? \(/)
  })

  it('keeps the product signature draggable when native drag events are used', () => {
    const source = readSource('src', 'client', 'components', 'tabs', 'app-drag.jsx')

    assert.match(source, /closest\?\.\('\.fiberterm-title-brand'\)/)
    assert.match(source, /!inTitleBrand/)
  })

  it('uses FiberTerm identity in the About and error surfaces without upstream support contacts', () => {
    const errorSource = readSource('src', 'client', 'components', 'main', 'error-wrapper.jsx')
    const aboutSource = readSource('src', 'client', 'components', 'sidebar', 'info-modal.jsx')

    assert.match(errorSource, /import LogoElem from '\.\.\/common\/logo-elem'/)
    assert.match(errorSource, /contact your organization/)
    assert.doesNotMatch(errorSource, /zxdong@gmail.com/)
    assert.doesNotMatch(errorSource, /electerm-wechat-group-qr/)
    assert.match(aboutSource, /\{e\('about'\)\} \{displayName\}/)
    assert.match(aboutSource, /Open-source upstream/)
  })
})
