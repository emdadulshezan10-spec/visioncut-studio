import { useState } from 'react'
import { create } from 'zustand'

/** Electron does not support window.prompt(), so text input goes through this promise-based dialog. */
interface PromptState {
  open: { id: number; title: string; initial: string; resolve: (v: string | null) => void } | null
  ask: (title: string, initial?: string) => Promise<string | null>
  close: (v: string | null) => void
}

let seq = 0
const usePrompt = create<PromptState>((set, get) => ({
  open: null,
  ask: (title, initial = '') => new Promise((resolve) => set({ open: { id: ++seq, title, initial, resolve } })),
  close: (v) => { get().open?.resolve(v); set({ open: null }) },
}))

/** Returns the trimmed text, or null if cancelled/empty. */
export const askText = async (title: string, initial = ''): Promise<string | null> => {
  const v = await usePrompt.getState().ask(title, initial)
  return v && v.trim() ? v.trim() : null
}

interface ConfirmState {
  open: { message: string; confirmLabel: string; resolve: (v: boolean) => void } | null
}
const useConfirm = create<ConfirmState>(() => ({ open: null }))

/** In-app replacement for window.confirm (native dialogs can steal input focus in Electron on Windows). */
export const askConfirm = (message: string, confirmLabel = 'Continue'): Promise<boolean> =>
  new Promise((resolve) => useConfirm.setState({ open: { message, confirmLabel, resolve } }))

export function PromptDialog() {
  const open = usePrompt((s) => s.open)
  const close = usePrompt((s) => s.close)
  const c = useConfirm((s) => s.open)
  const done = (v: boolean) => { c?.resolve(v); useConfirm.setState({ open: null }) }
  return (
    <>
      {open && <Inner key={open.id} title={open.title} initial={open.initial} onClose={close} />}
      {c && (
        <div className="fixed inset-0 z-[95] grid place-items-center bg-black/70" onMouseDown={(e) => e.target === e.currentTarget && done(false)}>
          <div className="w-96 space-y-4 rounded-xl border border-border bg-panel p-5 shadow-2xl" role="alertdialog">
            <p className="text-sm">{c.message}</p>
            <div className="flex gap-2">
              <button autoFocus onClick={() => done(false)} className="h-8 flex-1 rounded-md border border-border text-sm hover:bg-muted">Cancel</button>
              <button onClick={() => done(true)} className="h-8 flex-1 rounded-md bg-primary text-sm font-medium text-primary-foreground">{c.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Inner({ title, initial, onClose }: { title: string; initial: string; onClose: (v: string | null) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70" onMouseDown={(e) => e.target === e.currentTarget && onClose(null)}>
      <form className="w-80 space-y-3 rounded-xl border border-border bg-panel p-5 shadow-2xl" onSubmit={(e) => { e.preventDefault(); onClose(value) }}>
        <h2 className="text-sm font-semibold">{title}</h2>
        <input autoFocus value={value} maxLength={120} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.currentTarget.select()} className="h-9 w-full rounded border border-border bg-muted px-3 text-sm outline-none focus:border-primary" />
        <div className="flex gap-2">
          <button type="button" onClick={() => onClose(null)} className="h-8 flex-1 rounded-md border border-border text-sm hover:bg-muted">Cancel</button>
          <button className="h-8 flex-1 rounded-md bg-primary text-sm font-medium text-primary-foreground">OK</button>
        </div>
      </form>
    </div>
  )
}
