import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { SubtitleProgress, VisionCutApi } from '../src/types/electron'
import type { ExportProgress } from '../src/types/export'

const inv = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

// The ONLY surface the renderer can use to reach the main process. Keep it small and typed.
const api: VisionCutApi = {
  system: {
    getInfo: () => inv('system:info'),
    checkFfmpeg: () => inv('system:ffmpeg'),
  },
  media: {
    pick: () => inv('media:pick'),
    import: (paths) => inv('media:import', paths),
    missing: (paths) => inv('media:missing', paths),
    freezeFrame: (file, t) => inv('media:freezeFrame', file, t),
    makeProxy: (file) => inv('media:makeProxy', file),
    saveRecording: (data) => inv('media:saveRecording', data),
    pickLut: () => inv('media:pickLut'),
    pickSubtitles: () => inv('media:pickSubtitles'),
    // Sandboxed renderers no longer expose File.path; webUtils is the supported replacement.
    pathForFile: (file) => webUtils.getPathForFile(file),
  },
  projects: {
    list: () => inv('projects:list'),
    load: (id) => inv('projects:load', id),
    save: (p, autosave) => inv('projects:save', p, autosave),
    saveThumbnail: (id, d) => inv('projects:saveThumbnail', id, d),
    rename: (id, name) => inv('projects:rename', id, name),
    delete: (id) => inv('projects:delete', id),
    duplicate: (id) => inv('projects:duplicate', id),
    history: (id) => inv('projects:history', id),
    restoreHistory: (id, f) => inv('projects:restoreHistory', id, f),
  },
  exporter: {
    capabilities: () => inv('export:capabilities'),
    pickFolder: () => inv('export:pickFolder'),
    start: (p, o, t) => inv('export:start', p, o, t),
    cancel: (id) => inv('export:cancel', id),
    history: () => inv('export:history'),
    reveal: (f) => inv('export:reveal', f),
    onProgress: (cb) => {
      const h = (_e: unknown, p: ExportProgress) => cb(p)
      ipcRenderer.on('export:progress', h)
      return () => ipcRenderer.removeListener('export:progress', h)
    },
  },
  tracking: {
    track: (file, inPoint, seconds, srcW, srcH, start) => inv('tracking:track', file, inPoint, seconds, srcW, srcH, start),
  },
  subtitles: {
    status: () => inv('subtitles:status'),
    install: () => inv('subtitles:install'),
    cancel: () => inv('subtitles:cancel'),
    transcribe: (file, inPoint, seconds) => inv('subtitles:transcribe', file, inPoint, seconds),
    onProgress: (cb) => {
      const h = (_e: unknown, p: SubtitleProgress) => cb(p)
      ipcRenderer.on('subtitles:progress', h)
      return () => ipcRenderer.removeListener('subtitles:progress', h)
    },
  },
  prefs: {
    get: () => inv('prefs:get'),
    set: (patch) => inv('prefs:set', patch),
  },
  app: { openExternal: (url) => inv('app:openExternal', url) },
  auth: {
    // OAuth (Google) returns to the app through the visioncut:// deep link; main forwards it here.
    onCallback: (cb) => {
      const h = (_e: unknown, url: string) => cb(url)
      ipcRenderer.on('auth:callback', h)
      return () => ipcRenderer.removeListener('auth:callback', h)
    },
  },
}

contextBridge.exposeInMainWorld('visioncut', api)

