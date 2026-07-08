import { writeFile } from 'fs/promises';
import { stringify } from 'csv-stringify/sync';
import type { LighthouseReportData } from '../lighthouse-types.js';
import { generateLighthouseHtml } from './lighthouse-html.js';

export async function writeLighthouseReports(
  basePath: string,
  data: LighthouseReportData
): Promise<void> {
  const html = generateLighthouseHtml(data);
  await writeFile(`${basePath}.html`, html);

  const csvRows = data.results.map((result) => ({
    url: result.url,
    success: result.success,
    error: result.error || '',
    performance: result.categories.performance?.score || 0,
    accessibility: result.categories.accessibility?.score || 0,
    best_practices: result.categories['best-practices']?.score || 0,
    seo: result.categories.seo?.score || 0,
    timestamp: result.timestamp instanceof Date ? result.timestamp.toISOString() : result.timestamp,
  }));

  const csv = stringify(csvRows, { header: true });
  await writeFile(`${basePath}.csv`, csv);
}
