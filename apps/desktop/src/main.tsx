import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/jetbrains-mono'
import './styles.css'
import './dnd/theme.css'
import App from './App'
import { authState, Login } from './auth/Login'
import { isTauri } from './lib/storage'
import { setHostedUser } from './state/hosted'

async function start() {
  const root = createRoot(document.getElementById('root')!)
  // A hosted BrainWaves asks who you are first; the desktop app and the dev server don't.
  const auth = isTauri ? null : await authState()
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
