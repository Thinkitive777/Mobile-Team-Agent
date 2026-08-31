# 1. Overview

## What this is

A small shared setup that makes Claude Code behave the same way for every developer on the
team, in every repository.

It is not an application and not a plugin. It is a folder of files you commit to your repo.
When a developer opens Claude Code in that repo, the rules load automatically.

## The problems it solves

| Problem | What the system does |
|---|---|
| Claude guesses missing requirements | Rule: find the answer in the repo first, then **ask** — never invent |
| Claude presents a guess as a fact | Every claim carries a label: Known / Found / Inferred / Unknown |
| Claude runs `git commit` you did not ask for | A hook **blocks** it unless you asked in that message |
| Claude runs `git reset --hard` and work is gone | A hook blocks destructive Git unless you name the operation |
| Context fills up and useful information is lost in `/compact` | Handoffs and checkpoints, plus real context-usage warnings |
| Every developer gets different AI behavior | One committed `CLAUDE.md` + hooks, shared through git |
| English is a second language for most of the team | A language rule: short sentences, simple words, keep the technical terms |
| Nobody notices an expensive model is active | The status line shows the model; a hook warns on Fable 5 |
| Token waste | Search policy, subagents for heavy reading, no dumping whole files |

## The three layers

The system is built in layers, from weakest to strongest. This matters: **anything important
must not depend only on the model behaving well.**

```
  Layer 3   Hooks              shell scripts that BLOCK commands
            .claude/hooks/     ← cannot be talked out of it
                 ▲
  Layer 2   Permissions        settings.json "ask" rules
            .claude/settings.json  ← the human must approve
                 ▲
  Layer 1   Instructions       CLAUDE.md, skill, commands
            CLAUDE.md          ← the model follows them, usually
```

- **Git safety** and **model detection** are enforced at Layer 3, because a mistake there
  destroys work or costs money.
- **No assumptions**, **plain English** and **verify your work** live at Layer 1, because no
  script can check them. They are strong rules, not guarantees. This is stated honestly.

## Which mechanism holds what, and why

| Mechanism | Holds | Why there |
|---|---|---|
| `CLAUDE.md` | Only rules needed on **every** turn | It is read every turn. Every line costs tokens forever, so it stays short. |
| Skill (`context-handoff`) | Handoff + checkpoint templates (~200 lines) | Needed a few times per task. As a skill it loads **only when used**. In `CLAUDE.md` it would waste tokens on every turn. |
| Slash commands | Things a developer starts on purpose | `/handoff`, `/checkpoint`, `/context`, `/unknowns`, `/resume-handoff` |
| Hooks | Rules that must not be negotiable | Git guard, model detection, context warnings, session index |
| `settings.json` | Wiring + permission rules | Registers hooks and the status line |
| Status line | Live facts the developer should always see | Model, real context %, active task |

## What was deliberately **not** built

- **No new subagents.** The system tells Claude to use the built-in `Explore` /
  `general-purpose` agents for heavy reading. Writing custom agents would add files without
  adding behavior.
- **No auto-compaction.** The system recommends `/compact`. It never runs it. Compaction
  loses information, so a human decides.
- **No automatic handoff writing.** Claude offers, the developer confirms.
- **No giant `CLAUDE.md`.** Detail was pushed into the skill on purpose.

## Requirements

- Claude Code (tested against CLI 2.1.246)
- `bash` and `node` — Claude Code already needs Node

If `node` is missing, every hook exits quietly and Claude Code keeps working normally.
Nothing breaks; you only lose the extra safety.
