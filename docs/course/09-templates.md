# Templates

*Module 3: Structure · about 15 minutes*

A **template** is a page you copy to start a new one: a meeting note, a weekly review, a project
with its sub-pages. Templates can ask for things (the client's name, a date) and fill them in.

## Learn

- **Where they live:** the **Templates** view in the left rail. Each page in it is a template,
  with its sub-pages. **+** makes a new one, or use **Save as template** in any page's ⋯ menu.
- **Fields:** write these anywhere in a template, even in its title:

| Write | Means |
|---|---|
| `{{date}}`, `{{time}}`, `{{date:dddd D MMMM}}` | filled in for you |
| `{{title}}`, `{{parent}}` | the new page's title, the page it's under |
| `{{Client}}` | asked for in a form |
| `{{Due: date}}`, `{{Pages: number}}` | asked for, with a date or number field |
| `{{Status: Todo \| Doing \| Done}}` | a choice |
| `{{Author = Ray}}` | asked for, with a default |

- **Using one:** **Ctrl Shift N** (or the app menu → **New page from template…**) opens a form
  for the title and the fields. In a page, `/template` inserts one there or as a sub-page. Typing
  `{{template: Meeting}}` and **Enter** does the same.
- **In a database:** the **▾** next to **New** makes a row from any template, and the database's
  settings pick the template every new row starts from (the ☆ in the same menu does it too).

## Try it

- [ ] In **Templates**, make a template "Meeting {{date}}" with the headings *Attendees*,
  *Agenda* and *Actions*, and a line `Client: {{Client}}`.
- [ ] Press **Ctrl Shift N**, pick it, fill in the client and create the page.
- [ ] Add a sub-page "Follow-up for {{Client}}" to the template, and use it again.
- [ ] In your Reading list, use **▾** next to **New** and make a book from a template.
- [ ] Make a "Book notes" template and set it as the Reading list's template for new pages.

## Learn more

- [Templates](../guide/templates.md)
- [Databases: new pages from a template](../guide/databases.md)
