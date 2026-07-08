import { readFile } from 'fs/promises';
import { parse } from 'csv-parse/sync';

const URL_COLUMN_NAMES = ['url', 'link', 'href', 'address', 'page', 'website'];

export async function parseCSV(filePath: string): Promise<string[]> {
  const content = await readFile(filePath, 'utf-8');

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];

  if (records.length === 0) {
    throw new Error('CSV file is empty');
  }

  const firstRecord = records[0];
  const columns = Object.keys(firstRecord);

  const urlColumn = columns.find((col) =>
    URL_COLUMN_NAMES.includes(col.toLowerCase())
  );

  if (!urlColumn) {
    const urlPattern = /^https?:\/\//i;
    const columnWithUrls = columns.find((col) =>
      urlPattern.test(firstRecord[col])
    );

    if (columnWithUrls) {
      return extractUrls(records, columnWithUrls);
    }

    throw new Error(
      `Could not find URL column. Expected one of: ${URL_COLUMN_NAMES.join(', ')}. Found: ${columns.join(', ')}`
    );
  }

  return extractUrls(records, urlColumn);
}

function extractUrls(
  records: Record<string, string>[],
  column: string
): string[] {
  const urls: string[] = [];

  for (const record of records) {
    const url = record[column]?.trim();
    if (url) {
      try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          console.warn(`Skipping non-HTTP URL: ${url}`);
          continue;
        }
        urls.push(url);
      } catch {
        console.warn(`Skipping invalid URL: ${url}`);
      }
    }
  }

  if (urls.length === 0) {
    throw new Error('No valid URLs found in CSV');
  }

  return urls;
}
