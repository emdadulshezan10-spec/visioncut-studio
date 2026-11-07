export type ExportFormat = 'mp4' | 'mov' | 'webm' | 'avi'
export type ExportCodec = 'h264' | 'h265' | 'vp9'
export type ExportResolution = '720p' | '1080p' | '1440p' | '4k'

export interface ExportOptions {
  format: ExportFormat
  codec: ExportCodec
  resolution: ExportResolution
  fps: 24 | 30 | 60
  /** kbit/s. When undefined a quality-based (CRF) encode is used. */
  videoBitrateKbps?: number
  audioBitrateKbps: number
  outputDir: string
  fileName: string // without extension
}

/** Which codecs each container can hold (validated in UI and again in main). */
export const FORMAT_CODECS: Record<ExportFormat, ExportCodec[]> = {
  mp4: ['h264', 'h265', 'vp9'],
  mov: ['h264', 'h265'],
  webm: ['vp9'],
  avi: ['h264'],
}

export const RESOLUTION_SHORT_SIDE: Record<ExportResolution, number> = { '720p': 720, '1080p': 1080, '1440p': 1440, '4k': 2160 }

/** Output dimensions: the project's SHORT side maps to the chosen resolution, aspect preserved, even numbers. */
export function outputSize(projectW: number, projectH: number, res: ExportResolution): { width: number; height: number } {
  const short = RESOLUTION_SHORT_SIDE[res]
  const k = short / Math.min(projectW, projectH)
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
  return { width: even(projectW * k), height: even(projectH * k) }
}

export function validateExportOptions(o: ExportOptions): string | null {
  if (!FORMAT_CODECS[o.format].includes(o.codec)) return `${o.codec.toUpperCase()} cannot be stored in a .${o.format} file. Choose: ${FORMAT_CODECS[o.format].join(', ')}.`
  if (!o.outputDir) return 'Choose an output folder.'
  if (!o.fileName.trim() || /[<>:"/\\|?*\x00-\x1f]/.test(o.fileName)) return 'File name contains invalid characters.'
  if (o.videoBitrateKbps !== undefined && (o.videoBitrateKbps < 100 || o.videoBitrateKbps > 200000)) return 'Video bitrate must be between 100 and 200000 kbps.'
  return null
}

/** Rough size estimate in bytes used by the export dialog before rendering. */
export function estimateSizeBytes(o: ExportOptions, durationSec: number, w: number, h: number): number {
  const audio = (o.audioBitrateKbps * 1000 * durationSec) / 8
  if (o.videoBitrateKbps) return Math.round(((o.videoBitrateKbps * 1000 * durationSec) / 8) + audio)
  // Heuristic bits-per-pixel for CRF-based encodes.
  const bpp = o.codec === 'h264' ? 0.075 : 0.045
  const video = w * h * o.fps * bpp * durationSec / 8
  return Math.round(video + audio)
}

export interface ExportProgress {
  jobId: string
  state: 'preparing' | 'rendering' | 'done' | 'error' | 'cancelled'
  percent: number
  etaSec?: number
  speed?: string
  outputPath?: string
  sizeBytes?: number
  error?: string
}
