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

async function scanPage(
  url: string,
  context: BrowserContext,
  options: ScanOptions
): Promise<ScanResult> {
  const page = await context.newPage();

  try {
    for (let attempt = 0; attempt <= options.retries; attempt++) {
      try {
        await page.goto(url, {
          waitUntil: options.waitUntil,
          timeout: options.timeout,
        });

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
        if (attempt < options.retries) {
          const delay = 1000 * Math.pow(2, attempt);
          await sleep(delay);
          continue;
        }
        throw error;
      }
    }

    throw new Error('Unreachable');
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
          const result = await scanPage(url, context, options);
          completed++;

          if (onProgress) {
            await onProgress({
              current: completed,
              total: urls.length,
              url,
              success: result.success,
              result,
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
