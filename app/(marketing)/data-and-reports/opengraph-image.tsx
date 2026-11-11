import { OG_CONTENT_TYPE, OG_SIZE, renderOgImage } from '@/lib/brand/og'
import { DATA_REPORTS_PAGE } from '@/lib/marketing-pages'

/** Link-preview card for this page (see lib/brand/og.tsx). */
export const alt = DATA_REPORTS_PAGE.title
export const size = OG_SIZE
export const contentType = OG_CONTENT_TYPE

export default function Image() {
  return renderOgImage({ eyebrow: DATA_REPORTS_PAGE.eyebrow, title: `${DATA_REPORTS_PAGE.title}.`, subtitle: 'Data tables, saved reports with charts, OData for Excel and Power BI, and a reporting API.' })
}
