import { Browser, BrowserContext, Page, devices as playwrightDevices } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import pMap from 'p-map';
import {
  ScanOptions,
  ScanResult,
  Violation,
  Device,
  mergeDeviceResults,
  mapAxeViolations,
  countByImpact,
  getWcagTags,
} from './types.js';
import { sleep } from './utils.js';
import { launchChromium } from './browser.js';
import { createHash } from 'crypto';
import { mkdir } from 'fs/promises';
import { basename, join } from 'path';

// Pages served by rate limiters / bot protection instead of the real page.
// Scanning these produces bogus results (meta-refresh, empty headings, etc.).
const BLOCK_STATUSES = new Set([429, 503]);
const BLOCK_PATTERNS = [
  /connection needs to be verified/i, // Shopify
  /too many requests/i,
  /checking (if the site connection is secure|your browser)/i,
  /verify(ing)? (that )?you are (a )?human/i,
  /^just a moment\.\.\./i, // Cloudflare
  /attention required/i, // Cloudflare
];
const BLOCK_RETRIES = 5;
const BLOCK_BACKOFF_MS = [15000, 30000, 60000, 90000, 120000];
// Once the site has blocked us, space out page loads across all workers.
const BLOCK_SPACING_MS = 1500;

class BlockedError extends Error {}

// Screenshots: how many failing elements per rule per page, and how much
// surrounding page to keep around the highlighted element.
const SHOTS_PER_RULE = 3;
const SHOT_PADDING = 48;
const SHOT_MIN = { width: 360, height: 200 };
const HIDDEN_ATTR = 'data-a11y-scan-hidden';

// Runs in the page (string, since tsconfig has no DOM lib). Hides fixed or
// sticky layers sitting on top of the element's centre, up to 5 deep.
const UNCOVER_SCRIPT = `(selector) => {
  const el = document.querySelector(selector);
  if (!el) return;
  const r = el.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  for (let i = 0; i < 5; i++) {
    const top = document.elementFromPoint(x, y);
    if (!top || top === el || el.contains(top)) return;
    let cover = null;
    for (let n = top; n && n !== document.documentElement; n = n.parentElement) {
      const pos = getComputedStyle(n).position;
      if (pos === 'fixed' || pos === 'sticky') cover = n;
    }
    if (!cover || cover.contains(el)) return;
    cover.setAttribute('${HIDDEN_ATTR}', cover.style.getPropertyValue('visibility'));
    cover.style.setProperty('visibility', 'hidden', 'important');
  }
}`;
const RESTORE_SCRIPT = `document.querySelectorAll('[${HIDDEN_ATTR}]').forEach((n) => {
  const prev = n.getAttribute('${HIDDEN_ATTR}');
  if (prev) n.style.setProperty('visibility', prev); else n.style.removeProperty('visibility');
  n.removeAttribute('${HIDDEN_ATTR}');
})`;
const OVERLAY_ID = '__aws_highlight__';

// Screen sizes. Scale factor 1 keeps screenshots small.
const { defaultBrowserType: _ignored, ...iPhone } = playwrightDevices['iPhone 13'];
const DEVICE_CONTEXT: Record<Device, Parameters<Browser['newContext']>[0]> = {
  desktop: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  mobile: { ...iPhone, deviceScaleFactor: 1 },
};

function urlHash(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 10);
}

/** Screenshot of the top of the page, for the report's page list. */
async function captureThumbnail(page: Page, url: string, device: Device, dir: string): Promise<string | undefined> {
  try {
    await mkdir(dir, { recursive: true });
    const file = `${urlHash(url)}-${device}-page.jpg`;
    await page.screenshot({ path: join(dir, file), type: 'jpeg', quality: 55, animations: 'disabled', timeout: 5000 });
    return `${basename(dir)}/${file}`;
  } catch {
    return undefined;
  }
}

/**
 * Screenshot each failing element (up to SHOTS_PER_RULE per rule) with a red
 * box drawn around it. Best effort: an element that can't be captured
 * (hidden, in an iframe, detached) just gets no screenshot.
 */
