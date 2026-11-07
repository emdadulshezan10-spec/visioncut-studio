import { useEffect } from 'react'
import { api } from '@/services/api'
import { saveCurrentProject } from '@/services/projects'
import { useEditor } from '@/store/editorStore'
import { projectDuration } from '@/types/project'
import {
  addMarker, deleteSelected, duplicateSelected, rippleDeleteSelected, splitAtPlayhead,
} from '@/editor/actions'

/** Keyboard shortcuts for the editor. Ignored while typing in inputs. */
export function useShortcuts(active: boolean): void {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable]') && !(e.ctrlKey && e.key.toLowerCase() === 's')) return
      const s = useEditor.getState()
      const fps = s.project.settings.fps
      const ctrl = e.ctrlKey || e.metaKey
      const k = e.key.toLowerCase()
      const dur = projectDuration(s.project)
      if (ctrl && k === 'z') { e.preventDefault(); e.shiftKey ? s.redo() : s.undo() }
      else if (ctrl && k === 'y') { e.preventDefault(); s.redo() }
      else if (ctrl && k === 's') { e.preventDefault(); void saveCurrentProject() }
      else if (ctrl && k === 'd') { e.preventDefault(); duplicateSelected() }
      else if (ctrl && k === 'a') { e.preventDefault(); s.select(s.project.clips.map((c) => c.id)) }
      else if (k === ' ') { e.preventDefault(); if (!s.playing && s.playhead >= dur - 0.01) s.setPlayhead(0); s.setPlaying(!s.playing) }
      else if (k === 's' && !ctrl) { splitAtPlayhead() }
      else if (k === 'm' && !ctrl) { addMarker() }
      else if (k === 'delete' || k === 'backspace') { e.preventDefault(); e.shiftKey ? rippleDeleteSelected() : deleteSelected() }
      else if (k === 'arrowleft') { e.preventDefault(); s.setPlaying(false); s.setPlayhead(Math.max(0, Math.round(s.playhead * fps) / fps - (e.shiftKey ? 10 : 1) / fps)) }
      else if (k === 'arrowright') { e.preventDefault(); s.setPlaying(false); s.setPlayhead(Math.min(dur, Math.round(s.playhead * fps) / fps + (e.shiftKey ? 10 : 1) / fps)) }
      else if (k === 'home') { s.setPlaying(false); s.setPlayhead(0) }
      else if (k === 'end') { s.setPlaying(false); s.setPlayhead(dur) }
      else if (k === '=' || k === '+') { s.setZoom(s.zoom * 1.25) }
      else if (k === '-') { s.setZoom(s.zoom / 1.25) }
      else if (k === 'escape') { s.select([]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active])
}

/**
 * Autosave: writes a recovery copy (autosave.json) at the user's interval whenever there are unsaved changes.
 * An explicit Save (Ctrl+S) writes project.json and removes the recovery copy.
 */
export function useAutosave(active: boolean): void {
  useEffect(() => {
    if (!active || !window.visioncut) return
    let seconds = 15
    let timer: number | undefined
    const tick = () => {
      const s = useEditor.getState()
      if (s.dirty) void api().projects.save(s.project, true).catch((e) => console.warn('Autosave failed', e))
    }
    void api().prefs.get().then((p) => {
      seconds = Math.max(5, p.autosaveSeconds)
      timer = window.setInterval(tick, seconds * 1000)
    })
    const onHide = () => tick()
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [active])
}
