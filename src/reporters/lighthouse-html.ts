import type { LighthouseReportData } from '../lighthouse-types.js';

export function generateLighthouseHtml(data: LighthouseReportData): string {
  const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Lighthouse Report</title>
  <style>
    :root {
      --good: #0cce6b;
      --average: #ffa400;
      --poor: #ff4e42;
      --bg: #f8fafc;
      --card-bg: #ffffff;
      --text: #1e293b;
      --text-muted: #64748b;
      --border: #e2e8f0;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
      padding: 2rem;
    }

    .container { max-width: 1400px; margin: 0 auto; }

    header { margin-bottom: 2rem; }

    h1 { font-size: 1.75rem; font-weight: 600; }
    .generated { color: var(--text-muted); font-size: 0.875rem; margin-top: 0.25rem; }
    .form-factor {
      display: inline-block;
      background: #e2e8f0;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      text-transform: uppercase;
      margin-left: 0.5rem;
    }

    .score-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .score-card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      padding: 1.5rem;
      text-align: center;
    }

    .score-ring {
      width: 80px;
      height: 80px;
      margin: 0 auto 0.75rem;
      position: relative;
    }

    .score-ring svg {
      transform: rotate(-90deg);
    }

    .score-ring circle {
      fill: none;
      stroke-width: 8;
    }

    .score-ring .bg { stroke: #e2e8f0; }
    .score-ring .progress { stroke-linecap: round; }

    .score-value {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 1.5rem;
      font-weight: 700;
    }

    .score-label {
      font-size: 0.875rem;
      font-weight: 600;
    }

    .score-good { color: var(--good); }
    .score-average { color: var(--average); }
    .score-poor { color: var(--poor); }

    .section {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: 0.5rem;
      margin-bottom: 1.5rem;
    }

    .section-header {
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border);
      font-weight: 600;
    }

    .section-content { padding: 0; }

    .controls {
      display: flex;
      gap: 1rem;
      padding: 1rem 1.25rem;
      border-bottom: 1px solid var(--border);
      flex-wrap: wrap;
    }

    .search-input {
      flex: 1;
      min-width: 200px;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 0.375rem;
      font-size: 0.875rem;
    }

    .filter-select {
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 0.375rem;
      font-size: 0.875rem;
      background: var(--card-bg);
    }

    table { width: 100%; border-collapse: collapse; }

    th, td {
      padding: 0.75rem 1.25rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    th {
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 600;
      cursor: pointer;
    }

    th:hover { background: var(--bg); }

    .url-cell {
      font-family: monospace;
      font-size: 0.875rem;
      word-break: break-all;
    }

    .status-error { color: var(--poor); font-size: 0.75rem; }

    .empty-state {
      text-align: center;
      padding: 2rem;
      color: var(--text-muted);
    }

    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }

    .page-row { cursor: pointer; }
    .page-row:hover { background: var(--bg); }

    .page-chevron {
      color: var(--text-muted);
      font-size: 0.75rem;
      display: inline-block;
      transition: transform 0.15s;
    }

    .page-row.open .page-chevron { transform: rotate(90deg); }

    .page-details {
      display: none;
      background: var(--bg);
    }

    .page-details.open { display: table-row; }

    .page-details td { padding: 1rem 1.25rem; }

    .issue-item {
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
      font-size: 0.875rem;
    }

    .issue-item:last-child { border-bottom: none; }

    .issue-title { font-weight: 500; }
    .issue-score {
      display: inline-block;
      padding: 0.125rem 0.375rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      font-weight: 600;
      margin-left: 0.5rem;
    }

    .issue-category {
      font-size: 0.75rem;
      color: var(--text-muted);
      text-transform: uppercase;
    }

    .common-issues-list {
      padding: 1rem 1.25rem;
    }

    .common-issue {
      display: flex;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
      gap: 1rem;
    }

    .common-issue:last-child { border-bottom: none; }

    .common-issue-title { flex: 1; font-size: 0.875rem; }
    .common-issue-count {
      font-size: 0.75rem;
      color: var(--text-muted);
    }
    .common-issue-category {
      font-size: 0.625rem;
      padding: 0.125rem 0.375rem;
      background: #e2e8f0;
      border-radius: 0.25rem;
      text-transform: uppercase;
    }

    .worst-pages {
      padding: 1rem 1.25rem;
    }

    .worst-page {
      display: flex;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid var(--border);
      gap: 1rem;
    }

    .worst-page:last-child { border-bottom: none; }

    .worst-page-url {
      flex: 1;
      font-family: monospace;
      font-size: 0.875rem;
      word-break: break-all;
    }

    .worst-page-score {
      font-weight: 700;
      font-size: 1.25rem;
    }

    .tabs {
      display: flex;
      border-bottom: 1px solid var(--border);
    }

    .tab {
      padding: 0.75rem 1.25rem;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      font-size: 0.875rem;
      color: var(--text-muted);
    }

    .tab:hover { color: var(--text); }

    .tab.active {
      border-bottom-color: #2563eb;
      color: var(--text);
      font-weight: 500;
    }

    .tab-content { display: none; }
    .tab-content.active { display: block; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Lighthouse Report <span class="form-factor" id="form-factor"></span></h1>
      <p class="generated" id="generated-at"></p>
    </header>

    <div class="score-grid" id="score-grid"></div>

    <div class="section">
      <div class="section-header">Worst Pages by Category</div>
      <div class="tabs" id="worst-tabs"></div>
      <div id="worst-content"></div>
    </div>

    <div class="section">
      <div class="section-header">Common Issues</div>
      <div class="common-issues-list" id="common-issues"></div>
    </div>

    <div class="section">
      <div class="section-header">All Pages</div>
      <div class="section-content">
        <div class="controls">
          <input type="text" class="search-input" id="search" placeholder="Search URLs...">
          <select class="filter-select" id="filter">
            <option value="all">All</option>
            <option value="poor-perf">Poor Performance (&lt;50)</option>
            <option value="poor-a11y">Poor Accessibility (&lt;50)</option>
            <option value="poor-bp">Poor Best Practices (&lt;50)</option>
            <option value="poor-seo">Poor SEO (&lt;50)</option>
            <option value="errors">Errors</option>
          </select>
        </div>
        <table>
          <thead>
            <tr>
              <th style="width: 1.5rem"></th>
              <th>URL</th>
              <th data-sort="performance">Perf</th>
              <th data-sort="accessibility">A11y</th>
              <th data-sort="best-practices">BP</th>
              <th data-sort="seo">SEO</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody id="results-table"></tbody>
        </table>
      </div>
    </div>
  </div>

  <script type="application/json" id="report-data">${JSON.stringify(data)}</script>

  <script>
    const data = JSON.parse(document.getElementById('report-data').textContent);

    function getScoreClass(score) {
      if (score >= 90) return 'score-good';
      if (score >= 50) return 'score-average';
      return 'score-poor';
    }

    function getScoreColor(score) {
      if (score >= 90) return 'var(--good)';
      if (score >= 50) return 'var(--average)';
      return 'var(--poor)';
    }

    document.getElementById('form-factor').textContent = data.formFactor;
    document.getElementById('generated-at').textContent =
      'Generated: ' + new Date(data.generatedAt).toLocaleString() + ' • ' + data.totalUrls + ' pages';

    // Score cards
    const scoreGrid = document.getElementById('score-grid');
    const categories = [
      { key: 'performance', label: 'Performance', score: data.averages.performance },
      { key: 'accessibility', label: 'Accessibility', score: data.averages.accessibility },
      { key: 'bestPractices', label: 'Best Practices', score: data.averages.bestPractices },
      { key: 'seo', label: 'SEO', score: data.averages.seo },
    ];

    categories.forEach(cat => {
      const circumference = 2 * Math.PI * 36;
      const offset = circumference - (cat.score / 100) * circumference;
      const card = document.createElement('div');
      card.className = 'score-card';
      card.innerHTML = \`
        <div class="score-ring">
          <svg width="80" height="80" viewBox="0 0 80 80">
            <circle class="bg" cx="40" cy="40" r="36"/>
            <circle class="progress" cx="40" cy="40" r="36"
              stroke="\${getScoreColor(cat.score)}"
              stroke-dasharray="\${circumference}"
              stroke-dashoffset="\${offset}"/>
          </svg>
          <div class="score-value \${getScoreClass(cat.score)}">\${cat.score}</div>
        </div>
        <div class="score-label">\${cat.label}</div>
      \`;
      scoreGrid.appendChild(card);
    });

    // Worst pages tabs
    const worstTabs = document.getElementById('worst-tabs');
    const worstContent = document.getElementById('worst-content');
    const worstCategories = [
      { key: 'performance', label: 'Performance', data: data.worstPages.performance },
      { key: 'accessibility', label: 'Accessibility', data: data.worstPages.accessibility },
      { key: 'bestPractices', label: 'Best Practices', data: data.worstPages.bestPractices },
      { key: 'seo', label: 'SEO', data: data.worstPages.seo },
    ];

    worstCategories.forEach((cat, idx) => {
      const tab = document.createElement('div');
      tab.className = 'tab' + (idx === 0 ? ' active' : '');
      tab.textContent = cat.label;
      tab.dataset.tab = cat.key;
      worstTabs.appendChild(tab);

      const content = document.createElement('div');
      content.className = 'tab-content worst-pages' + (idx === 0 ? ' active' : '');
      content.id = 'worst-' + cat.key;

      const catKey = cat.key === 'bestPractices' ? 'best-practices' : cat.key;
      content.innerHTML = cat.data.map(page => {
        const score = page.categories[catKey]?.score || 0;
        return \`
          <div class="worst-page">
            <a href="\${page.url}" target="_blank" class="worst-page-url">\${page.url}</a>
            <div class="worst-page-score \${getScoreClass(score)}">\${score}</div>
          </div>
        \`;
      }).join('') || '<div class="empty-state">No data</div>';

      worstContent.appendChild(content);
    });

    worstTabs.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab')) {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        e.target.classList.add('active');
        document.getElementById('worst-' + e.target.dataset.tab).classList.add('active');
      }
    });

    // Common issues
    const commonIssues = document.getElementById('common-issues');
    if (data.commonIssues.length === 0) {
      commonIssues.innerHTML = '<div class="empty-state">No common issues found</div>';
    } else {
      commonIssues.innerHTML = data.commonIssues.slice(0, 15).map(issue => \`
        <div class="common-issue">
          <span class="common-issue-category">\${issue.category}</span>
          <span class="common-issue-title">\${issue.title}</span>
          <span class="common-issue-count">\${issue.count} pages</span>
        </div>
      \`).join('');
    }

    // Results table
    let filteredResults = [...data.results];
    let sortKey = null;
    let sortAsc = true;

    function renderTable() {
      const tbody = document.getElementById('results-table');
      tbody.innerHTML = '';

      if (filteredResults.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No results</td></tr>';
        return;
      }

      filteredResults.forEach((result, idx) => {
        const originalIdx = data.results.findIndex(r => r.url === result.url);
        const tr = document.createElement('tr');
        tr.className = 'page-row';
        tr.id = 'page-row-' + originalIdx;

        const perf = result.categories.performance?.score || 0;
        const a11y = result.categories.accessibility?.score || 0;
        const bp = result.categories['best-practices']?.score || 0;
        const seo = result.categories.seo?.score || 0;

        tr.innerHTML = \`
          <td><span class="page-chevron">▶</span></td>
          <td class="url-cell">\${result.url}</td>
          <td style="color: \${getScoreColor(perf)}; font-weight: 600">\${perf}</td>
          <td style="color: \${getScoreColor(a11y)}; font-weight: 600">\${a11y}</td>
          <td style="color: \${getScoreColor(bp)}; font-weight: 600">\${bp}</td>
          <td style="color: \${getScoreColor(seo)}; font-weight: 600">\${seo}</td>
          <td>\${result.success ? '<span style="color: var(--good)">OK</span>' : '<span class="status-error">' + (result.error || 'Error') + '</span>'}</td>
        \`;
        tbody.appendChild(tr);

        const detailsTr = document.createElement('tr');
        detailsTr.className = 'page-details';
        detailsTr.id = 'page-details-' + originalIdx;
        const detailsTd = document.createElement('td');
        detailsTd.colSpan = 7;

        if (result.audits.length === 0) {
          detailsTd.innerHTML = '<div class="empty-state">No failed audits</div>';
        } else {
          detailsTd.innerHTML = result.audits.slice(0, 10).map(audit => \`
            <div class="issue-item">
              <span class="issue-category">\${audit.category}</span>
              <span class="issue-title">\${audit.title}</span>
              <span class="issue-score" style="background: \${getScoreColor(audit.score)}20; color: \${getScoreColor(audit.score)}">\${audit.score}</span>
              \${audit.displayValue ? '<span style="color: var(--text-muted); font-size: 0.75rem; margin-left: 0.5rem;">' + audit.displayValue + '</span>' : ''}
            </div>
          \`).join('') + (result.audits.length > 10 ? '<div style="padding: 0.5rem 0; color: var(--text-muted); font-size: 0.75rem;">+ ' + (result.audits.length - 10) + ' more audits</div>' : '');
        }

        detailsTr.appendChild(detailsTd);
        tbody.appendChild(detailsTr);

        tr.addEventListener('click', () => {
          tr.classList.toggle('open');
          detailsTr.classList.toggle('open');
        });
      });
    }

    function applyFilters() {
      const search = document.getElementById('search').value.toLowerCase();
      const filter = document.getElementById('filter').value;

      filteredResults = data.results.filter(r => {
        if (search && !r.url.toLowerCase().includes(search)) return false;
        if (filter === 'poor-perf' && (r.categories.performance?.score || 0) >= 50) return false;
        if (filter === 'poor-a11y' && (r.categories.accessibility?.score || 0) >= 50) return false;
        if (filter === 'poor-bp' && (r.categories['best-practices']?.score || 0) >= 50) return false;
        if (filter === 'poor-seo' && (r.categories.seo?.score || 0) >= 50) return false;
        if (filter === 'errors' && r.success) return false;
        return true;
      });

      if (sortKey) {
        filteredResults.sort((a, b) => {
          const aVal = a.categories[sortKey]?.score || 0;
          const bVal = b.categories[sortKey]?.score || 0;
          return sortAsc ? aVal - bVal : bVal - aVal;
        });
      }

      renderTable();
    }

    document.getElementById('search').addEventListener('input', applyFilters);
    document.getElementById('filter').addEventListener('change', applyFilters);

    document.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        if (sortKey === key) {
          sortAsc = !sortAsc;
        } else {
          sortKey = key;
          sortAsc = true;
        }
        applyFilters();
      });
    });

    applyFilters();
  </script>
</body>
</html>`;

  return template;
}
