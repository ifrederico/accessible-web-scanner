import { writeFile } from 'fs/promises';
import { stringify } from 'csv-stringify/sync';
import { ReportData } from '../types.js';

interface CsvRow {
  url: string;
  status: string;
  error: string;
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  total_violations: number;
  passes: number;
  timestamp: string;
  top_issues: string;
}

export async function writeCSV(
  filePath: string,
  data: ReportData
): Promise<void> {
  const rows: CsvRow[] = data.results.map((result) => {
    const totalViolations =
      result.critical + result.serious + result.moderate + result.minor;

    // Get top 3 issues for this page
    const topIssues = result.violations
      .slice(0, 3)
      .map((v) => `${v.id} (${v.nodes.length})`)
      .join('; ');

    return {
      url: result.url,
      status: result.success ? 'success' : 'error',
      error: result.error || '',
      critical: result.critical,
      serious: result.serious,
      moderate: result.moderate,
      minor: result.minor,
      total_violations: totalViolations,
      passes: result.passCount,
      timestamp: result.timestamp.toISOString(),
      top_issues: topIssues,
    };
  });

  const csv = stringify(rows, {
    header: true,
    columns: [
      'url',
      'status',
      'error',
      'critical',
      'serious',
      'moderate',
      'minor',
      'total_violations',
      'passes',
      'timestamp',
      'top_issues',
    ],
  });

  await writeFile(filePath, csv);
}
