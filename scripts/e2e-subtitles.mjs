// End-to-end test for automatic subtitles in the REAL app: downloads the whisper engine + model (checksum-verified),
// transcribes a spoken clip (Windows speech synthesis) and checks subtitle clips land on the timeline.
// Usage: node scripts/e2e-subtitles.mjs      (needs `npm run build` first; downloads ~152 MB on first run)
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { launch } from './cdp.mjs'

const require = createRequire(import.meta.url)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-e2e-sub-'))
const wav = path.join(tmp, 'speech.wav')
const mp4 = path.join(tmp, 'talk.mp4')
execFileSync('powershell', ['-NoProfile', '-Command', `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${wav}'); $s.Speak('Hello, this is a test of the automatic subtitle system. The quick brown fox jumps over the lazy dog.'); $s.Dispose()`])
execFileSync('ffmpeg', ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=duration=9:size=640x360:rate=30', '-i', wav, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4])

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-e2e-'))
const app = await launch({ userData, electron: require('electron'), appDir: process.cwd() })
const { evalJs, sleep } = app
const ok = (c, m) => { if (!c) throw new Error('ASSERT FAILED: ' + m); console.log('  ok -', m) }
try {
  await evalJs(`localStorage.setItem('vc.debug','1')`)
  await app.send('Page.reload')
  await sleep(2500)
  ok((await evalJs(`window.visioncut.subtitles.status()`)).installed === false, 'engine not installed on a fresh profile')
  console.log('  downloading engine + model (checksum-verified)…')
  await evalJs(`void (window.__inst = window.visioncut.subtitles.install().then(() => 'ok', (e) => String(e)))`)
  let installRes
  for (let i = 0; i < 400 && !installRes; i++) { await sleep(1500); installRes = await evalJs(`Promise.race([window.__inst, new Promise(r => setTimeout(() => r(null), 100))])`) }
  ok(installRes === 'ok', 'install finished: ' + installRes)
  ok((await evalJs(`window.visioncut.subtitles.status()`)).installed === true, 'engine + model installed and verified')

  const res = await evalJs(`window.visioncut.media.import([${JSON.stringify(mp4)}])`)
  ok(res.items.length === 1 && res.items[0].hasAudio, 'imported spoken clip')
  const cues = await evalJs(`window.visioncut.subtitles.transcribe(${JSON.stringify(mp4)}, 0, 9)`)
  console.log('  cues:', JSON.stringify(cues))
  ok(cues.length >= 1 && cues.map((c) => c.text).join(' ').toLowerCase().includes('fox'), 'transcript contains the spoken words')

  // through the editor action, as the button does
  await evalJs(`(async () => {
    const s = () => __vc.useEditor.getState()
    s().commit(p => ({...p, media: [...p.media, ...${JSON.stringify(res.items)}]}))
    s().setPlayhead(2); __vc.actions.addMediaToTimeline(s().project.media[0])
    const clip = s().project.clips[0]; s().select([clip.id])
    await __vc.actions.autoSubtitles()
  })()`)
  const texts = await evalJs(`__vc.useEditor.getState().project.clips.filter(c => c.kind === 'text').map(c => ({ start: c.start, dur: c.duration }))`)
  ok(texts.length >= 1, `subtitle clips added to the timeline (${texts.length})`)
  ok(texts.every((t) => t.start >= 2 - 1e-6), 'subtitles are offset by the clip start (2 s)')
  ok(app.errors.length === 0, 'no renderer errors: ' + app.errors.join(' | ').slice(0, 200))
  console.log('SUBTITLE E2E PASSED')
} catch (e) {
  console.error('SUBTITLE E2E FAILED:', e.message)
  process.exitCode = 1
} finally {
  app.close()
}
