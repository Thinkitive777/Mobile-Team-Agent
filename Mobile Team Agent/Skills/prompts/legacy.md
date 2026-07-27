# Legacy Prompt

This skill keeps backward compatibility for a few older wrappers.

## Tool usage
- Use `sync_offline_actions` to retry queued Jira write actions that were attempted while offline.
- Use `run_skill` only if you must support older client behavior; otherwise call the underlying MCP tools directly.

