#!/usr/bin/env bash
# PreToolUse(Bash) — Git safety guard.
#
# Blocks Git commands that write history or destroy work, unless the user asked
# for that Git action in their most recent message.
#
# The last user message is saved by turn-context.sh (UserPromptSubmit hook) to
#   $TMPDIR/claude-team-guard/<session_id>.prompt
#
# Exit 0 = allow. Exit 2 = block (stderr goes back to Claude).
# Disable for one shell with: THINKTEAM_GIT_GUARD=off
#
# The rule tables below are meant to be edited by the team.
set -uo pipefail

[ "${THINKTEAM_GIT_GUARD:-on}" = "off" ] && exit 0
command -v node >/dev/null 2>&1 || exit 0

INPUT=$(cat)
STATE_DIR="${TMPDIR:-/tmp}/claude-team-guard"

PARSED=$(printf '%s' "$INPUT" | node -e '
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{
  try{const j=JSON.parse(d);
    const cmd=((j.tool_input&&j.tool_input.command)||"").replace(/[\r\n]+/g," ");
    process.stdout.write((j.session_id||"none")+"\n"+cmd+"\n");
  }catch(e){process.stdout.write("none\n\n");}
});' 2>/dev/null)

SESSION_ID=$(printf '%s' "$PARSED" | sed -n '1p')
CMD=$(printf '%s' "$PARSED" | sed -n '2p')
[ -z "$CMD" ] && exit 0

# Not a git command -> allow immediately, no cost.
printf '%s' "$CMD" | grep -Eq '(^|[;&|(]|[[:space:]])git[[:space:]]' || exit 0

LAST_PROMPT=""
[ -f "$STATE_DIR/${SESSION_ID}.prompt" ] && LAST_PROMPT=$(cat "$STATE_DIR/${SESSION_ID}.prompt" 2>/dev/null)
LP=$(printf '%s' "$LAST_PROMPT" | tr '[:upper:]' '[:lower:]' | tr '\n' ' ')
C=$(printf '%s' "$CMD" | tr '[:upper:]' '[:lower:]')

block() {
  cat >&2 <<MSG
GIT GUARD BLOCKED THIS COMMAND

  $CMD

Reason: $1

Team rule: Claude must not run this Git command unless the user asked for it in
their last message. Changing code is not permission to touch Git.

What to do now:
  - Do NOT retry this command. Do NOT work around this hook.
  - Tell the user in one line what you want to run and why.
  - Ask them to reply with the Git action, for example: "$2"
MSG
  exit 2
}

# ---------------------------------------------------------------------------
# 1. Destructive operations. The user must NAME the operation.
#    fields: label ~ command regex ~ skip-if regex ~ user-intent regex ~ example reply
# ---------------------------------------------------------------------------
DESTRUCTIVE='
hard reset~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+reset[[:space:]].*--hard~__none__~reset --hard|hard reset|discard .*(change|work)|throw away .*(change|work)~reset --hard
git clean~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+clean[[:space:]]+-~__none__~git clean|clean .*untracked|remove .*untracked|delete .*untracked~run git clean -fd
discard file changes~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+checkout[[:space:]]+(--|\.)~__none__~checkout --|discard .*(change|file)|revert .*file~discard my changes in that file
git restore~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+restore[[:space:]]~--staged~git restore|discard .*(change|file)|restore .*file~restore that file
rebase~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+rebase~__none__~rebase~rebase onto main
force push~git[[:space:]].*push[[:space:]].*(--force|--force-with-lease|[[:space:]]-f([[:space:]]|$))~__none__~force.?push|push .*--force|force.with.lease~force push this branch
delete branch~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+branch[[:space:]].*-D~__none__~delete .*branch|branch -d~delete that branch
drop stash~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+stash[[:space:]]+(drop|clear)~__none__~drop .*stash|clear .*stash~drop the stash
rewrite history~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+(filter-branch|filter-repo)~__none__~filter-branch|filter-repo|rewrite history~run git filter-branch
delete ref~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+update-ref[[:space:]]+-d~__none__~update-ref -d|delete .*ref~delete that ref
git rm~git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+rm[[:space:]]~__none__~git rm|remove .*from git|delete .*file~git rm those files
'

while IFS='~' read -r LABEL CMD_RE SKIP_RE INTENT_RE EXAMPLE; do
  [ -z "${LABEL:-}" ] && continue
  printf '%s' "$C" | grep -Eq "$CMD_RE" || continue
  if [ "$SKIP_RE" != "__none__" ] && printf '%s' "$C" | grep -Eq "$SKIP_RE"; then continue; fi
  if printf '%s' "$LP" | grep -Eq "$INTENT_RE"; then exit 0; fi
  block "'$LABEL' can destroy work that is not committed. The user did not ask for it in their last message." "$EXAMPLE"
done <<< "$DESTRUCTIVE"

# ---------------------------------------------------------------------------
# 2. Write operations (add / commit / push / merge / tag / stash ...).
#    Any clear Git request in the last message is enough.
# ---------------------------------------------------------------------------
WRITE_RE='git([[:space:]]+-[cC][[:space:]]+[^[:space:]]+)*[[:space:]]+(add|commit|push|merge|revert|cherry-pick|tag|stash|am|apply)([[:space:]]|$)'
INTENT_RE='commit|push|stage|staging|git add|pull request|(^| )pr( |$)|merge|revert|cherry.?pick|(^| )tag( |$)|ship (it|this)|stash|raise (a )?pr'
AFFIRM_RE='^(yes|yeah|yep|yup|ya|ok|okay|k|sure|do it|go ahead|proceed|please do|please|confirm|confirmed|correct|right|haan|ha|thik hai|theek hai)( |$|,|.)'

if printf '%s' "$C" | grep -Eq "$WRITE_RE"; then
  if printf '%s' "$LP" | grep -Eq "$INTENT_RE"; then exit 0; fi
  # A short "yes" right after Claude asked for permission also counts.
  if [ "${#LP}" -le 40 ] && printf '%s' "$LP" | grep -Eq "$AFFIRM_RE"; then exit 0; fi
  block "Writing to Git (add / commit / push / merge / tag / stash) needs an explicit request. The user's last message did not ask for any Git action." "commit these changes"
fi

exit 0
