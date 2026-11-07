import { MediaPanel } from '@/editor/media/MediaPanel'
import { useEditor } from '@/store/editorStore'
import { useUiStore } from '@/store/uiStore'

/** Full-page view of the open project's media library. */
export function MediaPage() {
  const name = useEditor((s) => s.project.name)
  const count = useEditor((s) => s.project.media.length)
  const setPage = useUiStore((s) => s.setPage)
  return (
    <div className="flex h-full flex-col p-8">
      <div className="mb-4 flex items-end justify-between">
        <div><h1 className="text-2xl font-semibold">Media</h1><p className="text-sm text-muted-foreground">Library of “{name}” · {count} item{count === 1 ? '' : 's'}. Originals stay where they are on your disk.</p></div>
        <button onClick={() => setPage('editor')} className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground">Open editor</button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-panel"><MediaPanel /></div>
    </div>
  )
}
