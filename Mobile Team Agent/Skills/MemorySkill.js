const BaseSkill = require("./Core/BaseSkill");
const MemoryManager = require("../Services/memory-manager");
const { validate, ticketKeySchema } = require("../Utils/validators");

class MemorySkill extends BaseSkill {
  constructor() {
    super();
    this.name = "MemorySkill";
  }

  getTools() {
    return [
      {
        name: "remember",
        description: "Save a note, decision, or observation to memory. Persists across sessions. Use when the developer says 'remember this', 'note that', 'keep in mind', etc.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "What to remember" },
            ticket_key: { type: "string", description: "Related ticket key (e.g. PROJ-123). Auto-detected from text if omitted." },
            category: { type: "string", enum: ["note", "decision", "blocker", "observation", "context"], description: "Type of memory (default: note)" },
          },
          required: ["text"],
        },
      },
      {
        name: "recall",
        description: "Search memory for past notes, decisions, and context. Use when developer asks 'what did I note about...', 'what was the decision on...', 'remind me about...'.",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query — ticket key, keyword, or topic" },
            ticket_key: { type: "string", description: "Filter by specific ticket key" },
          },
        },
      },
      {
        name: "recall_ticket",
        description: "Get all saved memory for a specific ticket — notes, decisions, journal entries, and related decisions.",
        inputSchema: {
          type: "object",
          properties: {
            ticket_key: { type: "string", description: "Jira ticket key (e.g. PROJ-123)" },
          },
          required: ["ticket_key"],
        },
      },
      {
        name: "journal",
        description: "Add a work journal entry — a running log of what you're doing throughout the day. Unlike EOD reports, journal entries capture real-time progress. Use when developer says 'log that I...', 'I just finished...', 'started working on...', 'switching to...'.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "What you did or are doing" },
            tags: { type: "string", description: "Comma-separated tags (e.g. 'coding,review,meeting')" },
          },
          required: ["text"],
        },
      },
      {
        name: "show_journal",
        description: "Show work journal entries for today or a specific date.",
        inputSchema: {
          type: "object",
          properties: {
            date: { type: "string", description: "Date to show (YYYY-MM-DD, default: today)" },
          },
        },
      },
      {
        name: "add_decision",
        description: "Record a decision or agreement that affects how you work. Use when developer says 'we decided...', 'the plan is...', 'agreed that...'.",
        inputSchema: {
          type: "object",
          properties: {
            text: { type: "string", description: "The decision or agreement" },
            related_tickets: { type: "string", description: "Comma-separated ticket keys this decision relates to" },
          },
          required: ["text"],
        },
      },
      {
        name: "show_decisions",
        description: "Show active (unresolved) decisions. Use when developer asks 'what decisions are pending?', 'what did we agree on?'.",
        inputSchema: {
          type: "object",
          properties: {
            include_resolved: { type: "boolean", description: "Include resolved decisions (default: false)" },
          },
        },
      },
      {
        name: "resolve_decision",
        description: "Mark a decision as resolved/done.",
        inputSchema: {
          type: "object",
          properties: {
            decision_id: { type: "string", description: "Decision ID to resolve" },
          },
          required: ["decision_id"],
        },
      },
      {
        name: "forget",
        description: "Clear memory for a specific ticket. Use when developer says 'forget about PROJ-123', 'clear notes for...'.",
        inputSchema: {
          type: "object",
          properties: {
            ticket_key: { type: "string", description: "Ticket key to clear memory for" },
          },
          required: ["ticket_key"],
        },
      },
      {
        name: "memory_status",
        description: "Show memory usage: how many ticket notes, journal entries, decisions, and patterns are stored.",
        inputSchema: { type: "object", properties: {} },
      },
    ];
  }

  textResponse(msg) {
    return { content: [{ type: "text", text: msg }] };
  }

  errorResponse(msg) {
    return { content: [{ type: "text", text: msg }], isError: true };
  }

  async handleTool(name, args, context) {
    switch (name) {
      case "remember": {
        const text = args.text;
        if (!text || !text.trim()) return this.errorResponse("Nothing to remember. Provide text.");

        const category = args.category || 'note';

        // Auto-detect ticket key from text if not provided
        let ticketKey = args.ticket_key;
        if (!ticketKey) {
          const match = text.match(/[A-Z][A-Z0-9]+-\d+/);
          if (match) ticketKey = match[0];
        }

        if (ticketKey) {
          MemoryManager.addTicketNote(ticketKey, text, category);
          return this.textResponse(`Saved ${category} for ${ticketKey}: "${text}"\nThis will be recalled when you work on ${ticketKey} next time.`);
        } else {
          // Save as journal entry if no ticket context
          MemoryManager.addJournalEntry(text, [category]);
          return this.textResponse(`Saved to journal: "${text}"\nTip: Include a ticket key (e.g. PROJ-123) to link it to a specific ticket.`);
        }
      }

      case "recall": {
        if (args.ticket_key) {
          const keyCheck = validate(ticketKeySchema, args.ticket_key);
          if (!keyCheck.success) return this.errorResponse(keyCheck.error);

          const ctx = MemoryManager.getContextForTicket(args.ticket_key);
          if (ctx.ticketNotes.length === 0 && ctx.journalEntries.length === 0 && ctx.decisions.length === 0) {
            return this.textResponse(`No memory found for ${args.ticket_key}.`);
          }

          let out = `Memory for ${args.ticket_key}:\n\n`;
          if (ctx.ticketNotes.length > 0) {
            out += `--- Notes (${ctx.ticketNotes.length}) ---\n`;
            for (const n of ctx.ticketNotes) {
              out += `  [${n.category}] ${n.timestamp.substring(0, 10)}: ${n.text}\n`;
            }
            out += '\n';
          }
          if (ctx.journalEntries.length > 0) {
            out += `--- Journal Mentions (${ctx.journalEntries.length}) ---\n`;
            for (const j of ctx.journalEntries) {
              out += `  ${j.timestamp.substring(0, 10)}: ${j.text}\n`;
            }
            out += '\n';
          }
          if (ctx.decisions.length > 0) {
            out += `--- Related Decisions (${ctx.decisions.length}) ---\n`;
            for (const d of ctx.decisions) {
              const status = d.resolved ? '[resolved]' : '[active]';
              out += `  ${status} ${d.text}\n`;
            }
          }
          return this.textResponse(out);
        }

        if (args.query) {
          const results = MemoryManager.search(args.query);
          if (results.length === 0) {
            return this.textResponse(`No memory matches for "${args.query}".`);
          }

          let out = `Found ${results.length} match(es) for "${args.query}":\n\n`;
          for (const r of results) {
            const date = r.timestamp ? r.timestamp.substring(0, 10) : '';
            switch (r.type) {
              case 'ticket_note':
                out += `  [${r.ticketKey}/${r.category}] ${date}: ${r.text}\n`;
                break;
              case 'journal':
                out += `  [journal] ${date}: ${r.text}\n`;
                break;
              case 'decision':
                out += `  [decision${r.resolved ? '/resolved' : ''}] ${date}: ${r.text}\n`;
                break;
            }
          }
          return this.textResponse(out);
        }

        // No query or ticket — show today's context
        const ctx = MemoryManager.getContextForToday();
        let out = `Today's Memory Context:\n\n`;

        if (ctx.journalEntries.length > 0) {
          out += `--- Journal Today (${ctx.journalEntries.length}) ---\n`;
          for (const j of ctx.journalEntries) {
            out += `  ${j.timestamp.substring(11, 16)}: ${j.text}\n`;
          }
          out += '\n';
        }

        if (ctx.activeDecisions.length > 0) {
          out += `--- Active Decisions (${ctx.activeDecisions.length}) ---\n`;
          for (const d of ctx.activeDecisions) {
            out += `  [${d.id}] ${d.text}\n`;
          }
          out += '\n';
        }

        if (ctx.recentTickets.length > 0) {
          out += `--- Recent Ticket Notes ---\n`;
          for (const t of ctx.recentTickets) {
            out += `  ${t.key}: ${t.entryCount} note(s), last updated ${t.lastUpdated ? t.lastUpdated.substring(0, 10) : 'unknown'}\n`;
          }
        }

        if (ctx.journalEntries.length === 0 && ctx.activeDecisions.length === 0 && ctx.recentTickets.length === 0) {
          out += 'No memory yet. Use "remember", "journal", or "add_decision" to start building context.\n';
        }

        return this.textResponse(out);
      }

      case "recall_ticket": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return this.errorResponse(keyCheck.error);

        const ctx = MemoryManager.getContextForTicket(args.ticket_key);
        const totalEntries = ctx.ticketNotes.length + ctx.journalEntries.length + ctx.decisions.length;

        if (totalEntries === 0) {
          return this.textResponse(`No memory for ${args.ticket_key}. Notes, journal entries, and decisions will appear here once saved.`);
        }

        let out = `Full Memory for ${args.ticket_key} (${totalEntries} entries):\n${'='.repeat(50)}\n\n`;

        if (ctx.ticketNotes.length > 0) {
          const grouped = {};
          for (const n of ctx.ticketNotes) {
            if (!grouped[n.category]) grouped[n.category] = [];
            grouped[n.category].push(n);
          }
          for (const [cat, notes] of Object.entries(grouped)) {
            out += `--- ${cat.toUpperCase()} (${notes.length}) ---\n`;
            for (const n of notes) {
              out += `  ${n.timestamp.substring(0, 16)}: ${n.text}\n`;
            }
            out += '\n';
          }
        }

        if (ctx.journalEntries.length > 0) {
          out += `--- JOURNAL MENTIONS (${ctx.journalEntries.length}) ---\n`;
          for (const j of ctx.journalEntries) {
            out += `  ${j.timestamp.substring(0, 16)}: ${j.text}\n`;
          }
          out += '\n';
        }

        if (ctx.decisions.length > 0) {
          out += `--- RELATED DECISIONS (${ctx.decisions.length}) ---\n`;
          for (const d of ctx.decisions) {
            const status = d.resolved ? 'RESOLVED' : 'ACTIVE';
            out += `  [${status}] ${d.text}\n`;
          }
        }

        return this.textResponse(out);
      }

      case "journal": {
        const text = args.text;
        if (!text || !text.trim()) return this.errorResponse("Journal entry text is required.");

        const tags = args.tags ? args.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
        const entry = MemoryManager.addJournalEntry(text, tags);

        let out = `Journal entry saved at ${entry.timestamp.substring(11, 16)}:\n  "${text}"`;
        if (entry.ticketIds.length > 0) {
          out += `\n  Linked tickets: ${entry.ticketIds.join(', ')}`;
        }
        if (tags.length > 0) {
          out += `\n  Tags: ${tags.join(', ')}`;
        }
        return this.textResponse(out);
      }

      case "show_journal": {
        const date = args.date || new Date().toISOString().split('T')[0];
        const entries = MemoryManager.getJournalForDate(date);

        if (entries.length === 0) {
          return this.textResponse(`No journal entries for ${date}.`);
        }

        let out = `Work Journal — ${date} (${entries.length} entries)\n\n`;
        for (const e of entries) {
          const time = e.timestamp.substring(11, 16);
          const tickets = e.ticketIds.length > 0 ? ` [${e.ticketIds.join(', ')}]` : '';
          const tags = e.tags.length > 0 ? ` #${e.tags.join(' #')}` : '';
          out += `  ${time}: ${e.text}${tickets}${tags}\n`;
        }
        return this.textResponse(out);
      }

      case "add_decision": {
        const text = args.text;
        if (!text || !text.trim()) return this.errorResponse("Decision text is required.");

        const relatedTickets = args.related_tickets
          ? args.related_tickets.split(',').map(t => t.trim()).filter(Boolean)
          : [];

        // Auto-detect tickets from text
        const autoDetected = text.match(/[A-Z][A-Z0-9]+-\d+/g) || [];
        const allTickets = [...new Set([...relatedTickets, ...autoDetected])];

        const decision = MemoryManager.addDecision(text, allTickets);

        let out = `Decision recorded [${decision.id}]:\n  "${text}"`;
        if (allTickets.length > 0) {
          out += `\n  Related tickets: ${allTickets.join(', ')}`;
        }
        out += `\n\nThis decision will surface in future planning and ticket recall.`;
        return this.textResponse(out);
      }

      case "show_decisions": {
        const includeResolved = args.include_resolved || false;
        const decisions = includeResolved
          ? MemoryManager.getDecisions().entries
          : MemoryManager.getActiveDecisions();

        if (decisions.length === 0) {
          return this.textResponse(includeResolved
            ? 'No decisions recorded yet.'
            : 'No active decisions. Use "add_decision" to record one.'
          );
        }

        let out = `${includeResolved ? 'All' : 'Active'} Decisions (${decisions.length}):\n\n`;
        for (const d of decisions) {
          const status = d.resolved ? '[RESOLVED]' : '[ACTIVE]';
          const date = d.timestamp.substring(0, 10);
          out += `  ${status} [${d.id}] ${date}: ${d.text}\n`;
          if (d.relatedTickets.length > 0) {
            out += `    Tickets: ${d.relatedTickets.join(', ')}\n`;
          }
        }
        if (!includeResolved) {
          out += `\nUse "resolve_decision" with the ID to mark a decision as resolved.\n`;
        }
        return this.textResponse(out);
      }

      case "resolve_decision": {
        const result = MemoryManager.resolveDecision(args.decision_id);
        if (!result) {
          return this.errorResponse(`Decision "${args.decision_id}" not found.`);
        }
        return this.textResponse(`Decision [${args.decision_id}] marked as resolved: "${result.text}"`);
      }

      case "forget": {
        const keyCheck = validate(ticketKeySchema, args.ticket_key);
        if (!keyCheck.success) return this.errorResponse(keyCheck.error);

        const cleared = MemoryManager.clearTicketMemory(args.ticket_key);
        if (cleared) {
          return this.textResponse(`Memory cleared for ${args.ticket_key}.`);
        }
        return this.textResponse(`No memory found for ${args.ticket_key}.`);
      }

      case "memory_status": {
        const tickets = MemoryManager.listTicketsWithMemory();
        const journal = MemoryManager.getJournal();
        const decisions = MemoryManager.getDecisions();
        const patterns = MemoryManager.getPatterns();
        const activeDecisions = decisions.entries.filter(d => !d.resolved).length;

        let totalNotes = 0;
        for (const t of tickets) totalNotes += t.entryCount;

        let out = `Memory Status\n${'='.repeat(40)}\n\n`;
        out += `Ticket notes:     ${totalNotes} across ${tickets.length} ticket(s)\n`;
        out += `Journal entries:   ${journal.entries.length}\n`;
        out += `Decisions:         ${decisions.entries.length} total (${activeDecisions} active)\n`;
        out += `Patterns:          ${patterns.entries.length}\n`;
        out += `Storage:           ${MemoryManager.MEMORY_DIR}\n`;

        if (tickets.length > 0) {
          out += `\nRecent ticket notes:\n`;
          for (const t of tickets.slice(0, 5)) {
            out += `  ${t.key}: ${t.entryCount} note(s), last ${t.lastUpdated ? t.lastUpdated.substring(0, 10) : '?'}\n`;
          }
        }

        return this.textResponse(out);
      }

      default:
        return null;
    }
  }

  getPrompt() {
    return (
      this.loadPromptChunk("memory.md") ||
      `### Memory
Use \`remember\` to save notes about tickets or work context.
Use \`recall\` to search past notes, decisions, and journal entries.
Use \`journal\` to log real-time progress throughout the day.
Use \`add_decision\` to record decisions that affect future work.`
    );
  }
}

module.exports = MemorySkill;
