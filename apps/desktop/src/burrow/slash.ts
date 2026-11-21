import type { SlashExtra } from '@brainwaves/editor'
import { getState } from '../state/store'
import { cardContent } from './api'
import { pickBookmark } from './Burrow'
import { openSaveToBurrow } from './Save'

/** The Burrow entries of the `/` menu. */
export const burrowSlashExtras: SlashExtra[] = [
  {
    id: 'burrow-bookmark',
    label: 'Burrow bookmark',
    desc: 'Search your Burrow and put a bookmark here as a card',
    keywords: 'burrow bookmark link save read later archive web',
    group: 'Burrow',
    run: (editor) => pickBookmark((b) => editor.chain().focus().insertContent(cardContent(b)).run()),
  },
  {
    id: 'burrow-save',
    label: 'Save to Burrow',
    desc: 'This page as a note, or its links as bookmarks',
    keywords: 'burrow save export share bookmark',
    group: 'Burrow',
    run: () => {
      const id = getState().activeId
      if (id) openSaveToBurrow(id)
    },
  },
]
