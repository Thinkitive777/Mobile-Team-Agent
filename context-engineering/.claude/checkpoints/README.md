# Checkpoints

Working state for the task **in progress**. Not committed (see `.gitignore`).

- One file per task: `<task-slug>.md`, updated in place. Never a new file per save.
- `ACTIVE` holds the current task slug. The status line reads it.
- `/checkpoint` writes here. `/handoff` writes the final record to `docs/handoffs/` and
  clears `ACTIVE`.

Checkpoint = still working. Handoff = finished or intentionally paused.
