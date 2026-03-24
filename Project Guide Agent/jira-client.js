const fs = require('fs');

class JiraClient {
  constructor(baseUrl, email, token) {
    if (!baseUrl || !email || !token) {
      throw new Error('Jira client requires baseUrl, email, and token');
    }
    this.baseUrl = baseUrl.replace(/\/$/, ''); // Remove trailing slash
    this.email = email;
    this.token = token;
    this.auth = this.createAuthHeader();
  }

  createAuthHeader() {
    const credentials = `${this.email}:${this.token}`;
    return `Basic ${Buffer.from(credentials).toString('base64')}`;
  }

  async testConnection() {
    try {
      const response = await fetch(`${this.baseUrl}/rest/api/3/myself`, {
        method: 'GET',
        headers: {
          'Authorization': this.auth,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('Invalid Jira credentials (401/403 Unauthorized)');
        }
        throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return {
        success: true,
        user: data.displayName,
        email: data.emailAddress,
        accountId: data.accountId,
      };
    } catch (error) {
      throw new Error(`Jira connection failed: ${error.message}`);
    }
  }

  async searchTickets(jql, fields = ['key', 'summary', 'status', 'priority', 'assignee', 'duedate', 'created', 'updated']) {
    try {
      const body = {
        jql,
        fields,
        maxResults: 50,
      };

      const response = await fetch(`${this.baseUrl}/rest/api/3/search`, {
        method: 'POST',
        headers: {
          'Authorization': this.auth,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        throw new Error(`Jira search failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.issues.map(issue => ({
        key: issue.key,
        summary: issue.fields.summary,
        status: issue.fields.status?.name || 'Unknown',
        priority: issue.fields.priority?.name || 'Medium',
        assignee: issue.fields.assignee?.displayName || 'Unassigned',
        dueDate: issue.fields.duedate || null,
        created: issue.fields.created,
        updated: issue.fields.updated,
      }));
    } catch (error) {
      throw new Error(`Jira search error: ${error.message}`);
    }
  }

  async getTicket(issueKey) {
    try {
      const response = await fetch(
        `${this.baseUrl}/rest/api/3/issue/${issueKey}?expand=changelog&fields=*all`,
        {
          method: 'GET',
          headers: {
            'Authorization': this.auth,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        if (response.status === 404) {
          throw new Error(`Issue ${issueKey} not found`);
        }
        throw new Error(`Jira API error: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      const issue = data.fields;

      return {
        key: data.key,
        summary: issue.summary,
        description: issue.description?.content?.[0]?.content?.[0]?.text || 'No description',
        status: issue.status?.name || 'Unknown',
        priority: issue.priority?.name || 'Medium',
        assignee: issue.assignee?.displayName || 'Unassigned',
        dueDate: issue.duedate || null,
        created: issue.created,
        updated: issue.updated,
        subtasks: issue.subtasks?.map(st => ({
          key: st.key,
          summary: st.fields.summary,
          status: st.fields.status?.name || 'Unknown',
        })) || [],
        comments: issue.comment?.comments?.map(c => ({
          author: c.author.displayName,
          body: c.body?.content?.[0]?.content?.[0]?.text || '',
          created: c.created,
        })) || [],
        changelog: data.changelog?.histories?.map(h => ({
          author: h.author.displayName,
          created: h.created,
          items: h.items.map(item => ({
            field: item.field,
            fromString: item.fromString,
            toString: item.toString,
          })),
        })) || [],
      };
    } catch (error) {
      throw new Error(`Jira ticket fetch failed: ${error.message}`);
    }
  }

  maskToken() {
    if (this.token.length <= 4) return 'tok_****';
    return `tok_****${this.token.slice(-4)}`;
  }
}

module.exports = JiraClient;
