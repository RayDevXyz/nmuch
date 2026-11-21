# Burrow side of the BrainWaves integration

`0001-BrainWaves-….patch` is a commit for the [Burrow](https://github.com/RayDevXyz/burrow)
repository. It adds:

- **Settings → 🧠 BrainWaves**: connect a BrainWaves (its address and an API token made in
  BrainWaves: Settings → Account and API tokens → New token).
- On **tag pages**: the BrainWaves pages with the same tag, linking to them.
- **`#/b/<id>`** links that open a bookmark (BrainWaves' "In Burrow" buttons use them).

Burrow's server calls BrainWaves with the token, so the token never reaches the browser. See
[`docs/burrow.md`](../../docs/burrow.md) for the whole integration.

## Apply it

```sh
cd burrow                     # your Burrow checkout, on main
git am /path/to/nmuch/integrations/burrow/0001-*.patch
git push                      # GitHub Actions builds the new Burrow image
```

Then update Burrow in Cosmos so it pulls the new image. The patch adds one table
(`integrations`) on start; nothing else in Burrow's data changes.
