// Black-box smoke test of a running UserTasks install, over HTTP only
// (dependency-free; Node 20+). Run inside the deployment's network by
// `npm run stack -- smoke`, or from anywhere that reaches the app:
//
//   SMOKE_URL=http://localhost:3000 SMOKE_API_KEY=ut_… SMOKE_EMAIL=… SMOKE_PASSWORD=… \
//   SMOKE_ORG=<slug> SMOKE_SIGNIN_ACTION=<server action id> node deploy/compose/smoke/smoke.mjs
//
// Checks: the app answers; the API key works (database + RLS path); a task
// round trip; password sign-in through the login page's server action (the
// auth provider) and the session it sets; a file upload served back by
// /files (storage provider); the realtime SSE stream (REALTIME_PROVIDER=sse);
// an invitation email reaching the mail sink (email provider); and, with
// SMOKE_LOGS, a log destination's test event reaching the cloud log stand-in.
//
// Optional: SMOKE_REALTIME=sse|skip (default sse),
// SMOKE_MAIL=mailpit|acs-mock|ses-mock|skip and SMOKE_MAIL_URL (default
// http://mailpit:8025, or http://mocks:8080 for the stand-ins),
// SMOKE_LOGS=azure_monitor|gcp_logging|aws_cloudwatch_logs with
// SMOKE_LOGS_CONFIG (the destination config JSON) and SMOKE_LOGS_URL (default
// http://mocks:8080, or http://localstack:4566 for CloudWatch).
// Exit code 0 when every check passes.

const BASE = (process.env.SMOKE_URL || 'http://app:3000').replace(/\/+$/, '')
const KEY = process.env.SMOKE_API_KEY || ''
const EMAIL = process.env.SMOKE_EMAIL || ''
const PASSWORD = process.env.SMOKE_PASSWORD || ''
const ORG = process.env.SMOKE_ORG || ''
const ACTION = process.env.SMOKE_SIGNIN_ACTION || ''
const REALTIME = process.env.SMOKE_REALTIME || 'sse'
const MAIL = process.env.SMOKE_MAIL || 'mailpit'
const MAIL_URL = (process.env.SMOKE_MAIL_URL || (MAIL.endsWith('-mock') ? 'http://mocks:8080' : 'http://mailpit:8025')).replace(/\/+$/, '')
const LOGS = process.env.SMOKE_LOGS || ''
const LOGS_URL = (process.env.SMOKE_LOGS_URL || (LOGS === 'aws_cloudwatch_logs' ? 'http://localstack:4566' : 'http://mocks:8080')).replace(/\/+$/, '')
const RUN = Date.now().toString(36)

