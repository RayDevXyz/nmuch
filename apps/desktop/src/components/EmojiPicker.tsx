import { useMemo, useState } from 'react'
import { Popover } from './Popover'

const EMOJI =
  '📝 📄 📁 📚 📖 📓 📒 📌 📎 🧭 💡 ✨ ⭐ 🔥 🚀 🎯 🧠 💭 💬 ✅ ☑️ 🗓️ ⏰ 🔖 🏷️ 🔍 🔗 🧩 🛠️ ⚙️ 🧪 🔬 💻 🖥️ ⌨️ 🎨 🎬 🎧 🎹 🎛️ 🎚️ 📷 🎮 🌙 ☀️ 🌈 🌊 🌲 🌸 🍀 🍎 ☕ 🍕 🏠 🏢 ✈️ 🗺️ 🌍 💰 📈 📊 🧾 💼 🤝 👋 ❤️ 💜 💙 💚 🧡 💛 ⚡ ❗ ❓ ⚠️ 🚧 🔒 🔑 🎁 🏆 🐛 🐙 🦊 🐱 🐶 🌱 ⌘ ✦'.split(' ')

export function EmojiPicker({ x, y, onPick, onClose, allowRemove }: { x: number; y: number; onPick: (e: string) => void; onClose: () => void; allowRemove?: boolean }) {
  const [custom, setCustom] = useState('')
  const list = useMemo(() => EMOJI, [])
  return (
    <Popover x={x} y={y} onClose={onClose} className="emoji-popover">
      <div className="emoji-head">
        <input
          autoFocus
          className="emoji-input"
          placeholder="Paste any emoji…"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && custom.trim()) {
              onPick([...custom.trim()].slice(0, 2).join(''))
              onClose()
            }
          }}
        />
        {allowRemove && (
          <button
            className="emoji-remove"
            onClick={() => {
              onPick('')
              onClose()
            }}
          >
            Remove
          </button>
        )}
      </div>
      <div className="emoji-grid">
        {list.map((em) => (
          <button
            key={em}
            className="emoji-cell"
            onClick={() => {
              onPick(em)
              onClose()
            }}
          >
            {em}
          </button>
        ))}
      </div>
    </Popover>
  )
}
