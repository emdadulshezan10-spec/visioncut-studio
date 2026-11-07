import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { useToasts } from '@/store/toastStore'
import { cn } from '@/utils/cn'

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return (
    <div className="fixed bottom-4 right-4 z-[100] flex w-96 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? AlertCircle : Info
        return (
          <div key={t.id} className={cn('flex items-start gap-3 rounded-lg border bg-panel p-3 text-sm shadow-xl',
            t.kind === 'error' ? 'border-danger/50' : t.kind === 'success' ? 'border-success/40' : 'border-border')}>
            <Icon size={18} className={cn('mt-0.5 shrink-0', t.kind === 'error' ? 'text-danger' : t.kind === 'success' ? 'text-success' : 'text-accent')} />
            <p className="flex-1 whitespace-pre-wrap break-words select-text">{t.text}</p>
            <button onClick={() => dismiss(t.id)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
          </div>
        )
      })}
    </div>
  )
}
