import { useCallback, useEffect, useState } from 'react'
import { Cloud, CloudDownload, Copy, Film, FolderOpen, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
import { api, errMsg, mediaUrl } from '@/services/api'
import { confirmDiscard, createNewProject, openProject } from '@/services/projects'
import { cloudAvailable, deleteCloudProject, fetchCloudProject, listCloudProjects, type CloudProject } from '@/services/sync'
import { toast } from '@/store/toastStore'
import { askConfirm, askText } from '@/components/PromptDialog'
import { useEditor } from '@/store/editorStore'
import { useUiStore } from '@/store/uiStore'
import { ASPECT_PRESETS, type ProjectSummary } from '@/types/project'
import { formatDuration } from '@/utils/anim'

export function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('My video')
  const [aspect, setAspect] = useState(ASPECT_PRESETS[0].label)
  const [fps, setFps] = useState(30)
  const go = async () => {
    if (!(await confirmDiscard())) return
    const a = ASPECT_PRESETS.find((x) => x.label === aspect)!
    await createNewProject(name, { width: a.width, height: a.height, aspectLabel: a.label, fps })
    onClose()
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-96 space-y-4 rounded-xl border border-border bg-panel p-5">
        <h2 className="font-semibold">New project</h2>
        <label className="block text-xs text-muted-foreground">Name<input autoFocus value={name} maxLength={120} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void go()} className="mt-1 h-9 w-full rounded border border-border bg-muted px-3 text-sm text-foreground outline-none focus:border-primary" /></label>
        <div className="grid grid-cols-3 gap-2">
          {ASPECT_PRESETS.map((a) => (
            <button key={a.label} onClick={() => setAspect(a.label)} className={`rounded-md border p-2 text-center text-[11px] ${aspect === a.label ? 'border-primary bg-primary/15' : 'border-border hover:bg-muted'}`}>
              <div className="mx-auto mb-1 border border-muted-foreground/60" style={{ width: 28 * Math.min(1, a.width / a.height), height: 28 * Math.min(1, a.height / a.width) }} />{a.label.split(' ')[0]}
            </button>
          ))}
        </div>
        <label className="flex items-center justify-between text-xs text-muted-foreground">Frame rate
          <select value={fps} onChange={(e) => setFps(Number(e.target.value))} className="h-8 rounded border border-border bg-muted px-2 text-foreground">{[24, 25, 30, 50, 60].map((f) => <option key={f} value={f}>{f} fps</option>)}</select>
        </label>
        <div className="flex gap-2"><button onClick={onClose} className="h-9 flex-1 rounded-md border border-border text-sm hover:bg-muted">Cancel</button><button onClick={() => void go()} className="h-9 flex-1 rounded-md bg-primary text-sm font-medium text-primary-foreground">Create</button></div>
      </div>
    </div>
  )
}

export function useProjectList() {
  const [list, setList] = useState<ProjectSummary[] | null>(null)
  const refresh = useCallback(() => { api().projects.list().then(setList).catch((e) => { toast.error(errMsg(e)); setList([]) }) }, [])
  useEffect(refresh, [refresh])
  return { list, refresh }
}

export function ProjectCard({ p, onChanged }: { p: ProjectSummary; onChanged: () => void }) {
  const current = useEditor((s) => s.project.id)
  const open = async () => { if (current !== p.id && !(await confirmDiscard())) return; void openProject(p.id) }
  const rename = async () => {
    const n = await askText('Rename project', p.name)
    if (!n) return
    try { await api().projects.rename(p.id, n); if (current === p.id) useEditor.getState().live((pr) => ({ ...pr, name: n })); onChanged() } catch (e) { toast.error(errMsg(e)) }
  }
  const dup = async () => { try { await api().projects.duplicate(p.id); toast.success('Project duplicated'); onChanged() } catch (e) { toast.error(errMsg(e)) } }
  const del = async () => {
    if (!(await askConfirm(`Delete "${p.name}"? This removes the project file (your original media is not touched). This cannot be undone.`, 'Delete'))) return
    try { await api().projects.delete(p.id); if (current === p.id) useEditor.getState().newProject(); onChanged() } catch (e) { toast.error(errMsg(e)) }
  }
  return (
    <div className="group overflow-hidden rounded-xl border border-border bg-panel transition-colors hover:border-primary/60">
      <button onClick={() => void open()} className="relative grid aspect-video w-full place-items-center bg-black/50">
        {p.thumbnail ? <img src={mediaUrl(p.thumbnail) + `?v=${encodeURIComponent(p.updatedAt)}`} className="h-full w-full object-cover" /> : <Film className="text-muted-foreground" size={30} />}
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/70 px-1.5 text-[11px]">{formatDuration(p.duration)}</span>
      </button>
      <div className="flex items-center gap-1 p-3">
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{p.name}</div><div className="text-[11px] text-muted-foreground">{new Date(p.updatedAt).toLocaleString()} · {p.clipCount} clips</div></div>
        <IconBtn title="Rename" onClick={() => void rename()}><Pencil size={14} /></IconBtn>
        <IconBtn title="Duplicate" onClick={() => void dup()}><Copy size={14} /></IconBtn>
        <IconBtn title="Delete" onClick={() => void del()} danger><Trash2 size={14} /></IconBtn>
      </div>
    </div>
  )
}

