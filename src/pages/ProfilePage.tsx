import { useRef, useState } from 'react'
import { Camera, LogOut } from 'lucide-react'
import { useAuth, validatePassword } from '@/store/authStore'
import { errMsg } from '@/services/api'
import { toast } from '@/store/toastStore'

export function ProfilePage() {
  const { profile, localMode, updateProfile, uploadAvatar, changePassword, signOut } = useAuth()
  const [name, setName] = useState(profile?.fullName ?? '')
  const [pw, setPw] = useState('')
  const file = useRef<HTMLInputElement>(null)
  if (!profile) return null
  const guard = async (fn: () => Promise<void>, ok: string) => { try { await fn(); toast.success(ok) } catch (e) { toast.error(errMsg(e)) } }
  const inp = 'h-9 w-full rounded-md border border-border bg-muted px-3 text-sm outline-none focus:border-primary select-text'
  const fmt = (d: string | null) => (d ? new Date(d).toLocaleString() : '—')

  return (
    <div className="h-full overflow-y-auto p-8">
      <h1 className="mb-6 text-2xl font-semibold">User Profile</h1>
      <div className="max-w-xl space-y-6">
        <section className="flex items-center gap-5 rounded-xl border border-border bg-panel p-5">
          <div className="relative">
            {profile.avatarUrl ? <img src={profile.avatarUrl} className="h-20 w-20 rounded-full object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-full bg-primary/30 text-2xl font-semibold">{profile.fullName[0]?.toUpperCase()}</div>}
            {!localMode && <button onClick={() => file.current?.click()} title="Upload profile picture" className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"><Camera size={14} /></button>}
            <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void guard(() => uploadAvatar(f), 'Profile picture updated'); e.target.value = '' }} />
          </div>
          <div>
            <div className="text-lg font-medium">{profile.fullName}</div>
            <div className="text-sm text-muted-foreground select-text">{profile.email}</div>
            <span className="mt-1 inline-block rounded-full bg-accent/20 px-2 py-0.5 text-[11px] font-semibold uppercase text-accent">{profile.plan} plan</span>
          </div>
        </section>

        {localMode ? (
          <p className="rounded-lg border border-border bg-panel p-4 text-sm text-muted-foreground">Supabase is not configured, so VisionCut is running in <b>local mode</b>: projects are stored on this computer and there is no account. Add your Supabase keys to <code>.env</code> (see docs/supabase.md) to enable sign-in, profiles and cloud sync.</p>
        ) : (<>
          <section className="space-y-3 rounded-xl border border-border bg-panel p-5">
            <h2 className="font-medium">Profile</h2>
            <label className="block text-xs text-muted-foreground">Full name<input className={inp + ' mt-1'} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
            <button onClick={() => void guard(() => updateProfile({ fullName: name }), 'Profile saved')} className="h-9 rounded-md bg-primary px-4 text-sm text-primary-foreground">Save changes</button>
            <dl className="grid grid-cols-2 gap-y-1 pt-2 text-xs text-muted-foreground"><dt>Member since</dt><dd className="text-foreground">{fmt(profile.createdAt)}</dd><dt>Last login</dt><dd className="text-foreground">{fmt(profile.lastLogin)}</dd></dl>
          </section>
          <section className="space-y-3 rounded-xl border border-border bg-panel p-5">
            <h2 className="font-medium">Change password</h2>
            <input className={inp} type="password" placeholder="New password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" />
            <button onClick={() => { const err = validatePassword(pw); if (err) return toast.error(err); void guard(async () => { await changePassword(pw); setPw('') }, 'Password changed') }} className="h-9 rounded-md border border-border px-4 text-sm hover:bg-muted">Update password</button>
          </section>
          <button onClick={() => void signOut()} className="flex h-10 items-center gap-2 rounded-md border border-danger/50 px-4 text-sm text-danger hover:bg-danger/10"><LogOut size={15} />Sign out</button>
        </>)}
      </div>
    </div>
  )
}
