/**
 * Starts a throw-away PostgreSQL using the binaries shipped by `embedded-postgres` — but driven directly
 * through initdb/pg_ctl via a SHORT junction path. (Windows cannot spawn executables whose full path exceeds
 * 260 chars, which deep project folders under node_modules can hit.)
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface TestPg { url: string; stop: () => void }

function nativeDir(): string | null {
  const plat = process.platform === 'win32' ? 'windows' : process.platform
  const dir = path.join(process.cwd(), 'node_modules', '@embedded-postgres', `${plat}-${process.arch}`, 'native')
  return fs.existsSync(dir) ? dir : null
}

export const embeddedPgAvailable = (): boolean => nativeDir() !== null

export function startTestPg(port: number): TestPg {
  const native = nativeDir()!
  const id = Math.random().toString(36).slice(2, 8)
  const link = path.join(os.tmpdir(), `vcpg-${id}`)
  fs.symlinkSync(native, link, 'junction')
  const exe = (n: string) => path.join(link, 'bin', process.platform === 'win32' ? `${n}.exe` : n)
  const data = path.join(os.tmpdir(), `vcpgdata-${id}`)
  execFileSync(exe('initdb'), ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C'], { stdio: 'pipe' })
  execFileSync(exe('pg_ctl'), ['-D', data, '-o', `-p ${port} -c fsync=off`, '-w', '-l', path.join(data, 'log.txt'), 'start'], { stdio: 'ignore' }) // 'ignore': the server child must not hold our pipes open
  return {
    url: `postgresql://postgres@localhost:${port}/postgres`,
    stop: () => {
      try { execFileSync(exe('pg_ctl'), ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'pipe' }) } catch { /* already stopped */ }
      try { fs.unlinkSync(link) } catch { /* ignore */ }
      fs.rmSync(data, { recursive: true, force: true })
    },
  }
}

