'use client'

import { useMemo, useState, useSyncExternalStore } from 'react'
import { Check, Copy, KeyRound, Search, ShieldCheck } from 'lucide-react'
import { ENDPOINT_GROUPS, type Endpoint, type EndpointParam } from '@/components/api-keys/api-explorer'

const METHOD_COLOR: Record<string, string> = { GET: '#22C55E', POST: '#3B82F6', PUT: '#F59E0B', PATCH: '#A855F7', DELETE: '#EF4444' }

function sampleValue(param: EndpointParam): unknown {
  const raw = param.placeholder ?? (param.required ? `<${param.name}>` : '')
  if (!raw) return undefined
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw)
  if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
    try { return JSON.parse(raw) } catch { return raw }
  }
  return raw
}

function buildExample(endpoint: Endpoint, baseUrl: string) {
  let path = endpoint.path
  for (const param of endpoint.params.filter(p => p.type === 'path')) path = path.replace(`{${param.name}}`, String(sampleValue(param) ?? `<${param.name}>`))
  const query = new URLSearchParams()
  for (const param of endpoint.params.filter(p => p.type === 'query')) {
    const value = sampleValue(param)
    if (value !== undefined) query.set(param.name, String(value))
  }
  const body = Object.fromEntries(endpoint.params.filter(p => p.type === 'body').map(param => [param.name, sampleValue(param)]).filter(([, value]) => value !== undefined))
  const url = `${baseUrl.replace(/\/$/, '')}${path}${query.size ? `?${query}` : ''}`
  const lines = [`curl -X ${endpoint.method} '${url}'`, `  -H 'Authorization: Bearer <YOUR_API_KEY_OR_OAUTH_TOKEN>'`, `  -H 'Accept: application/json'`]
  if (Object.keys(body).length) lines.push(`  -H 'Content-Type: application/json'`, `  --data '${JSON.stringify(body, null, 2)}'`)
  return { url, body, curl: lines.join(' \\\n') }
}

const noSubscribe = () => () => {}

