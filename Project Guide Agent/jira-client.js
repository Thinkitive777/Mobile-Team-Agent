const {
  JIRA_MAX_RESULTS, JIRA_REQUEST_TIMEOUT_MS,
  JIRA_MAX_RETRIES, JIRA_RETRY_BASE_DELAY_MS,
  JIRA_DEFAULT_FIELDS, COMMENT_PREVIEW_LENGTH,
} = require('./constants');
const { JiraConnectionError, JiraAuthError, JiraRateLimitError } = require('./errors');
const Logger = require('./logger');

class JiraClient {
  constructor(baseUrl, email, token) {
    if (!baseUrl || !email || !token) {
      throw new JiraConnectionError('Jira client requires baseUrl, email, and token');
    }
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.email = email;
    this.token = token;
    this.auth = `Basic ${Buffer.from(`${email}:${token}`).toString('base64')}`;
  }

  // ── HTTP layer with timeout, retry, and rate-limit handling ───────────

  async _fetchWithRetry(url, options = {}, retries = JIRA_MAX_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), JIRA_REQUEST_TIMEOUT_MS);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'Authorization': this.auth,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
          },
        });
        clearTimeout(timer);

        // Rate limit
        if (response.status === 429) {
          const retrySec = parseInt(response.headers.get('retry-after') || '5', 10);
          Logger.warn('Jira rate limited', { attempt, retrySec });
          if (attempt < retries) {
            await this._sleep(retrySec * 1000);
            continue;
          }
          throw new JiraRateLimitError('Jira API rate limit exceeded after retries');
        }

        // Auth errors — no retry
        if (response.status === 401 || response.status === 403) {
          throw new JiraAuthError(`Jira authentication failed (${response.status})`);
        }

        // Other errors
        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new JiraConnectionError(
            `Jira API ${response.status}: ${response.statusText}`,
            { url, status: response.status, body: body.substring(0, 200) }
          );
        }

        return response;
      } catch (err) {
        // Timeout
        if (err.name === 'AbortError') {
          Logger.warn('Jira request timeout', { attempt, url });
          if (attempt < retries) {
            await this._sleep(JIRA_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
            continue;
          }
          throw new JiraConnectionError('Jira request timed out after retries');
        }
        // Non-retryable errors
        if (err instanceof JiraAuthError || err instanceof JiraRateLimitError) throw err;
        // Network / transient — retry
        if (attempt < retries) {
          Logger.warn('Jira request failed, retrying', { attempt, error: err.message });
          await this._sleep(JIRA_RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
          continue;
        }
        throw err;
      }
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── Atlassian Document Format (ADF) parser ────────────────────────────

  _parseAdf(adfNode) {
    if (!adfNode) return 'No content';
    if (typeof adfNode === 'string') return adfNode;
    if (!adfNode.content) return 'No content';
    return this._renderAdfNodes(adfNode.content).trim();
  }

  _renderAdfNodes(nodes) {
    if (!Array.isArray(nodes)) return '';
    return nodes.map(node => {
      switch (node.type) {
        case 'text':
          return node.text || '';
        case 'paragraph':
          return this._renderAdfNodes(node.content) + '\n';
        case 'heading': {
          const level = node.attrs?.level || 1;
          return '#'.repeat(level) + ' ' + this._renderAdfNodes(node.content) + '\n';
        }
        case 'bulletList':
          return (node.content || [])
            .map(li => '- ' + this._renderAdfNodes(li.content))
            .join('\n') + '\n';
        case 'orderedList':
          return (node.content || [])
            .map((li, i) => `${i + 1}. ` + this._renderAdfNodes(li.content))
            .join('\n') + '\n';
        case 'listItem':
          return this._renderAdfNodes(node.content);
        case 'codeBlock':
          return '```\n' + this._renderAdfNodes(node.content) + '\n```\n';
        case 'blockquote':
          return '> ' + this._renderAdfNodes(node.content) + '\n';
        case 'hardBreak':
          return '\n';
        case 'inlineCard':
          return node.attrs?.url || '';
        case 'mention':
          return '@' + (node.attrs?.text || 'unknown');
        case 'emoji':
          return node.attrs?.shortName || '';
        case 'table':
          return this._renderAdfNodes(node.content);
        case 'tableRow':
          return '| ' + (node.content || [])
            .map(cell => this._renderAdfNodes(cell.content))
            .join(' | ') + ' |\n';
        case 'tableCell':
        case 'tableHeader':
          return this._renderAdfNodes(node.content);
        case 'rule':
          return '---\n';
        case 'mediaGroup':
        case 'mediaSingle':
          return '[attachment]\n';
        default:
          if (node.content) return this._renderAdfNodes(node.content);
          return node.text || '';
      }
    }).join('');
  }

  // ── API methods ───────────────────────────────────────────────────────

  async testConnection() {
    Logger.info('Testing Jira connection', { url: this.baseUrl });
    const response = await this._fetchWithRetry(`${this.baseUrl}/rest/api/3/myself`);
    const data = await response.json();
    Logger.info('Jira connection successful', { user: data.displayName });
    return {
      success: true,
      user: data.displayName,
      email: data.emailAddress,
      accountId: data.accountId,
    };
  }

  async searchTickets(jql, fields = JIRA_DEFAULT_FIELDS, maxResults = JIRA_MAX_RESULTS, startAt = 0) {
    Logger.debug('Jira search', { jql, maxResults, startAt });
    const response = await this._fetchWithRetry(`${this.baseUrl}/rest/api/3/search`, {
      method: 'POST',
      body: JSON.stringify({ jql, fields, maxResults, startAt }),
    });

    const data = await response.json();

    if (data.total > maxResults + startAt) {
      Logger.warn('Jira results truncated', { total: data.total, fetched: data.issues.length });
    }

    return {
      tickets: (data.issues || []).map(issue => this._mapIssue(issue)),
      total: data.total || 0,
      startAt: data.startAt || 0,
      maxResults: data.maxResults || maxResults,
    };
  }

  _mapIssue(issue) {
    const f = issue.fields;
    return {
      key: issue.key,
      summary: f.summary || '',
      status: f.status?.name || 'Unknown',
      statusCategory: f.status?.statusCategory?.name || 'Unknown',
      priority: f.priority?.name || 'Medium',
      assignee: f.assignee?.displayName || 'Unassigned',
      dueDate: f.duedate || null,
      created: f.created,
      updated: f.updated,
      labels: f.labels || [],
      issueLinks: (f.issuelinks || []).map(link => ({
        type: link.type?.name || 'relates to',
        direction: link.inwardIssue ? 'inward' : 'outward',
        linkedKey: (link.inwardIssue || link.outwardIssue)?.key || null,
        linkedStatus: (link.inwardIssue || link.outwardIssue)?.fields?.status?.name || null,
        description: link.inwardIssue
          ? link.type?.inward
          : link.type?.outward,
      })),
    };
  }

  async getTicket(issueKey) {
    Logger.debug('Fetching ticket', { issueKey });
    const fields = 'summary,status,priority,assignee,duedate,created,updated,description,subtasks,comment,issuelinks,labels';
    const response = await this._fetchWithRetry(
      `${this.baseUrl}/rest/api/3/issue/${encodeURIComponent(issueKey)}?expand=changelog&fields=${fields}`
    );

    const data = await response.json();
    const f = data.fields;

    return {
      key: data.key,
      summary: f.summary || '',
      description: this._parseAdf(f.description),
      status: f.status?.name || 'Unknown',
      statusCategory: f.status?.statusCategory?.name || 'Unknown',
      priority: f.priority?.name || 'Medium',
      assignee: f.assignee?.displayName || 'Unassigned',
      dueDate: f.duedate || null,
      created: f.created,
      updated: f.updated,
      labels: f.labels || [],
      subtasks: (f.subtasks || []).map(st => ({
        key: st.key,
        summary: st.fields?.summary || '',
        status: st.fields?.status?.name || 'Unknown',
      })),
      comments: (f.comment?.comments || []).map(c => ({
        author: c.author?.displayName || 'Unknown',
        body: this._parseAdf(c.body),
        created: c.created,
      })),
      issueLinks: (f.issuelinks || []).map(link => ({
        type: link.type?.name || 'relates to',
        direction: link.inwardIssue ? 'inward' : 'outward',
        linkedKey: (link.inwardIssue || link.outwardIssue)?.key || null,
        linkedStatus: (link.inwardIssue || link.outwardIssue)?.fields?.status?.name || null,
        description: link.inwardIssue
          ? link.type?.inward
          : link.type?.outward,
      })),
      changelog: (data.changelog?.histories || []).slice(-10).map(h => ({
        author: h.author?.displayName || 'Unknown',
        created: h.created,
        items: (h.items || []).map(item => ({
          field: item.field,
          from: item.fromString,
          to: item.toString,
        })),
      })),
    };
  }

  maskToken() {
    if (!this.token || this.token.length <= 4) return 'tok_****';
    return `tok_****${this.token.slice(-4)}`;
  }
}

module.exports = JiraClient;
