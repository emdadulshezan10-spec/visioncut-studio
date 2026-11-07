// End-to-end smoke test: drives the REAL built app (Electron) through import -> edit -> save -> export.
// Usage: node scripts/e2e-smoke.mjs <mediaDir> <outDir>   (mediaDir needs clipA.mp4 clipB.mp4 music.mp3 pic.png)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { launch } from './cdp.mjs'

const require = createRequire(import.meta.url)
let [mediaDir, outDir] = process.argv.slice(2)
// No arguments: synthesise test media with FFmpeg into a temp folder.
if (!mediaDir) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-e2e-media-'))
  const ff = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a])
  ff('-f', 'lavfi', '-i', 'testsrc2=duration=6:size=1280x720:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(tmp, 'clipA.mp4'))
  ff('-f', 'lavfi', '-i', 'mandelbrot=size=1280x720:rate=30', '-t', '5', '-f', 'lavfi', '-i', 'sine=frequency=660:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(tmp, 'clipB.mp4'))
  ff('-f', 'lavfi', '-i', 'sine=frequency=220:duration=8', path.join(tmp, 'music.mp3'))
  ff('-f', 'lavfi', '-i', 'gradients=size=800x800:duration=1', '-frames:v', '1', path.join(tmp, 'pic.png'))
  mediaDir = tmp
  outDir ??= path.join(tmp, 'out')
}
outDir ??= path.join(os.tmpdir(), 'vc-e2e-out')
fs.mkdirSync(outDir, { recursive: true })
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-e2e-'))
// E2E_EXE=<packaged .exe> tests the installer build; E2E_BUNDLED=1 hides the system FFmpeg so the bundled one is used.
const env = { ...process.env }
if (process.env.E2E_BUNDLED) env.PATH = (env.PATH ?? '').split(';').filter((p) => !/ffmpeg|winget/i.test(p)).join(';')
const app = await launch(process.env.E2E_EXE ? { userData, electron: process.env.E2E_EXE, env } : { userData, electron: require('electron'), appDir: process.cwd(), env })
const { evalJs, sleep, screenshot } = app
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); console.log('  ok -', m) }
const j = (o) => JSON.stringify(o)

