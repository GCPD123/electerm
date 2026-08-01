import {
  packInfo
} from '../../common/constants'
import { Tag } from 'antd'
import './logo.styl'

export default function LogoElem () {
  const displayName = packInfo.displayName || packInfo.name
  const companyName = packInfo.companyName || 'FiberHome'
  const tagline = packInfo.productTagline || '企业智能运维终端'

  return (
    <h1 className='fiberterm-brand mg3y'>
      <span className='fiberterm-mark' aria-hidden='true'>
        FT
      </span>
      <span className='fiberterm-brand-copy'>
        <span className='fiberterm-name-row'>
          <span className='fiberterm-product-name'>{displayName}</span>
          <span className='fiberterm-company'>by {companyName}</span>
          <Tag color='#1677d2' variant='solid'>{packInfo.version}</Tag>
        </span>
        <span className='fiberterm-tagline'>{tagline}</span>
      </span>
    </h1>
  )
}
