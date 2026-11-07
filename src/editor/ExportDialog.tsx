import { useEffect, useMemo, useRef, useState } from 'react'
import { recordExport } from '@/services/sync'
import { AlertTriangle, CheckCircle2, FolderOpen, Loader2, X } from 'lucide-react'
import { api, errMsg } from '@/services/api'
import { useEditor } from '@/store/editorStore'
import { toast } from '@/store/toastStore'
import { estimateSizeBytes, FORMAT_CODECS, outputSize, validateExportOptions, type ExportCodec, type ExportFormat, type ExportOptions, type ExportProgress, type ExportResolution } from '@/types/export'
import type { FfCapabilities } from '@/types/electron'
import { projectDuration } from '@/types/project'
import { formatBytes, formatDuration } from '@/utils/anim'
import { renderTextImage } from './preview/renderText'
import { selectCls } from './properties/Fields'

const ENCODER: Record<ExportCodec, string> = { h264: 'libx264', h265: 'libx265', vp9: 'libvpx-vp9' }

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project)
  const duration = projectDuration(project)
  const [caps, setCaps] = useState<FfCapabilities | null>(null)
  const [capsErr, setCapsErr] = useState('')
  const [o, setO] = useState<ExportOptions>({
    format: 'mp4', codec: 'h264', resolution: '1080p', fps: Math.min(60, Math.max(24, project.settings.fps)) as 24 | 30 | 60,
    audioBitrateKbps: 192, outputDir: '', fileName: project.name.replace(/[<>:"/\\|?*]/g, '_'),
  })
  const [customBitrate, setCustomBitrate] = useState(false)
  const [kbps, setKbps] = useState(8000)
  const [job, setJob] = useState<{ id: string; progress: ExportProgress } | null>(null)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    void api().prefs.get().then((p) => p.defaultExportDir && setO((x) => ({ ...x, outputDir: x.outputDir || p.defaultExportDir })))
    api().exporter.capabilities().then(setCaps).catch((e) => setCapsErr(errMsg(e)))
  }, [])

  const opts: ExportOptions = { ...o, videoBitrateKbps: customBitrate ? kbps : undefined }
  const optsRef = useRef(opts)
  optsRef.current = opts

  useEffect(() => api().exporter.onProgress((p) => {
    setJob((j) => (j && j.id === p.jobId ? { id: j.id, progress: p } : j))
    // mirror successful exports into the account's export history (no-op in local mode)
    if (p.state === 'done') {
      const x = optsRef.current
      void recordExport({ projectId: useEditor.getState().project.id, format: x.format, codec: x.codec, resolution: x.resolution, fps: x.fps, sizeBytes: p.sizeBytes ?? 0, durationSec: projectDuration(useEditor.getState().project) })
    }
  }), [])
  const size = outputSize(project.settings.width, project.settings.height, o.resolution)
  const est = estimateSizeBytes(opts, duration, size.width, size.height)
  const invalid = validateExportOptions(opts)
  const busy = job && ['preparing', 'rendering'].includes(job.progress.state)
  const missingEncoder = caps && !caps.encoders[ENCODER[o.codec]]

  const setFormat = (format: ExportFormat) => setO((x) => ({ ...x, format, codec: FORMAT_CODECS[format].includes(x.codec) ? x.codec : FORMAT_CODECS[format][0] }))

  const pickFolder = async () => {
    const dir = await api().exporter.pickFolder()
    if (dir) { setO((x) => ({ ...x, outputDir: dir })); void api().prefs.set({ defaultExportDir: dir }) }
  }

  const start = async () => {
    if (invalid) return toast.error(invalid)
    if (duration <= 0) return toast.error('The timeline is empty — add clips before exporting.')
    setStarting(true)
    try {
      // Rasterise text clips here so export matches the preview exactly.
      const textImages: Record<string, string> = {}
      for (const c of project.clips) if (c.kind === 'text') textImages[c.id] = renderTextImage(c, project.settings.width, project.settings.height)
      const id = await api().exporter.start(project, opts, textImages)
      setJob({ id, progress: { jobId: id, state: 'preparing', percent: 0 } })
    } catch (e) {
      setJob({ id: 'x', progress: { jobId: 'x', state: 'error', percent: 0, error: errMsg(e) } })
    } finally { setStarting(false) }
  }

  const cancel = async () => { if (job) await api().exporter.cancel(job.id) }
  const p = job?.progress

  const warnings = useMemo(() => {
    const w: string[] = []
    for (const c of project.clips) {
      const m = c.mediaId ? project.media.find((x) => x.id === c.mediaId) : undefined
      if (c.kind !== 'text' && !m) w.push('A clip references media that was removed from the project.')
    }
    return [...new Set(w)]
  }, [project])

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose() }}>
      <div className="w-full max-w-lg rounded-xl border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <h2 className="font-semibold">Export video</h2>
          <button onClick={onClose} disabled={!!busy} className="text-muted-foreground hover:text-foreground disabled:opacity-30"><X size={18} /></button>
        </div>

        {p && p.state !== 'preparing' && p.state !== 'rendering' ? (
          <div className="space-y-4 p-5">
            {p.state === 'done' && (<>
              <div className="flex items-center gap-2 text-success"><CheckCircle2 /> <span className="font-medium">Export complete</span></div>
              <p className="break-all text-sm text-muted-foreground select-text">{p.outputPath} · {formatBytes(p.sizeBytes ?? 0)}</p>
              <div className="flex gap-2"><button onClick={() => void api().exporter.reveal(p.outputPath!)} className="flex-1 rounded-md bg-primary py-2 text-sm text-primary-foreground">Show in folder</button><button onClick={onClose} className="flex-1 rounded-md border border-border py-2 text-sm">Close</button></div>
            </>)}
            {p.state === 'error' && (<>
              <div className="flex items-center gap-2 text-danger"><AlertTriangle /> <span className="font-medium">Export failed</span></div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-2 text-xs select-text">{p.error}</pre>
              <div className="flex gap-2"><button onClick={() => setJob(null)} className="flex-1 rounded-md bg-primary py-2 text-sm text-primary-foreground">Back to settings</button><button onClick={onClose} className="flex-1 rounded-md border border-border py-2 text-sm">Close</button></div>
            </>)}
            {p.state === 'cancelled' && (<><p className="text-sm">Export cancelled. The partial file was deleted.</p><button onClick={() => setJob(null)} className="w-full rounded-md border border-border py-2 text-sm">Back to settings</button></>)}
          </div>
        ) : busy && p ? (
          <div className="space-y-4 p-5">
            <div className="flex items-center gap-2 text-sm"><Loader2 className="animate-spin" size={16} />{p.state === 'preparing' ? 'Preparing…' : `Rendering ${p.percent.toFixed(0)}%`}{p.etaSec !== undefined && <span className="text-muted-foreground">· about {formatDuration(p.etaSec)} left</span>}</div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-all" style={{ width: `${p.percent}%` }} /></div>
            <button onClick={() => void cancel()} className="w-full rounded-md border border-danger/50 py-2 text-sm text-danger hover:bg-danger/10">Cancel export</button>
          </div>
        ) : (
          <div className="space-y-3 p-5 text-sm">
            {capsErr && <p className="rounded bg-danger/15 p-2 text-xs text-danger">{capsErr}</p>}
            {warnings.map((w) => <p key={w} className="rounded bg-amber-500/15 p-2 text-xs text-amber-300">{w}</p>)}
            <div className="grid grid-cols-2 gap-3">
              <L label="Format"><select className={selectCls + ' w-full'} value={o.format} onChange={(e) => setFormat(e.target.value as ExportFormat)}>{(['mp4', 'mov', 'webm', 'avi'] as ExportFormat[]).map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}</select></L>
              <L label="Codec"><select className={selectCls + ' w-full'} value={o.codec} onChange={(e) => setO({ ...o, codec: e.target.value as ExportCodec })}>{FORMAT_CODECS[o.format].map((c) => <option key={c} value={c} disabled={caps ? !caps.encoders[ENCODER[c]] : false}>{{ h264: 'H.264', h265: 'H.265 (HEVC)', vp9: 'VP9' }[c]}</option>)}</select></L>
              <L label="Resolution"><select className={selectCls + ' w-full'} value={o.resolution} onChange={(e) => setO({ ...o, resolution: e.target.value as ExportResolution })}>{(['720p', '1080p', '1440p', '4k'] as ExportResolution[]).map((r) => <option key={r} value={r}>{r === '4k' ? '4K (2160p)' : r}</option>)}</select></L>
              <L label="Frame rate"><select className={selectCls + ' w-full'} value={o.fps} onChange={(e) => setO({ ...o, fps: Number(e.target.value) as 24 | 30 | 60 })}>{[24, 30, 60].map((f) => <option key={f} value={f}>{f} FPS</option>)}</select></L>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={customBitrate} onChange={(e) => setCustomBitrate(e.target.checked)} />Custom video bitrate</label>
              {customBitrate && <span className="flex items-center gap-1 text-xs"><input type="number" min={100} max={200000} step={500} value={kbps} onChange={(e) => setKbps(Number(e.target.value))} className="h-7 w-24 rounded border border-border bg-muted px-1.5 text-right" />kbps</span>}
              {!customBitrate && <span className="text-xs text-muted-foreground">Automatic quality (CRF)</span>}
            </div>
            <L label="File name"><input value={o.fileName} onChange={(e) => setO({ ...o, fileName: e.target.value })} className="h-8 w-full rounded border border-border bg-muted px-2 outline-none focus:border-primary" /></L>
            <L label="Output folder">
              <div className="flex gap-2"><input readOnly value={o.outputDir} placeholder="Choose a folder…" className="h-8 min-w-0 flex-1 rounded border border-border bg-muted px-2 text-xs" /><button onClick={() => void pickFolder()} className="flex items-center gap-1 rounded border border-border px-3 hover:bg-muted"><FolderOpen size={14} />Browse</button></div>
            </L>
            <div className="flex justify-between rounded-md bg-muted px-3 py-2 text-xs"><span>{size.width}×{size.height} · {formatDuration(duration)}</span><span>Estimated size ≈ <b>{formatBytes(est)}</b></span></div>
            {missingEncoder && <p className="text-xs text-danger">Your FFmpeg build lacks the {ENCODER[o.codec]} encoder.</p>}
            {invalid && o.outputDir && <p className="text-xs text-danger">{invalid}</p>}
            <button disabled={!!invalid || starting || !!missingEncoder || duration <= 0} onClick={() => void start()} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40">
              {starting && <Loader2 size={15} className="animate-spin" />}Start export
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs text-muted-foreground">{label}</span>{children}</label>
}
