# Accessible Web Scanner

Point it at your site. It crawls your sitemap, runs [axe-core](https://github.com/dequelabs/axe-core) on every page, and hands you a report of real accessibility issues — the kind you fix in your code, not paper over with an overlay.

```bash
npx accessible-web-scanner https://example.com
```

That's it. It finds your sitemap automatically, scans every page, and writes an interactive HTML report plus CSV and JSON to a timestamped folder.

## Why this instead of axe directly?

axe-core is an engine, not a product. Out of the box it audits one page at a time, and wiring it across a whole site is on you. This CLI does the wiring: sitemap discovery, concurrent scanning, retries, WCAG level selection, authenticated pages, CI-friendly exit codes, and reports a human can actually read. It also bundles [Lighthouse](https://github.com/GoogleChrome/lighthouse) for performance/SEO/best-practices audits when you want the full picture.

## Install

Requires Node 18+.

```bash
npm install -g accessible-web-scanner
npx playwright install chromium   # one-time browser download
```

Or run it ad hoc with `npx accessible-web-scanner …` — no install.

## Usage

```bash
# Scan a whole site (sitemap auto-discovered)
accessible-web-scanner https://example.com

# Scan a specific sitemap, CSV of URLs, or a single page
accessible-web-scanner https://example.com/sitemap.xml
accessible-web-scanner urls.csv
accessible-web-scanner https://example.com/pricing

# Accessibility + Lighthouse in one run
accessible-web-scanner all https://example.com

# Lighthouse only
accessible-web-scanner lighthouse https://example.com --form-factor mobile
```

**Output:** a folder like `a11y_example-com_24DEC2025-0938am/` containing `report.html` (interactive — violations grouped by rule, expandable per page), `report.csv`, and `report.json`.

### Options

```
-c, --concurrency <n>            Concurrent pages (default 3)
-q, --quiet                      Suppress output, exit code only
--json                           JSON to stdout (for piping/CI)
--limit <n>                      Scan at most n URLs
--timeout <ms>                   Page timeout (default 30000)
--wait-until <event>             load | domcontentloaded | networkidle
--wait-for-selector <selector>   Wait for an element before scanning
--post-load-delay <ms>           Extra delay after load
--retries <n>                    Retries on failure (default 2)
--wcag <level>                   a | aa | aaa (default aa)
--storage-state <file>           Playwright auth state, for pages behind login
--form-factor <type>             mobile | desktop (lighthouse only)
```

### CI

Exit codes: `0` clean, `1` error, `2` issues found. So this fails a pipeline when violations appear:

```bash
accessible-web-scanner https://staging.example.com --quiet
```

### CSV input

```csv
url,name
https://example.com,Homepage
https://example.com/pricing,Pricing
```

## What it won't do

No automated scanner catches everything — axe-core finds roughly [57% of WCAG issues](https://www.deque.com/blog/automated-testing-study-identifies-57-percent-of-digital-accessibility-issues/) by volume. It will not tell you whether your alt text is *meaningful*, your focus order makes *sense*, or your page works with a real screen reader. Treat a clean scan as a floor, not a certificate.

## Related

Fixing what the scanner finds is the real work. If you also want visitor-facing controls — font sizing, contrast, readable fonts, text-to-speech, in 54 languages — see the companion [**AccessibleWeb Widget**](https://github.com/ifrederico/accessible-web-widget). Same philosophy in both directions: the widget doesn't claim to fix your code, and the scanner doesn't claim a clean report makes you compliant.

## License

MIT — see [LICENSE](LICENSE).
