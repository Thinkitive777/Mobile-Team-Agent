/// MARK: - Validators
/// Zod-based input validation schemas for all external inputs:
/// ticket keys, dates, service names, URLs, and email addresses.
const { z } = require('zod');

const ticketKeySchema = z.string()
  .min(1, 'Ticket key is required')
  .regex(/^[A-Z][A-Z0-9]+-\d+$/, 'Invalid ticket key format (expected: PROJ-123)');

const dateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD format')
  .refine(val => !isNaN(Date.parse(val)), 'Invalid date');

const serviceSchema = z.enum(['jira', 'github'], {
  errorMap: () => ({ message: 'Service must be "jira" or "github"' }),
});

const jiraUrlSchema = z.string()
  .url('Must be a valid URL')
  .refine(u => u.startsWith('https://'), 'Jira URL must use HTTPS');

const emailSchema = z.string().email('Invalid email address');

const sinceSchema = z.string().min(1, 'Time period is required');

const statusFilterSchema = z.string().min(1, 'Status filter cannot be empty');

/**
 * Safely validate input, returning { success, data, error }.
 * Does not throw.
 */
function validate(schema, value) {
  const result = schema.safeParse(value);
  if (result.success) {
    return { success: true, data: result.data, error: null };
  }
  return {
    success: false,
    data: null,
    error: result.error.issues.map(i => i.message).join('; '),
  };
}

module.exports = {
  ticketKeySchema,
  dateSchema,
  serviceSchema,
  jiraUrlSchema,
  emailSchema,
  sinceSchema,
  statusFilterSchema,
  validate,
};
