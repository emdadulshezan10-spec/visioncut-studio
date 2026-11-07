import { useEffect, useState } from 'react'
import { History, X } from 'lucide-react'
import { api, errMsg } from '@/services/api'
import { toast } from '@/store/toastStore'
import { askConfirm } from '@/components/PromptDialog'
import { useEditor } from '@/store/editorStore'

/** Saved-version history: each explicit Save snapshots the previous file (last 15). Restoring is undoable. */
export function HistoryDialog({ onClose }: { onClose: () => void }) {
  const id = useEditor((s) => s.project.id)
  const [items, setItems] = useState<{ file: string; savedAt: number }[] | null>(null)

  useEffect(() => { api().projects.history(id).then(setItems).catch((e) => { toast.error(errMsg(e)); setItems([]) }) }, [id])

  const restore = async (file: string) => {
    if (!(await askConfirm('Replace the current timeline with this saved version? You can undo this with Ctrl+Z.', 'Restore'))) return
    try {
      const old = await api().projects.restoreHistory(id, file)
      // Keep current media list entries that still exist so missing-file flags and thumbnails survive.
      useEditor.getState().commit((cur) => ({ ...old, id: cur.id, name: cur.name, media: old.media.length ? old.media : cur.media }))
      useEditor.getState().select([])
      toast.success('Version restored')
      onClose()
    } catch (e) { toast.error(errMsg(e)) }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-[420px] rounded-xl border border-border bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-3"><h2 className="flex items-center gap-2 font-semibold"><History size={16} />Version history</h2><button onClick={onClose}><X size={18} /></button></div>
        <div className="max-h-80 space-y-1 overflow-y-auto p-3">
          {items === null ? <p className="p-3 text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? <p className="p-3 text-sm text-muted-foreground">No earlier versions yet. A version is kept every time you save.</p> : items.map((v) => (
            <div key={v.file} className="flex items-center justify-between rounded-md px-3 py-2 text-sm hover:bg-muted">
              <span>{new Date(v.savedAt).toLocaleString()}</span>
              <button onClick={() => void restore(v.file)} className="rounded bg-primary/20 px-2 py-1 text-xs text-primary hover:bg-primary hover:text-primary-foreground">Restore</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
