const fs = require('fs');
const path = require('path');

const {
  MEMORY_DIR, MEMORY_FILE_PERMISSIONS,
  MEMORY_MAX_ENTRIES_PER_TICKET, MEMORY_MAX_JOURNAL_ENTRIES,
  MEMORY_SEARCH_LIMIT, TICKET_ID_PATTERN,
} = require('../Constants/constants');
const Logger = require('../Utils/logger');

/**
 * Persistent memory system for the Mobile Team Agent.
 *
 * Storage layout:
 *   ~/.mobile-team-agent/memory/
 *     tickets/           — per-ticket notes, decisions, context
 *       PROJ-123.json
 *     journal.json       — running work journal (timestamped entries)
 *     decisions.json     — cross-ticket decisions and context
 *     patterns.json      — learned developer patterns/preferences
 */
class MemoryManager {
  static MEMORY_DIR = MEMORY_DIR;
  static TICKETS_DIR = path.join(MEMORY_DIR, 'tickets');

  static JOURNAL_FILE = path.join(MEMORY_DIR, 'journal.json');
  static DECISIONS_FILE = path.join(MEMORY_DIR, 'decisions.json');
  static PATTERNS_FILE = path.join(MEMORY_DIR, 'patterns.json');

  // ── Init ──────────────────────────────────────────────────────────────

  static ensureDir() {
    if (!fs.existsSync(this.MEMORY_DIR)) {
      fs.mkdirSync(this.MEMORY_DIR, { recursive: true, mode: 0o700 });
    }
    if (!fs.existsSync(this.TICKETS_DIR)) {
      fs.mkdirSync(this.TICKETS_DIR, { recursive: true, mode: 0o700 });
    }
  }

  static _readJSON(filePath) {
    try {
      if (!fs.existsSync(filePath)) return null;
      return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
      Logger.error('Memory read failed', { path: filePath, error: err.message });
      return null;
    }
  }

