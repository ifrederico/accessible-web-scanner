import { writeFile, readFile } from 'fs/promises';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { ReportData } from '../types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function writeHTML(
  filePath: string,
  data: ReportData
): Promise<void> {
  const templatePath = join(__dirname, '../templates/report.html');
  const template = await readFile(templatePath, 'utf-8');

  const jsonData = JSON.stringify(data).replace(/</g, '\\u003c');
  const dataScript = `<script type="application/json" id="report-data">${jsonData}</script>`;
  const html = template.replace('<!-- DATA_PLACEHOLDER -->', dataScript);

  await writeFile(filePath, html);
}
