const fs = require('fs');
const path = require('path');
const os = require('os');

class ReportManager {
  static REPORTS_DIR = path.join(os.homedir(), '.projectguide-agent', 'daily-reports');

  static ensureDir() {
    if (!fs.existsSync(this.REPORTS_DIR)) {
      fs.mkdirSync(this.REPORTS_DIR, { recursive: true });
    }
  }

  static formatDate(date = new Date()) {
    if (typeof date === 'string') {
      date = new Date(date);
    }
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  static getReportPath(date) {
    this.ensureDir();
    const dateStr = typeof date === 'string' ? date : this.formatDate(date);
    return path.join(this.REPORTS_DIR, `${dateStr}.md`);
  }

  static saveReport(date, content) {
    const reportPath = this.getReportPath(date);
    fs.writeFileSync(reportPath, content, 'utf-8');
    return reportPath;
  }

  static getReport(date) {
    const reportPath = this.getReportPath(date);
    if (!fs.existsSync(reportPath)) {
      throw new Error(`Report for ${date} not found`);
    }
    return fs.readFileSync(reportPath, 'utf-8');
  }

  static listReports(startDate = null, endDate = null) {
    this.ensureDir();
    const files = fs.readdirSync(this.REPORTS_DIR);
    const reports = files
      .filter(f => f.endsWith('.md'))
      .map(f => ({
        date: f.replace('.md', ''),
        filename: f,
        path: path.join(this.REPORTS_DIR, f),
      }))
      .sort((a, b) => new Date(b.date) - new Date(a.date));

    if (!startDate && !endDate) {
      return reports;
    }

    return reports.filter(r => {
      if (startDate && r.date < startDate) return false;
      if (endDate && r.date > endDate) return false;
      return true;
    });
  }

  static generateDailyReport(date, completed = [], inProgress = [], commits = [], blockers = [], notes = '') {
    const dateStr = typeof date === 'string' ? date : this.formatDate(date);
    let report = `# Daily Report - ${dateStr}\n\n`;

    report += `## ✅ Completed\n`;
    if (completed.length > 0) {
      completed.forEach(item => {
        report += `- ${item}\n`;
      });
    } else {
      report += `- None\n`;
    }
    report += `\n`;

    report += `## 🚧 In Progress\n`;
    if (inProgress.length > 0) {
      inProgress.forEach(item => {
        report += `- ${item}\n`;
      });
    } else {
      report += `- None\n`;
    }
    report += `\n`;

    report += `## 🧾 Commits\n`;
    if (commits.length > 0) {
      report += `- ${commits.length} commit(s) made\n`;
      commits.forEach(commit => {
        report += `- ${commit.hash}: ${commit.message}\n`;
      });
    } else {
      report += `- No commits\n`;
    }
    report += `\n`;

    report += `## ⚠️ Blockers\n`;
    if (blockers.length > 0) {
      blockers.forEach(item => {
        report += `- ${item}\n`;
      });
    } else {
      report += `- None\n`;
    }
    report += `\n`;

    report += `## 📝 Notes\n`;
    report += notes || `- No additional notes`;
    report += `\n`;

    return report;
  }
}

module.exports = ReportManager;
