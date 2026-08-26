# 7. Reference

For whoever maintains the system.

## Files

| File | Lines | What |
|---|---|---|
| `CLAUDE.md` | 244 | 15 rules, loaded every turn |
| `.claude/settings.json` | 57 | hooks, `permissions.ask`, status line |
| `.claude/hooks/git-guard.sh` | 102 | `PreToolUse(Bash)` — Git blocking |
| `.claude/hooks/turn-context.sh` | 7 | wrapper: checks `node`, sets `STATE_DIR` |
| `.claude/hooks/turn-context.js` | 102 | `UserPromptSubmit` — save prompt, Fable, context bands |
| `.claude/hooks/statusline.sh` | 6 | wrapper |
| `.claude/hooks/statusline.js` | 60 | status line + writes the real context % to state |
| `.claude/hooks/session-start.sh` | 23 | `SessionStart` — list recent handoffs |
| `.claude/hooks/pre-compact.sh` | 11 | `PreCompact` — warn if no recent handoff |
| `.claude/scripts/context-status.sh` | 42 | data source for `/context` |
| `.claude/skills/context-handoff/SKILL.md` | 209 | handoff + checkpoint formats |
| `.claude/commands/*.md` | 5 files | `/handoff` `/checkpoint` `/context` `/unknowns` `/resume-handoff` |
| `install.sh` | 92 | copy into another repo, merge settings |

## `CLAUDE.md` rules

| # | Rule |
|---|---|
| 1 | No assumptions — search order, then ask |
| 2 | Label certainty: Known / Found / Inferred / Unknown / Needs confirmation |
| 3 | Understand before you change (11 steps) |
| 4 | Follow the existing project; ask before architecture decisions |
| 5 | Git safety |
| 6 | Verify — no fake certainty |
| 7 | Language: simple English |
| 8 | Explain why, briefly |
| 9 | Keep the context small: search policy, subagents, no dumping |
| 10 | Finish format: Done / Validation / Notes → handoff offer → saved message |
| 11 | Do not repeat questions |
| 12 | The user decides |
| 13 | Context budget bands |
| 14 | New task detection |
| 15 | Track unknowns, do not guess |

## Hooks

| Event | Script | Blocks? | Output |
|---|---|---|---|
| `SessionStart` | `session-start.sh` | no | `additionalContext` — up to 5 recent handoffs |
| `UserPromptSubmit` | `turn-context.sh` | no | `additionalContext` — Fable / context warnings |
| `PreToolUse` (`Bash`) | `git-guard.sh` | **yes** (exit 2) | stderr → shown to Claude |
| `PreCompact` | `pre-compact.sh` | no | stderr → shown to the user |
| `statusLine` | `statusline.sh` | n/a | one line of text |

All hooks exit 0 and print nothing when there is nothing to say. Normal turns cost no extra
tokens.

## State files

Directory: `${TMPDIR:-/tmp}/claude-team-guard/`

Outside the repo on purpose — nothing is added to your working tree.

| File | Written by | Read by | Content |
|---|---|---|---|
| `<session_id>.prompt` | `turn-context.js` | `git-guard.sh` | your last message, raw |
| `<session_id>.ctx` | `statusline.js` | `turn-context.js`, `context-status.sh` | `{used_percentage, total_input_tokens, context_window_size, model, at}` |
| `<session_id>.ctxband` | `turn-context.js` | `turn-context.js` | last warning band fired: `0`, `80`, `90` |
| `<session_id>.fable-ack` | `turn-context.js` | `turn-context.js` | model id; means "already asked once" |

They are temporary. Deleting them is safe — the next turn recreates what it needs.

## The context bridge

Claude cannot read its own status line, and the `UserPromptSubmit` hook input does not include
context usage. So:

```
Claude Code
   │  statusLine JSON:  context_window.used_percentage
   ▼
statusline.js  ──writes──►  <session_id>.ctx
                                  │
                                  ├──read by──►  turn-context.js   (80% / 90% warnings)
                                  └──read by──►  context-status.sh (/context)
```

`context-status.sh` ignores any `.ctx` file older than 5 minutes, so it cannot report a
different session's number.

## Status line input (from Claude Code)

Fields this system uses:

```jsonc
{
  "session_id": "string",
  "model": { "id": "string", "display_name": "string" },
  "workspace": { "current_dir": "string", "project_dir": "string" },
  "context_window": {
    "total_input_tokens": 84600,
    "context_window_size": 200000,
    "used_percentage": 42.3,
    "remaining_percentage": 57.7
  }
}
```

`used_percentage` is `null` until the first API call in a session.

## Status line format

```
● Opus 5  │  ! ctx 82%  │  myapp  │  ▸ auth-refactor
└ model      └ context     └ repo   └ active checkpoint slug
```

- `!` at 80%, `!!` at 90%
- `⚠️  FABLE 5 — HIGH USAGE` replaces the model name on Fable
- The task part appears only when `.claude/checkpoints/ACTIVE` exists

## `context-status.sh` output

```
task_slug: auth-refactor
context_used: 64% of 200k
open_unknowns: 2
checkpoint: .claude/checkpoints/auth-refactor.md (updated 16:41)
latest_handoff: docs/handoffs/2026-08-26-bugfix-login-401.md
```

`context_used` is `unknown` when the status line has not run or the state file is stale.
Open unknowns are counted by matching `| UNKNOWN #NNN | ... | open |` rows.

## Configuration

| Knob | Where | Effect |
|---|---|---|
| `THINKTEAM_GIT_GUARD=off` | environment | turns off the Git guard for that command |
| `DESTRUCTIVE` table | `git-guard.sh` | which destructive ops are caught, and what unlocks them |
| `WRITE_RE` / `INTENT_RE` / `AFFIRM_RE` | `git-guard.sh` | which write ops are caught, and what unlocks them |
| bands `80` / `90` | `turn-context.js` | when the context warnings fire |
| `-mmin -180` | `pre-compact.sh` | how fresh a handoff must be to skip the warning |
| `head -5` | `session-start.sh` | how many handoffs are listed at session start |
| `permissions.ask` | `.claude/settings.json` | which commands Claude Code asks about |

## Naming

Handoffs: `docs/handoffs/YYYY-MM-DD-<type>-<short-name>.md`
Types: `feature` `bugfix` `refactor` `migration` `investigation` `config` `incident` `integration`

Checkpoints: `.claude/checkpoints/<kebab-case-slug>.md`, plus `ACTIVE` holding the slug.
