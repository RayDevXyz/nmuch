import type { SlashExtra } from '@brainwaves/editor'
import type { Editor } from '@tiptap/core'
import { openCompendium } from './Compendium'
import type { Category, Ref } from './fivee'

/** Put a compendium entry in the page as a card (only the reference is stored). */
export function insertCard(editor: Editor, ref: Ref) {
  editor
    .chain()
    .focus()
    .insertContent([{ type: 'widget', attrs: { widget: 'dnd:card', settings: JSON.stringify(ref) } }, { type: 'paragraph' }])
    .run()
}

const pick = (cats: Category[] | undefined, title: string) => (editor: Editor) => openCompendium({ cats, title, onPick: (ref) => insertCard(editor, ref) })

/** The D&D entries of the `/` menu. Campaign and character entries are added by their modules. */
export const dndSlashExtras: SlashExtra[] = [
  { id: 'dnd-compendium', label: 'Compendium entry', desc: '5e spell, monster, item, race, class… as a card', keywords: 'dnd 5e 5etools compendium srd', run: pick(undefined, 'Insert from the compendium') },
  { id: 'dnd-spell', label: 'Spell', desc: 'A 5e spell card from your 5etools', keywords: 'dnd 5e magic', run: pick(['spell'], 'Insert a spell') },
  { id: 'dnd-monster', label: 'Monster', desc: 'A stat block from your 5etools bestiary', keywords: 'dnd 5e creature statblock bestiary npc', run: pick(['monster'], 'Insert a stat block') },
  { id: 'dnd-item', label: 'Magic item', desc: 'An item card from your 5etools', keywords: 'dnd 5e item weapon armor loot treasure', run: pick(['item'], 'Insert an item') },
]
