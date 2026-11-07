import { useRef, useState } from 'react'
import { Captions, Crosshair, Mic, Square, Type } from 'lucide-react'
import { api, errMsg } from '@/services/api'
import { toast } from '@/store/toastStore'
import { useEditor } from '@/store/editorStore'
import { defaultColor, defaultEffects, type Clip, type ColorGrade, type Effects, type TransitionType } from '@/types/project'
import { addMediaToTimeline, addText, autoSubtitles, importSubtitles, trackMotion } from '../actions'
import { askConfirm } from '@/components/PromptDialog'
import { addMediaClip } from '../timeline/ops'
import { cn } from '@/utils/cn'

const FILTERS: { name: string; color: Partial<ColorGrade>; fx?: Partial<Effects>; swatch: string }[] = [
  { name: 'Original', color: {}, swatch: 'linear-gradient(135deg,#888,#ccc)' },
  { name: 'Cinematic', color: { contrast: 0.2, saturation: -0.15, temperature: -0.15, shadows: -0.1, highlights: -0.05 }, fx: { vignette: 0.4 }, swatch: 'linear-gradient(135deg,#0f3b4a,#d89b4a)' },
  { name: 'Vintage', color: { saturation: -0.3, temperature: 0.3, contrast: -0.1, tint: 0.05 }, fx: { grain: 18, vignette: 0.3 }, swatch: 'linear-gradient(135deg,#8a6a3a,#e8cf9c)' },
  { name: 'Black & White', color: { contrast: 0.15 }, fx: { grayscale: true }, swatch: 'linear-gradient(135deg,#111,#eee)' },
  { name: 'Warm', color: { temperature: 0.4, saturation: 0.1 }, swatch: 'linear-gradient(135deg,#c2410c,#fde68a)' },
  { name: 'Cool', color: { temperature: -0.4, tint: -0.05 }, swatch: 'linear-gradient(135deg,#1e3a8a,#a5f3fc)' },
  { name: 'Vivid', color: { saturation: 0.45, contrast: 0.15 }, swatch: 'linear-gradient(135deg,#db2777,#22d3ee)' },
  { name: 'Faded', color: { saturation: -0.35, contrast: -0.25, brightness: 0.1 }, swatch: 'linear-gradient(135deg,#9ca3af,#f3f4f6)' },
]

const EFFECTS: { name: string; patch: Partial<Effects> }[] = [
  { name: 'Blur', patch: { blur: 8 } },
  { name: 'Gaussian blur', patch: { gaussianBlur: 10 } },
  { name: 'Sharpen', patch: { sharpen: 1.5 } },
  { name: 'Glow', patch: { glow: 0.5 } },
  { name: 'Vignette', patch: { vignette: 0.6 } },
  { name: 'Film grain', patch: { grain: 25 } },
  { name: 'Noise', patch: { noise: 20 } },
  { name: 'Chromatic aberration', patch: { chromaticAberration: 6 } },
  { name: 'Mirror', patch: { mirror: true } },
  { name: 'Invert', patch: { invert: true } },
  { name: 'Stabilize', patch: { stabilize: true } },
  { name: 'Ellipse mask', patch: { ellipseMask: true } },
  { name: 'Green screen', patch: { chromaKey: { enabled: true, color: '#00ff00', similarity: 0.18, blend: 0.1 } } },
]

const TRANSITIONS: { type: TransitionType; label: string }[] = [
  { type: 'fade', label: 'Fade' }, { type: 'dissolve', label: 'Cross dissolve' }, { type: 'wipe', label: 'Wipe' },
  { type: 'slide', label: 'Slide' }, { type: 'zoom', label: 'Zoom' }, { type: 'blur', label: 'Blur' },
]

const visualSelection = (): Clip[] => {
  const s = useEditor.getState()
  return s.project.clips.filter((c) => s.selection.includes(c.id) && c.kind !== 'audio')
}

function applyToSelected(fn: (c: Clip) => Partial<Clip>): void {
  const sel = visualSelection()
  if (!sel.length) return void toast.info('Select a video, image or text clip on the timeline first.')
  useEditor.getState().commit((p) => ({ ...p, clips: p.clips.map((c) => (sel.some((s) => s.id === c.id) ? { ...c, ...fn(c) } : c)) }))
}

