#!/usr/bin/env node

import { Command } from 'commander';
import { mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { parseCSV } from './parsers.js';
import { parseSitemap, isSitemapUrl, isUrl, normalizeSource, isSiteRoot } from './sitemap.js';
import { scanUrls } from './checker.js';
import { buildReportData, writeReports } from './reporters/index.js';
import type { ScanOptions, ScanResult, WaitUntilOption, WcagLevel, Device } from './types.js';
import { ALL_DEVICES } from './types.js';
import {
  EXIT_SUCCESS,
  EXIT_ERROR,
  EXIT_ISSUES_FOUND,
  generateOutputDir,
  formatTime,
  renderProgress,
  log,
  isTTY,
  VERSION,
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

function parseDevices(input: string): Device[] {
  const list = input.split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const mapped = list.map((d) => (d === 'phone' ? 'mobile' : d));
  const bad = mapped.filter((d) => !ALL_DEVICES.includes(d as Device));
  if (bad.length || mapped.length === 0) {
    throw new Error(`--devices must be desktop, mobile, or both (got "${input}")`);
  }
  return [...new Set(mapped)] as Device[];
}

// Lets the Ctrl+C / error handlers label partial reports with the run's settings.
const reportMetaRef: { current: { wcag?: WcagLevel; devices?: Device[] } } = { current: {} };

const program = new Command();

program
  .name('accessible-web-scanner')
  .description('Accessibility checker - pass a sitemap URL, CSV file, or a single URL')
  .version(VERSION)
  .argument('<source>', 'Sitemap URL or CSV file')
  .option('-c, --concurrency <number>', 'Concurrent pages', '3')
  .option('-q, --quiet', 'Suppress output, only exit code')
  .option('--json', 'Output JSON to stdout (implies --quiet for logs)')
  .option('--limit <number>', 'Limit URLs to scan')
  .option('--timeout <ms>', 'Page timeout in ms', '30000')
  .option('--wait-until <event>', 'load | domcontentloaded | networkidle', 'load')
  .option('--wait-for-selector <selector>', 'Wait for selector')
  .option('--post-load-delay <ms>', 'Delay after load', '0')
  .option('--retries <number>', 'Retries on failure', '2')
  .option('--wcag <level>', 'a | aa | aaa', 'aa')
  .option('--storage-state <file>', 'Auth state file')
  .option('--no-screenshots', 'Skip screenshots of failing elements in the HTML report')
  .option('--devices <list>', 'Screen sizes to test: desktop, mobile, or both', 'desktop,mobile')
  .action(async (source: string, options) => {
    const startTime = Date.now();
    const quiet = options.quiet || options.json;
    let outDir: string | null = null;
    let partialResults: ScanResult[] = [];

    // Handle Ctrl+C gracefully
    const saveAndExit = async () => {
      if (outDir && partialResults.length > 0 && !options.json) {
        log('\n\nInterrupted. Saving partial results...', quiet);
        const reportData = buildReportData(partialResults, reportMetaRef.current);
        await writeReports(join(outDir, 'report'), ['html', 'csv', 'json'], reportData);
        log(`Saved ${partialResults.length} results to ${outDir}/`, quiet);
      }
      process.exit(EXIT_ERROR);
    };

    process.on('SIGINT', saveAndExit);
    process.on('SIGTERM', saveAndExit);

    try {
      source = normalizeSource(source);
      let urls: string[];

      if (isSitemapUrl(source)) {
        const result = await parseSitemap(source);
        urls = result.urls;
      } else if (isUrl(source)) {
        const skipSitemapDiscovery =
          Boolean(process.env.SKIP_SITEMAP_DISCOVERY) || !isSiteRoot(source);
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

      log(`\n${urls.length} URLs${limited ? ' (limited)' : ''}\n`, quiet);

      if (urls.length === 0) {
        if (!quiet) console.error('No URLs found');
        process.exit(EXIT_ERROR);
      }

      // Skip file output in JSON mode
      if (!options.json) {
        outDir = generateOutputDir('a11y', source);
        await mkdir(outDir, { recursive: true });
      }

      const scanOptions: ScanOptions = {
        concurrency: parseInt(options.concurrency, 10),
        timeout: parseInt(options.timeout, 10),
        waitUntil: options.waitUntil as WaitUntilOption,
        waitForSelector: options.waitForSelector,
        postLoadDelay: parseInt(options.postLoadDelay, 10),
        retries: parseInt(options.retries, 10),
        wcag: options.wcag as WcagLevel,
        storageState: options.storageState,
        screenshotDir:
          outDir && options.screenshots ? resolve(outDir, 'screenshots') : undefined,
        devices: parseDevices(options.devices),
      };
      const reportMeta = { wcag: scanOptions.wcag, devices: scanOptions.devices };
      reportMetaRef.current = reportMeta;

      const scanStartTime = Date.now();
      let failedCount = 0;
      let blockedCount = 0;
      let lastSave = 0;

      const allResults = await scanUrls(urls, scanOptions, async (progress) => {
        if (!progress.success) failedCount++;
        blockedCount = progress.blockedCount;
        if (!progress.result.skipped) partialResults.push(progress.result);

        if (!quiet) {
          renderProgress(progress.current, progress.total, failedCount, scanStartTime);
        }

        // Save progress every 20 URLs (skip in JSON mode)
        if (outDir && progress.current - lastSave >= 20) {
          lastSave = progress.current;
          const tempData = buildReportData(partialResults, reportMetaRef.current);
          await writeReports(join(outDir, 'report'), ['csv'], tempData);
        }
      });

      // Clear progress line
      if (isTTY && !quiet) {
        process.stdout.write('\r' + ' '.repeat(80) + '\r');
      }

      const skipped = allResults.filter((r) => r.skipped);
      const results = allResults.filter((r) => !r.skipped);
      if (skipped.length > 0) {
        log(`\nSkipped ${skipped.length} URL(s) that aren't web pages: ${skipped.map((r) => `${r.url} (${r.skipped})`).join(', ')}`, quiet);
      }
      const reportData = buildReportData(results, reportMeta);

      // JSON output mode
      if (options.json) {
        console.log(JSON.stringify(reportData, null, 2));
        const hasIssues = reportData.totals.critical > 0 || reportData.totals.serious > 0;
        process.exit(hasIssues ? EXIT_ISSUES_FOUND : EXIT_SUCCESS);
      }

      // Normal output mode
      await writeReports(join(outDir!, 'report'), ['html', 'csv', 'json'], reportData);

      const elapsed = formatTime(Date.now() - startTime);
      const failed = reportData.failedScans > 0 ? ` (${reportData.failedScans} failed)` : '';

      log(`\nCompleted in ${elapsed}${failed}`, quiet);
      if (blockedCount > 0) {
        const stillBlocked = results.filter((r) => r.error?.startsWith('Blocked by')).length;
        log(
          `Site rate-limited the scanner ${blockedCount} time(s); backed off and retried.` +
            (stillBlocked > 0
              ? ` ${stillBlocked} page(s) stayed blocked and are marked failed — try a lower --concurrency.`
              : ''),
          quiet
        );
      }
      log(`Critical: ${reportData.totals.critical}  Serious: ${reportData.totals.serious}  Moderate: ${reportData.totals.moderate}  Minor: ${reportData.totals.minor}`, quiet);

      if (reportData.topIssues.length > 0 && !quiet) {
        log('\nTop issues:', quiet);
        reportData.topIssues.slice(0, 3).forEach((issue, i) => {
          log(`  ${issue.id} (${issue.affectedUrls.length} pages)`, quiet);
        });
      }

      log(`\n${outDir}/report.html\n`, quiet);

      // Exit with code 2 if critical or serious issues found
      const hasIssues = reportData.totals.critical > 0 || reportData.totals.serious > 0;
      process.exit(hasIssues ? EXIT_ISSUES_FOUND : EXIT_SUCCESS);

    } catch (error) {
      if (outDir && partialResults.length > 0) {
        log('\n\nError occurred. Saving partial results...', quiet);
        const reportData = buildReportData(partialResults, reportMetaRef.current);
        await writeReports(join(outDir, 'report'), ['html', 'csv', 'json'], reportData);
        log(`Saved ${partialResults.length} results to ${outDir}/`, quiet);
      }
      if (!quiet) console.error('\nError:', error instanceof Error ? error.message : error);
      process.exit(EXIT_ERROR);
    }
  });

program.parse();
