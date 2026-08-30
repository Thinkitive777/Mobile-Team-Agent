# 6. Model Safety (Fable 5)

## Why

Claude Code can run different models. Claude Fable 5 is a real model, and it can use more of
the team's expensive allocation. Nobody should be on it by accident.

## What you see

**Always** — in the status line:

```
⚠️  FABLE 5 — HIGH USAGE  │  ctx 34%  │  myapp
```

versus a normal session:

```
● Opus 5  │  ctx 34%  │  myapp
```

**In every reply** while Fable is active:

```
# **⚠️ FABLE 5 IS ACTIVE — USAGE MAY BE HIGHER**
```

**On the first Fable turn only**, Claude also asks:

> You are using Claude Fable 5. It may use more of the expensive team allocation.
> Do you want to continue with Fable 5 for this task?

It waits for your answer before starting heavy work. After you confirm, the heading keeps
appearing on every reply, but the question is not asked again.

If you switch away from Fable and later switch back, the question comes back once.

## How the detection works

It is not a guess. The hook reads the conversation transcript, walks backwards to the last
assistant message, and takes `message.model` — the model that actually produced that reply.

```js
if (e.type === "assistant" && e.message && e.message.model) model = e.message.model;
```

If that string contains `fable`, the warning is injected into Claude's context for that turn.

Two independent sources:

| Source | Shows | When |
|---|---|---|
| Status line | `model.id` from Claude Code | immediately, every refresh |
| `turn-context.js` | last assistant `message.model` from the transcript | from the second turn on |

## Switching model

Claude **cannot** change its own model, and the system tells it never to claim otherwise.

You change it:

```
/model
```

## Limits

- On the very first turn of a session there is no assistant message yet, so the in-reply
  warning starts from turn 2. The status line is correct from the start.
- If the transcript cannot be read, no warning is injected — the hook fails quietly rather
  than blocking your work.
- The warning is an instruction to the model, so it is Layer 1 (see
  [Overview](01-overview.md)). The status line is the reliable part.
