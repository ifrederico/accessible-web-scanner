import { chromium, Browser, BrowserContext, Page } from 'playwright';
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
  const browser = await chromium.launch({
    headless: true,
  });

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
