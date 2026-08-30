# 2. Getting Started

## Install into a repository

```bash
./install.sh /path/to/your/repo
```

The script copies the kit and **never overwrites a file without asking**. If the target repo
already has `.claude/settings.json`, it **merges** instead: your existing `allow` list, your
existing hooks and your existing status line are kept.

What lands in the repo:

```
CLAUDE.md                          the rules (edit the bottom of this file)
.claude/settings.json              wiring
.claude/hooks/                     5 hooks
.claude/scripts/                   helper for /context
.claude/commands/                  5 slash commands
.claude/skills/context-handoff/    handoff + checkpoint formats
.claude/checkpoints/               working notes  (NOT committed)
docs/handoffs/                     finished-task records (committed)
```

## After installing — 3 steps

### 1. Add your project section

Open the new `CLAUDE.md` and add this at the bottom. This is the only part you must write
yourself:

```markdown
## This project

- Stack: Kotlin, Jetpack Compose, Hilt, Retrofit
- Build: `./gradlew assembleDebug`
- Unit tests: `./gradlew testDebugUnitTest`
- Lint: `./gradlew ktlintCheck`
- Layout: `feature/<name>/` — each feature has `ui/`, `domain/`, `data/`
- Do not touch: `legacy/` (being deleted in Q4)
```

Keep it under 30 lines. It is read on every turn.

Without this section Claude has to search for the build command every time. With it, Claude
just runs the right command. This is the single highest-value edit you can make.

### 2. Commit it

```bash
git add CLAUDE.md .claude docs/handoffs
git commit -m "Add team Claude Code engineering system"
```

`.claude/checkpoints/` has its own `.gitignore` and stays local. That is on purpose —
checkpoints are personal working notes.

### 3. Restart Claude Code

Hooks are loaded at start. A running session will not pick them up.

## Check that it worked

Look at the status line at the bottom of the terminal:

```
● Opus 5  │  ctx 12%  │  myapp
```

If you see the model and a context percentage, the status line and the state bridge work.

Then try this in a fresh session:

```
> what does this repo do?
```

Claude should answer without touching Git. Now try:

```
> commit that
```

Claude should ask for permission (the `ask` rule) — and if you ask it to commit when you did
**not** request it, the hook blocks it. See [Git Safety](05-git-safety.md).

## Updating an existing repo

Run `install.sh` again from an updated copy of the kit. It asks before overwriting each file,
so you can take the new hooks and keep your edited `CLAUDE.md`:

```
Exists: CLAUDE.md — overwrite? [y/N] n     ← keep your project section
Exists: .claude/hooks/git-guard.sh — overwrite? [y/N] y
```

## Removing it

```bash
rm -rf .claude/hooks .claude/scripts .claude/skills/context-handoff .claude/checkpoints
rm .claude/commands/{handoff,checkpoint,context,unknowns,resume-handoff}.md
```

Then delete the `hooks` and `statusLine` blocks from `.claude/settings.json`, and delete
`CLAUDE.md` if you do not want the rules. Keep `docs/handoffs/` — those are useful notes even
without the system.

To turn off only the Git guard for one command:

```bash
THINKTEAM_GIT_GUARD=off git rebase main
```
