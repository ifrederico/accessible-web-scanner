import { Browser, BrowserContext, Page } from 'playwright';
import { AxeBuilder } from '@axe-core/playwright';
import pMap from 'p-map';
import {
  ScanOptions,
  ScanResult,
  Violation,
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
const OVERLAY_ID = '__aws_highlight__';

/**
 * Screenshot each failing element (up to SHOTS_PER_RULE per rule) with a red
 * box drawn around it. Best effort: an element that can't be captured
 * (hidden, in an iframe, detached) just gets no screenshot.
 */
async function captureScreenshots(
  page: Page,
  url: string,
  violations: Violation[],
  dir: string
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const urlHash = createHash('sha1').update(url).digest('hex').slice(0, 10);
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

        const x = Math.max(0, box.x - SHOT_PADDING);
        const y = Math.max(0, box.y - SHOT_PADDING);
        const width = Math.min(viewport.width, box.x + box.width + SHOT_PADDING) - x;
        const height = Math.min(viewport.height, box.y + box.height + SHOT_PADDING) - y;
        if (width < 1 || height < 1) continue;

        const file = `${urlHash}-${violation.id}-${i}.jpg`;
        await page.screenshot({
          path: join(dir, file),
          type: 'jpeg',
          quality: 70,
          clip: { x, y, width, height },
          animations: 'disabled',
          timeout: 5000,
        });
        node.screenshot = `${folder}/${file}`;
      } catch {
        // Skip this element's screenshot.
      } finally {
        await page
          .evaluate(`document.getElementById('${OVERLAY_ID}')?.remove()`)
          .catch(() => {});
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
  throttle: ThrottleState
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

        const axeResults = await new AxeBuilder({ page })
          .withTags(getWcagTags(options.wcag))
          .analyze();

        const violations = mapAxeViolations(axeResults.violations);
        if (options.screenshotDir && violations.length > 0) {
          await captureScreenshots(page, url, violations, options.screenshotDir);
        }
        const counts = countByImpact(violations);

        return {
          url,
          success: true,
          violations,
          passCount: axeResults.passes.length,
          timestamp: new Date(),
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
        const contextOptions: Parameters<Browser['newContext']>[0] = {};

        if (options.storageState) {
          contextOptions.storageState = options.storageState;
        }

        const context = await browser.newContext(contextOptions);

        try {
          const result = await scanPage(url, context, options, throttle);
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
        } finally {
          await context.close();
        }
      },
      { concurrency: options.concurrency }
    );

    return results;
  } finally {
    await browser.close();
  }
}
