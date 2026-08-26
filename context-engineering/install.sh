#!/usr/bin/env bash
# Install the Team Claude Code Engineering System into another repository.
#
#   ./install.sh /path/to/your/repo
#
# It copies CLAUDE.md, .claude/ and docs/handoffs/ into the target repo.
# It never overwrites an existing file without asking.
set -euo pipefail

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-}"

if [ -z "$TARGET" ]; then
  echo "Usage: ./install.sh /path/to/your/repo"
  exit 1
fi
if [ ! -d "$TARGET" ]; then
  echo "Not a directory: $TARGET"
  exit 1
fi

copy() { # copy <relative path>
  local rel="$1" from="$SRC/$1" to="$TARGET/$1"
  mkdir -p "$(dirname "$to")"
  if [ -e "$to" ]; then
    read -r -p "Exists: $rel — overwrite? [y/N] " a </dev/tty
    case "$a" in y|Y) ;; *) echo "  skipped $rel"; return ;; esac
  fi
  cp "$from" "$to"
  echo "  added $rel"
}

echo "Installing into: $TARGET"

# Core rules
copy CLAUDE.md

# Hooks
for f in "$SRC"/.claude/hooks/*; do copy ".claude/hooks/$(basename "$f")"; done
chmod +x "$TARGET"/.claude/hooks/*.sh 2>/dev/null || true

# Commands
for f in "$SRC"/.claude/commands/*.md; do copy ".claude/commands/$(basename "$f")"; done

# Scripts (used by /context)
for f in "$SRC"/.claude/scripts/*; do copy ".claude/scripts/$(basename "$f")"; done
chmod +x "$TARGET"/.claude/scripts/*.sh 2>/dev/null || true

# Skill
copy .claude/skills/context-handoff/SKILL.md

# Documentation
copy docs/guide/README.md
for f in "$SRC"/docs/guide/0*.md; do copy "docs/guide/$(basename "$f")"; done

# Handoff folder (committed) and checkpoint folder (not committed)
copy docs/handoffs/README.md
copy .claude/checkpoints/README.md
copy .claude/checkpoints/.gitignore

# Settings: merge instead of overwrite, because the repo may already have some.
DEST_SETTINGS="$TARGET/.claude/settings.json"
if [ -f "$DEST_SETTINGS" ]; then
  echo "  merging .claude/settings.json"
  node -e '
    const fs = require("fs");
    const [dst, src] = [process.argv[1], process.argv[2]];
    const a = JSON.parse(fs.readFileSync(dst, "utf8"));
    const b = JSON.parse(fs.readFileSync(src, "utf8"));
    a.permissions = a.permissions || {};
    a.permissions.ask = Array.from(new Set([...(a.permissions.ask || []), ...b.permissions.ask]));
    a.hooks = a.hooks || {};
    for (const [ev, entries] of Object.entries(b.hooks)) {
      a.hooks[ev] = a.hooks[ev] || [];
      for (const e of entries) {
        const cmd = e.hooks[0].command;
        const already = JSON.stringify(a.hooks[ev]).includes(cmd);
        if (!already) a.hooks[ev].push(e);
      }
    }
    if (!a.statusLine) a.statusLine = b.statusLine;
    fs.writeFileSync(dst, JSON.stringify(a, null, 2) + "\n");
  ' "$DEST_SETTINGS" "$SRC/.claude/settings.json"
  echo "  merged hooks + permissions into existing settings.json"
else
  copy .claude/settings.json
fi

echo
echo "Done."
echo "Next:"
echo "  1. cd $TARGET && git status   # review what was added"
echo "  2. Add a short '## This project' section at the end of CLAUDE.md"
echo "     (stack, build command, test command, folder layout)."
echo "  3. Commit .claude/ and CLAUDE.md so the whole team gets the same behavior."
echo "  4. Restart Claude Code so the new hooks load."
