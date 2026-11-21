import { useSyncExternalStore } from 'react'

/**
 * BrainWaves as an installable app (hosted only): the service worker (`public/sw.js`) and the
 * browser's install prompt, which Settings and the phone menu offer as "Install app".
 */

export function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return
  // Only where it's allowed and useful: https, or localhost while testing.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return
  void navigator.serviceWorker.register('/sw.js').catch(() => {})
}

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let deferred: InstallEvent | null = null
const subs = new Set<() => void>()
const emit = () => subs.forEach((l) => l())
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    emit()
  })
}

/** Whether the browser offers to install the app right now, and a function that asks. */
export function useInstall(): { canInstall: boolean; install: () => Promise<void> } {
  const can = useSyncExternalStore(
    (l) => (subs.add(l), () => subs.delete(l)),
    () => !!deferred,
  )
  return {
    canInstall: can,
    install: async () => {
      if (!deferred) return
      await deferred.prompt()
      await deferred.userChoice
      deferred = null
      emit()
    },
  }
}

/** Running as the installed app (its own window), not in a browser tab. */
export const installed = () => window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
