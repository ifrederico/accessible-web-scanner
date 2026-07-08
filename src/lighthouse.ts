#!/usr/bin/env node

import { Command } from 'commander';
import { mkdir } from 'fs/promises';
import { join } from 'path';
import { parseCSV } from './parsers.js';
import { parseSitemap, isSitemapUrl, isUrl } from './sitemap.js';
import { scanUrls } from './lighthouse-checker.js';
import { buildLighthouseReportData, type FormFactor, type LighthouseScanResult } from './lighthouse-types.js';
import { writeLighthouseReports } from './reporters/lighthouse.js';
import {
  EXIT_SUCCESS,
  EXIT_ERROR,
  EXIT_ISSUES_FOUND,
  generateOutputDir,
  formatTime,
  renderProgress,
  log,
  isTTY,
} from './utils.js';

async function tryLoadSitemapUrls(siteUrl: string, quiet: boolean): Promise<string[] | null> {
  const sitemapUrl = new URL('/sitemap.xml', siteUrl).toString();

  try {
    const result = await parseSitemap(sitemapUrl);
    if (result.urls.length > 0) {
      log(`Sitemap detected: ${sitemapUrl}`, quiet);
      return result.urls;
    }
  } catch {
    // Fall back to scanning the provided URL directly.
  }

  return null;
}

function getScoreColor(score: number): string {
  if (score >= 90) return '\x1b[32m'; // Green
  if (score >= 50) return '\x1b[33m'; // Yellow
  return '\x1b[31m'; // Red
}

const RESET = '\x1b[0m';

const program = new Command();

program
  .name('lighthouse')
  .description('Lighthouse performance & quality checker - pass a sitemap URL or CSV file')
  .version('1.0.0')
  .argument('<source>', 'Sitemap URL or CSV file')
  .option('-q, --quiet', 'Suppress output, only exit code')
  .option('--json', 'Output JSON to stdout (implies --quiet for logs)')
  .option('--limit <number>', 'Limit URLs to scan')
  .option('--timeout <ms>', 'Page timeout in ms', '60000')
  .option('--retries <number>', 'Retries on failure', '1')
  .option('--form-factor <type>', 'mobile | desktop', 'desktop')
  .action(async (source: string, options) => {
    const startTime = Date.now();
    const quiet = options.quiet || options.json;
    let outDir: string | null = null;
    let partialResults: LighthouseScanResult[] = [];
    const formFactor = options.formFactor as FormFactor;

    // Handle Ctrl+C gracefully
    const saveAndExit = async () => {
      if (outDir && partialResults.length > 0 && !options.json) {
        log('\n\nInterrupted. Saving partial results...', quiet);
        const reportData = buildLighthouseReportData(partialResults);
        await writeLighthouseReports(join(outDir, 'report'), reportData);
        log(`Saved ${partialResults.length} results to ${outDir}/`, quiet);
      }
      process.exit(EXIT_ERROR);
    };

    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

    try {
      let urls: string[];

      if (isSitemapUrl(source)) {
        const result = await parseSitemap(source);
        urls = result.urls;
      } else if (isUrl(source)) {
        const skipSitemapDiscovery = Boolean(process.env.SKIP_SITEMAP_DISCOVERY);
        const sitemapUrls = skipSitemapDiscovery ? null : await tryLoadSitemapUrls(source, quiet);
        // Single URL provided (unless a sitemap.xml is detected).
        urls = sitemapUrls ?? [source];
      } else {
        urls = await parseCSV(source);
      }

      let limited = false;
      if (options.limit) {
        const limit = parseInt(options.limit, 10);
        if (urls.length > limit) {
          urls = urls.slice(0, limit);
          limited = true;
        }
      }

      log(`\nLighthouse scan (${formFactor})`, quiet);
      log(`${urls.length} URLs${limited ? ' (limited)' : ''}\n`, quiet);

      if (urls.length === 0) {
        if (!quiet) console.error('No URLs found');
        process.exit(EXIT_ERROR);
      }

      // Skip file output in JSON mode
      if (!options.json) {
        outDir = generateOutputDir('lighthouse', source, formFactor);
        await mkdir(outDir, { recursive: true });
      }

      const scanOptions = {
        formFactor,
        timeout: parseInt(options.timeout, 10),
        retries: parseInt(options.retries, 10),
      };

      const scanStartTime = Date.now();
      let failedCount = 0;
      let lastSave = 0;

      const results = await scanUrls(urls, scanOptions, async (progress) => {
        if (!progress.success) failedCount++;
        partialResults.push(progress.result);

        if (!quiet) {
          renderProgress(progress.current, progress.total, failedCount, scanStartTime);
        }

        // Save progress every 10 URLs (skip in JSON mode)
        if (outDir && progress.current - lastSave >= 10) {
          lastSave = progress.current;
          const tempData = buildLighthouseReportData(partialResults);
          await writeLighthouseReports(join(outDir, 'report'), tempData);
        }
      });

      // Clear progress line
      if (isTTY && !quiet) {
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
      }

      const reportData = buildLighthouseReportData(results);

      // JSON output mode
      if (options.json) {
        console.log(JSON.stringify(reportData, null, 2));
        const hasIssues = reportData.averages.performance < 50 || reportData.averages.accessibility < 50;
        process.exit(hasIssues ? EXIT_ISSUES_FOUND : EXIT_SUCCESS);
      }

      // Normal output mode
      await writeLighthouseReports(join(outDir!, 'report'), reportData);

      const elapsed = formatTime(Date.now() - startTime);
      const failed = reportData.failedScans > 0 ? ` (${reportData.failedScans} failed)` : '';

      log(`\nCompleted in ${elapsed}${failed}`, quiet);
      log(`\nAverage Scores:`, quiet);
      log(`  ${getScoreColor(reportData.averages.performance)}Performance: ${reportData.averages.performance}${RESET}`, quiet);
      log(`  ${getScoreColor(reportData.averages.accessibility)}Accessibility: ${reportData.averages.accessibility}${RESET}`, quiet);
      log(`  ${getScoreColor(reportData.averages.bestPractices)}Best Practices: ${reportData.averages.bestPractices}${RESET}`, quiet);
      log(`  ${getScoreColor(reportData.averages.seo)}SEO: ${reportData.averages.seo}${RESET}`, quiet);

      log(`\n${outDir}/report.html\n`, quiet);

      // Exit with code 2 if performance or accessibility is poor
      const hasIssues = reportData.averages.performance < 50 || reportData.averages.accessibility < 50;
      process.exit(hasIssues ? EXIT_ISSUES_FOUND : EXIT_SUCCESS);

    } catch (error) {
      if (outDir && partialResults.length > 0) {
        log('\n\nError occurred. Saving partial results...', quiet);
        const reportData = buildLighthouseReportData(partialResults);
        await writeLighthouseReports(join(outDir, 'report'), reportData);
        log(`Saved ${partialResults.length} results to ${outDir}/`, quiet);
      }
      if (!quiet) console.error('\nError:', error instanceof Error ? error.message : error);
      process.exit(EXIT_ERROR);
    }
  });

program.parse();