try {
  await evalJs(`localStorage.setItem('vc.debug','1')`)
  await app.send('Page.reload')
  await sleep(2500)
  ok(await evalJs(`typeof window.__vc`) === 'object', 'debug hook available')
  for (let i = 0; i < 20 && !(await evalJs(`document.body.innerText`)).includes('Welcome'); i++) await sleep(500)
  ok((await evalJs(`document.body.innerText`)).includes('Welcome'), 'home page renders (local mode, no login wall)')

  // create project through the real UI buttons
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent.includes('New project')).click()`)
  await sleep(300)
  await evalJs(`[...document.querySelectorAll('button')].find(b => b.textContent === 'Create').click()`)
  await sleep(800)
  ok((await evalJs(`__vc.useUiStore.getState().page`)) === 'editor', 'new project opens the editor')

  // import real media through the main-process pipeline (ffprobe + thumbnail + waveform)
  const files = ['clipA.mp4', 'clipB.mp4', 'music.mp3', 'pic.png'].map((f) => path.join(mediaDir, f))
  const res = await evalJs(`window.visioncut.media.import(${j(files)})`)
  ok(res.items.length === 4 && res.errors.length === 0, 'imported 4 media files ' + JSON.stringify(res.errors))
  ok(res.items[0].width === 1280 && res.items[0].duration > 5.9, 'ffprobe metadata correct')
  ok(!!res.items[0].thumbnail && res.items[0].waveform?.length > 100, 'thumbnail + waveform generated')
  const bad = await evalJs(`window.visioncut.media.import([${j(path.join(mediaDir, 'nope.mp4'))}])`)
  ok(bad.errors.length === 1, 'missing/corrupt file reported as error, not crash')
  fs.writeFileSync(path.join(outDir, 'corrupt.mp4'), 'this is not a video')
  const bad2 = await evalJs(`window.visioncut.media.import([${j(path.join(outDir, 'corrupt.mp4'))}])`)
  ok(bad2.errors.length === 1, 'corrupt file rejected with message: ' + bad2.errors[0]?.error.slice(0, 60))

  await evalJs(`__vc.useEditor.getState().commit(p => ({...p, media: [...p.media, ...${j(res.items)}]}))`)
  const ids = res.items.map((m) => m.id)
  // place clips with real timeline ops
  await evalJs(`(async () => {
    const { addMediaToTimeline } = __vc.actions; const s = () => __vc.useEditor.getState()
    const m = s().project.media
    s().setPlayhead(0); addMediaToTimeline(m[0])
    s().setPlayhead(5); addMediaToTimeline(m[1])
    s().setPlayhead(0); addMediaToTimeline(m[2])
    s().setPlayhead(1); addMediaToTimeline(m[3])
  })()`)
  let st = await evalJs(`(() => { const p = __vc.useEditor.getState().project; return { n: p.clips.length, byTrack: p.clips.map(c => [c.kind, p.tracks.find(t=>t.id===c.trackId).name, +c.start.toFixed(2), +c.duration.toFixed(2)]) } })()`)
  console.log('  clips:', j(st.byTrack))
  ok(st.n === 4, '4 clips on the timeline')

  // split / undo / redo / ripple delete
  await evalJs(`(() => { const s = __vc.useEditor.getState(); s.select([]); s.setPlayhead(3); __vc.actions.splitAtPlayhead() })()`)
  ok((await evalJs(`__vc.useEditor.getState().project.clips.length`)) === 7, 'split cut every clip under the playhead (video, music, image)')
  await evalJs(`__vc.useEditor.getState().undo()`)
  ok((await evalJs(`__vc.useEditor.getState().project.clips.length`)) === 4, 'undo reverts split')
  await evalJs(`__vc.useEditor.getState().redo()`)
  ok((await evalJs(`__vc.useEditor.getState().project.clips.length`)) === 7, 'redo re-applies split')

  // text + effects + transition + keyframes
  await evalJs(`(() => { const s = __vc.useEditor.getState(); s.setPlayhead(0.5); __vc.actions.addText('title') })()`)
  await evalJs(`(() => { const s = __vc.useEditor.getState(); const c = s.project.clips.find(c => c.kind==='video'); s.commit(p => ({...p, clips: p.clips.map(x => x.id===c.id ? {...x, color:{...x.color, saturation:0.3, contrast:0.1}, effects:{...x.effects, vignette:0.4}, transitionOut:{type:'dissolve',duration:0.5}} : x)})) })()`)
  await evalJs(`(() => { const s = __vc.useEditor.getState(); const c = s.project.clips.find(c => c.kind==='image'); s.commit(p => ({...p, clips: p.clips.map(x => x.id===c.id ? {...x, duration:3, transform:{...x.transform, scale:0.3}, keyframes:{x:[{time:0,value:-40},{time:3,value:40}]}} : x)})) })()`)
  await evalJs(`__vc.useEditor.getState().setPlayhead(1.5)`)
  await sleep(1200)
  await screenshot(path.join(outDir, 'editor.png'))

  // save + reopen from disk
  await evalJs(`window.visioncut.projects.save(__vc.useEditor.getState().project)`)
  const list = await evalJs(`window.visioncut.projects.list()`)
  ok(list.length === 1 && list[0].clipCount >= 7, 'project saved and listed')
  const loaded = await evalJs(`window.visioncut.projects.load(${j(list[0].id)}).then(r => r.project.clips.length)`)
  ok(loaded >= 7, 'project reloads from disk')

  // real export via the UI pipeline
  const exportDir = path.join(outDir, 'exports')
  fs.mkdirSync(exportDir, { recursive: true })
  const result = await evalJs(`(async () => {
    const p = __vc.useEditor.getState().project
    const { renderTextImage } = await import('/src/editor/preview/renderText.ts').catch(() => ({}))
    const png = document.createElement('canvas'); png.width = 1920; png.height = 1080
    const ctx = png.getContext('2d'); ctx.fillStyle = '#fff'; ctx.font = 'bold 120px Arial'; ctx.fillText('Hello VisionCut', 400, 540)
    const textImages = {}; for (const c of p.clips) if (c.kind === 'text') textImages[c.id] = png.toDataURL('image/png')
    const opts = { format:'mp4', codec:'h264', resolution:'720p', fps:30, audioBitrateKbps:128, outputDir:${j(exportDir)}, fileName:'smoke' }
    return await new Promise(async (resolve) => {
      const off = window.visioncut.exporter.onProgress(pr => { if (['done','error','cancelled'].includes(pr.state)) { off(); resolve(pr) } })
      try { await window.visioncut.exporter.start(p, opts, textImages) } catch (e) { resolve({ state:'error', error: String(e) }) }
    })
  })()`)
  console.log('  export result:', j(result))
  ok(result.state === 'done', 'export finished')
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', result.outputPath]).toString())
  const v = probe.streams.find((s) => s.codec_type === 'video')
  ok(v.width === 1280 && v.height === 720, 'exported 1280x720')
  ok(probe.streams.some((s) => s.codec_type === 'audio'), 'exported file has audio')
  console.log('  duration', probe.format.duration)
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '1.5', '-i', result.outputPath, '-frames:v', '1', path.join(outDir, 'frame1.5.png')])
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '7', '-i', result.outputPath, '-frames:v', '1', path.join(outDir, 'frame7.png')])

  // cancel
  const cancelled = await evalJs(`(async () => {
    const p = __vc.useEditor.getState().project
    const opts = { format:'mp4', codec:'h265', resolution:'4k', fps:60, audioBitrateKbps:128, outputDir:${j(exportDir)}, fileName:'cancel' }
    return await new Promise(async (resolve) => {
      const off = window.visioncut.exporter.onProgress(pr => { if (['done','error','cancelled'].includes(pr.state)) { off(); resolve(pr.state) } })
      const id = await window.visioncut.exporter.start(p, opts, {})
      setTimeout(() => window.visioncut.exporter.cancel(id), 1500)
    })
  })()`)
  ok(cancelled === 'cancelled', 'export can be cancelled')
  ok(!fs.existsSync(path.join(exportDir, 'cancel.mp4')), 'partial file removed after cancel')

  console.log('JS errors during run:', app.errors.length ? j(app.errors.slice(0, 5)) : 'none')
  console.log('E2E PASSED')
} catch (e) {
  console.error('E2E FAILED:', e.message)
  console.error('JS errors:', j(app.errors.slice(0, 5)))
  await screenshot(path.join(outDir, 'failure.png')).catch(() => undefined)
  process.exitCode = 1
} finally {
  app.close()
  await new Promise((r) => setTimeout(r, 500))
  fs.rmSync(userData, { recursive: true, force: true })
}




