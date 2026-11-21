import { useSyncExternalStore } from 'react'

/** Phone-sized screens (the layout in styles.css switches at the same width). */
export const NARROW = '(max-width: 760px)'
const mq = typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(NARROW) : null
export const isNarrow = () => !!mq?.matches
export function useNarrow(): boolean {
  return useSyncExternalStore(
    (l) => {
      mq?.addEventListener('change', l)
      return () => mq?.removeEventListener('change', l)
    },
    isNarrow,
  )
}
