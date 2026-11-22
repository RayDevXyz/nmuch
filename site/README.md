# The BrainWaves website

One page (`index.html`) that shows the app and links to the docs. The workflow `.github/workflows/pages.yml` publishes it on GitHub Pages, with the screenshots it uses from `docs/images/`. It runs on every push to `main` that changes the site or the screenshots.

**Turn it on once:** in the repository's **Settings → Pages**, set **Source** to **GitHub Actions**. The site is then at `https://raydevxyz.github.io/nmuch/`.

**Preview it locally:**

```bash
mkdir -p /tmp/site/images && cp -r site/. /tmp/site/
for img in $(grep -o 'images/[a-z0-9-]*\.png' site/index.html | sort -u); do cp "docs/$img" "/tmp/site/$img"; done
python3 -m http.server -d /tmp/site 8000      # http://localhost:8000
```
