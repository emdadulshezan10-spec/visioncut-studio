// Renderer-side mirror of the preload bridge (electron/preload.ts). Keep both in sync.
import type { ExportOptions, ExportProgress } from './export'
import type { MediaItem, Project, ProjectSummary } from './project'

export interface SystemInfo {
  appVersion: string; electron: string; chrome: string; node: string
  platform: string; arch: string; cpus: number; totalMemGb: number
}
export interface ToolStatus { found: boolean; version?: string; error?: string }
export interface FfmpegStatus { ffmpeg: ToolStatus; ffprobe: ToolStatus; source?: string }
export interface FfCapabilities { version: string; filters: Record<string, boolean>; encoders: Record<string, boolean> }
export interface ImportResult { items: MediaItem[]; errors: { path: string; error: string }[] }
export interface Preferences {
  autosaveSeconds: number; cloudSyncEnabled: boolean; cloudUploadEnabled: boolean; defaultExportDir: string; proxyForLargeFiles: boolean; snapping: boolean
}
export interface ExportHistoryEntry {
  id: string; projectId: string; projectName: string; outputPath: string; format: string; codec: string
  resolution: string; fps: number; sizeBytes: number; durationSec: number; createdAt: string
}
export interface SubtitleCue { start: number; end: number; text: string }

export interface SubtitleStatus { installed: boolean; language: string; downloadMB: number }
export interface SubtitleProgress { stage: 'download-engine' | 'download-model' | 'extract' | 'audio' | 'transcribe' | 'done'; percent: number }

export interface VisionCutApi {
  tracking: {
    track: (file: string, inPoint: number, seconds: number, srcW: number, srcH: number, start: { x: number; y: number }) => Promise<{ samples: { t: number; x: number; y: number }[]; lostAt: number | null }>
  }
  subtitles: {
    status: () => Promise<SubtitleStatus>
    install: () => Promise<void>
    cancel: () => Promise<void>
    transcribe: (file: string, inPoint: number, seconds: number) => Promise<SubtitleCue[]>
    onProgress: (cb: (p: SubtitleProgress) => void) => () => void
  }
  system: {
    getInfo: () => Promise<SystemInfo>
    checkFfmpeg: () => Promise<FfmpegStatus>
  }
  media: {
    pick: () => Promise<string[]>
    import: (paths: string[]) => Promise<ImportResult>
    missing: (paths: string[]) => Promise<string[]>
    freezeFrame: (file: string, sourceTime: number) => Promise<ImportResult>
    makeProxy: (file: string) => Promise<string>
    saveRecording: (data: ArrayBuffer) => Promise<ImportResult>
    pickLut: () => Promise<string | null>
    pickSubtitles: () => Promise<SubtitleCue[] | null>
    pathForFile: (file: File) => string
  }
  projects: {
    list: () => Promise<ProjectSummary[]>
    load: (id: string) => Promise<{ project: Project; recovered: Project | null }>
    save: (p: Project, autosave?: boolean) => Promise<void>
    saveThumbnail: (id: string, dataUrl: string) => Promise<void>
    rename: (id: string, name: string) => Promise<void>
    delete: (id: string) => Promise<void>
    duplicate: (id: string) => Promise<string>
    history: (id: string) => Promise<{ file: string; savedAt: number }[]>
    restoreHistory: (id: string, file: string) => Promise<Project>
  }
  exporter: {
    capabilities: () => Promise<FfCapabilities>
    pickFolder: () => Promise<string | null>
    start: (p: Project, o: ExportOptions, textImages: Record<string, string>) => Promise<string>
    cancel: (jobId: string) => Promise<boolean>
    history: () => Promise<ExportHistoryEntry[]>
    reveal: (file: string) => Promise<void>
    onProgress: (cb: (p: ExportProgress) => void) => () => void
  }
  prefs: {
    get: () => Promise<Preferences>
    set: (patch: Partial<Preferences>) => Promise<Preferences>
  }
  app: { openExternal: (url: string) => Promise<void> }
  auth: { onCallback: (cb: (url: string) => void) => () => void }
}

declare global {
  interface Window { visioncut?: VisionCutApi }
}

