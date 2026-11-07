// Bundles Electron main + preload with esbuild into dist-electron/ (CommonJS, as Electron requires for sandboxed preload).
import { build } from 'esbuild'

const prod = process.argv.includes('--prod')
const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron', 'ffmpeg-static', 'ffprobe-static'],
  sourcemap: !prod,
  minify: prod,
  logLevel: 'info',
}

await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.js' })
await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.js' })

