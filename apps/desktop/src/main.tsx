import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import './dnd/theme.css'
import App from './App'
import { authState, Login } from './auth/Login'
import { isTauri } from './lib/storage'
import { registerServiceWorker } from './mobile/pwa'
import { readShare, ShareOffline } from './mobile/share'
import { setHostedUser } from './state/hosted'

async function start() {
  const root = createRoot(document.getElementById('root')!)
  // A hosted BrainWaves asks who you are first; the desktop app and the dev server don't.
  const auth = isTauri ? null : await authState()
  if (auth === 'offline') {
    // The installed app without a connection: a share can wait on the phone.
    const shared = readShare()
    root.render(
      shared ? (
        <ShareOffline shared={shared} />
      ) : (
        <main className="login">
          <div className="login-card">
            <h1>You're offline</h1>
            <p className="login-hint">BrainWaves keeps your notes on your server. Connect to the internet and try again.</p>
            <button className="login-go" onClick={() => location.reload()}>
              Try again
            </button>
          </div>
        </main>
      ),
    )
    registerServiceWorker()
    return
  }
  if (auth) registerServiceWorker()
  if (auth && !auth.user) {
    root.render(<Login setup={!auth.hasOwner} />)
    return
  }
  if (auth?.user) setHostedUser(auth.user)
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
void start()
