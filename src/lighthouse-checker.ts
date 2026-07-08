import lighthouse, { Flags, Result as LighthouseResult } from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';
import type { LighthouseScanOptions, LighthouseScanResult, LighthouseCategory } from './lighthouse-types.js';
import { sleep } from './utils.js';

async function scanPage(
  url: string,
  chrome: chromeLauncher.LaunchedChrome,
  options: LighthouseScanOptions
): Promise<LighthouseScanResult> {
  const timestamp = new Date();

  try {
    const flags: Flags = {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
      formFactor: options.formFactor,
      screenEmulation: options.formFactor === 'mobile'
        ? { mobile: true, width: 375, height: 667, deviceScaleFactor: 2, disabled: false }
        : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
      throttlingMethod: 'simulate',
    };

    const result = await lighthouse(url, flags);

    if (!result || !result.lhr) {
      return {
        url,
        success: false,
        error: 'Lighthouse returned no result',
        timestamp,
        formFactor: options.formFactor,
        categories: {
          performance: { score: 0, title: 'Performance' },
          accessibility: { score: 0, title: 'Accessibility' },
          'best-practices': { score: 0, title: 'Best Practices' },
          seo: { score: 0, title: 'SEO' },
        },
        audits: [],
      };
    }

    const lhr = result.lhr;

    const categories: Record<string, LighthouseCategory> = {};
    for (const [key, cat] of Object.entries(lhr.categories)) {
      categories[key] = {
        score: Math.round((cat.score || 0) * 100),
        title: cat.title,
      };
    }

    // Extract failed audits
    const audits = Object.entries(lhr.audits)
      .filter(([_, audit]) => audit.score !== null && audit.score < 1)
      .map(([id, audit]) => ({
        id,
        title: audit.title,
        description: audit.description || '',
        score: Math.round((audit.score || 0) * 100),
        displayValue: audit.displayValue || '',
        category: findAuditCategory(id, lhr.categories),
      }))
      .sort((a, b) => a.score - b.score);

    return {
      url,
      success: true,
      timestamp,
      formFactor: options.formFactor,
      categories,
      audits,
      finalUrl: lhr.finalDisplayedUrl,
      fetchTime: lhr.fetchTime,
      runWarnings: lhr.runWarnings || [],
    };
  } catch (error) {
    return {
      url,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp,
      formFactor: options.formFactor,
      categories: {
        performance: { score: 0, title: 'Performance' },
        accessibility: { score: 0, title: 'Accessibility' },
        'best-practices': { score: 0, title: 'Best Practices' },
        seo: { score: 0, title: 'SEO' },
      },
      audits: [],
    };
  }
}

function findAuditCategory(auditId: string, categories: LighthouseResult['categories']): string {
  for (const [catId, cat] of Object.entries(categories)) {
    if (cat.auditRefs?.some(ref => ref.id === auditId)) {
      return catId;
    }
  }
  return 'other';
}

export interface ScanProgress {
  current: number;
  total: number;
  url: string;
  success: boolean;
  result: LighthouseScanResult;
}

export async function scanUrls(
  urls: string[],
  options: LighthouseScanOptions,
  onProgress?: (progress: ScanProgress) => Promise<void>
): Promise<LighthouseScanResult[]> {
  const results: LighthouseScanResult[] = [];

  // Launch Chrome once for all scans
  const chrome = await chromeLauncher.launch({
    chromeFlags: ['--headless', '--disable-gpu', '--no-sandbox'],
  });

  try {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      let result: LighthouseScanResult | null = null;
      let lastError: string | undefined;

      // Retry logic
      for (let attempt = 0; attempt <= options.retries; attempt++) {
        if (attempt > 0) {
          await sleep(1000 * attempt); // Backoff
        }

        result = await scanPage(url, chrome, options);

        if (result.success) {
          break;
        }
        lastError = result.error;
      }

      if (!result) {
        result = {
          url,
          success: false,
          error: lastError || 'Unknown error',
          timestamp: new Date(),
          formFactor: options.formFactor,
          categories: {
            performance: { score: 0, title: 'Performance' },
            accessibility: { score: 0, title: 'Accessibility' },
            'best-practices': { score: 0, title: 'Best Practices' },
            seo: { score: 0, title: 'SEO' },
          },
          audits: [],
        };
      }

      results.push(result);

      if (onProgress) {
        await onProgress({
          current: i + 1,
          total: urls.length,
          url,
          success: result.success,
          result,
        });
      }

      // Small delay between scans to be nice to the server
      if (i < urls.length - 1) {
        await sleep(500);
      }
    }
  } finally {
    await chrome.kill();
  }

  return results;
}