export function EffectsPanel() {
  const [tab, setTab] = useState<'filters' | 'effects' | 'transitions' | 'text' | 'audio'>('filters')
  const tabs = ['filters', 'effects', 'transitions', 'text', 'audio'] as const
  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-0.5 border-b border-border px-1 pt-1">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={cn('rounded-t px-2 py-1.5 text-[11px] capitalize', tab === t ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground')}>{t}</button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {tab === 'filters' && (
          <div className="grid grid-cols-2 gap-2">
            {FILTERS.map((f) => (
              <button key={f.name} onClick={() => applyToSelected((c) => ({ color: { ...defaultColor(), ...f.color, lutPath: c.color.lutPath }, effects: { ...c.effects, ...(f.name === 'Original' ? { grayscale: false, vignette: 0, grain: 0 } : {}), ...f.fx } }))}
                className="overflow-hidden rounded-md border border-border text-left hover:border-primary">
                <div className="h-14" style={{ background: f.swatch }} /><div className="px-2 py-1 text-xs">{f.name}</div>
              </button>
            ))}
          </div>
        )}
        {tab === 'effects' && (
          <div className="grid grid-cols-2 gap-2">
            {EFFECTS.map((e) => (
              <button key={e.name} onClick={() => applyToSelected((c) => ({ effects: { ...c.effects, ...e.patch } }))} className="rounded-md border border-border px-2 py-2 text-left text-xs hover:border-primary hover:bg-muted">{e.name}</button>
            ))}
            <button onClick={() => applyToSelected(() => ({ effects: defaultEffects() }))} className="col-span-2 rounded-md border border-danger/40 px-2 py-2 text-xs text-danger hover:bg-danger/10">Clear all effects</button>
            <p className="col-span-2 text-[11px] text-muted-foreground">Fine-tune every effect in the Properties panel. Sharpen, glow, grain, noise, chromatic aberration, green screen, stabilize and LUTs are applied when you export (the live preview shows the rest).</p>
          </div>
        )}
        {tab === 'transitions' && (
          <div className="space-y-1">
            <p className="mb-2 text-[11px] text-muted-foreground">Applies to the start (In) or end (Out) of the selected clip. Set the length in Properties → Transitions.</p>
            {TRANSITIONS.map((t) => (
              <div key={t.type} className="flex items-center gap-1 rounded-md border border-border p-1.5">
                <span className="flex-1 text-xs">{t.label}</span>
                <button onClick={() => applyToSelected((c) => ({ transitionIn: { type: t.type, duration: Math.min(0.8, c.duration / 2) } }))} className="rounded bg-muted px-2 py-1 text-[11px] hover:bg-primary hover:text-primary-foreground">In</button>
                <button onClick={() => applyToSelected((c) => ({ transitionOut: { type: t.type, duration: Math.min(0.8, c.duration / 2) } }))} className="rounded bg-muted px-2 py-1 text-[11px] hover:bg-primary hover:text-primary-foreground">Out</button>
              </div>
            ))}
            <button onClick={() => applyToSelected(() => ({ transitionIn: { type: 'none', duration: 0.5 }, transitionOut: { type: 'none', duration: 0.5 } }))} className="mt-2 w-full rounded-md border border-border py-1.5 text-xs hover:bg-muted">Remove transitions</button>
          </div>
        )}
        {tab === 'text' && <TextTab />}
        {tab === 'audio' && <AudioTab />}
      </div>
    </div>
  )
}

const STAGE_LABEL: Record<string, string> = { 'download-engine': 'Downloading speech engine', 'download-model': 'Downloading speech model', extract: 'Unpacking', audio: 'Extracting audio', transcribe: 'Transcribing', done: 'Done' }

