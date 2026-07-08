import type { Result as AxeResult } from 'axe-core';

export type Impact = 'critical' | 'serious' | 'moderate' | 'minor';

export type WaitUntilOption = 'load' | 'domcontentloaded' | 'networkidle' | 'commit';

export type WcagLevel = 'a' | 'aa' | 'aaa';

export type OutputFormat = 'html' | 'csv';

export interface ScanOptions {
  concurrency: number;
  timeout: number;
  waitUntil: WaitUntilOption;
  waitForSelector?: string;
  postLoadDelay: number;
  retries: number;
  wcag: WcagLevel;
  storageState?: string;
}

export interface ViolationInstance {
  html: string;
  target: string[];
  failureSummary?: string;
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
