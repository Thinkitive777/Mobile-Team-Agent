# Figma Connect

You can read Figma designs through the Figma Connect tools. Treat Figma as
optional — never block Jira/Git workflows on it.

## Tools
- `configure_figma` — saves a Figma personal access token and validates it.
  Require the token; do NOT prompt to reconfigure if already connected.
- `figma_connection_test` — verifies the saved token. Run this before
  Figma reads if you're unsure of state. If it succeeds, do NOT ask the user
  to reconnect.
- `list_figma_screens` — reads a Figma file (URL or key) and lists every
  top-level frame as a screen. Remembers the last file used.
- `suggest_figma_screens` — recommends ONLY screens that are not already
  implemented in the current project. Returns 5 at a time. To see the next
  batch, call again with `offset=<previous_offset + 5>` (or `page=2`, etc.).

## Connection awareness (CRITICAL)
- Before suggesting `configure_figma`, check `config.figma.connected` via
  `get_setup_status` or just call `figma_connection_test`.
- Once connected, NEVER re-ask the user to authenticate. Reuse the saved
  token silently across requests.
- If a Figma call returns `FIGMA_AUTH_ERROR`, the token is now invalid —
  ask the user to re-run `configure_figma` once, with a clear reason.

## Triggers (be flexible across phrasings)
Route any of these to the appropriate Figma tool, even if phrased loosely:
- "connect figma", "set up figma", "add figma token" → `configure_figma`
  (only if not already connected; otherwise confirm with `figma_connection_test`).
- "read my figma file <url>", "what's in this figma", "show figma screens",
  "list frames", "what designs do we have" → `list_figma_screens`.
- "suggest screens", "what should I build next from figma",
  "what's missing", "screens not implemented", "next 5 screens",
  "show me 5 more" → `suggest_figma_screens` (use `offset` to paginate).

## Suggestion behavior
- Always cap suggestions at 5 per response.
- Always offer "Show next 5" with the exact tool call to use.
- Skip screens that are already implemented in the project (the tool does
  this by scanning source filenames in the project directory).
- If the user changes the project or edits files, pass `refresh=true` to
  re-scan.

## Failure handling
- Network failure → explain and suggest `figma_connection_test`.
- Invalid token (`FIGMA_AUTH_ERROR`) → ask for a fresh token via
  `configure_figma`. Do not loop.
- Bad/missing file URL → ask the user for a Figma URL like
  `https://www.figma.com/file/<key>/Name`.
- Empty file → tell the user the file has no frames; do not error.
