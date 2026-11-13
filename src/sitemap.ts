import { existsSync } from 'fs';

const IGNORE_PATTERNS = [
  /\.(jpg|jpeg|png|gif|webp|svg|ico|bmp|tiff)$/i,
  /\.(css|js|woff|woff2|ttf|eot|otf)$/i,
  /\.(pdf|doc|docx|xls|xlsx|ppt|pptx)$/i,
  /\.(mp4|webm|mp3|wav|ogg|avi|mov)$/i,
  /\.(zip|tar|gz|rar|7z)$/i,
  /\/cdn[-.]?/i,
  /\/assets\//i,
  /\/static\//i,
  /\/images\//i,
  /\/media\//i,
  /cloudfront\.net/i,
  /cdn\./i,
  /\.cloudinary\.com/i,
  /\.imgix\.net/i,
];

function shouldIncludeUrl(url: string): boolean {
  return !IGNORE_PATTERNS.some((pattern) => pattern.test(url));
}

function extractUrls(xml: string): string[] {
  const urls: string[] = [];
  const urlMatches = xml.matchAll(/<url[^>]*>[\s\S]*?<loc[^>]*>([^<]+)<\/loc>[\s\S]*?<\/url>/gi);
  for (const match of urlMatches) {
    const url = match[1].trim();
    if (url) urls.push(url);
  }
  return urls;
}

function extractSitemapUrls(xml: string): string[] {
  const urls: string[] = [];
  const sitemapMatches = xml.matchAll(/<sitemap[^>]*>[\s\S]*?<loc[^>]*>([^<]+)<\/loc>[\s\S]*?<\/sitemap>/gi);
  for (const match of sitemapMatches) {
    const url = match[1].trim();
    if (url) urls.push(url);
  }
  return urls;
}

function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex/i.test(xml);
}

export function isSitemapUrl(input: string): boolean {
  try {
    const url = new URL(input);
    return (
      url.pathname.endsWith('.xml') ||
      url.pathname.includes('sitemap') ||
      url.searchParams.has('sitemap')
    );
  } catch {
    return false;
  }
}

export function isUrl(input: string): boolean {
  try {
    new URL(input);
    return true;
  } catch {
    return false;
  }
}

const FETCH_TIMEOUT_MS = 30000;

async function fetchWithRetry(url: string, retries = 2): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      const response = await fetch(url, {
        headers: {
          'User-Agent': 'a11y-check/1.0 (accessibility scanner)',
          Accept: 'application/xml, text/xml, */*',
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return await response.text();
    } catch (error) {
      if (attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Unreachable');
}

export interface SitemapResult {
  urls: string[];
}

export async function parseSitemap(sitemapUrl: string): Promise<SitemapResult> {
  const allUrls = new Set<string>();
  const visitedSitemaps = new Set<string>();

  async function processSitemap(url: string): Promise<void> {
    if (visitedSitemaps.has(url)) return;
    visitedSitemaps.add(url);

    const xml = await fetchWithRetry(url);

    if (isSitemapIndex(xml)) {
      const childSitemaps = extractSitemapUrls(xml);
      for (const childUrl of childSitemaps) {
        await processSitemap(childUrl);
      }
    } else {
      const pageUrls = extractUrls(xml);
      for (const pageUrl of pageUrls) {
        if (shouldIncludeUrl(pageUrl)) {
          allUrls.add(pageUrl);
        }
      }
    }
  }

  await processSitemap(sitemapUrl);

  return {
    urls: Array.from(allUrls).sort(),
  };
}

/**
 * Accept a bare domain like `example.com` or `example.com/pricing` by adding
 * https://. Local files (CSV) and full URLs are returned unchanged.
 */
export function normalizeSource(input: string): string {
  if (existsSync(input)) return input;
  if (/^https?:\/\//i.test(input)) return input;
  if (/^(localhost|[a-z0-9-]+(\.[a-z0-9-]+)+)(:\d+)?(\/\S*)?$/i.test(input)) {
    return `https://${input}`;
  }
  return input;
}

/**
 * A site root (`https://example.com` or `https://example.com/`) means "scan
 * the whole site" via its sitemap. Any deeper path means "scan this page".
 */
export function isSiteRoot(input: string): boolean {
  try {
    const url = new URL(input);
    return (url.pathname === '/' || url.pathname === '') && !url.search;
  } catch {
    return false;
  }
}
