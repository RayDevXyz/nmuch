import { Copy, KeyRound, LogOut, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from '../state/store'
import { authCall } from './Login'

/**
 * The owner's account on a hosted BrainWaves: the password, signing out, and API tokens that
 * let other apps (Burrow, scripts) use BrainWaves' API.
 */

interface Token {
  id: string
  name: string
  created: number
  lastUsed: number | null
}

export function AccountDialog({ user, onClose }: { user: string; onClose: () => void }) {
  const [tokens, setTokens] = useState<Token[] | null>(null)
  const [newName, setNewName] = useState('Burrow')
  const [secret, setSecret] = useState<string | null>(null)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const load = () => void authCall<Token[]>('tokens', undefined, 'GET').then(setTokens, () => setTokens([]))
  useEffect(load, [])
  const fail = (e: unknown) => toast(String(e).replace(/^Error:\s*/, ''))
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="account" role="dialog" aria-label="Account">
        <header>
          <span>
            <KeyRound size={16} /> Account
          </span>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </header>
        <section>
          <p>
            Signed in as <b>{user}</b>.
          </p>
          <button className="setting-action" onClick={() => void authCall('logout').then(() => location.reload(), fail)}>
            <LogOut size={13} /> Sign out
          </button>
        </section>
        <section>
          <h3>API tokens</h3>
          <p className="account-hint">For other apps that use BrainWaves, like Burrow (its BrainWaves setting), with <code>Authorization: Bearer …</code>. A token can read and change your pages, but not this account.</p>
          {secret && (
            <div className="account-secret">
              <code>{secret}</code>
              <button className="icon-button" title="Copy" onClick={() => void navigator.clipboard.writeText(secret).then(() => toast('Token copied'))}>
                <Copy size={14} />
              </button>
              <small>Copy it now: it won't be shown again.</small>
            </div>
          )}
          <ul className="account-tokens">
            {(tokens ?? []).map((t) => (
              <li key={t.id}>
                <span>
                  <b>{t.name}</b>
                  <small>
                    made {new Date(t.created).toLocaleDateString()} · {t.lastUsed ? `last used ${new Date(t.lastUsed).toLocaleDateString()}` : 'not used yet'}
                  </small>
                </span>
                <button className="icon-button" aria-label={`Delete ${t.name}`} onClick={() => confirm(`Delete the token “${t.name}”? Apps using it stop working.`) && void authCall(`tokens/${t.id}`, undefined, 'DELETE').then(load, fail)}>
                  <Trash2 size={14} />
                </button>
              </li>
            ))}
            {tokens?.length === 0 && <li className="account-hint">No tokens yet.</li>}
          </ul>
          <div className="account-row">
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="What it's for" maxLength={60} />
            <button
              className="setting-action"
              onClick={() =>
                void authCall<{ token: string }>('tokens', { name: newName }).then((r) => {
                  setSecret(r.token)
                  load()
                }, fail)
              }
            >
              <Plus size={13} /> New token
            </button>
          </div>
        </section>
        <section>
          <h3>Password</h3>
          <div className="account-row">
            <input type="password" autoComplete="current-password" placeholder="Current password" value={current} onChange={(e) => setCurrent(e.target.value)} />
            <input type="password" autoComplete="new-password" placeholder="New password (10+ characters)" value={next} onChange={(e) => setNext(e.target.value)} />
          </div>
          <button
            className="setting-action"
            onClick={() =>
              void authCall('password', { current, password: next }).then(() => {
                setCurrent('')
                setNext('')
                toast('Password changed: other browsers are signed out')
              }, fail)
            }
          >
            Change password
          </button>
        </section>
      </div>
    </div>
  )
}
