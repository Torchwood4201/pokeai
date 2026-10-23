import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'

const root = resolve(process.argv[2] || 'dist')
const port = Number(process.argv[3] || process.env.PORT || 3000)

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8'
}

async function resolveFile(pathname) {
  const decoded = decodeURIComponent(pathname)
  const path = resolve(root, '.' + decoded)
  if (path !== root && !path.startsWith(root + sep)) return null
  try {
    const info = await stat(path)
    if (info.isDirectory()) {
      const indexPath = join(path, 'index.html')
      const indexInfo = await stat(indexPath)
      return indexInfo.isFile() ? { file: indexPath, size: indexInfo.size } : null
    }
    return info.isFile() ? { file: path, size: info.size } : null
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  const started = Date.now()
  try {
    const url = new URL(req.url || '/', 'http://localhost')
    if (url.pathname === '/__health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end('ok\n')
      return
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' })
      res.end('Method not allowed\n')
      return
    }
    const found = await resolveFile(url.pathname)
    if (!found) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('Not found\n')
      return
    }
    const body = await readFile(found.file)
    res.writeHead(200, {
      'Content-Type': mime[extname(found.file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': body.length,
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff'
    })
    res.end(req.method === 'HEAD' ? undefined : body)
    if (url.pathname !== '/' && !url.pathname.startsWith('/assets/')) {
      console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`)
    }
  } catch (error) {
    console.error(error)
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Internal server error\n')
  }
})

server.listen(port, '0.0.0.0', () => {
  console.log(`poke.AI preview serving ${root} at http://0.0.0.0:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}
