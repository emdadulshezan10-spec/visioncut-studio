import { useState } from 'react'
import { Clapperboard, Loader2 } from 'lucide-react'
import { useAuth, validateEmail, validatePassword } from '@/store/authStore'
import { errMsg } from '@/services/api'
import { getRememberMe } from '@/services/supabase'
import { toast } from '@/store/toastStore'

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'reset'

const inputCls = 'h-10 w-full rounded-md border border-border bg-muted px-3 text-sm outline-none focus:border-primary select-text'

export function AuthPage() {
  const auth = useAuth()
  const [mode, setMode] = useState<Mode>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [remember, setRemember] = useState(getRememberMe())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const run = async (fn: () => Promise<void>) => {
    setError(''); setBusy(true)
    try { await fn() } catch (e) { setError(errMsg(e)) } finally { setBusy(false) }
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    void run(async () => {
      if (!validateEmail(email)) throw new Error('Enter a valid email address.')
      if (mode === 'login') {
        if (!password) throw new Error('Enter your password.')
        try { await auth.signIn(email, password, remember) } catch (err) {
          if (/not confirmed/i.test(errMsg(err))) { setMode('verify'); throw new Error('Please verify your email first — enter the code we sent.') }
          throw err
        }
      } else if (mode === 'register') {
        if (name.trim().length < 2) throw new Error('Enter your full name.')
        const pw = validatePassword(password)
        if (pw) throw new Error(pw)
        const r = await auth.signUp(email, password, name.trim())
        if (r.needsVerification) { setMode('verify'); toast.info('Check your email for the verification code.') }
      } else if (mode === 'verify') {
        await auth.verifySignupCode(email, code)
        toast.success('Email verified — you can sign in now.')
        setMode('login')
      } else if (mode === 'forgot') {
        await auth.requestPasswordReset(email)
        toast.info('If that email exists, a reset code was sent.')
        setMode('reset')
      } else if (mode === 'reset') {
        const pw = validatePassword(password)
        if (pw) throw new Error(pw)
        await auth.resetPassword(email, code, password)
        toast.success('Password updated. Sign in with your new password.')
        setPassword(''); setCode(''); setMode('login')
      }
    })
  }

  const title = { login: 'Sign in', register: 'Create your account', verify: 'Verify your email', forgot: 'Forgot password', reset: 'Reset password' }[mode]

  return (
    <div className="grid h-full place-items-center bg-[radial-gradient(ellipse_at_top,hsl(262_50%_14%),hsl(var(--background))_60%)]">
      <form onSubmit={submit} className="w-[400px] space-y-4 rounded-2xl border border-border bg-panel/95 p-8 shadow-2xl">
        <div className="flex items-center gap-2"><Clapperboard className="text-primary" /><span className="text-lg font-semibold">VisionCut Studio</span></div>
        <h1 className="text-xl font-semibold">{title}</h1>
        {mode === 'register' && <input className={inputCls} placeholder="Full name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
        <input className={inputCls} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value.trim())} autoComplete="email" />
        {(mode === 'verify' || mode === 'reset') && <input className={inputCls} inputMode="numeric" placeholder="Code from your email" value={code} maxLength={10} onChange={(e) => setCode(e.target.value)} />}
        {mode !== 'forgot' && mode !== 'verify' && <input className={inputCls} type="password" placeholder={mode === 'reset' ? 'New password' : 'Password'} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />}
        {mode === 'login' && (
          <div className="flex items-center justify-between text-xs">
            <label className="flex items-center gap-2 text-muted-foreground"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />Remember me</label>
            <button type="button" className="text-accent hover:underline" onClick={() => { setError(''); setMode('forgot') }}>Forgot password?</button>
          </div>
        )}
        {error && <p className="rounded bg-danger/15 p-2 text-xs text-danger select-text">{error}</p>}
        <button disabled={busy} className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60">
          {busy && <Loader2 size={15} className="animate-spin" />}{{ login: 'Sign in', register: 'Create account', verify: 'Verify email', forgot: 'Send reset code', reset: 'Set new password' }[mode]}
        </button>
        {(mode === 'login' || mode === 'register') && (
          <button type="button" disabled={busy} onClick={() => void run(auth.signInWithGoogle)} className="h-10 w-full rounded-md border border-border text-sm hover:bg-muted">Continue with Google</button>
        )}
        <div className="text-center text-xs text-muted-foreground">
          {mode === 'login' ? <>New here? <button type="button" className="text-accent hover:underline" onClick={() => { setError(''); setMode('register') }}>Create an account</button></> : <button type="button" className="text-accent hover:underline" onClick={() => { setError(''); setMode('login') }}>Back to sign in</button>}
        </div>
      </form>
    </div>
  )
}
