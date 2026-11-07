import { useEffect } from 'react'
import { useEditor } from '@/store/editorStore'
import { projectDuration } from '@/types/project'

/** Master playback clock. Media elements follow this clock (see MediaLayers). Mount once in the editor. */
export function usePlaybackClock(): void {
  const playing = useEditor((s) => s.playing)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const s = useEditor.getState()
      const dur = projectDuration(s.project)
      const dt = Math.min(0.25, (now - last) / 1000) // clamp after tab stalls
      last = now
      let t = s.playhead + dt * s.playbackRate
      if (t >= dur) {
        if (s.loop && dur > 0) t = 0
        else { s.setPlayhead(dur); s.setPlaying(false); return }
      }
      s.setPlayhead(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])
}
