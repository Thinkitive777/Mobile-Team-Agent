# 5. Git Safety

## The rule

**Changing code is not permission to touch Git.**

Claude may only run a Git write command if you asked for a Git action **in your last message**.

| You said | Claude may |
|---|---|
| "Fix the login bug" | read Git only — `status`, `diff`, `log`, `show` |
| "Commit these changes" | `git add`, `git commit` |
| "Push this branch" | `git push` |
| "Create a PR" | `git add`, `git commit`, `git push` |

Permission lasts **one turn**. It does not carry over to the next message.

## Three categories

### Always allowed — reading

`git status` · `git diff` · `git log` · `git show` · `git branch` (listing) ·
`git remote -v` · `git stash list`

Claude needs these to understand your work. They change nothing.

### Needs a Git request in your last message — writing

`git add` · `git commit` · `git push` · `git merge` · `git revert` · `git cherry-pick` ·
`git tag` · `git stash` · `git am` · `git apply`

Any clear Git word in your message unlocks these for that turn: *commit, push, stage, git add,
merge, revert, tag, pull request, PR, ship it, stash*.

A short "yes" / "ok" / "go ahead" / "haan" also counts, because it usually answers a question
Claude just asked. This is limited to messages of 40 characters or less.

### Needs you to NAME the operation — destructive

| Operation | What it can destroy |
|---|---|
| `git reset --hard` | all uncommitted work |
| `git clean -fd` | untracked files |
| `git checkout -- <file>` / `git checkout .` | changes in those files |
| `git restore <file>` | changes in those files |
| `git rebase` | history, on conflict |
| `git push --force` / `--force-with-lease` | someone else's commits on the remote |
| `git branch -D` | an unmerged branch |
| `git stash drop` / `clear` | stashed work |
| `git filter-branch` / `filter-repo` | the whole history |
| `git update-ref -d` | a ref |
| `git rm` | files |

For these, "commit these changes" is **not** enough. You have to name that operation:
"do a hard reset", "force push this branch", "rebase onto main", "drop the stash".

Permission for one destructive operation never spreads to another.

## Real test results

Verified by running the hook:

| Your last message | Command | Result |
|---|---|---|
| "fix the login bug" | `git status` | allowed |
| "fix the login bug" | `git add . && git commit -m "fix"` | **blocked** |
| "fix the login bug" | `git push origin HEAD` | **blocked** |
| "commit these changes" | `git add -A` | allowed |
| "commit these changes" | `git commit -m "fix login"` | allowed |
| "commit these changes" | `git push` | allowed |
| "commit these changes" | `git reset --hard` | **blocked** |
| "yes" | `git commit -m x` | allowed |
| "yes" | `git clean -fd` | **blocked** |
| "please do a hard reset, discard my changes" | `git reset --hard HEAD` | allowed |
| "please do a hard reset, discard my changes" | `git push --force` | **blocked** |
| "force push this branch" | `git push --force-with-lease origin HEAD` | allowed |
| "force push this branch" | `git rebase main` | **blocked** |
| anything | `npm test`, `ls -la`, `./gradlew` | allowed |

## What a block looks like

```
GIT GUARD BLOCKED THIS COMMAND

  git add . && git commit -m "fix"

Reason: Writing to Git (add / commit / push / merge / tag / stash) needs an explicit
request. The user's last message did not ask for any Git action.

Team rule: Claude must not run this Git command unless the user asked for it in
their last message. Changing code is not permission to touch Git.

What to do now:
  - Do NOT retry this command. Do NOT work around this hook.
  - Tell the user in one line what you want to run and why.
  - Ask them to reply with the Git action, for example: "commit these changes"
```

Claude sees this text and asks you. It is told not to work around it.

## How it works

Two hooks work together:

```
You type a message
      │
      ▼
UserPromptSubmit  →  turn-context.sh saves your message to
                     $TMPDIR/claude-team-guard/<session_id>.prompt
      │
      ▼
Claude decides to run: git commit -m "fix"
      │
      ▼
PreToolUse(Bash)  →  git-guard.sh reads your saved message
                     and decides: allow (exit 0) or block (exit 2)
```

Because the decision is made by a shell script reading **your actual words**, the model cannot
argue its way past it.

There is also a second layer: `.claude/settings.json` has `permissions.ask` rules for the same
commands, so Claude Code itself asks you before running them.

## Changing the rules

The rule tables live in `.claude/hooks/git-guard.sh` and are plain text, meant to be edited.

Destructive table — five fields separated by `~`:

```
label ~ command regex ~ skip-if regex ~ user-intent regex ~ example reply
```

```
hard reset~git...reset[[:space:]].*--hard~__none__~reset --hard|hard reset|discard .*(change|work)~reset --hard
```

- **command regex** — what to catch
- **skip-if regex** — an exception, or `__none__` (used to let `git restore --staged` through)
- **user-intent regex** — what you must say to allow it
- **example reply** — printed in the block message so you know what to type

Write operations are one line near the bottom: `WRITE_RE`, `INTENT_RE`, `AFFIRM_RE`.

Add a word to `INTENT_RE` if your team says something the guard does not recognise.

## Escape hatch

For a single command:

```bash
THINKTEAM_GIT_GUARD=off git rebase main
```

Use it when the guard is wrong, not to skip the rule.

## Honest limit

`--dangerously-skip-permissions` (bypass mode) can get around permission rules. A developer who
wants to get past their own tooling always can. **This system stops accidents, not intent.**
