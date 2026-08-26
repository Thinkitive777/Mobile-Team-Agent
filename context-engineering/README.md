# Team Claude Code Engineering System

A small, shared setup that makes Claude Code behave the same way for every developer
on the team, in every repository.

It uses only real Claude Code mechanisms: `CLAUDE.md`, hooks, a skill, slash commands
and `settings.json`. Nothing is invented.

**Full documentation: [docs/guide/](docs/guide/README.md)**

| | |
|---|---|
| [1. Overview](docs/guide/01-overview.md) | what it is, the three layers, design decisions |
| [2. Getting Started](docs/guide/02-getting-started.md) | install, customize, update, remove |
| [3. Commands](docs/guide/03-commands.md) | `/handoff` `/checkpoint` `/context` `/unknowns` `/resume-handoff` |
| [4. Context Engineering](docs/guide/04-context-engineering.md) | handoff → compact workflow, budget, unknowns |
| [5. Git Safety](docs/guide/05-git-safety.md) | what is blocked, why, how to change it |
| [6. Model Safety](docs/guide/06-model-safety.md) | Fable 5 detection and warnings |
| [7. Reference](docs/guide/07-reference.md) | every file, hook, state file and knob |
| [8. Troubleshooting](docs/guide/08-troubleshooting.md) | fixes, hook testing, honest limits |

---

## What is in the box

| File | Mechanism | What it does |
|---|---|---|
| `CLAUDE.md` | Permanent rules | Loaded every turn. No assumptions, certainty labels, plain English, Git rules, verify-your-work, finish format. ~165 lines. |
| `.claude/settings.json` | Settings | Registers the hooks, the status line, and `ask` permission rules for Git. |
| `.claude/hooks/git-guard.sh` | `PreToolUse(Bash)` | **Blocks** `git add/commit/push/merge/tag/stash` unless the user asked for it in their last message. **Blocks** `reset --hard`, `clean -fd`, `checkout --`, `restore`, `rebase`, `push --force`, `branch -D`, `stash drop`, `filter-branch`, `git rm` unless the user names that operation. |
| `.claude/hooks/turn-context.sh` + `.js` | `UserPromptSubmit` | Saves the user's message for the Git guard. Reads the transcript to find the real model and injects the Fable 5 warning. |
| `.claude/hooks/session-start.sh` | `SessionStart` | Lists the last 5 Context Handoffs in a few lines. Silent when there are none. |
| `.claude/hooks/pre-compact.sh` | `PreCompact` | Warns before `/compact` if no handoff was saved in the last 3 hours. |
| `.claude/skills/context-handoff/SKILL.md` | Skill | Handoff + checkpoint formats, including `Compact Focus`. Loaded only when needed. |
| `.claude/commands/handoff.md` | `/handoff` | Write the final Context Handoff, then say `/compact` is safe. |
| `.claude/commands/resume-handoff.md` | `/resume-handoff` | Load one earlier handoff and continue. |
| `.claude/commands/unknowns.md` | `/unknowns` | List what is still unclear, before any code is written. |
| `.claude/hooks/statusline.sh` + `.js` | `statusLine` | Model + **real context %** + project + active task. Writes the real percentage to a state file, which is the only way the hooks and `/context` can see it. |
| `.claude/scripts/context-status.sh` | Script | Facts for `/context`: context %, open unknowns, checkpoint, handoff. |
| `.claude/commands/checkpoint.md` | `/checkpoint` | Save state of a task that is **still running**. |
| `.claude/commands/context.md` | `/context` | Six-line status report. |
| `docs/handoffs/` | Documentation | One file per **finished** task. Commit these. |
| `.claude/checkpoints/` | Working notes | One file per **running** task, updated in place. Not committed. |

---

## Why the rules are split like this

- **`CLAUDE.md` = only the rules needed on every single turn.** It is read on every turn, so every extra line costs tokens forever. It stays short.
- **Skill = detail that is needed sometimes.** The handoff template is ~127 lines. Putting it in `CLAUDE.md` would waste those tokens on every turn. As a skill it loads only when a handoff is actually being written.
- **Commands = things a developer starts on purpose.** `/handoff`, `/resume-handoff`, `/unknowns`.
- **Hooks = rules that must not depend on the model behaving well.** Git safety and model detection are enforced by shell scripts, not by asking the model nicely.
- **No new agents.** The repo already has agents. Adding more would be over-engineering.

---

## Install into another repository

```bash
./install.sh /path/to/your/repo
```

Then:

1. Open the new `CLAUDE.md` and add a short `## This project` section at the bottom:
   stack, build command, test command, folder layout. Keep it under 30 lines.
2. Commit `CLAUDE.md`, `.claude/` and `docs/handoffs/`.
3. Restart Claude Code so the hooks load.

Every developer who pulls the repo gets the same behavior. Nothing to install per person.

Requirements: `bash` and `node` (Claude Code already needs Node).
If `node` is missing, every hook exits quietly and Claude Code keeps working.

---

## Daily use

```
Task → Work → /checkpoint or /handoff → /compact → Continue
```

```
/unknowns          # what is still unclear — answer before any code is written
... work ...
/context           # Task / Context % / Unknowns / Checkpoint / Handoff / Recommendation
/checkpoint        # task still running, context getting big
/compact
... work ...
/handoff           # task finished — Claude then prints:
                   #   CONTEXT HANDOFF SAVED — YOU CAN NOW USE /compact
/compact
/resume-handoff    # later, or in a new session
```

### Context budget

The status line shows the real number: `● Opus 5 │ ! ctx 82% │ myapp │ ▸ auth-refactor`

| Used | Behavior |
|---|---|
| under 60% | nothing |
| 60-79% | status line only |
| 80-89% | one short warning, once |
| 90%+ | one stronger warning, once |

Warnings fire **once per band per session**. No warning on every reply.

---

## Turning the Git guard off

For one command only, when the guard is wrong:

```bash
THINKTEAM_GIT_GUARD=off <your command>
```

The rule tables inside `git-guard.sh` are plain text and meant to be edited by the team.

---

## Honest limits

- `bypassPermissions` mode (`--dangerously-skip-permissions`) can bypass permission rules.
  The `PreToolUse` hook is the stronger layer, but a developer who wants to get around
  their own tooling always can. This system stops accidents, not intent.
- Model detection reads the **last assistant message** in the transcript. On the very first
  turn of a session there is no assistant message yet, so the Fable warning starts from the
  second turn. The status line shows the model correctly from the start.
- Claude cannot change its own model. The warning asks the user to change it with `/model`.
- "Do not assume" and "state your uncertainty" are model behavior. They come from
  `CLAUDE.md` and are strong, but they are not mechanically enforceable.
- The Git guard reads the user's last message. A Git word in an unrelated sentence
  ("do not push this to prod yet") can grant permission for that turn. `CLAUDE.md` is the
  second layer that stops Claude from acting on it.
- Context percentage is real (Claude Code gives it to the status line), but Claude itself
  cannot read the status line. It reaches Claude through a state file, so it can be a few
  seconds old, and it is `unknown` until the status line has run once.
- "New task detected" is a judgement call by the model, not a script. A hook cannot tell a
  new task from a follow-up question.
- Checkpoints are not committed on purpose. If a developer wants to hand work to a
  teammate, that needs `/handoff`, not `/checkpoint`.
