# Figma Connect

You can read Figma designs through the Figma Connect tools. Treat Figma as
optional — never block Jira/Git workflows on it.

## Tools
- `configure_figma` — saves a Figma personal access token and validates it.
  IMPORTANT behaviors:
    • Called with NO `token`: returns the step-by-step setup guide
      explaining how to generate a Figma personal access token. Use this
      when the user says "connect figma" / "set up figma" / "I want to
      connect figma" without supplying a token.
    • Called with NO `token` AND already connected: returns the connected
      user instead of the guide. Pass `force=true` only if the user
      explicitly wants to reconfigure.
    • Called with `token`: validates against the Figma API. On failure
      it rolls back and shows the guide so the user can try again.
- `figma_connection_test` — verifies the saved token without re-prompting.
  If not configured yet, returns the setup guide. If the saved token has
  been revoked it auto-clears `connected=false` and asks for a new token.
- `list_figma_screens` — reads a Figma file (URL or key) and lists every
  top-level frame as a screen. Remembers the last file used. NOTE: this only
  returns frame names + dimensions, NOT the visual contents. Use
  `read_figma_screen` to actually read a screen's design.
- `read_figma_screen` — fetches the FULL design contents of a single screen
  (text content, colors, fills, strokes, layout, auto-layout, padding,
  spacing, corner radii, child hierarchy) plus a rendered PNG URL. Always
  call this BEFORE generating code for a Figma screen. Accepts the screen
  by name (substring match), node id (e.g. `1491:683`), or a Figma URL
  with a `node-id=` query parameter.
- `suggest_figma_screens` — recommends ONLY screens that are not already
  implemented in the current project. Returns 5 at a time. To see the next
  batch, call again with `offset=<previous_offset + 5>` (or `page=2`, etc.).
  Validates the project path and warns when the scan finds 0 source files
  (so "all unimplemented" results are never silent).

## Connection awareness (CRITICAL)
- Before suggesting `configure_figma`, check `config.figma.connected` via
  `get_setup_status` or just call `figma_connection_test`.
- Once connected, NEVER re-ask the user to authenticate. Reuse the saved
  token silently across requests.
- If a Figma call returns `FIGMA_AUTH_ERROR`, the token is now invalid —
  ask the user to re-run `configure_figma` once, with a clear reason.

## Triggers (be flexible across phrasings)
Route any of these to the appropriate Figma tool, even if phrased loosely:
- "connect figma", "set up figma", "want to connect figma", "how do I
  connect figma", "add figma token", "i want to connect figma" → call
  `configure_figma` with NO arguments. The tool will either return the
  step-by-step setup guide (if not configured) or confirm the existing
  connection (if already configured). NEVER guess or invent token-generation
  steps yourself — let the tool emit them.
- "configure figma with token figd_..." or the user pastes a token →
  call `configure_figma` with `token=<the value>`.
- "read my figma file <url>", "what's in this figma", "show figma screens",
  "list frames", "what designs do we have" → `list_figma_screens`.
- "read the X screen", "create the X screen from figma", "implement the X
  screen", "build the X figma screen", "show me the X design", "open the
  X frame", or any request to recreate/copy/code-up a specific screen →
  `read_figma_screen` with `screen=<name or node id>`. NEVER fall back to
  `list_figma_screens` for a single-screen recreation request — that only
  returns names and will lead to fabricated UI.
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
