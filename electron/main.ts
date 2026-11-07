import { app, BrowserWindow, session, shell } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { handleMediaScheme, registerMediaScheme } from './protocol'
import { shutdownExports } from './ipc/export'

const isDev = process.env.VISIONCUT_DEV === '1'
let mainWindow: BrowserWindow | null = null
registerMediaScheme() // must run before app is ready

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 680,
    backgroundColor: '#0b0b0f',
    title: 'VisionCut Studio',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true, // renderer cannot touch Node/Electron directly
      nodeIntegration: false,
      sandbox: true,
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.setMenuBarVisibility(false)

  // Never let the app window navigate away or open arbitrary windows; external links go to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (e, url) => {
    if (!(isDev && url.startsWith('http://localhost:5173'))) e.preventDefault()
  })

  if (isDev) void mainWindow.loadURL('http://localhost:5173')
  else void mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))

  mainWindow.on('closed', () => { mainWindow = null })
}

// Single instance: a second launch focuses the existing window.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  // Deep link for OAuth: visioncut://auth-callback?code=...
  const deepLink = (argv: string[]) => argv.find((a) => a.startsWith('visioncut://'))
  const forward = (url?: string) => { if (url && mainWindow) mainWindow.webContents.send('auth:callback', url) }
  if (process.defaultApp && process.argv[1]) app.setAsDefaultProtocolClient('visioncut', process.execPath, [path.resolve(process.argv[1])])
  else app.setAsDefaultProtocolClient('visioncut')
  app.on('second-instance', (_e, argv) => {
    forward(deepLink(argv))
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })
  app.whenReady().then(() => {
    // Only the microphone (voiceover recording) may be requested by the renderer.
    session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'media'))
    handleMediaScheme()
    registerIpc(() => mainWindow)
    createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })
  app.on('before-quit', shutdownExports)
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}


