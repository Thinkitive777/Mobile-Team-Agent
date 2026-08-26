---
description: Short report on context usage, open unknowns, checkpoint and handoff status.
---

Run this and read the output:

```bash
bash "$CLAUDE_PROJECT_DIR/.claude/scripts/context-status.sh"
```

Then print exactly this shape, nothing more:

```
Task: <task name, or "none">
Context: <value from context_used>
Unknowns: <number>
Checkpoint: <Available / none>
Handoff: <Available / none>
Recommendation: <one short line>
```

Rules:
- If `context_used` is `unknown`, write `Context: unknown (status line has not run yet)`.
  **Never invent a percentage.**
- Recommendation, based on the real number only:
  - under 60% — `Continue`
  - 60–79% — `Continue, checkpoint soon`
  - 80–89% — `Run /checkpoint, then /compact`
  - 90%+ — `Run /handoff or /checkpoint now, then /compact`
  - unknown — `Continue; checkpoint if this task is long`
- If there are open unknowns, add one line: `Ask the user: <first open unknown>`
- No extra explanation. Six or seven lines total.
