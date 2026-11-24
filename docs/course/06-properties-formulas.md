# Properties and formulas

*Module 2: Writing well · about 15 minutes*

**Properties** are facts about a page: a status, a due date, tags, a rating. **Formulas** put live
values in your sentences: "I've read 12 books this year" stays true as you read more.

## Learn

**Page properties**

- Hover the title and click **Properties**, then **Add property**. Types: text, number, date,
  select, multi-select, checkbox and link.
- Select and multi-select remember every value you've used.
- Properties stay in the pop-up until you click **Show on page**; **Hide** puts them away again.
- A **Tags** property counts as tags everywhere: the Tags view and maps of content use it.

**Formulas**

- Type `{{= ` and your formula, then `}}`, or use `/formula`, which opens an editor with examples
  and shows the result as you type.
- Some things you can write:

| Formula | Gives |
|---|---|
| `Status` | this page's property |
| `[[Dune]].Rating` | another page's property |
| `[[Books]].count` | how many rows a database has |
| `[[Books]].count(Read = true)` | how many rows match |
| `[[Books]].sum(Pages)` | a total |
| `if(Pages > 300, "long", "short")` | logic |
| `days(today(), Due)` | days until a date |

## Try it

- [ ] Add a **Status** (select) and a **Due** (date) property to a page.
- [ ] Click **Show on page**, then hide them again.
- [ ] Add a **Tags** property with a tag, and find the page in the **Tags** view.
- [ ] In the same page, write "Status: " followed by the formula `{{= Status}}`.
- [ ] Add `{{= days(today(), Due)}} days to go` and change the due date to see it update.

> [!TIP]
> Formulas really shine with databases. After lesson 7, come back and try
> `[[Your database]].count`.

## Learn more

- [Page properties](../guide/page-properties.md)
- [Formulas](../guide/formulas.md)
