export type FormFactor = 'mobile' | 'desktop';

export interface LighthouseCategory {
  score: number;
  title: string;
}

export interface LighthouseAudit {
  id: string;
  title: string;
  description: string;
  score: number;
  displayValue: string;
  category: string;
}

export interface LighthouseScanOptions {
  formFactor: FormFactor;
  timeout: number;
  retries: number;
}

export interface LighthouseScanResult {
  url: string;
  success: boolean;
  error?: string;
  timestamp: Date;
  formFactor: FormFactor;
  categories: Record<string, LighthouseCategory>;
  audits: LighthouseAudit[];
  finalUrl?: string;
  fetchTime?: string;
  runWarnings?: string[];
}

export interface LighthouseReportData {
  generatedAt: string;
  formFactor: FormFactor;
  totalUrls: number;
  successfulScans: number;
  failedScans: number;
  averages: {
    performance: number;
    accessibility: number;
    bestPractices: number;
    seo: number;
  };
  worstPages: {
    performance: LighthouseScanResult[];
    accessibility: LighthouseScanResult[];
    bestPractices: LighthouseScanResult[];
    seo: LighthouseScanResult[];
  };
  commonIssues: {
    id: string;
    title: string;
    category: string;
    count: number;
    avgScore: number;
  }[];
  results: LighthouseScanResult[];
}

export function buildLighthouseReportData(results: LighthouseScanResult[]): LighthouseReportData {
  const successful = results.filter(r => r.success);
  const formFactor = results[0]?.formFactor || 'desktop';

  // Calculate averages
  const avgPerf = successful.length > 0
    ? Math.round(successful.reduce((sum, r) => sum + (r.categories.performance?.score || 0), 0) / successful.length)
    : 0;
  const avgA11y = successful.length > 0
    ? Math.round(successful.reduce((sum, r) => sum + (r.categories.accessibility?.score || 0), 0) / successful.length)
    : 0;
  const avgBp = successful.length > 0
    ? Math.round(successful.reduce((sum, r) => sum + (r.categories['best-practices']?.score || 0), 0) / successful.length)
    : 0;
  const avgSeo = successful.length > 0
    ? Math.round(successful.reduce((sum, r) => sum + (r.categories.seo?.score || 0), 0) / successful.length)
    : 0;

  // Find worst pages for each category
  const sortedByPerf = [...successful].sort((a, b) =>
    (a.categories.performance?.score || 0) - (b.categories.performance?.score || 0)
  );
  const sortedByA11y = [...successful].sort((a, b) =>
    (a.categories.accessibility?.score || 0) - (b.categories.accessibility?.score || 0)
  );
  const sortedByBp = [...successful].sort((a, b) =>
    (a.categories['best-practices']?.score || 0) - (b.categories['best-practices']?.score || 0)
  );
  const sortedBySeo = [...successful].sort((a, b) =>
    (a.categories.seo?.score || 0) - (b.categories.seo?.score || 0)
  );

  // Aggregate common issues
  const issueMap = new Map<string, { title: string; category: string; scores: number[] }>();
  for (const result of successful) {
    for (const audit of result.audits) {
      const existing = issueMap.get(audit.id);
      if (existing) {
        existing.scores.push(audit.score);
      } else {
        issueMap.set(audit.id, {
          title: audit.title,
          category: audit.category,
          scores: [audit.score],
        });
      }
    }
  }

  const commonIssues = Array.from(issueMap.entries())
    .map(([id, data]) => ({
      id,
      title: data.title,
      category: data.category,
      count: data.scores.length,
      avgScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 20);

  return {
    generatedAt: new Date().toISOString(),
    formFactor,
    totalUrls: results.length,
    successfulScans: successful.length,
    failedScans: results.length - successful.length,
    averages: {
      performance: avgPerf,
      accessibility: avgA11y,
      bestPractices: avgBp,
      seo: avgSeo,
    },
    worstPages: {
      performance: sortedByPerf.slice(0, 5),
      accessibility: sortedByA11y.slice(0, 5),
      bestPractices: sortedByBp.slice(0, 5),
      seo: sortedBySeo.slice(0, 5),
    },
    commonIssues,
    results,
  };
}
