#!/usr/bin/env node

import { Command } from 'commander';
import { spawn, type StdioOptions } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { parseSitemap, isSitemapUrl, isUrl } from './sitemap.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

type RunResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function toStringValue(value: unknown): string {
  return typeof value === 'string' ? value : String(value);
}

async function runTool(
  label: string,
  args: string[],
  captureOutput: boolean,
  envOverrides?: NodeJS.ProcessEnv
): Promise<RunResult> {
  return new Promise((resolve) => {
    const stdio: StdioOptions = captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit';
    const child = spawn(process.execPath, args, {
      stdio,
      cwd: process.cwd(),
      env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
    });

    let stdout = '';
    let stderr = '';

    if (captureOutput && child.stdout) {
      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (captureOutput && child.stderr) {
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on('error', (error) => {
      const message = error instanceof Error ? error.message : String(error);
      if (captureOutput) {
        stderr += message;
      } else {
        process.stderr.write(`${label} failed to start: ${message}\n`);
      }
      resolve({ code: 1, stdout, stderr });
    });

    child.on('close', (code) => {
      resolve({ code: code ?? 0, stdout, stderr });
    });
  });
}

async function resolveSource(source: string): Promise<{ source: string; skipDiscovery: boolean }> {
  if (!isUrl(source) || isSitemapUrl(source)) {
    return { source, skipDiscovery: false };
  }

  const sitemapUrl = new URL('/sitemap.xml', source).toString();

  try {
    const result = await parseSitemap(sitemapUrl);
    if (result.urls.length > 0) {
      return { source: sitemapUrl, skipDiscovery: true };
    }
  } catch {
    // Fall back to the provided URL.
  }

  return { source, skipDiscovery: true };
}

function parseJson(label: string, stdout: string, stderr: string, errors: string[]): unknown | null {
  const trimmed = stdout.trim();
  if (!trimmed) {
    const detail = stderr.trim();
    errors.push(`${label} produced no JSON output${detail ? `: ${detail}` : ''}`);
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`${label} JSON parse failed: ${message}`);
    return null;
  }
}

const program = new Command();

program
  .name('all')
  .description('Run a11y and lighthouse scans for the same source')
  .version('1.0.0')
  .argument('<source>', 'Sitemap URL, CSV file, or a single URL')
  .option('-q, --quiet', 'Suppress output, only exit code')
  .option('--json', 'Output combined JSON to stdout')
  .option('--limit <number>', 'Limit URLs to scan')
  .option('--timeout <ms>', 'Page timeout in ms (a11y default 30000, lighthouse default 60000)')
  .option('--retries <number>', 'Retries on failure (a11y default 2, lighthouse default 1)')
  .option('-c, --concurrency <number>', 'Concurrent pages (a11y only)')
  .option('--wait-until <event>', 'load | domcontentloaded | networkidle (a11y only)')
  .option('--wait-for-selector <selector>', 'Wait for selector (a11y only)')
  .option('--post-load-delay <ms>', 'Delay after load (a11y only)')
  .option('--wcag <level>', 'a | aa | aaa (a11y only)')
  .option('--storage-state <file>', 'Auth state file (a11y only)')
  .option('--form-factor <type>', 'mobile | desktop (lighthouse only)')
  .action(async (source: string, options) => {
    const captureOutput = Boolean(options.json);

    const resolved = await resolveSource(source);
    const envOverrides = resolved.skipDiscovery ? { SKIP_SITEMAP_DISCOVERY: '1' } : undefined;

    const sharedArgs: string[] = [];
    if (options.quiet) sharedArgs.push('--quiet');
    if (options.json) sharedArgs.push('--json');
    if (options.limit) sharedArgs.push('--limit', toStringValue(options.limit));
    if (options.timeout) sharedArgs.push('--timeout', toStringValue(options.timeout));
    if (options.retries) sharedArgs.push('--retries', toStringValue(options.retries));

    const a11yArgs = [join(__dirname, 'index.js'), resolved.source, ...sharedArgs];
    if (options.concurrency) a11yArgs.push('--concurrency', toStringValue(options.concurrency));
    if (options.waitUntil) a11yArgs.push('--wait-until', toStringValue(options.waitUntil));
    if (options.waitForSelector) a11yArgs.push('--wait-for-selector', toStringValue(options.waitForSelector));
    if (options.postLoadDelay) a11yArgs.push('--post-load-delay', toStringValue(options.postLoadDelay));
    if (options.wcag) a11yArgs.push('--wcag', toStringValue(options.wcag));
    if (options.storageState) a11yArgs.push('--storage-state', toStringValue(options.storageState));

    const lighthouseArgs = [join(__dirname, 'lighthouse.js'), resolved.source, ...sharedArgs];
    if (options.formFactor) lighthouseArgs.push('--form-factor', toStringValue(options.formFactor));

    const a11yResult = await runTool('a11y', a11yArgs, captureOutput, envOverrides);
    const lighthouseResult = await runTool('lighthouse', lighthouseArgs, captureOutput, envOverrides);

    if (captureOutput) {
      const errors: string[] = [];
      const output = {
        a11y: parseJson('a11y', a11yResult.stdout, a11yResult.stderr, errors),
        lighthouse: parseJson('lighthouse', lighthouseResult.stdout, lighthouseResult.stderr, errors),
        exitCodes: {
          a11y: a11yResult.code,
          lighthouse: lighthouseResult.code,
        },
        ...(errors.length > 0 ? { errors } : {}),
      };

      process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
    }

    const codes = [a11yResult.code, lighthouseResult.code];
    if (codes.includes(1)) process.exit(1);
    if (codes.includes(2)) process.exit(2);
    process.exit(0);
  });

program.parse();
