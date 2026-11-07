import { useRef, useState } from 'react'
import { HistoryDialog } from '@/editor/HistoryDialog'
import { Download, History, Loader2, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Save } from 'lucide-react'
import { useEditor } from '@/store/editorStore'
import { useUiStore } from '@/store/uiStore'
import { saveCurrentProject } from '@/services/projects'
import { useAutosave, useShortcuts } from '@/hooks/useEditorRuntime'
import { usePlaybackClock } from '@/hooks/usePlayback'
import { ResizeHandle } from '@/components/ResizeHandle'
import { MediaPanel } from '@/editor/media/MediaPanel'
import { EffectsPanel } from '@/editor/effects/EffectsPanel'
import { Preview } from '@/editor/preview/Preview'
import { Timeline } from '@/editor/timeline/Timeline'
import { PropertiesPanel } from '@/editor/properties/PropertiesPanel'
import { ExportDialog } from '@/editor/ExportDialog'
import { cn } from '@/utils/cn'

export function EditorPage() {
  usePlaybackClock()
  useShortcuts(true)
  useAutosave(true)
  const ui = useUiStore()
  const { project, dirty } = useEditor()
  const [leftTab, setLeftTab] = useState<'media' | 'effects'>('media')
  const [exporting, setExporting] = useState(false)
  const [history, setHistory] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const drag = useRef({ leftW: 0, rightW: 0, timelineH: 0 })
  const start = () => { drag.current = { leftW: ui.leftW, rightW: ui.rightW, timelineH: ui.timelineH } }

  const rename = (name: string) => {
    const n = name.trim()
    if (n && n !== project.name) useEditor.getState().commit((p) => ({ ...p, name: n.slice(0, 120) }))
    setEditingName(false)
  }
  const save = async () => { setSaving(true); await saveCurrentProject(); setSaving(false) }

  return (
    <div className="flex h-full flex-col gap-1.5 p-1.5">
      <header className="flex h-10 shrink-0 items-center gap-2 px-2">
        <button onClick={() => ui.setLayout({ leftOpen: !ui.leftOpen })} title="Toggle media panel" className="text-muted-foreground hover:text-foreground">{ui.leftOpen ? <PanelLeftClose size={17} /> : <PanelLeftOpen size={17} />}</button>
        {editingName ? (
          <input autoFocus defaultValue={project.name} onBlur={(e) => rename(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') rename(e.currentTarget.value); if (e.key === 'Escape') setEditingName(false) }} className="h-7 w-64 rounded border border-primary bg-muted px-2 text-sm outline-none" />
        ) : (
          <button onClick={() => setEditingName(true)} title="Rename project" className="max-w-md truncate text-sm font-semibold hover:text-primary">{project.name}</button>
        )}
        <span className={cn('text-[11px]', dirty ? 'text-amber-400' : 'text-muted-foreground')}>{dirty ? '● Unsaved (autosaving)' : 'Saved'}</span>
        <span className="text-[11px] text-muted-foreground">{project.settings.width}×{project.settings.height} · {project.settings.fps} fps</span>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => setHistory(true)} title="Version history" className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted"><History size={14} />History</button>
          <button onClick={() => void save()} title="Save (Ctrl+S)" className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-sm hover:bg-muted">{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}Save</button>
          <button onClick={() => setExporting(true)} className="flex h-8 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"><Download size={14} />Export</button>
          <button onClick={() => ui.setLayout({ rightOpen: !ui.rightOpen })} title="Toggle properties panel" className="text-muted-foreground hover:text-foreground">{ui.rightOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          {ui.leftOpen && (<>
            <aside className="flex shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-panel" style={{ width: ui.leftW }}>
              <div className="flex shrink-0 border-b border-border">
                {(['media', 'effects'] as const).map((t) => (
                  <button key={t} onClick={() => setLeftTab(t)} className={cn('flex-1 py-2 text-xs font-medium capitalize', leftTab === t ? 'border-b-2 border-primary text-foreground' : 'text-muted-foreground hover:text-foreground')}>{t === 'effects' ? 'Effects & Text' : 'Media'}</button>
                ))}
              </div>
              <div className="min-h-0 flex-1">{leftTab === 'media' ? <MediaPanel /> : <EffectsPanel />}</div>
            </aside>
            <ResizeHandle direction="horizontal" onStart={start} onDrag={(d) => ui.setLayout({ leftW: Math.min(560, Math.max(220, drag.current.leftW + d)) })} />
          </>)}
          <main className="min-w-[320px] flex-1"><Preview /></main>
          {ui.rightOpen && (<>
            <ResizeHandle direction="horizontal" onStart={start} onDrag={(d) => ui.setLayout({ rightW: Math.min(560, Math.max(240, drag.current.rightW - d)) })} />
            <aside className="shrink-0 overflow-hidden rounded-lg border border-border bg-panel" style={{ width: ui.rightW }}><PropertiesPanel /></aside>
          </>)}
        </div>
        <ResizeHandle direction="vertical" onStart={start} onDrag={(d) => ui.setLayout({ timelineH: Math.min(window.innerHeight - 240, Math.max(180, drag.current.timelineH - d)) })} />
        <section className="shrink-0" style={{ height: ui.timelineH }}><Timeline /></section>
      </div>
      {exporting && <ExportDialog onClose={() => setExporting(false)} />}
      {history && <HistoryDialog onClose={() => setHistory(false)} />}
    </div>
  )
}
