export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_ISSUES_FOUND = 2;

export const isTTY = process.stdout.isTTY ?? false;

const BAR_FILLED = '\u2588';
const BAR_EMPTY = '\u2591';

export function formatSourceName(source: string): string {
  try {
    const url = new URL(source);
    return url.hostname.replace(/\./g, '-');
  } catch {
    return source.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9]/g, '-');
  }
}

export function formatTimestamp(now: Date = new Date()): string {
  const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const day = String(now.getDate()).padStart(2, '0');
  const month = months[now.getMonth()];
  const year = now.getFullYear();
  const hours = now.getHours();
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'pm' : 'am';
  const hour12 = String(hours % 12 || 12).padStart(2, '0');

  return `${day}${month}${year}-${hour12}${minutes}${ampm}`;
}

export function generateOutputDir(prefix: string, source: string, suffix?: string): string {
  const name = formatSourceName(source);
  const timestamp = formatTimestamp();
  const extra = suffix ? `_${suffix}` : '';
  return `${prefix}_${name}${extra}_${timestamp}`;
}

export function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(0)}s`;
  const mins = Math.floor(ms / 60000);
  const secs = Math.round((ms % 60000) / 1000);
  return `${mins}m ${secs}s`;
}

export function renderProgress(current: number, total: number, failed: number, startTime: number): void {
  if (!isTTY) return;

  const pct = Math.round((current / total) * 100);
  const barWidth = 30;
  const filled = Math.round((current / total) * barWidth);
  const bar = BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(barWidth - filled);

  const elapsed = Date.now() - startTime;
  const rate = current / (elapsed / 1000);
  const remaining = rate > 0 ? (total - current) / rate * 1000 : 0;

  const failedStr = failed > 0 ? ` (${failed} failed)` : '';
  const eta = current < total ? `  ETA ${formatTime(remaining)}` : '';

  process.stdout.write(`\r[${current}/${total}] ${bar} ${pct}%${failedStr}${eta}   `);
}

export function log(msg: string, quiet: boolean): void {
  if (!quiet) console.log(msg);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
