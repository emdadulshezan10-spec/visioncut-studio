import { confirmDiscard, createNewProject } from '@/services/projects'
import { addTextClip, updateClip } from '@/editor/timeline/ops'
import type { Project, ProjectSettings } from '@/types/project'

interface Template { name: string; description: string; settings: Partial<ProjectSettings>; swatch: string; setup?: (p: Project) => Project }

const withText = (content: string, preset: 'title' | 'lower-third' | 'subtitle', duration = 4) => (p: Project): Project => {
  const r = addTextClip(p, 0, preset, content)
  return updateClip(r.project, r.clipId, { duration })
}

/** Templates are real starting projects: canvas size, frame rate and starter text layers already in place. */
const TEMPLATES: Template[] = [
  { name: 'YouTube video', description: '16:9 · 30 fps · title card', settings: { width: 1920, height: 1080, fps: 30, aspectLabel: '16:9 Landscape' }, swatch: 'linear-gradient(135deg,#dc2626,#7f1d1d)', setup: withText('Your video title', 'title') },
  { name: 'TikTok / Reels / Shorts', description: '9:16 · 30 fps · caption', settings: { width: 1080, height: 1920, fps: 30, aspectLabel: '9:16 Vertical' }, swatch: 'linear-gradient(135deg,#06b6d4,#db2777)', setup: withText('Hook goes here', 'title', 3) },
  { name: 'Instagram square', description: '1:1 · 30 fps', settings: { width: 1080, height: 1080, fps: 30, aspectLabel: '1:1 Square' }, swatch: 'linear-gradient(135deg,#f59e0b,#be185d)' },
  { name: 'Instagram portrait', description: '4:5 · 30 fps', settings: { width: 1080, height: 1350, fps: 30, aspectLabel: '4:5 Portrait' }, swatch: 'linear-gradient(135deg,#8b5cf6,#2563eb)' },
  { name: 'Cinematic', description: '21:9 · 24 fps · lower third', settings: { width: 2560, height: 1080, fps: 24, aspectLabel: '21:9 Cinema' }, swatch: 'linear-gradient(135deg,#0f172a,#78350f)', setup: withText('Name Surname\nDirector', 'lower-third', 5) },
  { name: 'Interview / vlog', description: '16:9 · 30 fps · lower third', settings: { width: 1920, height: 1080, fps: 30, aspectLabel: '16:9 Landscape' }, swatch: 'linear-gradient(135deg,#0d9488,#164e63)', setup: withText('Guest Name\nTitle / Company', 'lower-third', 5) },
  { name: 'Slideshow 4:3', description: '4:3 · 30 fps', settings: { width: 1440, height: 1080, fps: 30, aspectLabel: '4:3 Classic' }, swatch: 'linear-gradient(135deg,#65a30d,#365314)' },
  { name: 'High-frame-rate gameplay', description: '16:9 · 60 fps', settings: { width: 1920, height: 1080, fps: 60, aspectLabel: '16:9 Landscape' }, swatch: 'linear-gradient(135deg,#7c3aed,#0f172a)' },
]

export function TemplatesPage() {
  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-1 text-2xl font-semibold">Templates</h1>
      <p className="mb-6 text-sm text-muted-foreground">Start from a ready-made canvas. Everything stays editable.</p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-4">
        {TEMPLATES.map((t) => (
          <button key={t.name} onClick={async () => { if (await confirmDiscard()) void createNewProject(t.name, t.settings, t.setup) }} className="overflow-hidden rounded-xl border border-border bg-panel text-left transition-colors hover:border-primary/60">
            <div className="h-28" style={{ background: t.swatch }} />
            <div className="p-3"><div className="text-sm font-medium">{t.name}</div><div className="text-xs text-muted-foreground">{t.description}</div></div>
          </button>
        ))}
      </div>
    </div>
  )
}