const IconBtn = ({ children, title, onClick, danger }: { children: React.ReactNode; title: string; onClick: () => void; danger?: boolean }) =>
  <button title={title} onClick={onClick} className={`grid h-7 w-7 place-items-center rounded hover:bg-muted ${danger ? 'text-danger' : 'text-muted-foreground hover:text-foreground'}`}>{children}</button>

export function ProjectsPage() {
  const { list, refresh } = useProjectList()
  const [creating, setCreating] = useState(false)
  const [cloud, setCloud] = useState<CloudProject[] | null>(null)
  const [cloudErr, setCloudErr] = useState('')
  const setPage = useUiStore((s) => s.setPage)

  const loadCloud = useCallback(() => {
    if (!cloudAvailable()) return
    listCloudProjects().then(setCloud).catch((e) => setCloudErr(errMsg(e)))
  }, [])
  useEffect(loadCloud, [loadCloud])

  const download = async (c: CloudProject) => {
    try {
      const p = await fetchCloudProject(c.id)
      await api().projects.save({ ...p, id: p.id })
      toast.success(`"${p.name}" downloaded. Relink its media when you open it.`)
      refresh()
    } catch (e) { toast.error(errMsg(e)) }
  }

  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My Projects</h1>
        <div className="flex gap-2">
          <button onClick={() => setPage('templates')} className="h-9 rounded-md border border-border px-4 text-sm hover:bg-muted">Templates</button>
          <button onClick={() => setCreating(true)} className="flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"><Plus size={15} />New project</button>
        </div>
      </div>
      {list === null ? <Loader2 className="animate-spin" /> : list.length === 0 ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-border py-20 text-center text-muted-foreground"><FolderOpen size={32} className="mb-2" />No projects yet. Create your first one.</div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">{list.map((p) => <ProjectCard key={p.id} p={p} onChanged={refresh} />)}</div>
      )}
      {cloudAvailable() && (
        <section className="mt-10">
          <h2 className="mb-3 flex items-center gap-2 text-lg font-semibold"><Cloud size={18} />Cloud projects</h2>
          {cloudErr && <p className="text-sm text-muted-foreground">Cloud server unreachable: {cloudErr}</p>}
          <div className="space-y-2">
            {cloud?.map((c) => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg border border-border bg-panel px-4 py-2 text-sm">
                <span className="flex-1 truncate">{c.name}</span><span className="text-xs text-muted-foreground">{new Date(c.updatedAt).toLocaleString()}</span>
                <IconBtn title="Download to this device" onClick={() => void download(c)}><CloudDownload size={15} /></IconBtn>
                <IconBtn title="Delete from cloud" danger onClick={async () => { if (await askConfirm(`Delete "${c.name}" from the cloud?`, 'Delete')) { await deleteCloudProject(c.id).catch((e) => toast.error(errMsg(e))); loadCloud() } }}><Trash2 size={15} /></IconBtn>
              </div>
            ))}
            {cloud?.length === 0 && <p className="text-sm text-muted-foreground">Nothing synced yet. Enable cloud sync in Settings, then save a project.</p>}
          </div>
        </section>
      )}
      {creating && <NewProjectDialog onClose={() => { setCreating(false); refresh() }} />}
    </div>
  )
}
