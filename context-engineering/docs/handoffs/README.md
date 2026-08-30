# Context Handoffs

One file per finished task. Not one file for the whole project.

Naming: `YYYY-MM-DD-<type>-<short-name>.md`
Types: `feature` `bugfix` `refactor` `migration` `investigation` `config` `incident` `integration`

Why: after `/compact` or in a new session, Claude reads one small file instead of the
whole old conversation. This saves tokens and stops context loss.

Create one with `/handoff`. Load one with `/resume-handoff`.

Commit these files — they are useful for the whole team, not just for AI.