function AutoSubtitles() {
  const [busy, setBusy] = useState<{ stage: string; percent: number } | null>(null)
  const go = async () => {
    setBusy({ stage: 'audio', percent: 0 })
    const off = api().subtitles.onProgress((p) => setBusy(p))
    try {
      const st = await api().subtitles.status()
      if (!st.installed) {
        const ok = await askConfirm(`Automatic subtitles run offline on your PC. This needs a one-time download of about ${st.downloadMB} MB (the open-source whisper.cpp engine from GitHub and its English speech model from Hugging Face). Your audio never leaves this computer. Download now?`, 'Download')
        if (!ok) return
        await api().subtitles.install()
        toast.success('Speech engine installed')
      }
      await autoSubtitles()
    } catch (e) {
      const m = errMsg(e)
      if (!/cancel/i.test(m)) toast.error(m)
    } finally {
      off()
      setBusy(null)
    }
  }
  return (
    <div className="space-y-1">
      <button disabled={!!busy} onClick={() => void go()} className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2.5 text-left text-sm hover:border-primary hover:bg-muted disabled:opacity-60"><Captions size={15} />Auto subtitles (offline, English)</button>
      {busy && (
        <div className="space-y-1 rounded-md border border-border p-2 text-xs">
          <div className="flex justify-between"><span>{STAGE_LABEL[busy.stage] ?? busy.stage}…</span><span>{Math.round(busy.percent)}%</span></div>
          <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${busy.percent}%` }} /></div>
          <button onClick={() => void api().subtitles.cancel()} className="text-primary hover:underline">Cancel</button>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Select a clip with speech first. English only; accuracy depends on audio quality, so review the result.</p>
    </div>
  )
}

function MotionTrack() {
  const [x, setX] = useState(50)
  const [y, setY] = useState(50)
  const [busy, setBusy] = useState(false)
  const num = (v: string) => Math.min(100, Math.max(0, Number(v) || 0))
  return (
    <div className="space-y-1.5 rounded-md border border-border p-2.5">
      <div className="flex items-center gap-2 text-sm"><Crosshair size={15} />Motion tracking</div>
      <p className="text-[11px] text-muted-foreground">Ctrl+click two clips on the timeline: the video, then a title or overlay that should follow a point in it. Point = where in the video frame to lock on (0–100 %).</p>
      <div className="flex items-center gap-2 text-xs">
        <label className="flex items-center gap-1">X <input type="number" min={0} max={100} value={x} onChange={(e) => setX(num(e.target.value))} className="h-7 w-14 rounded border border-border bg-muted px-1.5" />%</label>
        <label className="flex items-center gap-1">Y <input type="number" min={0} max={100} value={y} onChange={(e) => setY(num(e.target.value))} className="h-7 w-14 rounded border border-border bg-muted px-1.5" />%</label>
        <button disabled={busy} onClick={async () => { setBusy(true); try { await trackMotion(x / 100, y / 100) } finally { setBusy(false) } }}
          className="ml-auto h-7 rounded bg-primary px-3 text-xs font-medium text-primary-foreground disabled:opacity-60">{busy ? 'Tracking…' : 'Track'}</button>
      </div>
      <p className="text-[11px] text-muted-foreground">Tracks position only (not rotation/scale). Works best on a high-contrast spot that stays visible.</p>
    </div>
  )
}

function TextTab() {
  const T =({ label, onClick }: { label: string; onClick: () => void }) => (
    <button onClick={onClick} className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2.5 text-left text-sm hover:border-primary hover:bg-muted"><Type size={15} />{label}</button>
  )
  return (
    <div className="space-y-2">
      <T label="Add title" onClick={() => addText('title')} />
      <T label="Add lower third" onClick={() => addText('lower-third')} />
      <T label="Add subtitle" onClick={() => addText('subtitle')} />
      <button onClick={async () => { try { const cues = await api().media.pickSubtitles(); if (cues) cues.length ? importSubtitles(cues) : toast.error('No subtitle cues found in that file.') } catch (e) { toast.error(errMsg(e)) } }}
        className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2.5 text-left text-sm hover:border-primary hover:bg-muted"><Captions size={15} />Import subtitles (.srt)</button>
      <AutoSubtitles />
      <MotionTrack />
      <p className="text-[11px] text-muted-foreground">Text is added at the playhead. Select it on the timeline to edit font, colour, outline, shadow and animation in Properties.</p>
    </div>
  )
}

function AudioTab() {
  const [recording, setRecording] = useState(false)
  const rec = useRef<{ mr: MediaRecorder; chunks: Blob[]; startAt: number; stream: MediaStream } | null>(null)

  const start = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      const mr = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
      const state = { mr, chunks: [] as Blob[], startAt: useEditor.getState().playhead, stream }
      mr.ondataavailable = (e) => e.data.size && state.chunks.push(e.data)
      mr.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        try {
          const buf = await new Blob(state.chunks, { type: 'audio/webm' }).arrayBuffer()
          const res = await api().media.saveRecording(buf)
          const item = res.items[0]
          if (!item) throw new Error(res.errors[0]?.error ?? 'Recording could not be saved')
          useEditor.getState().commit((p) => ({ ...p, media: [...p.media, item] }))
          const track = useEditor.getState().project.tracks.find((t) => t.kind === 'audio' && t.name !== 'Music') ?? undefined
          let id = ''
          useEditor.getState().commit((p) => { const r = addMediaClip(p, item, { trackId: track?.id, start: state.startAt }); id = r.clipId; return r.project })
          useEditor.getState().select([id])
          toast.success('Voiceover added to the timeline')
        } catch (e) { toast.error(errMsg(e)) }
      }
      mr.start()
      rec.current = state
      setRecording(true)
    } catch (e) {
      toast.error(`Microphone unavailable: ${errMsg(e)}`)
    }
  }
  const stop = () => { rec.current?.mr.stop(); setRecording(false) }

  return (
    <div className="space-y-2">
      <button onClick={recording ? stop : () => void start()} className={cn('flex w-full items-center gap-2 rounded-md border px-3 py-2.5 text-sm', recording ? 'border-danger bg-danger/15 text-danger' : 'border-border hover:border-primary hover:bg-muted')}>
        {recording ? <><Square size={14} fill="currentColor" />Stop recording</> : <><Mic size={15} />Record voiceover at playhead</>}
      </button>
      <button onClick={async () => { const { importViaDialog } = await import('../actions'); const items = await importViaDialog(); const a = items.find((m) => m.kind === 'audio'); if (a) addMediaToTimeline(a, { trackId: useEditor.getState().project.tracks.find((t) => t.name === 'Music')?.id }) }}
        className="w-full rounded-md border border-border px-3 py-2.5 text-left text-sm hover:border-primary hover:bg-muted">Add background music…</button>
      <p className="text-[11px] text-muted-foreground">Per-clip volume, fade in/out, noise reduction and sync offset are in Properties → Audio. Mute whole tracks with the speaker icon in the timeline.</p>
    </div>
  )
}
