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
}

module.exports = MemoryManager;
