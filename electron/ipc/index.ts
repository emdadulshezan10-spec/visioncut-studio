import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import { registerSystemIpc } from './system'
import { registerMediaIpc } from './media'
import { registerProjectsIpc } from './projects'
import { registerExportIpc } from './export'
import { registerSubtitlesIpc } from './subtitles'
import { registerTrackingIpc } from './tracking'
import { dirs, readJson, writeJsonAtomic } from '../paths'

export interface Preferences {
  autosaveSeconds: number
  cloudSyncEnabled: boolean // push project JSON to the user's account (default OFF)
  cloudUploadEnabled: boolean // user consent for uploading media to Supabase Storage (default OFF)
  defaultExportDir: string
  proxyForLargeFiles: boolean
  snapping: boolean
}

export const DEFAULT_PREFS: Preferences = { autosaveSeconds: 15, cloudSyncEnabled: false, cloudUploadEnabled: false, defaultExportDir: '', proxyForLargeFiles: false, snapping: true }

export function registerIpc(getWindow: () => BrowserWindow | null): void {
  registerSystemIpc(ipcMain)
  registerMediaIpc(ipcMain, getWindow)
  registerProjectsIpc(ipcMain)
  registerExportIpc(ipcMain, getWindow)
  registerSubtitlesIpc(ipcMain, getWindow)
  registerTrackingIpc(ipcMain)

  ipcMain.handle('prefs:get', (): Preferences => ({ ...DEFAULT_PREFS, ...readJson<Partial<Preferences>>(dirs.prefs, {}) }))
  ipcMain.handle('prefs:set', (_e, patch: Partial<Preferences>): Preferences => {
    const next = { ...DEFAULT_PREFS, ...readJson<Partial<Preferences>>(dirs.prefs, {}), ...patch }
    writeJsonAtomic(dirs.prefs, next)
    return next
  })
  ipcMain.handle('app:openExternal', (_e, url: string) => { if (/^https:\/\//.test(url)) return shell.openExternal(url) })
  ipcMain.handle('app:userDataPath', () => app.getPath('userData'))
}

