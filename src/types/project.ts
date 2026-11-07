/**
 * Project data model. This file is the single source of truth shared by the renderer
 * (editor, preview), the main process (persistence, export) and the sync server.
 * All times are in SECONDS on the timeline unless noted.
 */

export type TrackKind = 'video' | 'audio' | 'text' | 'image'
export type MediaKind = 'video' | 'audio' | 'image'

export interface Track {
  id: string
  kind: TrackKind
  name: string
  locked: boolean
  visible: boolean
  muted: boolean
}

export interface MediaFolder {
  id: string
  name: string
}

export interface MediaItem {
  id: string
  name: string
  /** Absolute local path. Originals always stay on the user's disk. */
  path: string
  kind: MediaKind
  duration: number // 0 for images
  width?: number
  height?: number
  fps?: number
  hasAudio: boolean
  size: number
  /** Absolute path of a generated JPEG thumbnail (in app cache). */
  thumbnail?: string
  /** Normalized 0..1 waveform peaks for audio-bearing media. */
  waveform?: number[]
  folderId: string | null
  /** Optional low-res proxy used for preview of large files. */
  proxyPath?: string
  /** Set when the file could not be probed or is missing. */
  error?: string
}

export interface Keyframe {
  /** Seconds relative to clip start (timeline time, after speed). */
  time: number
  value: number
}

export type AnimatableProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity'

export interface Transform {
  x: number // % of canvas width offset from center
  y: number // % of canvas height offset from center
  scale: number // 1 = fit
  rotation: number // degrees
  opacity: number // 0..1
  cropLeft: number // % of source
  cropRight: number
  cropTop: number
  cropBottom: number
  flipH: boolean
  flipV: boolean
}

export interface ColorGrade {
  brightness: number // -1..1
  contrast: number // -1..1
  saturation: number // -1..1
  temperature: number // -1..1 (cool..warm)
  tint: number // -1..1 (green..magenta)
  exposure: number // -2..2 stops
  highlights: number // -1..1
  shadows: number // -1..1
  red: number // -1..1 channel gain
  green: number
  blue: number
  /** Absolute path to a .cube LUT file. */
  lutPath?: string
}

export interface Effects {
  blur: number // 0..50 (box blur radius, px)
  gaussianBlur: number // 0..50 (sigma)
  sharpen: number // 0..5
  glow: number // 0..1
  vignette: number // 0..1
  grain: number // 0..100 (film grain strength)
  noise: number // 0..100 (uniform noise strength)
  chromaticAberration: number // 0..20 (px channel shift)
  grayscale: boolean
  invert: boolean
  mirror: boolean
  stabilize: boolean
  ellipseMask: boolean
  chromaKey: { enabled: boolean; color: string; similarity: number; blend: number }
}

/** 'rise' is internal (text slide-up animation) and not offered in the transition picker. */
export type TransitionType = 'none' | 'fade' | 'dissolve' | 'slide' | 'wipe' | 'zoom' | 'blur' | 'rise'

export interface Transition {
  type: TransitionType
  duration: number
}

export type TextAlign = 'left' | 'center' | 'right'
export type TextAnimation = 'none' | 'fade' | 'slide-up' | 'typewriter' | 'pop'

export interface TextProps {
  content: string
  fontFamily: string
  fontSize: number // px at 1080p canvas height
  color: string
  bold: boolean
  italic: boolean
  align: TextAlign
  outlineColor: string
  outlineWidth: number
  shadow: boolean
  background: string // '' = none
  animation: TextAnimation
  /** "lower-third" positions at bottom-left with a bar; "subtitle" bottom-center. */
  preset: 'title' | 'lower-third' | 'subtitle'
}

