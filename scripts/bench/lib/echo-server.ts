/** Local HTTP echo server the bench integration points at (call_reference). */
import { createServer, type Server } from 'node:http'

export interface EchoServer {
  port: number
  requests: () => number
  close: () => Promise<void>
}

export async function startEchoServer(port: number): Promise<EchoServer> {
  let count = 0
  const server: Server = createServer((req, res) => {
    count++
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ ok: true, method: req.method, url: req.url, body: body || null, at: Date.now() }))
    })
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })
  return {
    port,
    requests: () => count,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  }
}
