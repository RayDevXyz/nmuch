# Page properties

Any page can have properties: a status, a due date, tags, a link, a number. You don't need a database.

## Using them

- Next to the page's title, click **Properties**. A pop-up opens. The button shows how many properties the page has.
- Add a property with **Add property**: give it a name and pick a type. The types are text, number, date, select, multi-select, checkbox and link.
  - Select and multi-select remember every value you've used and suggest them again.
  - A link opens with its arrow button.
- Click a property's name to rename it, change its type, move it up or down, or delete it.
  - Changing the type keeps the value where it can. For example, "412" as text becomes 412 as a number.

Properties stay in the pop-up until you click **Show on page**. Then they are listed under the title, where you can still edit them. **Hide** puts them back in the pop-up only. On a phone, the pop-up opens from the bottom of the screen.

**Copy as Markdown** puts them at the top of the text as YAML front matter:

```
---
Status: Reading
Tags:
  - sci-fi
Read: true
---
```

## How they're stored

They live in the page's own Y.Doc, in a root map called `properties`:
- Each property is one entry, a plain object: `{ id, name, type, order, value, options? }`.
- The key `$show` holds whether the properties are shown on the page.

They sync, and are versioned, with the page. The core indexes only the "Tags" property, as tags of the page (`property_tags` in the snapshot). See `apps/desktop/src/properties/model.ts`.

## Tags

A property named **Tags** (or **Tag**) holds the page's tags. It can be a multi-select, a select, or text with commas between the tags. Those tags count like `#tags` in the text:
- they appear in the Tags panel and on tag pages;
- a map of content set to "Pages with a tag" finds them.

Tags are matched without the `#` and ignoring case, and spaces become dashes, so "Sci Fi" and `#sci-fi` are the same tag. A Tags property also suggests the tags already used in the workspace.

## Limits

Search and the map of content don't use other property values yet.
- Database rows keep their own columns, which come from their database. A row can have page properties too.
