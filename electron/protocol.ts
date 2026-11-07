import { net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { ALL_MEDIA_EXT } from './ipc/media'

/**
 * `vcmedia://local/<encoded absolute path>` lets the sandboxed renderer stream local media
 * (with HTTP range support for seeking) without enabling file:// access. Only media/image
 * extensions are served.
 */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([{ scheme: 'vcmedia', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true } }])
}

export function handleMediaScheme(): void {
  protocol.handle('vcmedia', (req) => {
    try {
      const url = new URL(req.url)
      const file = decodeURIComponent(url.pathname.slice(1))
      const ext = path.extname(file).toLowerCase()
      if (!path.isAbsolute(file) || !(ALL_MEDIA_EXT.includes(ext) || ext === '.jpg')) return new Response('Forbidden', { status: 403 })
      return net.fetch(pathToFileURL(file).toString(), { headers: req.headers, method: req.method })
    } catch {
      return new Response('Bad request', { status: 400 })
    }
  })
}
