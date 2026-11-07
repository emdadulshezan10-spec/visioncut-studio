import { useMemo, useState } from 'react'
import { AudioLines, Film, Folder, FolderPlus, Image as ImageIcon, Loader2, Plus, Search, Trash2, Upload, Zap } from 'lucide-react'
import { api, errMsg, mediaUrl } from '@/services/api'
import { toast } from '@/store/toastStore'
import { askConfirm, askText } from '@/components/PromptDialog'
import { useEditor } from '@/store/editorStore'
import { newId, type MediaItem, type MediaKind } from '@/types/project'
import { formatBytes, formatDuration } from '@/utils/anim'
import { cn } from '@/utils/cn'
import { addMediaToTimeline, importPaths, importViaDialog } from '../actions'

type Filter = 'all' | MediaKind
const ICON = { video: Film, audio: AudioLines, image: ImageIcon }

export function MediaPanel() {
  const project = useEditor((s) => s.project)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [folder, setFolder] = useState<string | null | 'all'>('all')
  const [active, setActive] = useState<string | null>(null)
  const [busy, setBusy] = useState<Set<string>>(new Set())
  const [dragOver, setDragOver] = useState(false)

  const items = useMemo(() => project.media.filter((m) =>
    (filter === 'all' || m.kind === filter) &&
    (folder === 'all' || m.folderId === folder) &&
    m.name.toLowerCase().includes(q.toLowerCase())), [project.media, q, filter, folder])
  const current = project.media.find((m) => m.id === active)

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false)
    if (!e.dataTransfer.files.length) return
    const paths = [...e.dataTransfer.files].map((f) => api().media.pathForFile(f)).filter(Boolean)
    await importPaths(paths, folder === 'all' ? null : folder)
  }

  const addFolder = async () => {
    const name = await askText('New folder name')
    if (name) useEditor.getState().commit((p) => ({ ...p, folders: [...p.folders, { id: newId('fld'), name: name.slice(0, 60) }] }))
  }
  const moveTo = (m: MediaItem, folderId: string | null) => useEditor.getState().commit((p) => ({ ...p, media: p.media.map((x) => (x.id === m.id ? { ...x, folderId } : x)) }))
  const remove = async (m: MediaItem) => {
    const used = project.clips.some((c) => c.mediaId === m.id)
    if (used && !(await askConfirm(`"${m.name}" is used on the timeline. Remove it and its clips?`, 'Remove'))) return
    useEditor.getState().commit((p) => ({ ...p, media: p.media.filter((x) => x.id !== m.id), clips: p.clips.filter((c) => c.mediaId !== m.id) }))
    if (active === m.id) setActive(null)
  }
  /** Point an item at a new file (moved/renamed original). Clips keep working because the media id is unchanged. */
  const relink = async (m: MediaItem) => {
    try {
      const picked = (await api().media.pick())[0]
      if (!picked) return
      const res = await api().media.import([picked])
      const fresh = res.items[0]
      if (!fresh) return toast.error(res.errors[0]?.error ?? 'Could not read that file.')
      if (fresh.kind !== m.kind) return toast.error(`Pick a ${m.kind} file.`)
      useEditor.getState().commit((p) => ({ ...p, media: p.media.map((x) => (x.id === m.id ? { ...fresh, id: m.id, folderId: m.folderId, name: fresh.name } : x)) }))
      toast.success('Media relinked')
    } catch (e) { toast.error(errMsg(e)) }
  }
  const makeProxy = async (m: MediaItem) => {
    setBusy((b) => new Set(b).add(m.id))
    try {
      const proxyPath = await api().media.makeProxy(m.path)
      useEditor.getState().live((p) => ({ ...p, media: p.media.map((x) => (x.id === m.id ? { ...x, proxyPath } : x)) }))
      toast.success(`Proxy ready for ${m.name}`)
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy((b) => { const n = new Set(b); n.delete(m.id); return n }) }
  }

  return (
    <div className={cn('flex h-full flex-col', dragOver && 'ring-2 ring-primary ring-inset')} onDragOver={(e) => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)} onDrop={(e) => void onDrop(e)}>
      <div className="flex gap-2 p-2">
        <button onClick={() => void importViaDialog(folder === 'all' ? null : folder)} className="flex h-8 flex-1 items-center justify-center gap-2 rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"><Upload size={14} />Import</button>
        <button onClick={() => void addFolder()} title="New folder" className="grid h-8 w-8 place-items-center rounded-md border border-border hover:bg-muted"><FolderPlus size={15} /></button>
      </div>
      <div className="px-2">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-2.5 text-muted-foreground" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search media" className="h-8 w-full rounded-md border border-border bg-muted pl-7 pr-2 text-sm outline-none focus:border-primary" />
        </div>
        <div className="mt-2 flex gap-1">
          {(['all', 'video', 'audio', 'image'] as Filter[]).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={cn('flex-1 rounded px-1 py-1 text-[11px] capitalize', filter === f ? 'bg-primary/20 text-primary' : 'bg-muted text-muted-foreground hover:text-foreground')}>{f}</button>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-1">
          {[{ id: 'all' as const, name: 'All' }, { id: null, name: 'Unsorted' }, ...project.folders].map((f) => (
            <button key={String(f.id)} onClick={() => setFolder(f.id)} className={cn('flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]', folder === f.id ? 'bg-accent/20 text-accent' : 'text-muted-foreground hover:text-foreground')}>
              <Folder size={11} />{f.name}
            </button>
          ))}
        </div>
      </div>

      {current && <MediaPreview media={current} onAdd={() => addMediaToTimeline(current)} />}

      <div className="mt-2 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {items.length === 0 ? (
          <div className="grid h-full place-items-center text-center text-xs text-muted-foreground">
            <div><Upload className="mx-auto mb-2" size={22} />{project.media.length ? 'No media matches.' : 'Drop video, audio or images here, or click Import.'}</div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {items.map((m) => {
              const Icon = ICON[m.kind]
              return (
                <div key={m.id} draggable onDragStart={(e) => e.dataTransfer.setData('application/x-vc-media', m.id)} onClick={() => setActive(m.id)} onDoubleClick={() => addMediaToTimeline(m)}
                  className={cn('group relative overflow-hidden rounded-md border bg-muted', active === m.id ? 'border-primary' : 'border-border hover:border-muted-foreground')}>
                  <div className="relative grid aspect-video place-items-center bg-black/40">
                    {m.thumbnail ? <img src={mediaUrl(m.thumbnail)} className="h-full w-full object-cover" draggable={false} /> : <Icon size={22} className="text-muted-foreground" />}
                    {m.duration > 0 && <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10px]">{formatDuration(m.duration)}</span>}
                    {m.error && <span className="absolute inset-0 grid place-items-center bg-danger/40 text-[10px] font-bold">MISSING</span>}
                    {m.proxyPath && <span className="absolute left-1 top-1 rounded bg-accent/80 px-1 text-[9px] font-bold text-accent-foreground">PROXY</span>}
                    <button onClick={(e) => { e.stopPropagation(); addMediaToTimeline(m) }} title="Add to timeline" className="absolute right-1 top-1 hidden h-6 w-6 place-items-center rounded bg-primary text-primary-foreground group-hover:grid"><Plus size={14} /></button>
                  </div>
                  <div className="truncate px-1.5 py-1 text-[11px]" title={m.path}>{m.name}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {current && (
        <div className="space-y-1 border-t border-border p-2 text-[11px] text-muted-foreground">
          {current.error && (
            <div className="flex items-center justify-between gap-2 rounded bg-danger/15 p-1.5 text-danger">
              <span>{current.error}</span>
              <button onClick={() => void relink(current)} className="shrink-0 rounded bg-danger px-2 py-0.5 font-medium text-white">Relink</button>
            </div>
          )}
          <div className="flex justify-between"><span>{current.width && current.height ? `${current.width}×${current.height}` : current.kind}{current.fps ? ` · ${current.fps.toFixed(2)} fps` : ''}</span><span>{formatBytes(current.size)}</span></div>
          <div className="flex items-center gap-1">
            <select value={current.folderId ?? ''} onChange={(e) => moveTo(current, e.target.value || null)} className="h-7 min-w-0 flex-1 rounded border border-border bg-muted px-1 text-[11px]">
              <option value="">Unsorted</option>
              {project.folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            {current.kind === 'video' && (
              <button disabled={busy.has(current.id)} onClick={() => void makeProxy(current)} title="Create a lightweight 540p proxy for smoother preview of large files" className="flex h-7 items-center gap-1 rounded border border-border px-2 hover:bg-muted disabled:opacity-50">
                {busy.has(current.id) ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />}Proxy
              </button>
            )}
            <button onClick={() => void remove(current)} title="Remove from project (original file is not deleted)" className="grid h-7 w-7 place-items-center rounded border border-border text-danger hover:bg-danger/10"><Trash2 size={13} /></button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Plays the original file so the user can inspect it before editing. */
function MediaPreview({ media, onAdd }: { media: MediaItem; onAdd: () => void }) {
  return (
    <div className="mx-2 mt-2 overflow-hidden rounded-md border border-border bg-black">
      {media.kind === 'video' && <video key={media.id} src={mediaUrl(media.path)} controls className="aspect-video w-full" />}
      {media.kind === 'audio' && <div className="p-3"><audio key={media.id} src={mediaUrl(media.path)} controls className="w-full" /></div>}
      {media.kind === 'image' && <img key={media.id} src={mediaUrl(media.path)} className="aspect-video w-full object-contain" />}
      <button onClick={onAdd} className="w-full bg-muted py-1 text-xs hover:bg-primary hover:text-primary-foreground">Add to timeline at playhead</button>
    </div>
  )
}
