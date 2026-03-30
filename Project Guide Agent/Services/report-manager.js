const fs = require('fs');
const path = require('path');

const { REPORTS_DIR, REPORT_FILE_PERMISSIONS, DESKTOP_UPDATES_DIR } = require('../Constants/constants');
const { AppError } = require('../Utils/errors');
const Logger = require('../Utils/logger');

class ReportManager {
  static REPORTS_DIR = REPORTS_DIR;
  static DESKTOP_UPDATES_DIR = DESKTOP_UPDATES_DIR;

  static ensureDir() {
    if (!fs.existsSync(this.REPORTS_DIR)) {
      fs.mkdirSync(this.REPORTS_DIR, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(this.DESKTOP_UPDATES_DIR)) {
      fs.mkdirSync(this.DESKTOP_UPDATES_DIR, { recursive: true, mode: 0o700 });
    }
  }

  // ── Project-based Desktop storage ─────────────────────────────────────

  static getProjectDir(projectName) {
    const proj = projectName || 'General';
    const safe = proj.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const dir = path.join(this.DESKTOP_UPDATES_DIR, safe);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    return dir;
  }

  static formatDailyFilename(dateStr) {
    // Convert 'YYYY-MM-DD' → 'DD-MM-YYYY' (e.g. '2026-03-27' → '27-03-2026')
    const [year, month, day] = dateStr.split('-');
    return `${day}-${month}-${year}`;
  }

  static getProjectReportPath(date, projectName) {
    const dir = this.getProjectDir(projectName);
    const dateStr = typeof date === 'string' ? date : this.formatDate(date);
    return path.join(dir, `${this.formatDailyFilename(dateStr)}_updates.md`);
  }

  static saveProjectReport(date, content, projectName) {
    const reportPath = this.getProjectReportPath(date, projectName);
    try {
      fs.writeFileSync(reportPath, content, { encoding: 'utf-8', mode: REPORT_FILE_PERMISSIONS });
      Logger.info('Project report saved', { date, project: projectName, path: reportPath });
      return reportPath;
    } catch (err) {
      Logger.error('Failed to save project report', { date, project: projectName, error: err.message });
      throw new AppError(`Failed to save project report for ${date}/${projectName}: ${err.message}`, 'REPORT_SAVE_ERROR');
    }
  }

  static getProjectReport(date, projectName) {
    const reportPath = this.getProjectReportPath(date, projectName);
    if (!fs.existsSync(reportPath)) return null;
    return fs.readFileSync(reportPath, 'utf-8');
  }

  static listProjectNames() {
    if (!fs.existsSync(this.DESKTOP_UPDATES_DIR)) return [];
    return fs.readdirSync(this.DESKTOP_UPDATES_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
  }

  /**
   * Generate a consolidated summary of all project reports for a given date.
   * Aggregates completed items, in-progress tasks, and commits across all projects.
   */
  static generateConsolidatedSummary(date = new Date()) {
    const dateStr = this.formatDate(date);
    const projects = this.listProjectNames();

    if (projects.length === 0) {
      return `# Consolidated Summary — ${dateStr}\n\nNo project reports found. End-of-day reports will appear here when saved with a project name.`;
    }

    let summary = `# Consolidated Summary — ${dateStr}\n\n`;
    summary += `Projects tracked: ${projects.join(', ')}\n\n`;

    const allCompleted = [];
    const allInProgress = [];
    let totalCommits = 0;
    const projectSummaries = [];

    for (const project of projects) {
      const content = this.getProjectReport(dateStr, project);
      if (!content) continue;

      const sections = this._extractSections(content);
      allCompleted.push(...sections.completed.map(i => `[${project}] ${i}`));
      allInProgress.push(...sections.inProgress.map(i => `[${project}] ${i}`));
      totalCommits += sections.commitCount;

      projectSummaries.push({
        project,
        completed: sections.completed.length,
        inProgress: sections.inProgress.length,
        commits: sections.commitCount,
      });
    }

    summary += `## Overview\n`;
    summary += `- Total items completed: ${allCompleted.length}\n`;
    summary += `- Total items in progress: ${allInProgress.length}\n`;
    summary += `- Total commits: ${totalCommits}\n\n`;

    summary += `## Per-Project Breakdown\n`;
    for (const p of projectSummaries) {
      summary += `- **${p.project}**: ${p.completed} completed, ${p.inProgress} in progress, ${p.commits} commit(s)\n`;
    }
    summary += '\n';

    summary += `## All Completed Today\n`;
    summary += allCompleted.length > 0
      ? allCompleted.map(i => `- ${i}`).join('\n') + '\n'
      : '- None\n';
    summary += '\n';

    summary += `## Still In Progress\n`;
    summary += allInProgress.length > 0
      ? allInProgress.map(i => `- ${i}`).join('\n') + '\n'
      : '- None\n';

    return summary;
  }

  static formatDate(date = new Date()) {
    if (typeof date === 'string') date = new Date(date);
    return date.toISOString().split('T')[0];
  }

  static getReportPath(date) {
    this.ensureDir();
    const dateStr = typeof date === 'string' ? date : this.formatDate(date);
    return path.join(this.REPORTS_DIR, `${dateStr}.md`);
  }

  // ── Write ─────────────────────────────────────────────────────────────

  static saveReport(date, content) {
    const reportPath = this.getReportPath(date);
    try {
      fs.writeFileSync(reportPath, content, { encoding: 'utf-8', mode: REPORT_FILE_PERMISSIONS });
      Logger.info('Report saved', { date, path: reportPath });
      return reportPath;
    } catch (err) {
      Logger.error('Failed to save report', { date, error: err.message });
      throw new AppError(`Failed to save report for ${date}: ${err.message}`, 'REPORT_SAVE_ERROR');
    }
  }

  // ── Read ──────────────────────────────────────────────────────────────

  static getReport(date) {
    const reportPath = this.getReportPath(date);
    if (!fs.existsSync(reportPath)) {
      return null; // Graceful — caller decides what to do
    }
    return fs.readFileSync(reportPath, 'utf-8');
  }

  static listReports(startDate = null, endDate = null) {
    this.ensureDir();
    const files = fs.readdirSync(this.REPORTS_DIR);
    let reports = files
      .filter(f => f.endsWith('.md') && /^\d{4}-\d{2}-\d{2}\.md$/.test(f))
      .map(f => ({
        date: f.replace('.md', ''),
        filename: f,
        path: path.join(this.REPORTS_DIR, f),
      }))
      .sort((a, b) => b.date.localeCompare(a.date)); // newest first

    if (startDate) reports = reports.filter(r => r.date >= startDate);
    if (endDate) reports = reports.filter(r => r.date <= endDate);
    return reports;
  }

  // ── Carry-forward: parse yesterday's in-progress items ────────────────

  static getYesterdayCarryForward() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const content = this.getReport(this.formatDate(yesterday));
    if (!content) return [];

    // Support new format (🟡 Pending Tasks) and old format (🚧 In Progress)
    let match = content.match(/## 🟡 Pending Tasks\n([\s\S]*?)(?=\n---\n|\n## |$)/);
    if (!match) match = content.match(/## 🚧 In Progress\n([\s\S]*?)(?=\n## )/);
    if (!match) return [];

    return match[1].trim().split('\n')
      .filter(line => line.length > 0
        && !line.includes('No pending tasks')
        && !line.includes('- None'))
      .map(line => line.replace(/^[🔴🟠🟡🟢🔵🟣]\s*/, '').replace(/^- /, ''));
  }

  // ── Weekly summary ────────────────────────────────────────────────────

  static generateWeeklySummary(endDate = new Date()) {
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - 6);
    const start = this.formatDate(startDate);
    const end = this.formatDate(endDate);
    const reports = this.listReports(start, end);

    if (reports.length === 0) return 'No reports found for this week.';

    const allCompleted = [];
    const allInProgress = [];
    let totalCommits = 0;
    const allBlockers = [];
    let daysWithReports = 0;

    for (const r of reports) {
      const content = this.getReport(r.date);
      if (!content) continue;
      daysWithReports++;

      const sections = this._extractSections(content);
      allCompleted.push(...sections.completed);
      allInProgress.push(...sections.inProgress);
      totalCommits += sections.commitCount;
      allBlockers.push(...sections.blockers);
    }

    let summary = `# Weekly Summary (${start} to ${end})\n\n`;
    summary += `## Overview\n`;
    summary += `- Reports found: ${daysWithReports}/7 days\n`;
    summary += `- Total commits: ${totalCommits}\n`;
    summary += `- Items completed: ${allCompleted.length}\n`;
    summary += `- Unique items still in progress: ${[...new Set(allInProgress)].length}\n\n`;

    summary += `## Completed This Week\n`;
    summary += allCompleted.length > 0
      ? allCompleted.map(i => `- ${i}`).join('\n') + '\n'
      : '- None\n';
    summary += '\n';

    summary += `## Still In Progress\n`;
    const uniqueInProgress = [...new Set(allInProgress)];
    summary += uniqueInProgress.length > 0
      ? uniqueInProgress.map(i => `- ${i}`).join('\n') + '\n'
      : '- None\n';
    summary += '\n';

    summary += `## Blockers Encountered\n`;
    const uniqueBlockers = [...new Set(allBlockers)];
    summary += uniqueBlockers.length > 0
      ? uniqueBlockers.map(i => `- ${i}`).join('\n') + '\n'
      : '- None\n';

    return summary;
  }

  // ── Report generation ─────────────────────────────────────────────────

  static generateDailyReport(date, {
    completed = [],
    inProgress = [],
    commits = [],
    carryForward = [],
    blockers = [],
    notes = '',
  } = {}) {
    const dateStr = typeof date === 'string' ? date : this.formatDate(date);
    const [yyyy, mm, dd] = dateStr.split('-');
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const displayDate = `${dd} ${months[parseInt(mm, 10) - 1]} ${yyyy}`;

    let report = `# Updates\n`;
    report += `## Daily Updates — ${displayDate}\n\n`;
    report += `---\n\n`;

    // Tickets Completed Today
    report += `## 🔵 Tickets Completed Today\n`;
    if (completed.length > 0) {
      for (const item of completed) report += `🟢 ${item}\n`;
    } else {
      report += `🟡 No tickets completed today\n`;
    }
    report += `\n---\n\n`;

    // Tasks Performed (humanized commits)
    report += `## 🟣 Tasks Performed\n`;
    if (commits.length > 0) {
      const seen = new Set();
      for (const c of commits) {
        let msg = c.message.replace(/^[A-Z][A-Z0-9]+-\d+\s*[-:]?\s*/i, '').trim() || c.message;
        msg = msg.charAt(0).toUpperCase() + msg.slice(1).replace(/\.+$/, '');
        const key = msg.slice(0, 40).toLowerCase();
        if (!seen.has(key)) { seen.add(key); report += `🔵 ${msg}\n`; }
      }
    } else {
      report += `🔴 No development activity recorded today\n`;
    }
    report += `\n---\n\n`;

    // Pending Tasks (In Progress + Carry Forward)
    report += `## 🟡 Pending Tasks\n`;
    const pendingItems = [...inProgress, ...carryForward];
    if (pendingItems.length > 0) {
      for (const item of pendingItems) report += `🟠 ${item}\n`;
    } else {
      report += `🟢 No pending tasks — all caught up!\n`;
    }
    report += `\n---\n\n`;

    // Notes
    report += `## 🔴 Notes\n`;
    let hasNotes = false;
    if (blockers.length > 0) {
      for (const b of blockers) report += `🟠 BLOCKED: ${b}\n`;
      hasNotes = true;
    }
    if (notes) {
      report += `🟡 ${notes}\n`;
      hasNotes = true;
    }
    if (!hasNotes) {
      report += `🟢 No risks or blockers today\n`;
    }
    report += '\n';

    return report;
  }

  // ── Internal ──────────────────────────────────────────────────────────

  static _extractSections(content) {
    const extractSection = (header) => {
      const re = new RegExp(`## ${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n([\\s\\S]*?)(?=\\n---\\n|\\n## |$)`);
      const m = content.match(re);
      if (!m) return [];
      return m[1].trim().split('\n')
        .filter(l => l.length > 0
          && !l.includes('No tickets completed today')
          && !l.includes('No development activity recorded today')
          && !l.includes('No pending tasks')
          && !l.includes('No risks or blockers'))
        .map(l => l.replace(/^[🔴🟠🟡🟢🔵🟣]\s*/, ''));
    };

    // Support both old format (✅/🚧) and new format (🔵/🟣/🟡/🔴)
    let completed = extractSection('🔵 Tickets Completed Today');
    if (completed.length === 0) completed = extractSection('✅ Completed');

    let inProgress = extractSection('🟡 Pending Tasks');
    if (inProgress.length === 0) inProgress = extractSection('🚧 In Progress');

    const tasksPerformed = extractSection('🟣 Tasks Performed');
    const commitCount = tasksPerformed.length > 0 ? tasksPerformed.length : 0;

    // Fallback for old commit format
    const commitMatch = content.match(/- (\d+) commit\(s\) made/);
    const finalCommitCount = commitCount > 0 ? commitCount : (commitMatch ? parseInt(commitMatch[1], 10) : 0);

    let blockers = extractSection('🔴 Notes');
    if (blockers.length === 0) blockers = extractSection('⚠️ Blockers');
    // Filter notes to only include actual blockers/overdue
    blockers = blockers.filter(l => l.includes('OVERDUE') || l.includes('BLOCKED'));

    return {
      completed,
      inProgress,
      commitCount: finalCommitCount,
      blockers,
    };
  }
}

module.exports = ReportManager;
