import { useEffect, useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { api, errMsg } from '@/services/api'
import { useAuth } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { toast } from '@/store/toastStore'
import type { ExportHistoryEntry, FfCapabilities, FfmpegStatus, Preferences, SystemInfo, ToolStatus } from '@/types/electron'
import { formatBytes } from '@/utils/anim'
import { Toggle } from '@/editor/properties/Fields'

/** Usage limits per plan. Enforced by the sync server; displayed here. Payments are NOT implemented. */
const PLANS = [
  { id: 'free', name: 'Free', limits: ['Up to 5 cloud projects', '1080p export', 'Local editing unlimited'] },
  { id: 'pro', name: 'Pro', limits: ['Up to 50 cloud projects', '4K export', '10 GB cloud media'] },
  { id: 'premium', name: 'Premium', limits: ['Unlimited cloud projects', '4K export', '100 GB cloud media'] },
]

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="space-y-3 rounded-xl border border-border bg-panel p-5"><h2 className="font-medium">{title}</h2>{children}</section>
}

function Tool({ name, s }: { name: string; s: ToolStatus }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      {s.found ? <CheckCircle2 className="text-success" size={16} /> : <XCircle className="text-danger" size={16} />}
      <span className="font-medium">{name}</span>
      <span className="text-muted-foreground">{s.found ? `version ${s.version ?? '?'}` : s.error ?? 'not found'}</span>
    </div>
  )
}

export function SettingsPage() {
  const [prefs, setPrefs] = useState<Preferences | null>(null)
  const [info, setInfo] = useState<SystemInfo | null>(null)
  const [ff, setFf] = useState<FfmpegStatus | null>(null)
  const [caps, setCaps] = useState<FfCapabilities | null>(null)
  const [hist, setHist] = useState<ExportHistoryEntry[]>([])
  const profile = useAuth((s) => s.profile)
  const localMode = useAuth((s) => s.localMode)
  const resetLayout = useUiStore((s) => s.resetLayout)

  useEffect(() => {
    const a = api()
    void a.prefs.get().then(setPrefs)
    void a.system.getInfo().then(setInfo)
    void a.system.checkFfmpeg().then(setFf)
    a.exporter.capabilities().then(setCaps).catch(() => undefined)
    void a.exporter.history().then(setHist)
  }, [])

  const save = async (patch: Partial<Preferences>) => {
    try { setPrefs(await api().prefs.set(patch)) } catch (e) { toast.error(errMsg(e)) }
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <div className="grid max-w-5xl gap-5 lg:grid-cols-2">
        <Card title="Editor">
          {prefs && (<>
            <label className="flex items-center justify-between text-sm">Autosave interval
              <select value={prefs.autosaveSeconds} onChange={(e) => void save({ autosaveSeconds: Number(e.target.value) })} className="h-8 rounded border border-border bg-muted px-2">{[5, 15, 30, 60, 120].map((s) => <option key={s} value={s}>{s}s</option>)}</select>
            </label>
            <p className="text-[11px] text-muted-foreground">Takes effect the next time you open the editor.</p>
            <Toggle label="Prefer proxies for preview when available" checked={prefs.proxyForLargeFiles} onChange={(v) => void save({ proxyForLargeFiles: v })} />
            <button onClick={resetLayout} className="text-sm text-accent hover:underline">Reset workspace layout</button>
          </>)}
        </Card>

        <Card title="Cloud & privacy">
          {prefs && (<>
            <Toggle label="Sync project files (timeline JSON) to my account" checked={!!prefs.cloudSyncEnabled} onChange={(v) => void save({ cloudSyncEnabled: v })} />
            <Toggle label="Allow uploading media files to cloud storage" checked={prefs.cloudUploadEnabled} onChange={(v) => void save({ cloudUploadEnabled: v })} />
            <p className="text-[11px] text-muted-foreground">Both are OFF by default. Your original video/audio/image files never leave this computer unless you turn on media upload and explicitly upload them. Sync sends only the project timeline, with folder paths reduced to file names.</p>
            {localMode && <p className="text-[11px] text-amber-400">Cloud features need Supabase configured (see docs/supabase.md).</p>}
          </>)}
        </Card>

        <Card title="Subscription">
          <p className="text-sm">Current plan: <b className="uppercase text-accent">{profile?.plan ?? 'free'}</b></p>
          <div className="grid gap-2">
            {PLANS.map((p) => (
              <div key={p.id} className={`rounded-lg border p-3 text-sm ${profile?.plan === p.id ? 'border-primary bg-primary/10' : 'border-border'}`}>
                <div className="font-medium">{p.name}</div><ul className="mt-1 list-disc pl-5 text-xs text-muted-foreground">{p.limits.map((l) => <li key={l}>{l}</li>)}</ul>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground">Paid upgrades are not available: no payment provider is connected. The database stores plan, status and limits so a provider (e.g. Stripe) can be added later — see docs/architecture.md.</p>
        </Card>

        <Card title="FFmpeg & system">
          {ff ? (<><Tool name="ffmpeg" s={ff.ffmpeg} /><Tool name="ffprobe" s={ff.ffprobe} />{ff.source && <p className="text-[11px] text-muted-foreground">Using {ff.source} binaries.</p>}</>) : <p className="text-sm text-muted-foreground">Checking…</p>}
          {caps && (
            <div className="flex flex-wrap gap-1 pt-1">
              {[...Object.entries(caps.encoders), ...Object.entries(caps.filters)].map(([k, v]) => <span key={k} className={`rounded px-1.5 py-0.5 text-[10px] ${v ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}`}>{k}</span>)}
            </div>
          )}
          {info && <p className="pt-1 font-mono text-[11px] text-muted-foreground">v{info.appVersion} · Electron {info.electron} · Chromium {info.chrome} · {info.cpus} threads · {info.totalMemGb} GB</p>}
        </Card>

        <div className="lg:col-span-2"><Card title="Export history">
          {hist.length === 0 ? <p className="text-sm text-muted-foreground">No exports yet.</p> : (
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {hist.map((h) => (
                <button key={h.id} onClick={() => void api().exporter.reveal(h.outputPath)} className="flex w-full items-center gap-3 rounded px-2 py-1.5 text-left text-xs hover:bg-muted" title="Show in folder">
                  <span className="min-w-0 flex-1 truncate">{h.projectName}</span><span className="text-muted-foreground">{h.format.toUpperCase()} · {h.resolution} · {h.fps}fps · {formatBytes(h.sizeBytes)}</span><span className="text-muted-foreground">{new Date(h.createdAt).toLocaleString()}</span>
                </button>
              ))}
            </div>
          )}
        </Card></div>
      </div>
    </div>
  )
}
