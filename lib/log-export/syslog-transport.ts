/**
 * Socket delivery for syslog destinations (lib/log-export/formats/syslog
 * builds the frames). One connection per request: TLS (certificate verified
 * against the system CAs and NODE_EXTRA_CA_CERTS, optional client
 * certificate), plain TCP, or one UDP datagram per message. Success means
 * every byte was written and the stream closed cleanly (UDP: handed to the
 * network — syslog has no application-level acknowledgement).
 */

import dgram from 'node:dgram'
import net from 'node:net'
import tls from 'node:tls'
import type { OutboundRequest } from './formats/types'

export interface SyslogTarget {
  transport: 'tls' | 'tcp' | 'udp'
  host: string
  port: number
}

export function parseSyslogUrl(url: string): SyslogTarget {
  const m = /^syslog\+(tls|tcp|udp):\/\/(\[[^\]]+\]|[^:/]+):(\d{1,5})$/.exec(url)
  if (!m) throw new TypeError(`invalid syslog target ${url}`)
  return { transport: m[1] as SyslogTarget['transport'], host: m[2].replace(/^\[|\]$/g, ''), port: Number(m[3]) }
}

/** `ca` adds a trust anchor (tests); in production trust comes from the system store and NODE_EXTRA_CA_CERTS. */
export async function sendSyslog(request: OutboundRequest, options: { timeoutMs: number; ca?: string }): Promise<void> {
  const target = parseSyslogUrl(request.url)
  const messages = request.messages ?? []
  if (target.transport === 'udp') {
    const socket = dgram.createSocket(net.isIPv6(target.host) ? 'udp6' : 'udp4')
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timed out after ${Math.round(options.timeoutMs / 1000)}s`)), options.timeoutMs)
        socket.once('error', (error) => { clearTimeout(timer); reject(error) })
        let pending = messages.length
        if (!pending) { clearTimeout(timer); resolve(); return }
        for (const message of messages) {
          socket.send(Buffer.from(message, 'utf8'), target.port, target.host, (error) => {
            if (error) { clearTimeout(timer); reject(error); return }
            if (--pending === 0) { clearTimeout(timer); resolve() }
          })
        }
      })
    } finally {
      socket.close()
    }
    return
  }

  await new Promise<void>((resolve, reject) => {
    const servername = request.tls?.servername ?? (net.isIP(target.host) ? undefined : target.host)
    const socket = target.transport === 'tls'
      ? tls.connect({ host: target.host, port: target.port, servername, ...(options.ca ? { ca: options.ca } : {}), ...(request.tls?.cert && request.tls?.key ? { cert: request.tls.cert, key: request.tls.key } : {}) })
      : net.connect({ host: target.host, port: target.port })
    let settled = false
    const done = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve()
    }
    const timer = setTimeout(() => done(new Error(`timed out after ${Math.round(options.timeoutMs / 1000)}s`)), options.timeoutMs)
    socket.once('error', (error) => done(error))
    socket.once(target.transport === 'tls' ? 'secureConnect' : 'connect', () => {
      socket.end(messages.join(''), 'utf8')
    })
    // All data flushed and the peer closed (or we finished writing): delivered.
    socket.once('finish', () => setImmediate(() => done()))
    socket.once('close', (hadError) => done(hadError ? new Error('connection closed with an error') : undefined))
  })
}