export function PublicApiExplorer() {
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Endpoint>(ENDPOINT_GROUPS[0].endpoints[0])
  const [copied, setCopied] = useState(false)
  // Placeholder on the server and first client render (avoids a hydration
  // mismatch), then the real origin once mounted.
  const baseUrl = useSyncExternalStore(noSubscribe, () => window.location.origin, () => 'https://your-usertasks-instance.example')
  const example = buildExample(selected, baseUrl)
  const groups = useMemo(() => ENDPOINT_GROUPS.map(group => ({ ...group, endpoints: group.endpoints.filter(endpoint => `${group.label} ${endpoint.label} ${endpoint.path} ${endpoint.description}`.toLowerCase().includes(search.toLowerCase())) })).filter(group => group.endpoints.length), [search])

  return <div className="grid min-h-[720px] overflow-hidden rounded-2xl border border-[#1B1916]/[0.10] bg-[#FAF8F3]/50 lg:grid-cols-[340px_minmax(0,1fr)]">
    <aside className="border-b border-[#1B1916]/[0.08] p-4 lg:border-b-0 lg:border-r">
      <div className="relative"><Search size={14} className="absolute left-3 top-3 text-[#857D6D]" /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search endpoints…" className="w-full rounded-lg border border-[#1B1916]/10 bg-[#1B1916]/[0.04] py-2.5 pl-9 pr-3 text-sm text-[#1B1916] outline-none focus:border-[#857B66]/50" /></div>
      <div className="mt-4 max-h-[640px] space-y-5 overflow-y-auto pr-1">{groups.map(group => <div key={group.label}><p className="mb-2 px-2 text-[10px] font-semibold uppercase tracking-wider text-[#857D6D]">{group.label}</p><div className="space-y-1">{group.endpoints.map(endpoint => <button key={`${endpoint.method}-${endpoint.path}-${endpoint.label}`} onClick={() => setSelected(endpoint)} className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${selected === endpoint ? 'bg-[#EDE6D6]/10 text-[#1B1916]' : 'text-[#6E6759] hover:bg-[#1B1916]/[0.04] hover:text-[#1B1916]'}`}><span className="w-12 shrink-0 text-[10px] font-bold" style={{ color: METHOD_COLOR[endpoint.method] }}>{endpoint.method}</span><span className="min-w-0 truncate text-xs">{endpoint.label}</span></button>)}</div></div>)}</div>
    </aside>
    <div className="p-5 sm:p-7">
      <div className="flex flex-wrap items-center gap-3"><span className="rounded-md px-2.5 py-1 text-xs font-bold" style={{ color: METHOD_COLOR[selected.method], background: `${METHOD_COLOR[selected.method]}18` }}>{selected.method}</span><code className="break-all text-sm text-[#33302A]">{selected.path}</code></div>
      <h2 className="mt-5 text-2xl font-bold">{selected.label}</h2><p className="mt-2 text-sm leading-6 text-[#6E6759]">{selected.description}</p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2"><div className="rounded-xl border border-[#1B1916]/[0.08] bg-[#1B1916]/[0.03] p-4"><KeyRound size={17} className="text-[#A79B82]" /><h3 className="mt-3 text-sm font-semibold">Authentication</h3><p className="mt-1 text-xs leading-5 text-[#6E6759]">Send a tenant API key or OAuth access token in the Bearer header. Permissions and live user roles still apply.</p></div><div className="rounded-xl border border-[#1B1916]/[0.08] bg-[#1B1916]/[0.03] p-4"><ShieldCheck size={17} className="text-[#A79B82]" /><h3 className="mt-3 text-sm font-semibold">Public explorer safety</h3><p className="mt-1 text-xs leading-5 text-[#6E6759]">This explorer creates examples only. It never asks for, stores, or transmits your credentials.</p></div></div>
      {selected.params.length > 0 && <div className="mt-7"><h3 className="text-sm font-semibold uppercase tracking-wider text-[#A79B82]">Parameters</h3><div className="mt-3 overflow-hidden rounded-xl border border-[#1B1916]/[0.08]">{selected.params.map(param => <div key={`${param.type}-${param.name}`} className="grid gap-2 border-t border-[#1B1916]/[0.07] px-4 py-3 first:border-t-0 sm:grid-cols-[150px_70px_minmax(0,1fr)]"><div><code className="text-xs text-[#1B1916]">{param.name}</code>{param.required && <span className="ml-2 text-[9px] font-semibold text-amber-300">required</span>}</div><span className="text-[10px] uppercase text-[#857D6D]">{param.type}</span><p className="text-xs leading-5 text-[#6E6759]">{param.description || param.placeholder || 'Optional parameter'}</p></div>)}</div></div>}
      <div className="mt-7"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold uppercase tracking-wider text-[#A79B82]">Example request</h3><button onClick={async () => { await navigator.clipboard.writeText(example.curl); setCopied(true); setTimeout(() => setCopied(false), 1500) }} className="inline-flex items-center gap-1.5 text-xs text-[#6E6759] hover:text-[#1B1916]">{copied ? <Check size={13} /> : <Copy size={13} />}{copied ? 'Copied' : 'Copy cURL'}</button></div><pre className="mt-3 overflow-x-auto rounded-xl border border-[#1B1916]/[0.08] bg-[#1C1A16] p-4 text-xs leading-6 text-[#EDE8DC]"><code>{example.curl}</code></pre></div>
      <div className="mt-7"><h3 className="text-sm font-semibold uppercase tracking-wider text-[#A79B82]">Response conventions</h3><div className="mt-3 grid gap-2 sm:grid-cols-3">{[['2xx', 'Request completed successfully'], ['4xx', 'Authentication, permission, validation, or missing-resource error'], ['5xx', 'Server or downstream execution error']].map(([code, body]) => <div key={code} className="rounded-lg border border-[#1B1916]/[0.08] p-3"><code className="text-sm text-[#1B1916]">{code}</code><p className="mt-1 text-xs leading-5 text-[#6E6759]">{body}</p></div>)}</div></div>
    </div>
  </div>
}
