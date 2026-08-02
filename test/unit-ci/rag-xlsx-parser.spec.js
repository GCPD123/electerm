const { describe, it } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs/promises')
const os = require('node:os')
const path = require('node:path')

const { parseXlsxCommandWorkbook } = require('../../src/app/lib/knowledge/xlsx-parser')

function crc32 (buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeStoredZip (files) {
  const localParts = []
  const directoryParts = []
  let offset = 0

  for (const { name, content } of files) {
    const nameBuffer = Buffer.from(name)
    const contentBuffer = Buffer.from(content)
    const crc = crc32(contentBuffer)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(contentBuffer.length, 18)
    local.writeUInt32LE(contentBuffer.length, 22)
    local.writeUInt16LE(nameBuffer.length, 26)

    const directory = Buffer.alloc(46)
    directory.writeUInt32LE(0x02014b50, 0)
    directory.writeUInt16LE(20, 4)
    directory.writeUInt16LE(20, 6)
    directory.writeUInt16LE(0, 8)
    directory.writeUInt16LE(0, 10)
    directory.writeUInt32LE(crc, 16)
    directory.writeUInt32LE(contentBuffer.length, 20)
    directory.writeUInt32LE(contentBuffer.length, 24)
    directory.writeUInt16LE(nameBuffer.length, 28)
    directory.writeUInt32LE(offset, 42)

    localParts.push(local, nameBuffer, contentBuffer)
    directoryParts.push(directory, nameBuffer)
    offset += local.length + nameBuffer.length + contentBuffer.length
  }

  const directorySize = directoryParts.reduce((size, part) => size + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directorySize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...localParts, ...directoryParts, end])
}

function sharedStrings (values) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${values.length}" uniqueCount="${values.length}">${values.map(value => `<si><t>${value}</t></si>`).join('')}</sst>`
}

async function createFixture () {
  const values = [
    'SPN650/SPN690E 协议栈常用查询命令行', '命令视图', '说明', '使用范围', '实例', '专家解读',
    'show interface GE1/1/1', '用户视图', '查看接口状态', '一线',
    '协议栈(diagnose)诊断模式下', 'show clock\nshow ntp status', 'diagnose', '查看时钟状态', '二线',
    'interface eth-10gi 0/22/0/1.100\n no shutdown'
  ]
  const workbook = '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="SPN Commands" sheetId="1" r:id="rId1"/></sheets></workbook>'
  const relationships = '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>'
  const worksheet = `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
    <row r="1"><c r="B1" s="2" t="s"><v>0</v></c><c r="C1" s="2" t="s"><v>1</v></c><c r="D1" s="2" t="s"><v>2</v></c><c r="E1" s="2" t="s"><v>3</v></c><c r="F1" s="2" t="s"><v>4</v></c><c r="G1" s="2" t="s"><v>5</v></c></row>
    <row r="2"><c r="B2" s="1" t="s"><v>6</v></c><c r="C2" s="1" t="s"><v>7</v></c><c r="D2" s="1" t="s"><v>8</v></c><c r="E2" s="1" t="s"><v>9</v></c></row>
    <row r="3"><c r="B3" s="2" t="s"><v>10</v></c><c r="C3" s="2" t="s"><v>1</v></c><c r="D3" s="2" t="s"><v>2</v></c><c r="E3" s="2" t="s"><v>3</v></c></row>
    <row r="4"><c r="B4" s="1" t="s"><v>11</v></c><c r="C4" s="1" t="s"><v>12</v></c><c r="D4" s="1" t="s"><v>13</v></c><c r="E4" s="1" t="s"><v>14</v></c></row>
    <row r="5"><c r="B5" s="1" t="s"><v>15</v></c><c r="C5" s="1" t="s"><v>7</v></c><c r="D5" s="1" t="s"><v>8</v></c><c r="E5" s="1" t="s"><v>9</v></c></row>
  </sheetData></worksheet>`
  const fixturePath = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'fiberterm-xlsx-')), 'spn-command-fixture.xlsx')
  await fs.writeFile(fixturePath, writeStoredZip([
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: relationships },
    { name: 'xl/sharedStrings.xml', content: sharedStrings(values) },
    { name: 'xl/worksheets/sheet1.xml', content: worksheet }
  ]))
  return fixturePath
}

describe('SPN XLSX parser', () => {
  it('keeps sections, command groups, empty columns, CLI punctuation and source rows', async () => {
    const fixturePath = await createFixture()
    const result = await parseXlsxCommandWorkbook(fixturePath)

    assert.equal(result.worksheets.length, 1)
    assert.equal(result.worksheets[0].name, 'SPN Commands')
    assert.equal(result.worksheets[0].sections.length, 2)
    assert.equal(result.units.length, 3)

    assert.deepEqual(result.units[0], {
      command: 'show interface GE1/1/1',
      commandView: '用户视图',
      description: '查看接口状态',
      usageScope: '一线',
      example: '',
      expertNotes: '',
      source: {
        worksheet: 'SPN Commands',
        section: 'SPN650/SPN690E 协议栈常用查询命令行',
        row: 2
      }
    })
    assert.equal(result.units[1].command, 'show clock\nshow ntp status')
    assert.equal(result.units[1].source.section, '协议栈(diagnose)诊断模式下')
    assert.equal(result.units[2].command, 'interface eth-10gi 0/22/0/1.100\n no shutdown')
    assert.equal(result.units[2].source.row, 5)
  })
})
