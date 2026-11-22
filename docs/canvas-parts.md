# Splitting a page into parts on the canvas

In canvas view (Ctrl Shift E), a page's text is one note at first. You can cut it into parts and lay them out freely. Each part is still a note of the same page, so in document view the parts read in order, one after the other.

## Split

Click into a note. Its bar at the top has two split buttons:
- **✂ Split at the cursor:** the block the cursor is in, and everything after it, becomes a new part placed to the right.
- **≡ Split at each heading:** a new part starts at each heading of the highest level the note uses. Text before the first heading stays where it is. The parts are laid out in a row.

A new part goes right after its original in the document order. Splitting the first of several notes therefore keeps the text in order.

## Move, select, group

- **Move a part:** drag the strip at its top. It moves on its own.
- **Select several:** drag a box over them on an empty spot, or Shift-click. Then drag one to move them all.
- **Group:** **Ctrl G** groups the selection; notes can be grouped together and with shapes, text and pictures. Clicking any member then selects the whole group, and the group moves together. Ctrl-click picks one member inside the group. **Ctrl Shift G** ungroups.

## Merge

Select two or more notes and click **Merge**. The top-left one keeps its place. The others' content is added after its own, in reading order (top to bottom, then left to right), and they're removed.

## Under the hood

Each part is an entry in the page's `notes` map, with its own `order`, `xywh` and optional `group`; see `apps/desktop/src/edgeless/split.ts`. A note is removed only after its editor has closed: deleting a note while its editor is still bound to it breaks the editor.
