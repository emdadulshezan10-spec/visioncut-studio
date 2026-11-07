// End-to-end test for motion tracking in the REAL app. Renders a video where a textured patch moves at a KNOWN speed
// (60 px/s right, 20 px/s down on a 640x360 frame), tracks it, and compares the overlay keyframes with the true motion.
// Usage: node scripts/e2e-tracking.mjs      (needs `npm run build` first and ffmpeg on PATH)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { launch } from './cdp.mjs'

const require = createRequire(import.meta.url)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-e2e-track-'))
const ff = (...a) => execFileSync('ffmpeg', ['-y', '-v', 'error', ...a])
// static noisy background + a coloured-bar patch (80x80) whose centre starts at (90,140)
ff('-f', 'lavfi', '-i', 'color=c=0x303030:s=640x360', '-vf', 'noise=alls=30:allf=u', '-frames:v', '1', path.join(tmp, 'bg.png'))
ff('-f', 'lavfi', '-i', 'smptebars=s=80x80:r=30', '-t', '1', '-frames:v', '1', path.join(tmp, 'patch.png'))
const video = path.join(tmp, 'move.mp4')
ff('-loop', '1', '-framerate', '30', '-i', path.join(tmp, 'bg.png'), '-loop', '1', '-framerate', '30', '-i', path.join(tmp, 'patch.png'), '-filter_complex', "[0][1]overlay=x='50+60*t':y='100+20*t'", '-t', '6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video)

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-e2e-'))
const app = await launch({ userData, electron: require('electron'), appDir: process.cwd() })
const { evalJs, sleep } = app
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); console.log('  ok -', m) }
try {
  await evalJs(`localStorage.setItem('vc.debug','1')`)
  await app.send('Page.reload')
  await sleep(2500)
  const res = await evalJs(`window.visioncut.media.import([${JSON.stringify(video)}])`)
  ok(res.items.length === 1 && res.items[0].width === 640, 'imported test video')
  await evalJs(`(async () => {
    const s = () => __vc.useEditor.getState()
    s().commit(p => ({...p, media: [...p.media, ...${JSON.stringify(res.items)}]}))
    s().setPlayhead(0); __vc.actions.addMediaToTimeline(s().project.media[0])
    s().setPlayhead(0); __vc.actions.addText('title')
    const v = s().project.clips.find(c => c.kind === 'video'), t = s().project.clips.find(c => c.kind === 'text')
    s().commit(p => ({...p, clips: p.clips.map(c => c.id === t.id ? {...c, start: 0, duration: v.duration} : c)}))
    s().select([v.id, t.id])
    await __vc.actions.trackMotion(90 / 639, 140 / 359)
  })()`)
  const t = await evalJs(`(() => { const c = __vc.useEditor.getState().project.clips.find(c => c.kind === 'text'); return { x: c.keyframes.x, y: c.keyframes.y } })()`)
  ok(t.x?.length >= 2 && t.y?.length >= 2, `keyframes written (${t.x?.length} x, ${t.y?.length} y)`)
  const dur = t.x[t.x.length - 1].time
  const dx = t.x[t.x.length - 1].value - t.x[0].value
  const dy = t.y[t.y.length - 1].value - t.y[0].value
  // truth over `dur` seconds: x moves 60*dur px of 640 (percent of canvas width, video fills canvas width), y 20*dur px of 360
  const ex = (60 * dur / 640) * 100, ey = (20 * dur / 360) * 100
  console.log(`  tracked over ${dur.toFixed(2)} s: dx=${dx.toFixed(2)}% (expected ${ex.toFixed(2)}%), dy=${dy.toFixed(2)}% (expected ${ey.toFixed(2)}%)`)
  ok(dur > 4 && Math.abs(dx - ex) < 1.5, 'horizontal motion matches the true motion within 1.5 % of canvas width')
  ok(Math.abs(dy - ey) < 1.5, 'vertical motion matches the true motion within 1.5 % of canvas height')
  ok(Math.abs(t.x[0].value - ((90 / 639 - 0.5) * 100)) < 2, 'overlay starts on the tracked point')
  ok(app.errors.length === 0, 'no renderer errors: ' + app.errors.join(' | ').slice(0, 200))
  console.log('TRACKING E2E PASSED')
} catch (e) {
  console.error('TRACKING E2E FAILED:', e.message)
  process.exitCode = 1
} finally {
  app.close()
}
