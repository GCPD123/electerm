import { useEffect, useState } from 'react'
import { Alert, Button, List, Modal, Popconfirm, Space, Tag } from 'antd'
import { DeleteOutlined, ReloadOutlined, UploadOutlined } from '@ant-design/icons'

export default function KnowledgeBaseModal ({ open, onClose }) {
  const [documents, setDocuments] = useState([])
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  async function refresh () {
    setLoading(true)
    try {
      const [nextStatus, nextDocuments] = await Promise.all([
        window.pre.runGlobalAsync('getKnowledgeStatus'),
        window.pre.runGlobalAsync('listKnowledgeDocuments')
      ])
      setStatus(nextStatus)
      setDocuments(nextDocuments)
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open) refresh()
  }, [open])

  async function importWorkbook () {
    const paths = await window.api.openDialog({
      properties: ['openFile'],
      filters: [{ name: 'SPN command workbook', extensions: ['xlsx'] }]
    })
    if (!paths || !paths.length) return
    setLoading(true)
    try {
      const result = await window.pre.runGlobalAsync('importKnowledgeDocuments', paths)
      const failed = result.failed.map(item => item.error).join('; ')
      setMessage(failed || `Imported ${result.imported.length}; skipped duplicates ${result.duplicates.length}`)
      await refresh()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  async function removeDocument (documentId) {
    setLoading(true)
    try {
      await window.pre.runGlobalAsync('removeKnowledgeDocument', documentId)
      await refresh()
    } finally {
      setLoading(false)
    }
  }

  async function rebuild () {
    setLoading(true)
    try {
      await window.pre.runGlobalAsync('rebuildKnowledgeIndex')
      setMessage('Knowledge index rebuilt')
      await refresh()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title='FiberHome knowledge base' open={open} onCancel={onClose} footer={null} width={720}>
      <Space className='mg1b'>
        <Button icon={<UploadOutlined />} onClick={importWorkbook} loading={loading}>Import XLSX</Button>
        <Button icon={<ReloadOutlined />} onClick={rebuild} loading={loading}>Rebuild index</Button>
        {status && <Tag>{status.documentCount} documents · {status.unitCount} commands</Tag>}
      </Space>
      {message && <Alert className='mg1b' type='info' showIcon message={message} />}
      <List
        loading={loading}
        dataSource={documents}
        locale={{ emptyText: 'Import an SPN command workbook to start searching.' }}
        renderItem={document => (
          <List.Item
            actions={[
              <Popconfirm key='remove' title='Remove this knowledge document?' onConfirm={() => removeDocument(document.id)}>
                <Button danger size='small' icon={<DeleteOutlined />}>Remove</Button>
              </Popconfirm>
            ]}
          >
            <List.Item.Meta
              title={document.title}
              description={`${document.unitCount} commands · ${document.worksheets.flatMap(sheet => sheet.sections).length} sections · imported ${new Date(document.importedAt).toLocaleString()}`}
            />
          </List.Item>
        )}
      />
    </Modal>
  )
}
