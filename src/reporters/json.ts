import { writeFile } from 'fs/promises';
import { ReportData } from '../types.js';

export async function writeJSON(
  filePath: string,
  data: ReportData
): Promise<void> {
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n');
}
