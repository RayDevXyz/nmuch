import type { SlashExtra } from '@brainwaves/editor'
import type { Editor } from '@tiptap/core'
import { toast } from '../state/store'
import { createCampaign, refreshRoles } from './api'
import { openSoon } from './Campaign'
import { openCharacterWizard } from './CharacterWizard'
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

/** The D&D entries of the `/` menu. */
export const dndSlashExtras: SlashExtra[] = [
  {
    id: 'dnd-campaign',
    label: 'New campaign',
    desc: 'D&D campaign: NPCs, locations, factions, sessions, story beats, world map',
    keywords: 'dnd campaign dungeon master dm world building story',
    run: () => {
      const title = window.prompt('Name of the campaign', 'New campaign')
      if (title === null) return
      toast('Founding the campaign…')
      void createCampaign(title).then(
        async (c) => {
          await refreshRoles()
          openSoon(c.id)
        },
        (e) => toast('Could not create the campaign: ' + String(e)),
      )
    },
  },
  { id: 'dnd-character', label: 'New character', desc: 'D&D character sheet from your 5etools races, classes, backgrounds', keywords: 'dnd character sheet player pc hero', run: () => openCharacterWizard() },
  { id: 'dnd-compendium', label: 'Compendium entry', desc: '5e spell, monster, item, race, class… as a card', keywords: 'dnd 5e 5etools compendium srd', run: pick(undefined, 'Insert from the compendium') },
  { id: 'dnd-spell', label: 'Spell', desc: 'A 5e spell card from your 5etools', keywords: 'dnd 5e magic', run: pick(['spell'], 'Insert a spell') },
  { id: 'dnd-monster', label: 'Monster', desc: 'A stat block from your 5etools bestiary', keywords: 'dnd 5e creature statblock bestiary npc', run: pick(['monster'], 'Insert a stat block') },
  { id: 'dnd-item', label: 'Magic item', desc: 'An item card from your 5etools', keywords: 'dnd 5e item weapon armor loot treasure', run: pick(['item'], 'Insert an item') },
]