async function captureScreenshots(
  page: Page,
  url: string,
  violations: Violation[],
  dir: string,
  device: Device
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const hash = urlHash(url);
  const folder = basename(dir);
  const viewport = page.viewportSize() ?? { width: 1280, height: 720 };

  for (const violation of violations) {
    for (const [i, node] of violation.nodes.slice(0, SHOTS_PER_RULE).entries()) {
      // A nested target means the element is inside an iframe (e.g. a YouTube
      // embed): outline the iframe itself. Whole-document targets (<html>,
      // <head> content) have nothing useful to frame.
      const selector = node.target[0];
      if (typeof selector !== 'string' || selector === 'html') continue;

      try {
        const el = page.locator(selector).first();
        await el.scrollIntoViewIfNeeded({ timeout: 2000 });
        // Let lazy images and sticky headers settle before measuring.
        await page.waitForTimeout(150);
        // Hide anything pinned to the screen (cookie banners, sticky headers)
        // that covers the element, so the screenshot shows the element itself.
        // Playwright won't pass an argument to a string function, so inline it.
        await page.evaluate(`(${UNCOVER_SCRIPT})(${JSON.stringify(selector)})`).catch(() => {});
        const box = await el.boundingBox();
        if (!box || box.width < 1 || box.height < 1) continue;

        await page.evaluate(
          `(() => {
            const b = ${JSON.stringify(box)};
            // Custom element + !important so site CSS (e.g. div:empty
            // { display: none }) can't hide or restyle the outline.
            const d = document.createElement('a11y-scan-highlight');
            d.id = '${OVERLAY_ID}';
            const css = {
              display: 'block', position: 'fixed', 'pointer-events': 'none',
              'z-index': '2147483647', 'box-sizing': 'border-box',
              margin: '0', padding: '0', background: 'transparent',
              border: '3px solid #e11d48', 'border-radius': '3px',
              'box-shadow': '0 0 0 2px #fff', transform: 'none',
              left: (b.x - 4) + 'px', top: (b.y - 4) + 'px',
              width: (b.width + 8) + 'px', height: (b.height + 8) + 'px',
            };
            for (const k in css) d.style.setProperty(k, css[k], 'important');
            document.documentElement.appendChild(d);
          })()`
        );

        // Pad around the element, and keep at least SHOT_MIN of context so a
        // tiny element (a slider dot, an icon) is recognisable.
        const cx = box.x + box.width / 2;
        const cy = box.y + box.height / 2;
        const wantW = Math.max(box.width + SHOT_PADDING * 2, SHOT_MIN.width);
        const wantH = Math.max(box.height + SHOT_PADDING * 2, SHOT_MIN.height);
        const x = Math.max(0, Math.min(cx - wantW / 2, viewport.width - wantW));
        const y = Math.max(0, Math.min(cy - wantH / 2, viewport.height - wantH));
        const width = Math.min(wantW, viewport.width - x);
        const height = Math.min(wantH, viewport.height - y);
        if (width < 1 || height < 1) continue;

        const file = `${hash}-${device}-${violation.id}-${i}.jpg`;
        await page.screenshot({
          path: join(dir, file),
          type: 'jpeg',
          quality: 70,
          clip: { x, y, width, height },
          animations: 'disabled',
          timeout: 5000,
        });
        node.screenshots = { ...node.screenshots, [device]: `${folder}/${file}` };
      } catch {
        // Skip this element's screenshot.
      } finally {
        await page
          .evaluate(`document.getElementById('${OVERLAY_ID}')?.remove()`)
          .catch(() => {});
        await page.evaluate(RESTORE_SCRIPT).catch(() => {});
      }
    }
  }
}

/** Shared across all workers in one scan run. */
interface ThrottleState {
  /** No page load may start before this time. */
  cooldownUntil: number;
  /** Minimum gap between page loads (0 until the site first blocks us). */
  spacingMs: number;
  /** Earliest start time for the next page load when spacing is active. */
  nextStart: number;
  blockedCount: number;
}

async function waitForTurn(throttle: ThrottleState): Promise<void> {
  const now = Date.now();
  let start = Math.max(now, throttle.cooldownUntil);
  if (throttle.spacingMs > 0) {
    start = Math.max(start, throttle.nextStart);
    throttle.nextStart = start + throttle.spacingMs;
  }
  if (start > now) await sleep(start - now);
}

async function detectBlock(
  page: Page,
  status: number | undefined
): Promise<string | null> {
  if (status !== undefined && BLOCK_STATUSES.has(status)) {
    return `HTTP ${status}`;
  }
  // String expression: this runs in the browser, and tsconfig has no DOM lib.
  const text = await page
    .evaluate<string[]>(
      `[document.title, document.querySelector('h1')?.textContent ?? '']`
    )
    .catch(() => [] as string[]);
  for (const raw of text) {
    const t = raw.trim();
    if (t && BLOCK_PATTERNS.some((p) => p.test(t))) return `"${t.slice(0, 80)}"`;
  }
  return null;
}

