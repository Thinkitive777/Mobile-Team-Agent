/// MARK: - Ticket Utilities
/// Shared helper functions for Jira ticket analysis (e.g., blocked detection).

/**
 * Detect if a ticket is blocked via issue links, labels, or status text.
 * @param {object} ticket - Mapped Jira ticket object.
 * @returns {boolean} True if the ticket appears to be blocked.
 */
function isTicketBlocked(ticket) {
  const nameBlocked = (ticket.summary + ' ' + ticket.status).toLowerCase().includes('blocked');
  const labelBlocked = (ticket.labels || []).some(l => l.toLowerCase() === 'blocked');
  const linkBlocked = (ticket.issueLinks || []).some(link =>
    link.description?.toLowerCase().includes('is blocked by') &&
    link.linkedStatus !== 'Done'
  );
  return nameBlocked || labelBlocked || linkBlocked;
}

module.exports = { isTicketBlocked };
