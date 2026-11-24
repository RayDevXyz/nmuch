# Buttons

*Module 3: Structure · about 15 minutes*

A **button** does something when you click it. Make it as specific as you like: "New meeting
note", "Log a workout", "Add to reading list". Each button has a look you choose and a list of
**steps**; each step says **what** to do, **where**, and the **extras**.

## Learn

- **Make one:** `/button`. Its settings open right away; the ⚙ next to it (when you point at it)
  opens them later.
- **Look:** label, icon, colour, and style (Solid, Soft, Outline or Plain), fitting its label or
  the full width.
- **Steps**, run in order:

| What | Where | Extras |
|---|---|---|
| Create a page | under this page, at the top level, under a page you pick, or as a row of a database | title, template, icon and tags, or column values; open it or not |
| Add text or a to-do | under the button, in the page an earlier step made, or in a page you pick | as text, to-do, bullet, heading or quote |
| Open a page or link | a page you pick, or a web address | |

- **Fields:** `{{date}}`, `{{time}}` and `{{title}}` are filled in. Any other field, like
  `{{Topic}}`, is asked for in a small form when you click.

## Try it

- [ ] Add a button "Create quick note": create a page under this page called
  `Note {{date}} {{time}}`, opened in a new tab. Click it.
- [ ] Give it an icon, a colour and the Soft style.
- [ ] Change its title to `{{Topic}}`, and add a second step that adds `{{Topic}}` as a heading
  in the page the first step made.
- [ ] Make a button "Add book" that creates a row in your Reading list with Status = To read,
  without opening it, and the message `Added {{Book}}`.
- [ ] Make a "Log" button that adds a to-do `{{time}} {{What}}` under itself.

> [!TIP]
> Put your favourite buttons on a page you keep starred, and you have a dashboard of one-click
> actions.

## Learn more

- [Buttons](../guide/buttons.md)
