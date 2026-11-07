import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'

export function Section({ title, children, defaultOpen = true }: { title: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-1 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground">
        {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}{title}
      </button>
      {open && <div className="space-y-2.5 px-3 pb-3">{children}</div>}
    </div>
  )
}

interface SliderProps {
  label: string; value: number; min: number; max: number; step?: number; unit?: string; digits?: number
  onChange: (v: number) => void; keyed?: boolean
}

/** Slider + numeric input. Number input accepts values beyond the slider range only within [min,max]. */
export function Slider({ label, value, min, max, step = 0.01, unit = '', digits = 2, onChange, keyed }: SliderProps) {
  const safe = Number.isFinite(value) ? value : 0
  return (
    <label className="block">
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}{keyed && <span className="ml-1 text-accent">◆</span>}</span>
        <span className="flex items-center gap-1">
          <input type="number" value={Number(safe.toFixed(digits))} min={min} max={max} step={step}
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v))) }}
            className="h-6 w-16 rounded border border-border bg-muted px-1 text-right font-mono text-xs outline-none focus:border-primary" />
          {unit && <span className="w-4 text-muted-foreground">{unit}</span>}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={safe} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[hsl(var(--primary))]" />
    </label>
  )
}

export function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
        className={cn('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-muted')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all', checked ? 'left-[18px]' : 'left-0.5')} />
      </button>
    </label>
  )
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </div>
  )
}

export const selectCls = 'h-7 rounded border border-border bg-muted px-1.5 text-xs outline-none focus:border-primary'
export const colorCls = 'h-7 w-10 cursor-pointer rounded border border-border bg-muted p-0.5'
