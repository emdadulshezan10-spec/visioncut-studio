import { Clapperboard, FolderKanban, Home, Images, LayoutTemplate, PanelLeftClose, PanelLeftOpen, Scissors, Settings, UserCircle } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useUiStore, type PageId } from '@/store/uiStore'
import { useAuth } from '@/store/authStore'

const items: { id: PageId; label: string; icon: typeof Home }[] = [
  { id: 'home', label: 'Home', icon: Home },
  { id: 'projects', label: 'My Projects', icon: FolderKanban },
  { id: 'media', label: 'Media', icon: Images },
  { id: 'editor', label: 'Editor', icon: Scissors },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const { page, setPage, sidebarCollapsed, toggleSidebar } = useUiStore()
  const profile = useAuth((s) => s.profile)
  const Item = ({ id, label, icon: Icon }: { id: PageId; label: string; icon: typeof Home }) => (
    <button onClick={() => setPage(id)} title={label}
      className={cn('flex w-full items-center gap-3 rounded-md px-3 h-10 text-sm transition-colors', page === id ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground')}>
      <Icon size={18} className="shrink-0" />{!sidebarCollapsed && label}
    </button>
  )
  return (
    <aside className={cn('flex shrink-0 flex-col border-r border-border bg-panel transition-all duration-200', sidebarCollapsed ? 'w-16' : 'w-56')}>
      <div className="flex h-14 items-center gap-2 px-4"><Clapperboard className="shrink-0 text-primary" size={22} />{!sidebarCollapsed && <span className="font-semibold tracking-tight">VisionCut</span>}</div>
      <nav className="flex-1 space-y-1 px-2">{items.map((i) => <Item key={i.id} {...i} />)}</nav>
      <div className="space-y-1 p-2">
        <button onClick={() => setPage('profile')} title="User profile" className={cn('flex w-full items-center gap-3 rounded-md px-2 h-11 text-sm hover:bg-muted', page === 'profile' && 'bg-primary/15')}>
          {profile?.avatarUrl ? <img src={profile.avatarUrl} className="h-7 w-7 shrink-0 rounded-full object-cover" /> : <UserCircle size={24} className="shrink-0 text-muted-foreground" />}
          {!sidebarCollapsed && <span className="min-w-0 text-left"><span className="block truncate text-xs font-medium">{profile?.fullName}</span><span className="block text-[10px] uppercase text-muted-foreground">{profile?.plan} plan</span></span>}
        </button>
        <button onClick={toggleSidebar} aria-label="Collapse sidebar" className="grid h-9 w-full place-items-center rounded-md text-muted-foreground hover:bg-muted">
          {sidebarCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>
    </aside>
  )
}