const results = []
async function check(name, fn) {
  const started = Date.now()
  try {
    const detail = await fn()
    results.push({ name, ok: true, ms: Date.now() - started, detail: detail ?? '' })
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: String(error?.message ?? error).slice(0, 300) })
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, path, body) {
  const res = await fetch(`${BASE}/api/v1${path}`, {
    method,
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok || json?.success === false) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json?.error ?? json).slice(0, 200)}`)
  return json && 'data' in json ? json.data : json
}

/** Absolute file URLs carry the public origin (APP_URL); fetch them through BASE. */
function viaBase(url) {
  const u = new URL(url, BASE)
  return u.pathname.startsWith('/files/') ? `${BASE}${u.pathname}${u.search}` : u.toString()
}

let cookie = ''
let userId = ''

async function main() {
  if (!KEY) { console.error('SMOKE_API_KEY is required'); process.exit(2) }

  await check('app answers', async () => {
    for (let i = 0; i < 60; i++) {
      const res = await fetch(`${BASE}/api/config/public`).catch(() => null)
      if (res?.ok) return `GET /api/config/public ${res.status}`
      await sleep(1000)
    }
    throw new Error('no answer from /api/config/public within 60 s')
  })

  await check('API key (/api/v1/me)', async () => {
    const me = await api('GET', '/me')
    return `tenant ${me?.tenant?.slug ?? me?.tenant_id ?? '?'}`
  })

  await check('task round trip', async () => {
    const created = await api('POST', '/tasks/ingest', { title: `Smoke task ${RUN}` })
    const id = created?.task_id
    if (!id) throw new Error(`no task_id in ${JSON.stringify(created).slice(0, 200)}`)
    const read = await api('GET', `/tasks/${id}`)
    if ((read?.task ?? read)?.title !== `Smoke task ${RUN}`) throw new Error('task read back differs')
    await api('PATCH', `/tasks/${id}`, { status: 'in_progress' })
    return `created, read and updated ${id}`
  })

  await check('password sign-in (auth provider)', async () => {
    if (!ACTION || !EMAIL || !PASSWORD || !ORG) throw new Error('SMOKE_SIGNIN_ACTION, SMOKE_EMAIL, SMOKE_PASSWORD and SMOKE_ORG are required')
    const res = await fetch(`${BASE}/login`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'next-action': ACTION,
        'content-type': 'text/plain;charset=UTF-8',
        accept: 'text/x-component',
        origin: new URL(BASE).origin,
      },
      body: JSON.stringify([{ org: ORG, email: EMAIL, password: PASSWORD, redirect: '/tasks' }]),
    })
    const text = await res.text()
    const cookies = res.headers.getSetCookie?.() ?? []
    if (!res.ok) throw new Error(`server action → ${res.status} ${text.slice(0, 160)}`)
    if (!/"ok":true/.test(text)) throw new Error(`sign-in refused: ${text.slice(0, 200)}`)
    cookie = cookies.map((c) => c.split(';')[0]).join('; ')
    if (!cookie) throw new Error('no session cookie set')
    const session = await fetch(`${BASE}/api/auth/session`, { headers: { cookie } })
    const body = await session.json().catch(() => ({}))
    if (!session.ok || !body.userId) throw new Error(`/api/auth/session → ${session.status}`)
    userId = body.userId
    return `signed in as ${userId}`
  })

  await check('file upload served by /files (storage provider)', async () => {
    const bytes = Buffer.concat([Buffer.from('wOF2'), Buffer.from(`smoke-${RUN}-`.padEnd(64, 'x'))])
    const uploaded = await api('POST', '/workspace-theme/fonts', { file_name: `Smoke-${RUN}.woff2`, content_base64: bytes.toString('base64') })
    const url = uploaded?.url ?? uploaded?.font?.url
    if (!url) throw new Error(`no url in ${JSON.stringify(uploaded).slice(0, 200)}`)
    const res = await fetch(viaBase(url))
    const got = Buffer.from(await res.arrayBuffer())
    if (!res.ok || !got.equals(bytes)) throw new Error(`GET ${url} → ${res.status}, ${got.length} bytes (expected ${bytes.length})`)
    return `${new URL(url, BASE).pathname} (${res.headers.get('content-type')})`
  })

  if (REALTIME === 'sse') {
    await check('realtime stream (SSE)', async () => {
      if (!cookie || !userId) throw new Error('needs the signed-in session')
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 15_000)
      try {
        const key = `notifications|user_id=eq.${userId}|*`
        const res = await fetch(`${BASE}/api/internal/realtime?s=${encodeURIComponent(key)}`, { headers: { cookie, accept: 'text/event-stream' }, signal: ctrl.signal })
        if (!res.ok || !String(res.headers.get('content-type')).includes('text/event-stream')) throw new Error(`→ ${res.status} ${res.headers.get('content-type')}`)
        const reader = res.body.getReader()
        const { value } = await reader.read()
        await reader.cancel().catch(() => undefined)
        return `event-stream open, first frame: ${JSON.stringify(Buffer.from(value ?? []).toString('utf8').slice(0, 60))}`
      } finally {
        clearTimeout(timer)
      }
    })
  }

  if (MAIL !== 'skip') {
    await check(`invitation email (${MAIL})`, async () => {
      const to = `invitee-${RUN}@usertasks.test`
      const sent = await api('POST', '/invitations', { email: to, role: 'member' })
      if (sent?.email_sent === false) throw new Error('the API reports email_sent: false')
      for (let i = 0; i < 30; i++) {
        if (MAIL === 'mailpit') {
          const res = await fetch(`${MAIL_URL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
          const json = await res.json().catch(() => ({}))
          if (json.messages_count > 0 || json.total > 0) return `delivered to Mailpit: "${json.messages?.[0]?.Subject ?? ''}"`
        } else if (MAIL === 'ses-mock') {
          const res = await fetch(`${MAIL_URL}/_mock/ses`)
          const list = await res.json().catch(() => [])
          const hit = list.find((m) => (m.Destination?.ToAddresses ?? []).includes(to))
          if (hit) return `accepted by the SES v2 endpoint: "${hit.Content?.Simple?.Subject?.Data ?? ''}"`
        } else {
          const res = await fetch(`${MAIL_URL}/_mock/emails`)
          const list = await res.json().catch(() => [])
          const hit = list.find((m) => (m.recipients?.to ?? []).some((r) => r.address === to))
          if (hit) return `accepted by the ACS endpoint: "${hit.content?.subject ?? ''}"`
        }
        await sleep(1000)
      }
      throw new Error(`no message to ${to} within 30 s`)
    })
  }

  if (LOGS) {
    await check(`log export (${LOGS})`, async () => {
      const config = JSON.parse(process.env.SMOKE_LOGS_CONFIG || '{}')
      const created = await api('POST', '/log-destinations', { name: `Smoke ${LOGS} ${RUN}`, type: LOGS, config, filters: { categories: ['system'] } })
      const id = (created?.log_destination ?? created)?.id
      if (!id) throw new Error(`no destination id in ${JSON.stringify(created).slice(0, 200)}`)
      try {
        const test = await api('POST', `/log-destinations/${id}/test`)
        if (!test?.ok) throw new Error(`test event refused: ${test?.error ?? JSON.stringify(test).slice(0, 200)}`)
        for (let i = 0; i < 20; i++) {
          if (LOGS === 'aws_cloudwatch_logs') {
            // LocalStack does not check signatures; the credential scope names the region.
            const res = await fetch(`${LOGS_URL}/`, {
              method: 'POST',
              headers: {
                'content-type': 'application/x-amz-json-1.1',
                'x-amz-target': 'Logs_20140328.GetLogEvents',
                authorization: `AWS4-HMAC-SHA256 Credential=smoke/20260101/${config.region}/logs/aws4_request, SignedHeaders=host, Signature=0`,
              },
              body: JSON.stringify({ logGroupName: config.log_group_name, logStreamName: config.log_stream_name ?? 'usertasks', startFromHead: true }),
            })
            const json = await res.json().catch(() => ({}))
            const hit = (json.events ?? []).find((e) => /"type":"system\.test"/.test(e.message ?? ''))
            if (hit) return `test event in ${config.log_group_name} (${test.latency_ms} ms)`
          } else {
            const res = await fetch(`${LOGS_URL}/_mock/logs`)
            const list = await res.json().catch(() => [])
            const hit = list.find((l) => l.kind === LOGS && JSON.stringify(l).includes('system.test'))
            if (hit) return `test event received by the ${LOGS} stand-in (${test.latency_ms} ms)`
          }
          await sleep(500)
        }
        throw new Error('the test event was accepted but not found at the sink')
      } finally {
        await api('DELETE', `/log-destinations/${id}`).catch(() => undefined)
      }
    })
  }

  const width = Math.max(...results.map((r) => r.name.length))
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name.padEnd(width)}  ${String(r.ms).padStart(6)} ms  ${r.detail}`)
  const failed = results.filter((r) => !r.ok).length
  console.log(failed ? `${failed} of ${results.length} smoke checks failed.` : `All ${results.length} smoke checks passed.`)
  process.exit(failed ? 1 : 0)
}

main().catch((error) => { console.error(error); process.exit(1) })