export interface Clip {
  id: string
  trackId: string
  kind: MediaKind | 'text'
  mediaId?: string
  /** Timeline start (s). */
  start: number
  /** Duration on the timeline (s) — already accounts for speed. */
  duration: number
  /** Source in-point (s) in media time. */
  inPoint: number
  speed: number // 0.1..8
  reverse: boolean
  volume: number // 0..2
  audioFadeIn: number
  audioFadeOut: number
  denoise: boolean // audio noise reduction
  audioOffset: number // sync nudge in seconds (can be negative)
  transform: Transform
  color: ColorGrade
  effects: Effects
  transitionIn: Transition
  transitionOut: Transition
  keyframes: Partial<Record<AnimatableProp, Keyframe[]>>
  text?: TextProps
  label?: string
}

export interface Marker {
  id: string
  time: number
  label: string
  color: string
}

export interface ProjectSettings {
  width: number
  height: number
  fps: number
  aspectLabel: string
  backgroundColor: string
}

export interface Project {
  id: string
  name: string
  version: number // schema version for migrations
  createdAt: string
  updatedAt: string
  settings: ProjectSettings
  tracks: Track[]
  clips: Clip[]
  media: MediaItem[]
  folders: MediaFolder[]
  markers: Marker[]
}

export interface ProjectSummary {
  id: string
  name: string
  updatedAt: string
  createdAt: string
  duration: number
  thumbnail?: string
  clipCount: number
}

export const PROJECT_VERSION = 1

export const ASPECT_PRESETS: { label: string; width: number; height: number }[] = [
  { label: '16:9 Landscape', width: 1920, height: 1080 },
  { label: '9:16 Vertical', width: 1080, height: 1920 },
  { label: '1:1 Square', width: 1080, height: 1080 },
  { label: '4:5 Portrait', width: 1080, height: 1350 },
  { label: '21:9 Cinema', width: 2560, height: 1080 },
  { label: '4:3 Classic', width: 1440, height: 1080 },
]

export const defaultTransform = (): Transform => ({
  x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
  cropLeft: 0, cropRight: 0, cropTop: 0, cropBottom: 0, flipH: false, flipV: false,
})

export const defaultColor = (): ColorGrade => ({
  brightness: 0, contrast: 0, saturation: 0, temperature: 0, tint: 0, exposure: 0,
  highlights: 0, shadows: 0, red: 0, green: 0, blue: 0,
})

export const defaultEffects = (): Effects => ({
  blur: 0, gaussianBlur: 0, sharpen: 0, glow: 0, vignette: 0, grain: 0, noise: 0,
  chromaticAberration: 0, grayscale: false, invert: false, mirror: false, stabilize: false,
  ellipseMask: false,
  chromaKey: { enabled: false, color: '#00ff00', similarity: 0.15, blend: 0.1 },
})

export const defaultText = (): TextProps => ({
  content: 'Your title', fontFamily: 'Arial', fontSize: 96, color: '#ffffff', bold: true, italic: false,
  align: 'center', outlineColor: '#000000', outlineWidth: 0, shadow: true, background: '',
  animation: 'fade', preset: 'title',
})

export const noTransition = (): Transition => ({ type: 'none', duration: 0.5 })

export function newId(prefix = 'id'): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
}

export function createProject(name: string, settings?: Partial<ProjectSettings>): Project {
  const now = new Date().toISOString()
  const mk = (kind: TrackKind, name: string): Track => ({ id: newId('trk'), kind, name, locked: false, visible: true, muted: false })
  return {
    id: newId('prj'), name, version: PROJECT_VERSION, createdAt: now, updatedAt: now,
    settings: { width: 1920, height: 1080, fps: 30, aspectLabel: '16:9 Landscape', backgroundColor: '#000000', ...settings },
    tracks: [mk('text', 'Text 1'), mk('image', 'Image 1'), mk('video', 'Video 2'), mk('video', 'Video 1'), mk('audio', 'Audio 1'), mk('audio', 'Music')],
    clips: [], media: [], folders: [], markers: [],
  }
}

export function projectDuration(p: Pick<Project, 'clips'>): number {
  return p.clips.reduce((m, c) => Math.max(m, c.start + c.duration), 0)
}

