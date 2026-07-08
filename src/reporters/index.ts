import {
  ScanResult,
  ReportData,
  ViolationSummary,
  OutputFormat,
} from '../types.js';
import { writeCSV } from './csv.js';
import { writeHTML } from './html.js';

export function buildReportData(results: ScanResult[]): ReportData {
  const successfulScans = results.filter((r) => r.success);
  const failedScans = results.filter((r) => !r.success);

  // Calculate totals
  const totals = {
    critical: results.reduce((sum, r) => sum + r.critical, 0),
    serious: results.reduce((sum, r) => sum + r.serious, 0),
    moderate: results.reduce((sum, r) => sum + r.moderate, 0),
    minor: results.reduce((sum, r) => sum + r.minor, 0),
  };

  // Build top issues (recurring across pages)
  const issueMap = new Map<string, ViolationSummary>();

  for (const result of results) {
    for (const violation of result.violations) {
      const existing = issueMap.get(violation.id);
      if (existing) {
        existing.count += violation.nodes.length;
        if (!existing.affectedUrls.includes(result.url)) {
          existing.affectedUrls.push(result.url);
        }
      } else {
        issueMap.set(violation.id, {
          id: violation.id,
          impact: violation.impact,
          description: violation.help,
          helpUrl: violation.helpUrl,
          count: violation.nodes.length,
          affectedUrls: [result.url],
        });
      }
    }
  }

  // Sort by affected pages count, then by total instances
  const topIssues = Array.from(issueMap.values()).sort((a, b) => {
    // First by impact severity
    const impactOrder = { critical: 0, serious: 1, moderate: 2, minor: 3 };
    const impactDiff = impactOrder[a.impact] - impactOrder[b.impact];
    if (impactDiff !== 0) return impactDiff;

    // Then by number of affected pages
    const pagesDiff = b.affectedUrls.length - a.affectedUrls.length;
    if (pagesDiff !== 0) return pagesDiff;

    // Then by total count
    return b.count - a.count;
  });

  // Worst pages (by critical + serious count)
  const worstPages = [...results]
    .filter((r) => r.success && (r.critical > 0 || r.serious > 0))
    .sort((a, b) => {
      const aSeverity = a.critical * 10 + a.serious;
      const bSeverity = b.critical * 10 + b.serious;
      return bSeverity - aSeverity;
    });

  return {
    generatedAt: new Date().toISOString(),
    totalUrls: results.length,
    successfulScans: successfulScans.length,
    failedScans: failedScans.length,
    totals,
    topIssues,
    worstPages,
    results,
  };
}

export async function writeReports(
  basename: string,
  formats: OutputFormat[],
  data: ReportData
): Promise<string[]> {
  const writtenFiles: string[] = [];

  for (const format of formats) {
    const filePath = `${basename}.${format}`;

    switch (format) {
      case 'csv':
        await writeCSV(filePath, data);
        break;
      case 'html':
        await writeHTML(filePath, data);
        break;
    }

    writtenFiles.push(filePath);
  }

  return writtenFiles;
}