async function scanPage(
  url: string,
  context: BrowserContext,
  options: ScanOptions,
  throttle: ThrottleState,
  device: Device,
  takeThumbnail: boolean
): Promise<ScanResult> {
  const page = await context.newPage();
  let errorAttempts = 0;
  let blockAttempts = 0;

  try {
    for (;;) {
      try {
        await waitForTurn(throttle);

        const response = await page.goto(url, {
          waitUntil: options.waitUntil,
          timeout: options.timeout,
        });

        // Accessibility rules apply to web pages, not text, JSON or PDF files
        // that sitemaps sometimes list (e.g. Shopify's /agents.md).
        const contentType = response?.headers()['content-type'] ?? '';
        if (contentType && !/html/i.test(contentType)) {
          return {
            url, success: true, skipped: contentType.split(';')[0].trim(),
            violations: [], passCount: 0, timestamp: new Date(),
            critical: 0, serious: 0, moderate: 0, minor: 0,
          };
        }

        const blocked = await detectBlock(page, response?.status());
        if (blocked) throw new BlockedError(blocked);

        if (options.waitForSelector) {
          await page.waitForSelector(options.waitForSelector, {
            timeout: options.timeout,
          });
        }

        if (options.postLoadDelay > 0) {
          await page.waitForTimeout(options.postLoadDelay);
        }

        const thumbnail =
          takeThumbnail && options.screenshotDir
            ? await captureThumbnail(page, url, device, options.screenshotDir)
            : undefined;

        const axeResults = await new AxeBuilder({ page })
          .withTags(getWcagTags(options.wcag))
          .analyze();

        const violations = mapAxeViolations(axeResults.violations);
        if (options.screenshotDir && violations.length > 0) {
          await captureScreenshots(page, url, violations, options.screenshotDir, device);
        }
        const counts = countByImpact(violations);

        return {
          url,
          success: true,
          violations,
          passCount: axeResults.passes.length,
          timestamp: new Date(),
          thumbnail,
          ...counts,
        };
      } catch (error) {
        if (error instanceof BlockedError) {
          throttle.blockedCount++;
          throttle.spacingMs = BLOCK_SPACING_MS;
          if (blockAttempts < BLOCK_RETRIES) {
            const backoff = BLOCK_BACKOFF_MS[blockAttempts];
            blockAttempts++;
            throttle.cooldownUntil = Math.max(
              throttle.cooldownUntil,
              Date.now() + backoff
            );
            continue;
          }
          throw new Error(
            `Blocked by rate limiting / bot protection (${error.message}) after ${BLOCK_RETRIES} retries`
          );
        }
        if (errorAttempts < options.retries) {
          const delay = 1000 * Math.pow(2, errorAttempts);
          errorAttempts++;
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      url,
      success: false,
      error: errorMessage,
      violations: [],
      passCount: 0,
      timestamp: new Date(),
      critical: 0,
      serious: 0,
      moderate: 0,
      minor: 0,
    };
  } finally {
    await page.close();
  }
}

export interface ScanProgress {
  current: number;
  total: number;
  url: string;
  success: boolean;
  result: ScanResult;
  /** Times the site served a rate-limit / bot-protection page so far. */
  blockedCount: number;
}

export type ProgressCallback = (progress: ScanProgress) => void | Promise<void>;

export async function scanUrls(
  urls: string[],
  options: ScanOptions,
  onProgress?: ProgressCallback
): Promise<ScanResult[]> {
  const browser = await launchChromium();

  let completed = 0;
  const throttle: ThrottleState = {
    cooldownUntil: 0,
    spacingMs: 0,
    nextStart: 0,
    blockedCount: 0,
  };

  try {
    const results = await pMap(
      urls,
      async (url) => {
        // One thumbnail per page: phone size when tested, else desktop.
        const thumbDevice: Device = options.devices.includes('mobile') ? 'mobile' : options.devices[0];
        const perDevice: { device: Device; result: ScanResult }[] = [];

        for (const device of options.devices) {
          const context = await browser.newContext({
            ...DEVICE_CONTEXT[device],
            ...(options.storageState ? { storageState: options.storageState } : {}),
          });
          try {
            const result = await scanPage(url, context, options, throttle, device, device === thumbDevice);
            perDevice.push({ device, result });
          } finally {
            await context.close();
          }
        }

        {
          const result = mergeDeviceResults(url, perDevice);
          completed++;

          if (onProgress) {
            await onProgress({
              current: completed,
              total: urls.length,
              url,
              success: result.success,
              result,
              blockedCount: throttle.blockedCount,
            });
          }

          return result;
        }
      },
      { concurrency: options.concurrency }
    );

    return results;
  } finally {
    await browser.close();
  }
}
