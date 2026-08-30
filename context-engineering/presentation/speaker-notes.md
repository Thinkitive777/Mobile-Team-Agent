# Speaker notes — Claude Code Team Kit

**Target: 10–12 minutes, plus questions.** Open `deck.html` in a browser, press `F` for
fullscreen. `→` next, `←` back, `O` for the slide overview, `T` to flip light/dark.

If you only get 5 minutes: slides **1 → 2 → 5 → 7 → 12 → 13** — problems, Git rules, task
summary files, what is not enforced, summary.

---

## 1 · Title  *(30 sec)*

> "I built a shared Claude Code setup for the team. It's a folder we commit to a repo —
> nothing for anyone to install. I want to show you what it does and how it works."

Point at the status line on screen. Say it is output from the running tool, not a mock-up.

## 2 · The problem  *(90 sec)*

Do not read the four cards out. Pick one and describe when it happened to you. The Git one is
usually the clearest example.

> "I asked it to fix a bug. It fixed the bug, then committed and pushed. Nobody asked it to."

Then: "Each of the four has a specific mechanism in the setup. The rest of the deck is those
mechanisms."

## 3 · What I built  *(60 sec)*

The point of this slide: it is files in the repo. No service, no dependency, nothing running in
the background.

> "A developer clones the repo, opens Claude Code, and the rules are already active. There is
> no per-person setup step to forget."

## 4 · Three enforcement levels  *(90 sec)* — **the most important slide**

This is the design decision, so slow down here.

> "The simple approach is to put rules in a text file and rely on the model following them.
> That is acceptable for style rules. It is not acceptable for `git reset --hard`.
> So Git commands and model detection are enforced by a shell script that returns exit 2 and
> stops the command. The model cannot override it."

Then state the limit directly:

> "Rules that cannot be checked by a script — like 'do not make assumptions' — are at layer one
> only, and the documentation says they are not enforced."

## 5 · Git safety  *(90 sec)*

Say clearly: **these rows are output from running the hook**, not written by hand.

Walk two rows only:

- "fix the login bug" → `git commit` → blocked
- "commit these changes" → `git commit` → allowed, but `git reset --hard` still blocked

> "Permission applies to one message only. Asking for one destructive command does not permit
> a different one — 'commit this' does not allow a hard reset."

## 6 · How the guard works  *(60 sec)*

> "One hook saves the developer's message. The other reads it before any Bash command runs and
> exits 0 or 2. The decision comes from the message text, not from the model."

Mention the off switch, for the case where the guard blocks something legitimate.

## 7 · Context handoff  *(90 sec)*

> "Long tasks fill the context window. Compacting removes the decisions, the approaches that
> did not work, and the findings. So before compacting, it writes one file: what changed, what
> was decided, what is risky, what is next."

Then the team point:

> "The files are committed. If I am on leave, another developer opens the file and continues
> from it."

## 8 · Context budget  *(60 sec)*

> "The percentage is not estimated. Claude Code sends `context_window.used_percentage` to the
> status line — I found it in the CLI's own schema and read that value. If it is not
> available, the tool reports unknown instead of guessing."

Then:

> "It warns once at 80% and once at 90%, not on every reply."

## 9 · Model safety  *(45 sec)*

> "Fable 5 can use more of the expensive allocation. When it is active it shows in the status
> line and at the top of every reply, and the first time it asks whether that was intended. The
> hook reads which model produced the last reply from the transcript."

## 10 · Token discipline  *(60 sec)*

> "CLAUDE.md is re-read on every turn, so its length is a permanent token cost. The handoff
> template is 209 lines, so it is in a skill instead — it loads only when a handoff is being
> written. The hooks print nothing unless a warning applies, so a normal turn adds no tokens."

## 11 · Adoption  *(45 sec)*

> "One command per repo, about half an hour of work once. It merges into an existing settings
> file instead of replacing it. Removing it is two commands."

## 12 · What this does not enforce  *(60 sec)*

Do not rush this slide.

> "Bypass permission mode gets around the permission rules. This prevents accidental commands,
> not deliberate ones. The same list is in the documentation."

## 13 · Summary  *(30 sec)*

> "It blocks unrequested Git write commands, blocks destructive Git unless it is named, writes
> a task summary before compacting, warns at 80% and 90% context, and shows the active model —
> the same for every developer on the repo. There is an eight-chapter manual, and every
> behaviour in this deck was produced by running the hooks."

Then stop and take questions.

---

# Likely questions

**"Does this slow developers down?"**
Read-only Git commands are unaffected. It stops only on write and destructive commands, and
when it does, it prints the exact sentence to reply with — so it costs one line.

**"What if the guard blocks something legitimate?"**
`THINKTEAM_GIT_GUARD=off <command>` skips it for one command. The rule tables are plain text
inside the script and can be edited.

**"Can it be bypassed?"**
Yes, with bypass permission mode. It is on the limits slide and in the documentation. It
prevents accidental commands, not deliberate ones.

**"Who maintains it?"**
About 950 lines total across shell, JS and markdown, with an 8-chapter manual. No dependencies
beyond bash and node, which Claude Code already requires. Most behaviour is changed by editing
tables rather than code.

**"What if Claude Code changes?"**
Every hook exits 0 if something is missing or a script errors, so Claude Code keeps working.
The worst case is losing the extra checks, not losing Claude Code.

**"Does this work with our existing setup?"**
`install.sh` merges into an existing `settings.json` — tested against a repo that already had
its own hooks and permissions. Existing config survives.

**"Why not just tell people to write better prompts?"**
That is layer one, and it is included. It depends on the developer remembering every time.
Layers two and three do not.

**"How do we know it works?"**
Every row in the Git table is hook output from an actual run. The installer was tested into a
clean repo and into a repo with existing settings. The line counts in the documentation were
measured, not estimated.
