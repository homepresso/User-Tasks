/** A static file server for the harness (module scripts do not load from file://). */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const root = resolve('.')
const port = Number(process.env.PORT) || 5180
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost')
  let path = normalize(join(root, decodeURIComponent(url.pathname)))
  if (!path.startsWith(root)) return void res.writeHead(403).end()
  // No live reload here (the harness asks for esbuild's /esbuild events): 204 tells it to stop.
  if (url.pathname === '/esbuild') return void res.writeHead(204).end()
  if (url.pathname.endsWith('/')) path = join(path, 'index.html')
  try {
    const body = await readFile(path)
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
  } catch {
    res.writeHead(404).end('not found')
  }
}).listen(port, '127.0.0.1', () => console.log(`Harness: http://localhost:${port}/harness/`))
