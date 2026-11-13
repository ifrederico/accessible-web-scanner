import type { Result as AxeResult } from 'axe-core';

export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export type WaitUntilOption = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export type WcagLevel = 'a' | 'aa' | 'aaa';

export type Device = 'desktop' | 'mobile';
export const ALL_DEVICES: Device[] = ['desktop', 'mobile'];

export type OutputFormat = 'html' | 'csv' | 'json';

export interface ScanOptions {
  concurrency: number;
  timeout: number;
  waitUntil: WaitUntilOption;
  waitForSelector?: string;
  postLoadDelay: number;
  retries: number;
  wcag: WcagLevel;
  storageState?: string;
  /** Absolute directory for element screenshots; omitted = no screenshots. */
  screenshotDir?: string;
  /** Screen sizes to test each page at. */
  devices: Device[];
}

export interface ViolationInstance {
  html: string;
  target: string[];
  failureSummary?: string;
  /** Screen sizes this element failed on. */
  devices?: Device[];
  /** Screenshot of this element per device, relative to the report. */
  screenshots?: Partial<Record<Device, string>>;
}

export interface Violation {
  id: string;
  impact: Impact;
  description: string;
  help: string;
  helpUrl: string;
  nodes: ViolationInstance[];
}

export interface ScanResult {
  url: string;
  success: boolean;
  error?: string;
  violations: Violation[];
  passCount: number;
  timestamp: Date;
  // Severity counts (primary metrics)
  critical: number;
  serious: number;
  moderate: number;
  minor: number;
  // Optional heuristic score
  score?: number;
  /** Screen sizes this page was tested at. */
  devices?: Device[];
  /** Screenshot of the top of the page (phone size when tested), relative to the report. */
  thumbnail?: string;
  /** Set when the URL isn't a web page (e.g. a text or PDF file), so it wasn't checked. */
  skipped?: string;
}

export interface ViolationSummary {
  id: string;
  impact: Impact;
  description: string;
  helpUrl: string;
  count: number;
  affectedUrls: string[];
}

export interface ReportData {
  generatedAt: string;
  wcag?: WcagLevel;
  devices?: Device[];
  totalUrls: number;
  successfulScans: number;
  failedScans: number;
  totals: {
    critical: number;
    serious: number;
    moderate: number;
    minor: number;
  };
  topIssues: ViolationSummary[];
  worstPages: ScanResult[];
  results: ScanResult[];
}

export function mapAxeViolations(violations: AxeResult[]): Violation[] {
  return violations.map((v) => ({
    id: v.id,
    impact: (v.impact || 'moderate') as Impact,
    description: v.description,
    help: v.help,
    helpUrl: v.helpUrl,
    nodes: v.nodes.map((n) => ({
      html: n.html,
      target: n.target as string[],
      failureSummary: n.failureSummary,
    })),
  }));
}

export function countByImpact(violations: Violation[]): Record<Impact, number> {
  const counts: Record<Impact, number> = {
    critical: 0,
    serious: 0,
    moderate: 0,
    minor: 0,
  };

  for (const v of violations) {
    counts[v.impact] += v.nodes.length;
  }

  return counts;
}

export function getWcagTags(level: WcagLevel): string[] {
  const tags = ['wcag2a', 'wcag21a', 'best-practice'];
  if (level === 'aa' || level === 'aaa') {
    tags.push('wcag2aa', 'wcag21aa', 'wcag22aa');
  }
  if (level === 'aaa') {
    tags.push('wcag2aaa', 'wcag21aaa');
  }
  return tags;
}

/** Merge per-device results for one URL. An element failing on several devices counts once. */
export function mergeDeviceResults(
  url: string,
  perDevice: { device: Device; result: ScanResult }[]
): ScanResult {
  const skipped = perDevice.find((d) => d.result.skipped)?.result.skipped;
  if (skipped) {
    return { url, success: true, skipped, violations: [], passCount: 0, timestamp: new Date(), critical: 0, serious: 0, moderate: 0, minor: 0 };
  }
  const ok = perDevice.filter((d) => d.result.success);
  const failed = perDevice.filter((d) => !d.result.success);
  const byRule = new Map<string, Violation>();

  for (const { device, result } of ok) {
    for (const v of result.violations) {
      let merged = byRule.get(v.id);
      if (!merged) {
        merged = { ...v, nodes: [] };
        byRule.set(v.id, merged);
      }
      for (const node of v.nodes) {
        const key = node.target.join(' >>> ');
        // Same selector, or (inside iframes, where selectors can differ by
        // screen size) the same HTML not yet seen on this device.
        let existing =
          merged.nodes.find((n) => n.target.join(' >>> ') === key) ??
          merged.nodes.find((n) => n.html === node.html && !n.devices!.includes(device));
        if (!existing) {
          existing = { html: node.html, target: node.target, failureSummary: node.failureSummary, devices: [], screenshots: {} };
          merged.nodes.push(existing);
        }
        existing.devices!.push(device);
        const shot = node.screenshots?.[device];
        if (shot) existing.screenshots![device] = shot;
      }
    }
  }

  const violations = [...byRule.values()];
  const thumbnail =
    ok.find((d) => d.device === 'mobile')?.result.thumbnail ?? ok[0]?.result.thumbnail;
  const error = failed.length
    ? failed.map((d) => `${d.device === 'mobile' ? 'Phone' : 'Desktop'}: ${d.result.error}`).join('; ')
    : undefined;

  return {
    url,
    success: ok.length > 0,
    error,
    violations,
    passCount: Math.max(0, ...ok.map((d) => d.result.passCount)),
    timestamp: new Date(),
    devices: ok.map((d) => d.device),
    thumbnail,
    ...countByImpact(violations),
  };
}
