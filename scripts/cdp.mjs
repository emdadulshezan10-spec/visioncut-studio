// Minimal Chrome-DevTools-Protocol helper used by the end-to-end smoke test (scripts/e2e-smoke.mjs).
import { spawn } from 'node:child_process'
import fs from 'node:fs'

export async function launch({ port = 9444, userData, electron, appDir, env = process.env }) {
  // appDir omitted => electron is a packaged app executable
  const args = [...(appDir ? [appDir] : []), `--remote-debugging-port=${port}`, `--user-data-dir=${userData}`]
  const proc = spawn(electron, args, { stdio: 'ignore', env })
  let targets
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 500))
    try { targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (targets.some((t) => t.type === 'page')) break } catch { /* not up yet */ }
  }
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((r) => (ws.onopen = r))
  let id = 0
  const pending = new Map()
  const errors = []
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data)
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push(m.params.args.map((a) => a.value ?? a.description).join(' '))
  }
  const send = (method, params = {}, timeoutMs = 60000) => new Promise((res, rej) => {
    const i = ++id
    const t = setTimeout(() => { pending.delete(i); rej(new Error('CDP timeout: ' + method + ' (renderer unresponsive?)')) }, timeoutMs)
    pending.set(i, (m) => { clearTimeout(t); res(m) })
    ws.send(JSON.stringify({ id: i, method, params }))
  })
  await send('Runtime.enable')
  await send('Page.enable')
  const evalJs = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed')
    return r.result?.result?.value
  }
  const screenshot = async (file) => {
    const r = await send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(file, Buffer.from(r.result.data, 'base64'))
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  const close = () => { try { ws.close() } catch { /* ignore */ } proc.kill() }
  return { evalJs, screenshot, sleep, close, errors, send }
}
