---
description: Load an earlier Context Handoff or the open checkpoint, and continue that task.
---

Use the `context-handoff` skill (Part C).

Target: $ARGUMENTS

Steps:
1. If a file path was given, read that file only.
2. If not: check `.claude/checkpoints/ACTIVE` first — an open checkpoint beats an old handoff.
   Otherwise run `ls -t docs/handoffs/*.md | head -10`, show the list, and ask which one.
3. Read only the chosen file. Do not read the others.
4. Summarize in 3-5 lines: task, current state, next step, known risks.
5. Check the files named in `Important Changes` / `Key Files` still exist. Say if any are gone.
6. List any `open` unknowns and ask them.
7. Ask what the user wants to do now. Do not start changing code before they answer.
