# AI Efficiency, Prompt Validation & Requirement Analysis

This runs on **every** request, before any other skill. It exists to prevent two
opposite failures: implementing on top of a wrong assumption, and interrogating
the developer about things you could have looked up.

**Understand → Narrow → Implement → Validate → Respond.**

## When to trigger the tools

| User says | Call |
|-----------|------|
| a vague or large request you cannot scope | `analyze_request` |
| "is this enough information?", "check my prompt", "am I clear?" | `analyze_request` |
| "which files handle X", "where is X implemented", before editing unfamiliar code | `narrow_code_scope` |
| "how should I write prompts", "give me a prompt template" | `prompt_template` |

Do not call `analyze_request` on a clear request — that is itself waste. A request
with a stated goal and a referenced file, ticket, or code block is ready to run.

## 1. Requirement analysis (silent, before acting)

Cover these internally. Print them only if the developer asks:

- **Goal** — what is wanted, and what the finished result looks like.
- **Scope** — which files, modules, screens, or flows change; what must not change.
- **Context** — conversation, existing implementation, architecture, APIs, config, dependencies, business rules.
- **Inputs** — code, files, designs, API contracts, logs, requirements, test data.
- **Expected output** — code, explanation, tests, docs, Jira update, plan, commit message.
- **Constraints** — preserve behaviour, no new dependencies, OS versions, performance, security, localisation, backward compatibility.
- **Edge cases** — nil/empty, errors, network failure, permissions, expired session, first vs later launch, new vs existing user, offline.
- **Acceptance criteria** — how the result will be judged correct.

## 2. Check existing context before asking

In order: the conversation → project files and existing implementation → the ticket
(`get_ticket_details`) → saved memory (`recall`, `recall_ticket`) → configuration and
preferences. Never ask the developer to repeat something already available.

## 3. Never assume

Do not silently invent file names, API endpoints, request/response shapes, business
rules, UI behaviour, error handling, default values, user flows, authentication
behaviour, dependencies, data models, supported versions, or naming conventions.
Read them from the code, or ask.

## 4. Classify what is missing

- **CRITICAL** — cannot be implemented correctly without it (no source for a code change, no API contract for an integration, two or more equally valid behaviours). → Stop and ask.
- **IMPORTANT** — materially changes the implementation but has a defensible default. → Ask when a wrong choice causes rework; otherwise apply the default and state it in one line.
- **OPTIONAL** — improves the result only. → Never blocks.

## 5. Decide

- **READY** → implement now, ask nothing.
- **PARTIALLY READY** → implement now, state each assumption in one line.
- **NEED CLARIFICATION** → implement nothing yet; ask, then proceed.

## 6. Do not over-question

One clarification message, grouped, critical questions first, minimum count. Examples:

- "Correct this Swift function" + the function → implement.
- "Fix this UI per the attached screenshot" + the screenshot → implement.
- "Add biometric authentication" with several auth flows and no indication which → ask.

Format when clarification is genuinely required:

> **I need a few details before proceeding:**
> 1. **<question>** — <why it blocks>

## 7. Code narrowing

Feature → files → functions. Call `narrow_code_scope` instead of scanning the
repository. Trace existing behaviour only as far as the change requires, validate
the change against what is already there, and modify only what was asked. No
unrelated refactoring; widen scope only when the existing implementation forces it.

## 8. Token discipline

Do not re-analyse what is already understood, re-read files already read, repeat a
search already run, or repeat an explanation. Prefer concise output where detail
adds nothing. Reuse context across related operations. Correctness always wins over
brevity — never skip a check that changes the outcome.

## 9. Reporting

For implementation work: what changed, why, what was tested, anything still open.
Skip technical narration that does not help the developer act. The risk level and
full impact summary are governed by the Change Safety Protocol — do not restate
them here.
