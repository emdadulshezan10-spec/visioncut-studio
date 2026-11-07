import { useState } from 'react'
import { Clapperboard, LayoutTemplate, Plus } from 'lucide-react'
import { useAuth } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { NewProjectDialog, ProjectCard, useProjectList } from './ProjectsPage'

export function HomePage() {
  const { list, refresh } = useProjectList()
  const [creating, setCreating] = useState(false)
  const name = useAuth((s) => s.profile?.fullName)
  const setPage = useUiStore((s) => s.setPage)
  return (
    <div className="h-full overflow-y-auto p-8">
      <div className="mb-8 flex items-center gap-4 rounded-2xl border border-border bg-gradient-to-br from-primary/25 via-panel to-accent/10 p-8">
        <Clapperboard size={48} className="text-primary" />
        <div className="flex-1">
          <h1 className="text-3xl font-semibold tracking-tight">Welcome{name ? `, ${name.split(' ')[0]}` : ''}</h1>
          <p className="mt-1 text-muted-foreground">Cut, colour, caption and export — all on your machine.</p>
        </div>
        <button onClick={() => setCreating(true)} className="flex h-11 items-center gap-2 rounded-lg bg-primary px-6 font-medium text-primary-foreground hover:bg-primary/90"><Plus size={18} />New project</button>
        <button onClick={() => setPage('templates')} className="flex h-11 items-center gap-2 rounded-lg border border-border px-5 hover:bg-muted"><LayoutTemplate size={17} />Templates</button>
      </div>
      <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">Recent projects</h2><button onClick={() => setPage('projects')} className="text-sm text-accent hover:underline">View all</button></div>
      {list && list.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">{list.slice(0, 6).map((p) => <ProjectCard key={p.id} p={p} onChanged={refresh} />)}</div>
      ) : <p className="text-sm text-muted-foreground">{list ? 'No projects yet — create one to get started.' : 'Loading…'}</p>}
      {creating && <NewProjectDialog onClose={() => { setCreating(false); refresh() }} />}
    </div>
  )
}
