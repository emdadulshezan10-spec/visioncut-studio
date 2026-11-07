import { Diamond, Trash2 } from 'lucide-react'
import { api, errMsg } from '@/services/api'
import { toast } from '@/store/toastStore'
import { useEditor } from '@/store/editorStore'
import { ASPECT_PRESETS, defaultColor, defaultEffects, type AnimatableProp, type Clip, type TextProps, type TransitionType } from '@/types/project'
import { currentValue, edit, editClips, setAnimatable } from './edit'
import { colorCls, Row, Section, selectCls, Slider, Toggle } from './Fields'
import { changeSpeed, trimRight } from '../timeline/ops'
import { cn } from '@/utils/cn'

const FONTS = ['Arial', 'Segoe UI', 'Calibri', 'Verdana', 'Trebuchet MS', 'Georgia', 'Times New Roman', 'Impact', 'Comic Sans MS', 'Courier New', 'Consolas']
const TRANSITION_OPTS: TransitionType[] = ['none', 'fade', 'dissolve', 'wipe', 'slide', 'zoom', 'blur']

export function PropertiesPanel() {
  const project = useEditor((s) => s.project)
  const selection = useEditor((s) => s.selection)
  const playhead = useEditor((s) => s.playhead)
  const clips = project.clips.filter((c) => selection.includes(c.id))
  const clip = clips[0]
  if (!clip) return <ProjectSettings />
  const ids = clips.map((c) => c.id)
  const media = project.media.find((m) => m.id === clip.mediaId)
  const isText = clip.kind === 'text'
  const isAudio = clip.kind === 'audio'
  const hasAudio = isAudio || (clip.kind === 'video' && !!media?.hasAudio)
  const timed = clip.kind === 'video' || clip.kind === 'audio'
  const set = (key: string, patch: (c: Clip) => Partial<Clip>) => editClips(ids, key, patch)
  const tf = clip.transform
  const kf = (p: AnimatableProp) => !!clip.keyframes[p]?.length
  const val = (p: AnimatableProp) => currentValue(clip, p, playhead)

  return (
    <div className="h-full overflow-y-auto pb-6">
      <div className="border-b border-border px-3 py-2">
        <div className="truncate text-sm font-semibold">{isText ? 'Text' : media?.name ?? clip.kind}</div>
        <div className="text-[11px] text-muted-foreground">{ids.length > 1 ? `${ids.length} clips selected — editing applies to all` : `${clip.kind} clip`}</div>
      </div>

      {isText && clip.text && <TextSection clip={clip} />}

      {!isAudio && (
        <Section title="Transform">
          <Slider label="Position X" unit="%" min={-150} max={150} step={0.5} digits={1} value={val('x')} keyed={kf('x')} onChange={(v) => setAnimatable(clip, 'x', v, playhead)} />
          <Slider label="Position Y" unit="%" min={-150} max={150} step={0.5} digits={1} value={val('y')} keyed={kf('y')} onChange={(v) => setAnimatable(clip, 'y', v, playhead)} />
          <Slider label="Scale" min={0.05} max={4} step={0.01} value={val('scale')} keyed={kf('scale')} onChange={(v) => setAnimatable(clip, 'scale', v, playhead)} />
          <Slider label="Rotation" unit="°" min={-360} max={360} step={1} digits={0} value={val('rotation')} keyed={kf('rotation')} onChange={(v) => setAnimatable(clip, 'rotation', v, playhead)} />
          <Slider label="Opacity (0-1)" min={0} max={1} step={0.01} value={val('opacity')} keyed={kf('opacity')} onChange={(v) => setAnimatable(clip, 'opacity', v, playhead)} />
          <Toggle label="Flip horizontal" checked={tf.flipH} onChange={(v) => set('flipH', (c) => ({ transform: { ...c.transform, flipH: v } }))} />
          <Toggle label="Flip vertical" checked={tf.flipV} onChange={(v) => set('flipV', (c) => ({ transform: { ...c.transform, flipV: v } }))} />
          <button className="text-xs text-accent hover:underline" onClick={() => set('tfreset', (c) => ({ transform: { ...c.transform, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, keyframes: {} }))}>Reset transform</button>
        </Section>
      )}

      {!isAudio && !isText && (
        <Section title="Crop" defaultOpen={false}>
          {(['cropLeft', 'cropRight', 'cropTop', 'cropBottom'] as const).map((k) => (
            <Slider key={k} label={k.replace('crop', 'Crop ')} unit="%" min={0} max={90} step={0.5} digits={1} value={tf[k]} onChange={(v) => set(k, (c) => ({ transform: { ...c.transform, [k]: v } }))} />
          ))}
        </Section>
      )}

      <Section title="Timing">
        <Row label="Start"><span className="font-mono">{clip.start.toFixed(2)}s</span></Row>
        <Row label="Duration">
          <input type="number" min={0.1} step={0.1} value={Number(clip.duration.toFixed(2))} onChange={(e) => { const v = Number(e.target.value); if (v >= 0.1) edit(`dur-${clip.id}`, (p) => trimRight(p, clip.id, clip.start + v)) }} className="h-7 w-20 rounded border border-border bg-muted px-1.5 text-right font-mono text-xs outline-none focus:border-primary" />
        </Row>
        {timed && (<>
          <Slider label="Speed" unit="x" min={0.1} max={8} step={0.05} value={clip.speed} onChange={(v) => edit(`speed-${clip.id}`, (p) => ids.reduce((acc, id) => changeSpeed(acc, id, v), p))} />
          <div className="flex gap-1">
            {[{ l: 'Slow-mo 0.25x', v: 0.25 }, { l: '0.5x', v: 0.5 }, { l: '1x', v: 1 }, { l: '2x', v: 2 }, { l: 'Fast 4x', v: 4 }].map((b) => (
              <button key={b.v} onClick={() => edit(`speed-${clip.id}`, (p) => ids.reduce((acc, id) => changeSpeed(acc, id, b.v), p))} className={cn('flex-1 rounded border px-1 py-1 text-[10px]', clip.speed === b.v ? 'border-primary bg-primary/20' : 'border-border hover:bg-muted')}>{b.l}</button>
            ))}
          </div>
          <Toggle label="Reverse (rendered on export)" checked={clip.reverse} onChange={(v) => set('rev', () => ({ reverse: v }))} />
          {clip.reverse && <p className="text-[11px] text-muted-foreground">Reverse needs the whole segment in memory when exporting. Keep reversed clips short (under ~30 s at 1080p).</p>}
        </>)}
      </Section>

      {hasAudio && (
        <Section title="Audio">
          <Slider label="Volume" unit="%" min={0} max={2} step={0.01} digits={2} value={clip.volume} onChange={(v) => set('vol', () => ({ volume: v }))} />
          <Slider label="Fade in" unit="s" min={0} max={Math.max(0.1, clip.duration / 2)} step={0.05} value={clip.audioFadeIn} onChange={(v) => set('afi', () => ({ audioFadeIn: v }))} />
          <Slider label="Fade out" unit="s" min={0} max={Math.max(0.1, clip.duration / 2)} step={0.05} value={clip.audioFadeOut} onChange={(v) => set('afo', () => ({ audioFadeOut: v }))} />
          <Slider label="Sync offset" unit="s" min={-2} max={2} step={0.01} value={clip.audioOffset} onChange={(v) => set('aoff', () => ({ audioOffset: v }))} />
          <Toggle label="Noise reduction (applied on export)" checked={clip.denoise} onChange={(v) => set('dn', () => ({ denoise: v }))} />
        </Section>
      )}

      {!isAudio && (
        <>
          <ColorSection clip={clip} ids={ids} />
          <EffectsSection clip={clip} ids={ids} />
          <TransitionSection clip={clip} ids={ids} />
          <AnimationSection clip={clip} playhead={playhead} />
        </>
      )}
    </div>
  )
}

function ColorSection({ clip, ids }: { clip: Clip; ids: string[] }) {
  const c = clip.color
  const set = (k: keyof typeof c, v: number) => editClips(ids, `col-${k}`, (cl) => ({ color: { ...cl.color, [k]: v } }))
  const rows: [keyof typeof c, string, number, number][] = [
    ['brightness', 'Brightness', -1, 1], ['contrast', 'Contrast', -1, 1], ['saturation', 'Saturation', -1, 1], ['exposure', 'Exposure', -2, 2],
    ['temperature', 'Temperature', -1, 1], ['tint', 'Tint', -1, 1], ['highlights', 'Highlights', -1, 1], ['shadows', 'Shadows', -1, 1],
    ['red', 'Red', -1, 1], ['green', 'Green', -1, 1], ['blue', 'Blue', -1, 1],
  ]
  return (
    <Section title="Color grading" defaultOpen={false}>
      {rows.map(([k, label, min, max]) => <Slider key={k} label={label} min={min} max={max} step={0.01} value={c[k] as number} onChange={(v) => set(k, v)} />)}
      <Row label="LUT (.cube)">
        <span className="flex items-center gap-1">
          <button className="rounded border border-border px-2 py-1 hover:bg-muted" onClick={async () => { try { const f = await api().media.pickLut(); if (f) editClips(ids, 'lut', (cl) => ({ color: { ...cl.color, lutPath: f } })) } catch (e) { toast.error(errMsg(e)) } }}>{c.lutPath ? c.lutPath.split(/[\\/]/).pop() : 'Choose…'}</button>
          {c.lutPath && <button title="Remove LUT" onClick={() => editClips(ids, 'lut', (cl) => ({ color: { ...cl.color, lutPath: undefined } }))}><Trash2 size={13} className="text-danger" /></button>}
        </span>
      </Row>
      <button className="text-xs text-accent hover:underline" onClick={() => editClips(ids, 'colreset', () => ({ color: defaultColor() }))}>Reset color</button>
      <p className="text-[11px] text-muted-foreground">LUTs and fine colour matching are applied on export; exposure, temperature, tint, RGB and highlights/shadows are previewed live.</p>
    </Section>
  )
}

function EffectsSection({ clip, ids }: { clip: Clip; ids: string[] }) {
  const e = clip.effects
  const num = (k: 'blur' | 'gaussianBlur' | 'sharpen' | 'glow' | 'vignette' | 'grain' | 'noise' | 'chromaticAberration', label: string, min: number, max: number, step: number) =>
    <Slider key={k} label={label} min={min} max={max} step={step} value={e[k]} onChange={(v) => editClips(ids, `fx-${k}`, (c) => ({ effects: { ...c.effects, [k]: v } }))} />
  const bool = (k: 'grayscale' | 'invert' | 'mirror' | 'stabilize' | 'ellipseMask', label: string) =>
    <Toggle key={k} label={label} checked={e[k]} onChange={(v) => editClips(ids, `fx-${k}`, (c) => ({ effects: { ...c.effects, [k]: v } }))} />
  const ck = e.chromaKey
  const setCk = (p: Partial<typeof ck>) => editClips(ids, 'ck', (c) => ({ effects: { ...c.effects, chromaKey: { ...c.effects.chromaKey, ...p } } }))
  return (
    <Section title="Effects" defaultOpen={false}>
      {num('blur', 'Blur', 0, 50, 1)}{num('gaussianBlur', 'Gaussian blur', 0, 50, 0.5)}{num('sharpen', 'Sharpen', 0, 5, 0.1)}{num('glow', 'Glow', 0, 1, 0.05)}
      {num('vignette', 'Vignette', 0, 1, 0.05)}{num('grain', 'Film grain', 0, 100, 1)}{num('noise', 'Noise', 0, 100, 1)}{num('chromaticAberration', 'Chromatic aberration', 0, 20, 1)}
      {bool('grayscale', 'Black & white')}{bool('invert', 'Invert')}{bool('mirror', 'Mirror')}{bool('stabilize', 'Stabilize (deshake, on export)')}{bool('ellipseMask', 'Ellipse mask')}
      <div className="rounded-md border border-border p-2">
        <Toggle label="Green screen (chroma key)" checked={ck.enabled} onChange={(v) => setCk({ enabled: v })} />
        {ck.enabled && (<div className="mt-2 space-y-2">
          <Row label="Key colour"><input type="color" className={colorCls} value={ck.color} onChange={(ev) => setCk({ color: ev.target.value })} /></Row>
          <Slider label="Similarity" min={0.01} max={0.6} step={0.01} value={ck.similarity} onChange={(v) => setCk({ similarity: v })} />
          <Slider label="Edge blend" min={0} max={0.5} step={0.01} value={ck.blend} onChange={(v) => setCk({ blend: v })} />
          <p className="text-[11px] text-muted-foreground">The key is rendered on export. Put the keyed clip on a track above your background to see the result in the exported video.</p>
        </div>)}
      </div>
      <button className="text-xs text-accent hover:underline" onClick={() => editClips(ids, 'fxreset', () => ({ effects: defaultEffects() }))}>Reset effects</button>
    </Section>
  )
}

function TransitionSection({ clip, ids }: { clip: Clip; ids: string[] }) {
  const part = (which: 'transitionIn' | 'transitionOut', label: string) => {
    const t = clip[which]
    return (
      <div className="space-y-2">
        <Row label={label}>
          <select className={selectCls} value={t.type} onChange={(e) => editClips(ids, which, (c) => ({ [which]: { type: e.target.value as TransitionType, duration: Math.min(c[which].duration || 0.5, c.duration / 2) } }))}>
            {TRANSITION_OPTS.map((o) => <option key={o} value={o}>{o === 'none' ? 'None' : o[0].toUpperCase() + o.slice(1)}</option>)}
          </select>
        </Row>
        {t.type !== 'none' && <Slider label="Duration" unit="s" min={0.1} max={Math.max(0.2, clip.duration / 2)} step={0.05} value={t.duration} onChange={(v) => editClips(ids, `${which}d`, (c) => ({ [which]: { ...c[which], duration: v } }))} />}
      </div>
    )
  }
  return <Section title="Transitions" defaultOpen={false}>{part('transitionIn', 'In')}{part('transitionOut', 'Out')}</Section>
}

const ANIM_PROPS: { p: AnimatableProp; label: string }[] = [
  { p: 'x', label: 'Position X' }, { p: 'y', label: 'Position Y' }, { p: 'scale', label: 'Scale' }, { p: 'rotation', label: 'Rotation' }, { p: 'opacity', label: 'Opacity' },
]

/** Keyframe animation: add a keyframe at the playhead, then change the property at other times. */
function AnimationSection({ clip, playhead }: { clip: Clip; playhead: number }) {
  const inside = playhead >= clip.start && playhead <= clip.start + clip.duration
  const local = playhead - clip.start
  return (
    <Section title="Keyframe animation" defaultOpen={false}>
      <p className="text-[11px] text-muted-foreground">Move the playhead inside the clip, click ◆ to add a keyframe, move the playhead and change the value in Transform — values interpolate smoothly between keyframes.</p>
      {ANIM_PROPS.map(({ p, label }) => {
        const frames = clip.keyframes[p] ?? []
        const at = frames.find((f) => Math.abs(f.time - local) < 0.02)
        return (
          <div key={p} className="rounded-md border border-border p-2">
            <div className="flex items-center justify-between text-xs">
              <span>{label}</span>
              <span className="flex items-center gap-1">
                <button disabled={!inside} title={at ? 'Remove keyframe at playhead' : 'Add keyframe at playhead'} onClick={() => {
                  const t = Math.min(clip.duration, Math.max(0, local))
                  if (at) editClips([clip.id], `kfx-${p}`, (c) => ({ keyframes: { ...c.keyframes, [p]: frames.filter((f) => f !== at) } }))
                  else editClips([clip.id], `kfx-${p}`, (c) => ({ keyframes: { ...c.keyframes, [p]: [...frames, { time: t, value: currentValue(c, p, playhead) }].sort((a, b) => a.time - b.time) } }))
                }} className={cn('grid h-6 w-6 place-items-center rounded hover:bg-muted disabled:opacity-30', at ? 'text-accent' : 'text-muted-foreground')}>
                  <Diamond size={13} fill={at ? 'currentColor' : 'none'} />
                </button>
                {frames.length > 0 && <button title="Clear keyframes" onClick={() => editClips([clip.id], `kfc-${p}`, (c) => ({ keyframes: { ...c.keyframes, [p]: [] } }))}><Trash2 size={13} className="text-danger" /></button>}
              </span>
            </div>
            {frames.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {frames.map((f) => <button key={f.time} onClick={() => useEditor.getState().setPlayhead(clip.start + f.time)} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] hover:bg-primary/30">{f.time.toFixed(2)}s={f.value.toFixed(2)}</button>)}
              </div>
            )}
          </div>
        )
      })}
    </Section>
  )
}

function TextSection({ clip }: { clip: Clip }) {
  const t = clip.text!
  const set = (patch: Partial<TextProps>) => editClips([clip.id], `txt-${Object.keys(patch)[0]}`, (c) => ({ text: { ...c.text!, ...patch } }))
  return (
    <Section title="Text">
      <textarea value={t.content} rows={3} onChange={(e) => set({ content: e.target.value })} className="w-full resize-none rounded border border-border bg-muted p-2 text-sm outline-none focus:border-primary select-text" />
      <Row label="Font"><select className={selectCls} value={t.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>{FONTS.map((f) => <option key={f} style={{ fontFamily: f }}>{f}</option>)}</select></Row>
      <Slider label="Size" min={16} max={300} step={1} digits={0} value={t.fontSize} onChange={(v) => set({ fontSize: v })} />
      <Row label="Colour"><input type="color" className={colorCls} value={t.color} onChange={(e) => set({ color: e.target.value })} /></Row>
      <div className="flex gap-1">
        {[{ k: 'bold', l: 'B', on: t.bold }, { k: 'italic', l: 'I', on: t.italic }].map((b) => (
          <button key={b.k} onClick={() => set({ [b.k]: !b.on } as Partial<TextProps>)} className={cn('h-7 w-8 rounded border text-sm', b.on ? 'border-primary bg-primary/20' : 'border-border', b.k === 'bold' && 'font-bold', b.k === 'italic' && 'italic')}>{b.l}</button>
        ))}
        {(['left', 'center', 'right'] as const).map((a) => <button key={a} onClick={() => set({ align: a })} className={cn('h-7 flex-1 rounded border text-[11px] capitalize', t.align === a ? 'border-primary bg-primary/20' : 'border-border')}>{a}</button>)}
      </div>
      <Slider label="Outline width" min={0} max={20} step={0.5} digits={1} value={t.outlineWidth} onChange={(v) => set({ outlineWidth: v })} />
      <Row label="Outline colour"><input type="color" className={colorCls} value={t.outlineColor} onChange={(e) => set({ outlineColor: e.target.value })} /></Row>
      <Toggle label="Shadow" checked={t.shadow} onChange={(v) => set({ shadow: v })} />
      <Row label="Background box">
        <span className="flex items-center gap-1">
          <input type="color" className={colorCls} value={t.background.slice(0, 7) || '#000000'} onChange={(e) => set({ background: e.target.value + 'cc' })} />
          {t.background && <button className="text-[11px] text-danger" onClick={() => set({ background: '' })}>none</button>}
        </span>
      </Row>
      <Row label="Layout"><select className={selectCls} value={t.preset} onChange={(e) => set({ preset: e.target.value as TextProps['preset'] })}><option value="title">Centered title</option><option value="lower-third">Lower third</option><option value="subtitle">Subtitle</option></select></Row>
      <Row label="Animation"><select className={selectCls} value={t.animation} onChange={(e) => set({ animation: e.target.value as TextProps['animation'] })}><option value="none">None</option><option value="fade">Fade</option><option value="slide-up">Slide up</option><option value="typewriter">Typewriter (wipe)</option><option value="pop">Pop</option></select></Row>
    </Section>
  )
}

/** Shown when nothing is selected: project canvas settings (aspect ratio, fps, background). */
function ProjectSettings() {
  const s = useEditor((st) => st.project.settings)
  const set = (patch: Partial<typeof s>) => edit('proj-settings', (p) => ({ ...p, settings: { ...p.settings, ...patch } }))
  const preset = ASPECT_PRESETS.find((a) => a.width === s.width && a.height === s.height)
  return (
    <div className="h-full overflow-y-auto">
      <div className="border-b border-border px-3 py-2 text-sm font-semibold">Project settings</div>
      <Section title="Canvas">
        <Row label="Aspect ratio">
          <select className={selectCls} value={preset?.label ?? 'custom'} onChange={(e) => { const a = ASPECT_PRESETS.find((x) => x.label === e.target.value); if (a) set({ width: a.width, height: a.height, aspectLabel: a.label }) }}>
            {ASPECT_PRESETS.map((a) => <option key={a.label}>{a.label}</option>)}<option value="custom">Custom</option>
          </select>
        </Row>
        <Row label="Size">
          <span className="flex items-center gap-1">
            <input type="number" min={240} max={7680} step={2} value={s.width} onChange={(e) => set({ width: Math.max(240, Math.round(Number(e.target.value) / 2) * 2), aspectLabel: 'Custom' })} className="h-7 w-16 rounded border border-border bg-muted px-1 text-right font-mono text-xs" />
            ×
            <input type="number" min={240} max={7680} step={2} value={s.height} onChange={(e) => set({ height: Math.max(240, Math.round(Number(e.target.value) / 2) * 2), aspectLabel: 'Custom' })} className="h-7 w-16 rounded border border-border bg-muted px-1 text-right font-mono text-xs" />
          </span>
        </Row>
        <Row label="Frame rate"><select className={selectCls} value={s.fps} onChange={(e) => set({ fps: Number(e.target.value) })}>{[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}</select></Row>
        <Row label="Background"><input type="color" className={colorCls} value={s.backgroundColor} onChange={(e) => set({ backgroundColor: e.target.value })} /></Row>
      </Section>
      <p className="px-3 text-[11px] text-muted-foreground">Select a clip on the timeline to edit its transform, speed, audio, colour, effects, transitions and keyframes.</p>
    </div>
  )
}