  static _writeJSON(filePath, data) {
    this.ensureDir();
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), {
        encoding: 'utf-8',
        mode: MEMORY_FILE_PERMISSIONS,
      });
    } catch (err) {
      Logger.error('Memory write failed', { path: filePath, error: err.message });
    }
  }

  static _timestamp() {
    return new Date().toISOString();
  }

  // ── Ticket Memory ─────────────────────────────────────────────────────
  // Per-ticket notes, decisions, observations, blockers

  static _ticketPath(ticketKey) {
    return path.join(this.TICKETS_DIR, `${ticketKey}.json`);
  }

  static getTicketMemory(ticketKey) {
    return this._readJSON(this._ticketPath(ticketKey)) || {
      key: ticketKey,
      entries: [],
      created: this._timestamp(),
    };
  }

  static addTicketNote(ticketKey, note, category = 'note') {
    const mem = this.getTicketMemory(ticketKey);
    mem.entries.push({
      timestamp: this._timestamp(),
      category, // note, decision, blocker, observation, context
      text: note,
    });
    // Cap entries
    if (mem.entries.length > MEMORY_MAX_ENTRIES_PER_TICKET) {
      mem.entries = mem.entries.slice(-MEMORY_MAX_ENTRIES_PER_TICKET);
    }
    mem.lastUpdated = this._timestamp();
    this._writeJSON(this._ticketPath(ticketKey), mem);
    return mem;
  }

  static getTicketNotes(ticketKey, category = null) {
    const mem = this.getTicketMemory(ticketKey);
    if (!category) return mem.entries;
    return mem.entries.filter(e => e.category === category);
  }

  static clearTicketMemory(ticketKey) {
    const p = this._ticketPath(ticketKey);
    if (fs.existsSync(p)) {
      fs.unlinkSync(p);
      return true;
    }
    return false;
  }

  static listTicketsWithMemory() {
    this.ensureDir();
    try {
      return fs.readdirSync(this.TICKETS_DIR)
        .filter(f => f.endsWith('.json'))
        .map(f => {
          const key = f.replace('.json', '');
          const mem = this._readJSON(path.join(this.TICKETS_DIR, f));
          return {
            key,
            entryCount: mem ? mem.entries.length : 0,
            lastUpdated: mem ? mem.lastUpdated : null,
          };
        })
        .sort((a, b) => (b.lastUpdated || '').localeCompare(a.lastUpdated || ''));
    } catch (err) {
      Logger.error('Failed to list ticket memories', { error: err.message });
      return [];
    }
  }

  // ── Work Journal ──────────────────────────────────────────────────────
  // Running log of work throughout the day — not just EOD snapshots

  static getJournal() {
    return this._readJSON(this.JOURNAL_FILE) || { entries: [] };
  }

  static addJournalEntry(text, tags = []) {
    const journal = this.getJournal();

    // Auto-extract ticket IDs from the text
    const ticketIds = text.match(TICKET_ID_PATTERN) || [];
    const uniqueTickets = [...new Set(ticketIds)];

    journal.entries.push({
      timestamp: this._timestamp(),
      date: this._timestamp().split('T')[0],
      text,
      tags,
      ticketIds: uniqueTickets,
    });

    // Cap entries
    if (journal.entries.length > MEMORY_MAX_JOURNAL_ENTRIES) {
      journal.entries = journal.entries.slice(-MEMORY_MAX_JOURNAL_ENTRIES);
    }

    this._writeJSON(this.JOURNAL_FILE, journal);
    return journal.entries[journal.entries.length - 1];
  }

  static getJournalForDate(date = null) {
    const journal = this.getJournal();
    const targetDate = date || this._timestamp().split('T')[0];
    return journal.entries.filter(e => e.date === targetDate);
  }

  static getJournalForTicket(ticketKey) {
    const journal = this.getJournal();
    return journal.entries.filter(e => e.ticketIds.includes(ticketKey));
  }

  // ── Decisions ─────────────────────────────────────────────────────────
  // Cross-ticket decisions, context, and agreements

  static getDecisions() {
    return this._readJSON(this.DECISIONS_FILE) || { entries: [] };
  }

  static addDecision(text, relatedTickets = []) {
    const decisions = this.getDecisions();
    decisions.entries.push({
      id: Date.now().toString(36),
      timestamp: this._timestamp(),
      text,
      relatedTickets,
      resolved: false,
    });
    this._writeJSON(this.DECISIONS_FILE, decisions);
    return decisions.entries[decisions.entries.length - 1];
  }

  static resolveDecision(id) {
    const decisions = this.getDecisions();
    const entry = decisions.entries.find(e => e.id === id);
    if (entry) {
      entry.resolved = true;
      entry.resolvedAt = this._timestamp();
      this._writeJSON(this.DECISIONS_FILE, decisions);
      return entry;
    }
    return null;
  }

  static getActiveDecisions() {
    const decisions = this.getDecisions();
    return decisions.entries.filter(e => !e.resolved);
  }

  // ── Patterns ──────────────────────────────────────────────────────────
  // Learned developer preferences

  static getPatterns() {
    return this._readJSON(this.PATTERNS_FILE) || { entries: [] };
  }

  static addPattern(pattern, reason = '') {
    const patterns = this.getPatterns();
    // Avoid duplicates
    const existing = patterns.entries.find(p => p.pattern === pattern);
    if (existing) {
      existing.lastSeen = this._timestamp();
      existing.count = (existing.count || 1) + 1;
      if (reason) existing.reason = reason;
    } else {
      patterns.entries.push({
        pattern,
        reason,
        firstSeen: this._timestamp(),
        lastSeen: this._timestamp(),
        count: 1,
      });
    }
    this._writeJSON(this.PATTERNS_FILE, patterns);
    return patterns;
  }

  // ── Search across all memory ──────────────────────────────────────────

  static search(query) {
    const queryLower = query.toLowerCase();
    const results = [];

    // Search ticket memories
    const tickets = this.listTicketsWithMemory();
    for (const t of tickets) {
      const mem = this.getTicketMemory(t.key);
      for (const entry of mem.entries) {
        if (entry.text.toLowerCase().includes(queryLower)) {
          results.push({
            type: 'ticket_note',
            ticketKey: t.key,
            category: entry.category,
            text: entry.text,
            timestamp: entry.timestamp,
          });
        }
      }
    }

    // Search journal
    const journal = this.getJournal();
    for (const entry of journal.entries) {
      if (entry.text.toLowerCase().includes(queryLower)) {
        results.push({
          type: 'journal',
          text: entry.text,
          date: entry.date,
          timestamp: entry.timestamp,
        });
      }
    }

    // Search decisions
    const decisions = this.getDecisions();
    for (const entry of decisions.entries) {
      if (entry.text.toLowerCase().includes(queryLower)) {
        results.push({
          type: 'decision',
          text: entry.text,
          resolved: entry.resolved,
          timestamp: entry.timestamp,
        });
      }
    }

    // Sort by timestamp descending, limit results
    return results
      .sort((a, b) => (b.timestamp || '').localeCompare(a.timestamp || ''))
      .slice(0, MEMORY_SEARCH_LIMIT);
  }

  // ── Context builder for workflows ─────────────────────────────────────
  // Returns relevant memory context for a ticket or time period

  static getContextForTicket(ticketKey) {
    const ticketNotes = this.getTicketNotes(ticketKey);
    const journalEntries = this.getJournalForTicket(ticketKey);
    const decisions = this.getDecisions().entries.filter(
      d => d.relatedTickets.includes(ticketKey)
    );
    return { ticketNotes, journalEntries, decisions };
  }

  static getContextForToday() {
    const today = this._timestamp().split('T')[0];
    const journalEntries = this.getJournalForDate(today);
    const activeDecisions = this.getActiveDecisions();
    const recentTickets = this.listTicketsWithMemory().slice(0, 10);
    return { journalEntries, activeDecisions, recentTickets };
  }

  // ── Session Snapshot ──────────────────────────────────────────────────
  // Saved to ~/Documents/MobileTeamAgent/<project>/session_snapshot.md
  // Human-readable markdown so the developer can pick up exactly where
  // they left off. Written at end_of_day_report and plan_my_day.

  static saveSessionSnapshot({
    projectName,
    inProgressTickets = [],
    pendingTickets = [],
    blockedTickets = [],
    completedToday = [],
    journalEntries = [],
    decisions = [],
    commits = [],
    nextFocus = null,
  } = {}) {
    try {
      const os = require('os');
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const dateStr = `${pad(now.getDate())}-${pad(now.getMonth() + 1)}-${now.getFullYear()}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const isoDate = now.toISOString().split('T')[0];

      const safe = (projectName || 'General').replace(/[^a-zA-Z0-9_\-]/g, '_');
      const snapshotDir = path.join(os.homedir(), 'Documents', 'MobileTeamAgent', safe);
      if (!fs.existsSync(snapshotDir)) fs.mkdirSync(snapshotDir, { recursive: true });
      const snapshotPath = path.join(snapshotDir, 'session_snapshot.md');

      let md = `# 🧠 Session Snapshot — ${projectName || 'General'}\n`;
      md += `**Last saved:** ${dateStr} at ${timeStr}\n\n`;
      md += `> Auto-generated by Mobile Team Agent. Loaded automatically on next session start.\n\n`;
      md += `---\n\n`;

      // In Progress — pick up here first
      md += `## 🟠 In Progress (pick up here first)\n`;
      if (inProgressTickets.length > 0) {
        for (const t of inProgressTickets) {
          md += `- **${t.key}** — ${t.summary}`;
          if (t.priority) md += ` *(${t.priority})*`;
          md += `\n`;
          const notes = this.getTicketNotes(t.key);
          if (notes.length > 0) {
            const last = notes[notes.length - 1];
            md += `  > Last note: ${last.text}\n`;
          }
        }
      } else {
        md += `- No tickets were in progress at end of session\n`;
      }
      md += `\n`;

      // Completed today
      md += `## ✅ Completed Today\n`;
      if (completedToday.length > 0) {
        for (const t of completedToday) md += `- ~~${t.key}~~ — ${t.summary}\n`;
      } else {
        md += `- Nothing marked as done today\n`;
      }
      md += `\n`;

      // Pending / To Do
      md += `## 📋 Pending (next up)\n`;
      if (pendingTickets.length > 0) {
        for (const t of pendingTickets.slice(0, 10)) {
          md += `- **${t.key}** — ${t.summary}`;
          if (t.priority) md += ` *(${t.priority})*`;
          if (t.dueDate && new Date(t.dueDate) < now) md += ` ⚠️ OVERDUE`;
          md += `\n`;
        }
        if (pendingTickets.length > 10) md += `- *(and ${pendingTickets.length - 10} more...)*\n`;
      } else {
        md += `- No pending tickets\n`;
      }
      md += `\n`;

      // Blocked
      if (blockedTickets.length > 0) {
        md += `## 🚫 Blocked\n`;
        for (const t of blockedTickets) md += `- **${t.key}** — ${t.summary}\n`;
        md += `\n`;
      }

      // Today's commits
      if (commits.length > 0) {
        md += `## 💻 Today's Commits\n`;
        for (const c of commits.slice(0, 10)) {
          md += `- \`${c.hash || ''}\` ${c.message || c}`;
          if (c.ticketIds && c.ticketIds.length > 0) md += ` *(${c.ticketIds.join(', ')})*`;
          md += `\n`;
        }
        md += `\n`;
      }

      // Journal entries
      const todayJournal = journalEntries.length > 0 ? journalEntries : this.getJournalForDate(isoDate);
      if (todayJournal.length > 0) {
        md += `## 📓 Today's Journal\n`;
        for (const j of todayJournal.slice(-10)) {
          const time = j.timestamp ? j.timestamp.split('T')[1]?.slice(0, 5) : '';
          md += `- ${time ? `[${time}] ` : ''}${j.text}\n`;
        }
        md += `\n`;
      }

      // Open decisions
      const activeDecisions = decisions.length > 0 ? decisions : this.getActiveDecisions();
      if (activeDecisions.length > 0) {
        md += `## 🤝 Open Decisions\n`;
        for (const d of activeDecisions) md += `- ${d.text}\n`;
        md += `\n`;
      }

      // Where to pick up
      md += `## 🎯 Where to Pick Up Tomorrow\n`;
      if (nextFocus) {
        md += `${nextFocus}\n`;
      } else if (inProgressTickets.length > 0) {
        const first = inProgressTickets[0];
        md += `Continue **${first.key}** — ${first.summary}\n`;
      } else if (pendingTickets.length > 0) {
        const first = pendingTickets[0];
        md += `Start **${first.key}** — ${first.summary}\n`;
      } else {
        md += `Check Jira for new tickets assigned to you.\n`;
      }
      md += `\n`;

      md += `---\n`;
      md += `*Say "invoke mobile-team-agent" or "good morning" to restore this context automatically.*\n`;

      fs.writeFileSync(snapshotPath, md, { encoding: 'utf-8' });
      Logger.info('Session snapshot saved', { path: snapshotPath });
      return snapshotPath;
    } catch (err) {
      Logger.error('Failed to save session snapshot', { error: err.message });
      return null;
    }
  }

  static loadSessionSnapshot(projectName) {
    try {
      const os = require('os');
      const safe = (projectName || 'General').replace(/[^a-zA-Z0-9_\-]/g, '_');
      const snapshotPath = path.join(os.homedir(), 'Documents', 'MobileTeamAgent', safe, 'session_snapshot.md');
      if (!fs.existsSync(snapshotPath)) return null;
      return { path: snapshotPath, content: fs.readFileSync(snapshotPath, 'utf-8') };
    } catch (_) {
      return null;
    }
  }

  static listAllSnapshots() {
    try {
      const os = require('os');
      const docsDir = path.join(os.homedir(), 'Documents', 'MobileTeamAgent');
      if (!fs.existsSync(docsDir)) return [];
      return fs.readdirSync(docsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => {
          const snapshotPath = path.join(docsDir, d.name, 'session_snapshot.md');
          if (!fs.existsSync(snapshotPath)) return null;
          const content = fs.readFileSync(snapshotPath, 'utf-8');
          const savedLine = content.match(/\*\*Last saved:\*\* (.+)/);
          return {
            project: d.name,
            lastSaved: savedLine ? savedLine[1].trim() : 'unknown',
            path: snapshotPath,
            content,
          };
        })
        .filter(Boolean);
    } catch (_) {
      return [];
    }
  }
}

module.exports = MemoryManager;
