import { useState } from 'react'

/**
 * Signing in to a hosted BrainWaves (`bw-server`). The first visit makes the owner's account;
 * after that, only the owner signs in. Not shown in the desktop app or with the dev server.
 */

export interface AuthState {
  hosted: boolean
  hasOwner: boolean
  user: string | null
}

/** What the server says about signing in; null: no sign-in here (desktop app, dev server). */
export async function authState(): Promise<AuthState | null> {
  try {
    const r = await fetch('/api/auth/state', { headers: { accept: 'application/json' } })
    if (!r.ok) return null
    const s = (await r.json()) as AuthState
    return s && s.hosted ? s : null
  } catch {
    return null
  }
}

export async function authCall<T = unknown>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const r = await fetch(`/api/auth/${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error((await r.text()) || `${path} failed (${r.status})`)
  return r.json()
}

export function Login({ setup }: { setup: boolean }) {
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [again, setAgain] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    if (setup && password !== again) return setError("The passwords don't match.")
    setBusy(true)
    setError('')
    try {
      await authCall(setup ? 'setup' : 'login', { name, password })
      location.reload()
    } catch (err) {
      setError(String(err).replace(/^Error:\s*/, ''))
      setBusy(false)
    }
  }
  return (
    <main className="login">
      <form className="login-card" onSubmit={go}>
        <div className="login-brand">
          <span className="brand-mark">✦</span> BrainWaves
        </div>
        <h1>{setup ? 'Make your account' : 'Sign in'}</h1>
        <p className="login-hint">{setup ? 'This BrainWaves has no owner yet. The account you make now is the only one: nobody else can sign up afterwards.' : 'Welcome back.'}</p>
        <label>
          Name
          <input autoFocus autoComplete="username" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} required />
        </label>
        <label>
          Password
          <input type="password" autoComplete={setup ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} required minLength={setup ? 10 : 1} />
        </label>
        {setup && (
          <label>
            Password again
            <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required />
          </label>
        )}
        {setup && <p className="login-hint small">At least 10 characters. A few words in a row make a good one.</p>}
        {error && <p className="login-error">{error}</p>}
        <button className="login-go" disabled={busy}>
          {busy ? '…' : setup ? 'Make account' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
