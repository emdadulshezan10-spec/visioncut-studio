import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Sidebar } from '@/components/Sidebar'
import { Toaster } from '@/components/Toaster'
import { PromptDialog } from '@/components/PromptDialog'
import { useAuth } from '@/store/authStore'
import { useUiStore } from '@/store/uiStore'
import { toast } from '@/store/toastStore'
import { errMsg } from '@/services/api'
import { AuthPage } from '@/pages/AuthPage'
import { EditorPage } from '@/pages/EditorPage'
import { HomePage } from '@/pages/HomePage'
import { MediaPage } from '@/pages/MediaPage'
import { ProfilePage } from '@/pages/ProfilePage'
import { ProjectsPage } from '@/pages/ProjectsPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { TemplatesPage } from '@/pages/TemplatesPage'

class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(e: Error, info: ErrorInfo) { console.error(e, info.componentStack) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="grid h-full place-items-center p-8 text-center">
        <div className="max-w-md space-y-3"><h1 className="text-xl font-semibold">Something went wrong</h1><p className="text-sm text-muted-foreground select-text">{this.state.error.message}</p>
          <p className="text-xs text-muted-foreground">Your work is autosaved. Reload to continue.</p>
          <button onClick={() => location.reload()} className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground">Reload</button></div>
      </div>
    )
  }
}

export default function App() {
  const { status, init, completeOAuth } = useAuth()
  const page = useUiStore((s) => s.page)

  useEffect(() => { void init() }, [init])
  useEffect(() => {
    const off = window.visioncut?.auth?.onCallback((url) => { completeOAuth(url).catch((e) => toast.error(errMsg(e))) })
    return () => off?.()
  }, [completeOAuth])

  if (status === 'loading') return <div className="grid h-full place-items-center"><Loader2 className="animate-spin text-primary" /></div>
  // Protected routes: nothing but the auth screen renders until a session exists.
  if (status === 'signedOut') return <><AuthPage /><Toaster /></>

  return (
    <Boundary>
      <div className="flex h-full">
        <Sidebar />
        <main className="min-w-0 flex-1 overflow-hidden">
          {page === 'home' && <HomePage />}
          {page === 'projects' && <ProjectsPage />}
          {page === 'media' && <MediaPage />}
          {page === 'editor' && <EditorPage />}
          {page === 'templates' && <TemplatesPage />}
          {page === 'settings' && <SettingsPage />}
          {page === 'profile' && <ProfilePage />}
        </main>
      </div>
      <Toaster />
      <PromptDialog />
    </Boundary>
  )
}
