#!/usr/bin/env node
/**
 * Mock third-party services for the screenshot demo workspace (local only).
 *
 *   node scripts/screenshots/mock-services.mjs            # 127.0.0.1:4010
 *   MOCK_PORT=4011 node scripts/screenshots/mock-services.mjs
 *
 * - "Northwind ERP" REST API
 *     GET  /vendors/:id        vendor master record (V-1099 hangs past the
 *                              engine's 30 s HTTP timeout and then answers 500,
 *                              so one invoice run fails realistically)
 *     GET  /vendors            vendor list: ?q= (name / id), ?country=, ?sort= &dir=,
 *                              ?page= &page_size= → { vendors, total, page } (Data table demos)
 *     POST /payments           schedules a payment → 201 { payment_id, … }
 *     POST /vendor-updates     receives one changed vendor (Data table "for each
 *                              changed row" demos) → 200 { ok, received }; vendor_id
 *                              V-1099 answers 422 so a per-row failure can be shown
 * - Splunk HTTP Event Collector
 *     POST /services/collector/event  → {"text":"Success","code":0}
 * - Generic webhook receiver
 *     POST /hooks/:name        → 200 { ok: true }
 * - GET /_stats               counts of everything received (for the seed script)
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.MOCK_PORT ?? 4010)
const HOST = '127.0.0.1'

const VENDORS = {
  'V-1001': { id: 'V-1001', name: 'Contoso Office Supplies', category: 'office', risk: 'low', country: 'NZ', iban: 'GB33BUKB20201555555555', payment_terms_days: 30 },
  'V-1002': { id: 'V-1002', name: 'Fabrikam Logistics', category: 'logistics', risk: 'medium', country: 'AU', iban: 'DE89370400440532013000', payment_terms_days: 45 },
  'V-1003': { id: 'V-1003', name: 'Litware Hardware', category: 'capex', risk: 'high', country: 'US', iban: 'FR1420041010050500013M02606', payment_terms_days: 30 },
  'V-1004': { id: 'V-1004', name: 'Tailspin Consulting', category: 'services', risk: 'medium', country: 'NZ', iban: 'NL91ABNA0417164300', payment_terms_days: 20 },
  'V-1005': { id: 'V-1005', name: 'Adventure Works Catering', category: 'facilities', risk: 'low', country: 'NZ', iban: 'GB29NWBK60161331926819', payment_terms_days: 14 },
  'V-1006': { id: 'V-1006', name: 'Proseware Software', category: 'it', risk: 'low', country: 'IE', iban: 'IE29AIBK93115212345678', payment_terms_days: 30 },
}
const FAILING_VENDOR = 'V-1099'
const HANG_MS = Number(process.env.MOCK_HANG_MS ?? 31_000)

const stats = { vendors: 0, payments: 0, splunk_requests: 0, splunk_events: 0, webhook_requests: 0, webhook_events: 0 }
let paymentSeq = 5000

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', () => resolve(''))
  })
}

/** Splunk HEC bodies are concatenated JSON objects (not an array). */
function countHecEvents(text) {
  let depth = 0, count = 0, inStr = false, esc = false
  for (const ch of text) {
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) count++
  }
  return count
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  const path = url.pathname.replace(/\/+$/, '') || '/'
  const body = await readBody(req)

  if (req.method === 'GET' && (path === '/' || path === '/health')) return send(res, 200, { ok: true, service: 'northwind-erp-mock' })
  if (req.method === 'GET' && path === '/_stats') return send(res, 200, stats)

  const vendor = path.match(/^\/vendors\/([^/]+)$/)
  if (vendor && req.method === 'GET') {
    stats.vendors++
    const id = decodeURIComponent(vendor[1])
    if (id === FAILING_VENDOR) {
      setTimeout(() => { if (!res.writableEnded) send(res, 500, { error: 'ERP vendor service unavailable', code: 'ERP-500' }) }, HANG_MS)
      return
    }
    if (VENDORS[id]) return send(res, 200, VENDORS[id])
    return send(res, 404, { error: `Vendor ${id} not found` })
  }
  if (path === '/vendors' && req.method === 'GET') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    const country = url.searchParams.get('country') ?? ''
    const sort = url.searchParams.get('sort') ?? ''
    const dir = url.searchParams.get('dir') === 'desc' ? -1 : 1
    let list = Object.values(VENDORS).filter((v) => (!q || `${v.id} ${v.name}`.toLowerCase().includes(q)) && (!country || v.country === country))
    if (sort && list.length && sort in list[0]) list = [...list].sort((a, b) => (a[sort] > b[sort] ? 1 : a[sort] < b[sort] ? -1 : 0) * dir)
    const total = list.length
    const size = Math.min(Math.max(Number(url.searchParams.get('page_size')) || total || 1, 1), 100)
    const page = Math.max(Number(url.searchParams.get('page')) || 1, 1)
    return send(res, 200, { vendors: list.slice((page - 1) * size, page * size), total, page })
  }
  if (path === '/vendor-updates' && req.method === 'POST') {
    stats.vendor_updates = (stats.vendor_updates ?? 0) + 1
    let input = {}
    try { input = JSON.parse(body || '{}') } catch { /* keep empty */ }
    if (input.vendor_id === FAILING_VENDOR) return send(res, 422, { error: `Vendor ${FAILING_VENDOR} is locked in the ERP` })
    return send(res, 200, { ok: true, received: input })
  }

  if (path === '/payments' && req.method === 'POST') {
    stats.payments++
    let input = {}
    try { input = JSON.parse(body || '{}') } catch { /* keep empty */ }
    const due = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
    return send(res, 201, { payment_id: `PAY-${++paymentSeq}`, status: 'scheduled', scheduled_for: due, ...input })
  }

  if (path === '/services/collector/event' || path === '/services/collector') {
    stats.splunk_requests++
    stats.splunk_events += countHecEvents(body)
    return send(res, 200, { text: 'Success', code: 0 })
  }
  if (path === '/services/collector/health') return send(res, 200, { text: 'HEC is healthy', code: 17 })

  if (path.startsWith('/hooks/') && req.method === 'POST') {
    stats.webhook_requests++
    try {
      const parsed = JSON.parse(body || 'null')
      stats.webhook_events += Array.isArray(parsed) ? parsed.length : Array.isArray(parsed?.events) ? parsed.events.length : 1
    } catch { stats.webhook_events += body.split('\n').filter(Boolean).length }
    return send(res, 200, { ok: true })
  }

  return send(res, 404, { error: 'Not found' })
})

server.listen(PORT, HOST, () => console.log(`mock services listening on http://${HOST}:${PORT}`))
