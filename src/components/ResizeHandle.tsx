import { cn } from '@/utils/cn'

interface Props {
  direction: 'horizontal' | 'vertical'
  /** Called with the pointer delta (px) since drag start. */
  onDrag: (delta: number) => void
  onStart?: () => void
}

/** Thin draggable splitter between panels. */
export function ResizeHandle({ direction, onDrag, onStart }: Props) {
  const down = (e: React.PointerEvent) => {
    e.preventDefault()
    onStart?.()
    const start = direction === 'horizontal' ? e.clientX : e.clientY
    const move = (ev: PointerEvent) => onDrag((direction === 'horizontal' ? ev.clientX : ev.clientY) - start)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); document.body.style.cursor = '' }
    document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div onPointerDown={down} role="separator"
      className={cn('shrink-0 rounded bg-transparent transition-colors hover:bg-primary/60', direction === 'horizontal' ? 'w-1.5 cursor-col-resize' : 'h-1.5 cursor-row-resize')} />
  )
}
