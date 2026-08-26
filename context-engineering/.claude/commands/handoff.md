---
description: Write the final Context Handoff for a finished or paused task, then tell the user /compact is safe.
---

Use the `context-handoff` skill (Part A).

Write a Context Handoff for the task in this conversation. $ARGUMENTS

Rules:
- One handoff = one task. Do not mix two tasks in one file.
- Get the date with `date +%F`. Do not guess it.
- Save to `docs/handoffs/YYYY-MM-DD-<type>-<short-name>.md` (create the folder if missing).
- If a checkpoint exists for this task, use it as the source instead of re-reading the
  whole conversation.
- Only what a new session needs. No conversation history.
- **Validation**: only what you actually ran and saw. If you ran nothing, say so.
- `Compact Focus` is required and must be specific to this task.

After saving, do all three:

1. Print on its own line: `# **CONTEXT HANDOFF SAVED — YOU CAN NOW USE /compact**`
2. Print one short line on what to preserve during compaction.
3. Delete `.claude/checkpoints/ACTIVE` if it exists (keep the `.md` file).

Do not run `/compact`. Do not offer a handoff again for this task.
