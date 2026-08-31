# 8. Troubleshooting

## Nothing happens — no status line, no blocking

**Restart Claude Code.** Hooks are loaded when the session starts. A session that was already
running will not pick up new hooks.

Then check the files are actually there:

```bash
ls .claude/hooks/ .claude/scripts/
node -e 'JSON.parse(require("fs").readFileSync(".claude/settings.json","utf8"))' && echo "settings OK"
```

## The status line shows only `claude`

That is the fallback when `node` is missing or the script failed. Test it by hand:

```bash
printf '{"session_id":"t","model":{"id":"claude-opus-5","display_name":"Opus 5"},"context_window":{"used_percentage":42,"context_window_size":200000}}' \
  | bash .claude/hooks/statusline.sh
```

Expected: `● Opus 5  │  ctx 42%`

## `/context` says `unknown`

Normal in two cases:

- the status line has not run yet in this session — send one message and try again
- the state file is older than 5 minutes, so it is ignored on purpose

It will never print a made-up percentage. That is the intended behavior.

## Claude was blocked but I DID ask for the commit

The guard reads your **last** message only. If you said "commit this" three messages ago and
then said "also fix the spacing", the permission is gone — by design.

Say the Git action again:

```
> commit these changes
```

If your team uses a word the guard does not know, add it to `INTENT_RE` in
`.claude/hooks/git-guard.sh`.

## Claude was allowed to commit but I did NOT ask

Look at your message. Words like *commit, push, merge, stage, PR* unlock write commands for
that turn, even inside another sentence. "Don't push this yet" contains *push*.

This is a known trade-off: the guard is a keyword matcher, not a mind reader. `CLAUDE.md` §5 is
the second layer that should stop Claude from acting on it.

To make it stricter, tighten `INTENT_RE` — for example require the word at the start of the
message.

## The guard blocks something legitimate

One command:

```bash
THINKTEAM_GIT_GUARD=off git rebase main
```

Permanently: edit the tables in `.claude/hooks/git-guard.sh`. See
[Git Safety](05-git-safety.md#changing-the-rules).

## Claude keeps offering a handoff for small things

`CLAUDE.md` §10 and the skill both say not to offer for a question, a one-line change or a
lookup. If it still happens, make it concrete in your `## This project` section:

```markdown
- Do not offer a Context Handoff for changes under ~20 lines.
```

## Claude wrote a second checkpoint file for the same task

It should reuse the slug in `.claude/checkpoints/ACTIVE`. Check that file exists:

```bash
cat .claude/checkpoints/ACTIVE
```

If it is missing, `/handoff` deleted it (correct — that task is finished) or it was never
written. Delete the extra file and run `/checkpoint` again.

## Context warnings fire too often / not at all

Each band fires once per session. The state is in
`${TMPDIR:-/tmp}/claude-team-guard/<session_id>.ctxband`.

To change the thresholds, edit `turn-context.js`:

```js
const band = pct >= 90 ? 90 : pct >= 80 ? 80 : 0;
```

## The Fable warning does not appear on the first message

Expected. The hook reads the **last assistant message** to find the model, and on turn 1 there
is none. The status line is correct from the start.

## Claude claims it switched the model

It cannot. `CLAUDE.md` and the Fable hook both say so. Change it yourself with `/model`. If
Claude says otherwise, that is a rule violation worth reporting to whoever maintains the setup.

## Handoffs are not listed at session start

`session-start.sh` lists up to 5 files from `docs/handoffs/`, skipping `README.md`. Check:

```bash
CLAUDE_PROJECT_DIR="$PWD" bash .claude/hooks/session-start.sh
```

Empty output means no handoffs exist yet. That is correct on a new repo.

## Testing a hook by hand

Every hook reads JSON on stdin. This is the fastest way to see what it does:

```bash
# git guard
printf '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push"}}' \
  | bash .claude/hooks/git-guard.sh; echo "exit=$?"   # 2 = blocked

# save a user message first, then try again
printf '{"session_id":"t","transcript_path":"/none","prompt":"push this branch"}' \
  | bash .claude/hooks/turn-context.sh
printf '{"session_id":"t","tool_name":"Bash","tool_input":{"command":"git push"}}' \
  | bash .claude/hooks/git-guard.sh; echo "exit=$?"   # 0 = allowed
```

---

# What cannot be enforced

Being honest about this matters more than the feature list.

| Cannot be enforced | Why | What holds instead |
|---|---|---|
| Bypass mode | `--dangerously-skip-permissions` gets past permission rules | The `PreToolUse` hook is stronger, but a determined developer always wins. This stops accidents, not intent. |
| "No assumptions" | No script can tell a fact from a guess | `CLAUDE.md` §1-2. Strong rule, not a guarantee. |
| "Verify your work" | No script knows what should have been tested | `CLAUDE.md` §6, plus the handoff `Validation` section which is hard to fake convincingly |
| New task detection | A hook cannot tell a new task from a follow-up question | Model judgement, `CLAUDE.md` §14 |
| Subagent use for heavy reading | Not mechanically checkable | `CLAUDE.md` §9 |
| Git intent matching | It is a keyword matcher. "Don't push this yet" contains *push*. | Two layers: the guard plus `CLAUDE.md` §5 |
| Fable warning on turn 1 | No assistant message exists yet to read the model from | The status line, which is correct from the start |
| Live context % inside Claude | Claude cannot read its own status line | A state file, so the number can be seconds old and is `unknown` before the first refresh |
| Sharing checkpoints | They are gitignored on purpose | Use `/handoff` to hand work to a teammate |
