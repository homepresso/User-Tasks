import { createConnection } from 'node:net'

/**
 * Optional virus scanning of form attachments (server only). Off by
 * default; FORM_ATTACHMENT_SCANNER selects a scanner:
 *
 *  - none (default)  nothing is scanned; files are recorded as `skipped`
 *  - clamav          clamd's INSTREAM command over TCP
 *                    (CLAMAV_HOST, default 127.0.0.1; CLAMAV_PORT, 3310;
 *                    CLAMAV_TIMEOUT_MS, 15000)
 *
 * An infected file is refused. A scanner error refuses the upload too
 * unless FORM_ATTACHMENT_SCAN_FAIL_OPEN=true (then it is stored with scan
 * status `error`). Other scanners implement AttachmentScanner and are added
 * to scannerFor().
 */

export type ScanStatus = 'skipped' | 'clean' | 'infected' | 'error'

export interface ScanResult {
  status: ScanStatus
  /** Signature name (infected) or the error. */
  detail?: string
}

export interface AttachmentScanner {
  readonly id: string
  scan(bytes: Uint8Array, name: string): Promise<ScanResult>
}

export const noScanner: AttachmentScanner = {
  id: 'none',
  async scan() { return { status: 'skipped' } },
}

/** clamd INSTREAM: `zINSTREAM\0`, then <uint32 length><chunk>… and a zero length; the reply is `stream: OK` or `stream: <name> FOUND`. */
export function createClamavScanner(options: { host?: string; port?: number; timeoutMs?: number } = {}): AttachmentScanner {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 3310
  const timeoutMs = options.timeoutMs ?? 15_000
  return {
    id: 'clamav',
    scan(bytes) {
      return new Promise<ScanResult>((resolve) => {
        const socket = createConnection({ host, port })
        let reply = ''
        let settled = false
        const done = (result: ScanResult) => {
          if (settled) return
          settled = true
          socket.destroy()
          resolve(result)
        }
        socket.setTimeout(timeoutMs, () => done({ status: 'error', detail: 'clamd timed out' }))
        socket.on('error', (error) => done({ status: 'error', detail: `clamd: ${error.message}` }))
        socket.on('data', (chunk) => { reply += chunk.toString('utf8') })
        socket.on('end', () => {
          const text = reply.replace(/\0/g, '').trim()
          if (/:\s*OK$/.test(text)) done({ status: 'clean' })
          else if (/FOUND$/.test(text)) done({ status: 'infected', detail: text.replace(/^stream:\s*/, '').replace(/\s*FOUND$/, '') })
          else done({ status: 'error', detail: text || 'clamd gave no answer' })
        })
        socket.on('connect', () => {
          socket.write('zINSTREAM\0')
          const CHUNK = 64 * 1024
          for (let offset = 0; offset < bytes.length; offset += CHUNK) {
            const part = bytes.subarray(offset, Math.min(bytes.length, offset + CHUNK))
            const size = Buffer.alloc(4)
            size.writeUInt32BE(part.length, 0)
            socket.write(size)
            socket.write(part)
          }
          socket.write(Buffer.alloc(4))
        })
      })
    },
  }
}

export function scannerFor(env: Record<string, string | undefined> = process.env): AttachmentScanner {
  const id = String(env.FORM_ATTACHMENT_SCANNER ?? 'none').trim().toLowerCase()
  if (id === 'clamav') {
    const port = Number(env.CLAMAV_PORT)
    const timeout = Number(env.CLAMAV_TIMEOUT_MS)
    return createClamavScanner({
      host: env.CLAMAV_HOST || undefined,
      port: Number.isInteger(port) && port > 0 ? port : undefined,
      timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : undefined,
    })
  }
  return noScanner
}

export function scanFailOpen(env: Record<string, string | undefined> = process.env): boolean {
  return /^(1|true|yes|on)$/i.test(String(env.FORM_ATTACHMENT_SCAN_FAIL_OPEN ?? ''))
}
