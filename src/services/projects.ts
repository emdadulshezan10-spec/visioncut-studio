import { api, errMsg, mediaUrl } from './api'
import { useEditor } from '@/store/editorStore'
import { useUiStore } from '@/store/uiStore'
import { toast } from '@/store/toastStore'
import { createProject, type Project, type ProjectSettings } from '@/types/project'
import { syncProject } from './sync'
import { askConfirm } from '@/components/PromptDialog'

/** JPEG data URL of the project's first thumbnail-bearing media, used as the project card image. */
async function makeThumbnail(p: Project): Promise<string | null> {
  const src = p.clips.map((c) => p.media.find((m) => m.id === c.mediaId)?.thumbnail).find(Boolean) ?? p.media.find((m) => m.thumbnail)?.thumbnail
  if (!src) return null
  try {
    const img = new Image()
    img.src = mediaUrl(src)
    await img.decode()
    const c = document.createElement('canvas')
    c.width = 320
    c.height = Math.round((320 * p.settings.height) / p.settings.width)
    const ctx = c.getContext('2d')!
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, c.width, c.height)
    const k = Math.min(c.width / img.width, c.height / img.height)
    ctx.drawImage(img, (c.width - img.width * k) / 2, (c.height - img.height * k) / 2, img.width * k, img.height * k)
    return c.toDataURL('image/jpeg', 0.8)
  } catch { return null }
}

export async function saveCurrentProject(opts: { silent?: boolean } = {}): Promise<boolean> {
  const { project } = useEditor.getState()
  try {
    await api().projects.save(project)
    const thumb = await makeThumbnail(project)
    if (thumb) await api().projects.saveThumbnail(project.id, thumb)
    useEditor.getState().markSaved()
    if (!opts.silent) toast.success('Project saved')
    void syncProject(project) // cloud sync is a no-op unless the user is signed in and has enabled it
    return true
  } catch (e) {
    toast.error(`Save failed: ${errMsg(e)}`)
    return false
  }
}

/** Ask before discarding unsaved changes. */
export async function confirmDiscard(): Promise<boolean> {
  const { dirty } = useEditor.getState()
  return !dirty || askConfirm('You have unsaved changes in the open project. They are autosaved for recovery, but continue without saving?', 'Discard & continue')
}

export async function openProject(id: string): Promise<void> {
  try {
    const { project, recovered } = await api().projects.load(id)
    let chosen = project
    if (recovered && (await askConfirm(`A newer autosave of "${project.name}" was found (the app may have closed unexpectedly). Restore it?`, 'Restore'))) chosen = recovered
    // Flag media whose files were moved or deleted so the UI can offer Relink instead of failing silently later.
    const missing = new Set(await api().media.missing(chosen.media.map((m) => m.path)))
    if (missing.size) {
      chosen = { ...chosen, media: chosen.media.map((m) => (missing.has(m.path) ? { ...m, error: 'File not found at its original location.' } : { ...m, error: undefined })) }
      toast.error(`${missing.size} media file(s) could not be found. Select them in the Media panel and choose Relink.`)
    }
    useEditor.getState().loadProject(chosen)
    useUiStore.getState().setPage('editor')
  } catch (e) {
    toast.error(`Could not open project: ${errMsg(e)}`)
  }
}

export async function createNewProject(name: string, settings?: Partial<ProjectSettings>, setup?: (p: Project) => Project): Promise<void> {
  let p = createProject(name.trim() || 'Untitled Project', settings)
  if (setup) p = setup(p)
  try {
    await api().projects.save(p)
    useEditor.getState().loadProject(p)
    useUiStore.getState().setPage('editor')
  } catch (e) {
    toast.error(`Could not create project: ${errMsg(e)}`)
  }
}
