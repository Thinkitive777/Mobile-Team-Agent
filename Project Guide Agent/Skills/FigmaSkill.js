/// MARK: - Figma Skill
/// Figma Connect integration: configures the Figma personal access token,
/// validates connectivity, reads design files, extracts screens/frames, and
/// recommends screens that are not yet implemented in the local project.

const fs = require("fs");
const path = require("path");
const BaseSkill = require("./Core/BaseSkill");
const { extractFileKey, summarizeNodeTree } = require("../Services/figma-client");

const DEFAULT_PAGE_SIZE = 5;

// Filename extensions that count as "implementation" sources we scan to detect
// whether a Figma screen has already been built in the project.
const SOURCE_EXTENSIONS = new Set([
  ".swift", ".kt", ".java", ".m", ".mm", ".dart",
  ".js", ".jsx", ".ts", ".tsx", ".vue", ".svelte",
  ".html", ".xml", ".storyboard", ".xib",
]);

const IGNORED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", "out", ".next",
  ".idea", ".vscode", "Pods", "DerivedData", "vendor", "target",
  ".gradle", "coverage", ".nuxt", ".turbo", ".cache",
]);

class FigmaSkill extends BaseSkill {
  constructor() {
    super();
    this.name = "FigmaSkill";
  }

  getTools() {
    return [
      {
        name: "configure_figma",
        description: "Configure Figma Connect. Call with NO arguments to receive step-by-step instructions for generating a Figma personal access token (use this when the user says 'connect figma' / 'set up figma' without providing a token). Call with 'token' to save and validate it. If already connected, returns connected status unless force=true is also passed.",
        inputSchema: {
          type: "object",
          properties: {
            token: { type: "string", description: "Figma personal access token (figd_...). Omit to receive setup instructions." },
            force: { type: "boolean", description: "Force re-configure even if already connected." },
          },
        },
      },
      {
        name: "figma_connection_test",
        description: "Verify the saved Figma token works and return the connected user. Use this before any Figma read to confirm the connection — do NOT ask the user to reconfigure if already connected.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "list_figma_screens",
        description: "Read a Figma design file and list every top-level frame (screen). Accepts a Figma file URL or file key. Remembers the last file so it can be omitted on subsequent calls.",
        inputSchema: {
          type: "object",
          properties: {
            file: { type: "string", description: "Figma file URL or file key. Optional if a file was used previously." },
            limit: { type: "number", description: "Max screens to display (default: 50)" },
          },
        },
      },
      {
        name: "read_figma_screen",
        description: "Read the FULL design contents of a single Figma screen/frame so the agent can faithfully recreate it in code. Returns a structured spec with text content, colors, fills, strokes, layout (auto-layout, padding, spacing), corner radii, child hierarchy, plus a rendered PNG URL of the screen. Use this BEFORE generating code for any Figma screen — `list_figma_screens` only returns names. Accepts the screen by name (substring match), node id (e.g. '1491:683'), or a Figma URL containing a node-id query parameter.",
        inputSchema: {
          type: "object",
          properties: {
            screen: { type: "string", description: "Screen name (substring/case-insensitive match against frames in the file) OR a Figma node id like '1491:683'." },
            file: { type: "string", description: "Figma file URL or file key. Optional if a file was used previously. If a Figma URL with ?node-id=... is passed here, that node id is used automatically." },
            include_image: { type: "boolean", description: "Also return a rendered PNG URL of the screen (default: true)." },
            image_scale: { type: "number", description: "Render scale for the PNG (1-4, default 2)." },
            max_depth: { type: "number", description: "How deep to walk the node tree (default 12)." },
            max_nodes: { type: "number", description: "Hard cap on nodes returned (default 400). Increase only if a screen is genuinely huge." },
          },
        },
      },
      {
        name: "suggest_figma_screens",
        description: "After reading a Figma file, suggest screens to implement that are NOT yet present in the current project. Returns 5 suggestions at a time. Pass page=2 (or offset=5) to get the next 5. Pass refresh=true to re-scan the project and Figma file.",
        inputSchema: {
          type: "object",
          properties: {
            file: { type: "string", description: "Figma file URL or key. Optional if previously used." },
            page: { type: "number", description: "1-indexed page (default 1). Each page shows 5 screens." },
            offset: { type: "number", description: "Alternative to page: starting index (0-based)." },
            page_size: { type: "number", description: "Override page size (default 5)." },
            refresh: { type: "boolean", description: "Force re-fetch the Figma file and re-scan the project." },
            project_path: { type: "string", description: "Override the project path to scan. Defaults to REPO_PATH env or cwd." },
          },
        },
      },
    ];
  }

  async handleTool(name, args, context) {
    const { config, saveConfig, getFigmaClient, getRepoPath, maskToken, isTokenMasked } = context;

    switch (name) {
      case "configure_figma": {
        const rawToken = typeof args.token === "string" ? args.token.trim() : "";
        const force = !!args.force;
        const alreadyConnected = !!(config.figma && config.figma.connected && config.figma.token && !isTokenMasked(config.figma.token));

        // CASE 1 — no token provided. Either show "already connected" or the setup guide.
        if (!rawToken) {
          if (alreadyConnected && !force) {
            let out = `Figma is already connected.\n`;
            if (config.figma.user) out += `Connected as: ${config.figma.user}\n`;
            out += `Token: ${maskToken(config.figma.token)}\n\n`;
            out += `You can use 'list_figma_screens' or 'suggest_figma_screens' right away.\n`;
            out += `If you want to switch tokens, run 'configure_figma' with token=<new_token> (or force=true to start over).`;
            return this.textResponse(out);
          }
          return this.textResponse(buildFigmaSetupGuide());
        }

        // CASE 2 — token provided. Validate format, then test against the API.
        if (isTokenMasked(rawToken)) {
          return this.errorResponse(
            "The provided token looks like a masked placeholder (e.g. '****' or 'tok_****').\n\n" +
            buildFigmaSetupGuide()
          );
        }
        if (rawToken.length < 20) {
          return this.errorResponse(
            "The provided token is too short to be a valid Figma personal access token.\n\n" +
            buildFigmaSetupGuide()
          );
        }
        if (!/^figd_[A-Za-z0-9_\-]+$/.test(rawToken)) {
          // Modern Figma personal access tokens start with `figd_`. We accept
          // anything that looks token-shaped, but warn loudly if not.
          // (Older tokens may exist; do not hard-fail here.)
        }

        if (!config.figma) {
          config.figma = { connected: false, token: null, user: null, last_file_key: null };
        }
        // Snapshot previous values so we can roll back cleanly on failure.
        const prev = { ...config.figma };
        config.figma.token = rawToken;
        config.figma.connected = true;

        try {
          const client = getFigmaClient();
          const result = await client.testConnection();
          config.figma.user = result.user;
          saveConfig();
          let out = `Figma configured successfully.\n`;
          out += `Connected as: ${result.user}${result.email ? ` (${result.email})` : ''}\n`;
          out += `Token: ${maskToken(rawToken)}\n\n`;
          out += `Next steps:\n`;
          out += `  1. Run 'list_figma_screens' with a Figma file URL to read your designs.\n`;
          out += `  2. Then 'suggest_figma_screens' to see which screens aren't implemented yet (5 at a time).`;
          return this.textResponse(out);
        } catch (err) {
          // Roll back to previous state — saved token did not validate.
          config.figma = prev;
          saveConfig();
          let msg = `Figma token validation failed: ${err.message}\n\n`;
          if (err.code === 'FIGMA_AUTH_ERROR') {
            msg += `Your token appears to be invalid, expired, or revoked.\n\n`;
          } else if (err.code === 'FIGMA_NETWORK_ERROR') {
            msg += `Could not reach Figma. Check your internet connection and try again — your token was NOT saved.\n\n`;
            return this.errorResponse(msg);
          }
          msg += buildFigmaSetupGuide();
          return this.errorResponse(msg);
        }
      }

      case "figma_connection_test": {
        if (!config.figma || !config.figma.connected || !config.figma.token || isTokenMasked(config.figma.token)) {
          return this.textResponse(
            `Figma is not configured yet.\n\n` + buildFigmaSetupGuide()
          );
        }
        try {
          const client = getFigmaClient();
          const result = await client.testConnection();
          // Refresh stored user — token still works
          config.figma.user = result.user;
          saveConfig();
          let out = `Figma connection OK.\n`;
          out += `User: ${result.user}\n`;
          if (result.email) out += `Email: ${result.email}\n`;
          if (config.figma.last_file_key) out += `Last file: ${config.figma.last_file_key}\n`;
          return this.textResponse(out);
        } catch (err) {
          if (err.code === 'FIGMA_AUTH_ERROR') {
            // Token is now invalid — clear connected flag so the agent prompts re-auth.
            config.figma.connected = false;
            saveConfig();
            return this.errorResponse(
              `Figma token is no longer valid (${err.message}).\n\n` +
              `It may have been revoked or expired. Generate a fresh token and run 'configure_figma' again.\n\n` +
              buildFigmaSetupGuide()
            );
          }
          throw err; // network/other — let central handler format it
        }
      }

      case "list_figma_screens": {
        if (!config.figma || !config.figma.connected || !config.figma.token || isTokenMasked(config.figma.token)) {
          return this.errorResponse(
            `Figma is not connected yet.\n\n` + buildFigmaSetupGuide()
          );
        }
        const fileInput = args.file || config.figma.last_file_key;
        if (!fileInput) {
          return this.errorResponse(
            "No Figma file specified and no previous file remembered.\n" +
            "Pass 'file' as a Figma URL or file key — for example:\n" +
            "  https://www.figma.com/design/<key>/<name>\n" +
            "  https://www.figma.com/file/<key>/<name>"
          );
        }
        const fileKey = extractFileKey(fileInput);
        if (!fileKey) {
          return this.errorResponse(
            `Could not parse a Figma file key from "${fileInput}".\n` +
            `Expected a Figma URL like https://www.figma.com/design/<key>/Name or the bare file key.`
          );
        }

        const client = getFigmaClient();
        const file = await client.getFile(fileKey);
        const screens = client.extractScreens(file.document);

        // Remember for next call
        config.figma.last_file_key = fileKey;
        saveConfig();

        if (screens.length === 0) {
          return this.textResponse(
            `Figma file "${file.name}" loaded, but no top-level frames (screens) were found. ` +
            `Make sure your design has FRAME nodes inside its pages.`
          );
        }

        const limit = args.limit && args.limit > 0 ? args.limit : 50;
        const shown = screens.slice(0, limit);

        let out = `Figma file: ${file.name}\n`;
        out += `Key: ${fileKey}\n`;
        if (file.lastModified) out += `Last modified: ${file.lastModified}\n`;
        out += `Total screens: ${screens.length}\n`;
        if (shown.length < screens.length) {
          out += `Showing first ${shown.length} (raise 'limit' to see more):\n\n`;
        } else {
          out += `\n`;
        }
        const byPage = new Map();
        for (const s of shown) {
          if (!byPage.has(s.page)) byPage.set(s.page, []);
          byPage.get(s.page).push(s);
        }
        for (const [page, list] of byPage.entries()) {
          out += `Page: ${page}\n`;
          for (const s of list) {
            const dims = s.width && s.height ? ` (${s.width}×${s.height})` : '';
            out += `  - ${s.name}${dims}\n`;
          }
          out += `\n`;
        }
        out += `Tip: run 'suggest_figma_screens' to see which of these aren't implemented yet (5 at a time).`;
        return this.textResponse(out);
      }

      case "read_figma_screen": {
        if (!config.figma || !config.figma.connected || !config.figma.token || isTokenMasked(config.figma.token)) {
          return this.errorResponse(
            `Figma is not connected yet.\n\n` + buildFigmaSetupGuide()
          );
        }

        // The user can pass either a Figma URL with a `node-id` query param or
        // the bare file key. If a node id is in the URL we use it directly,
        // otherwise we fall back to fuzzy-matching the screen name.
        const fileInput = args.file || config.figma.last_file_key;
        if (!fileInput) {
          return this.errorResponse(
            "No Figma file specified and no previous file remembered. Pass 'file' as a Figma URL or file key."
          );
        }
        const fileKey = extractFileKey(fileInput);
        if (!fileKey) {
          return this.errorResponse(
            `Could not parse a Figma file key from "${fileInput}". Expected a Figma URL or bare file key.`
          );
        }

        // Pull a node id from the URL's `node-id=` param if present. Figma
        // URLs use `1491-683`; the API expects `1491:683`. Normalize.
        const urlNodeId = extractNodeIdFromUrl(args.file) || extractNodeIdFromUrl(fileInput);

        // Decide which node id to load.
        const screenArg = typeof args.screen === 'string' ? args.screen.trim() : '';
        const looksLikeNodeId = /^\d+[:\-]\d+$/.test(screenArg);

        const client = getFigmaClient();
        let targetNodeId = null;
        let targetMeta = null; // { name, page, width, height }

        if (looksLikeNodeId) {
          targetNodeId = screenArg.replace('-', ':');
        } else if (urlNodeId && !screenArg) {
          targetNodeId = urlNodeId;
        } else {
          // Resolve a name (or fall back to the URL node id) by listing screens.
          // We need the full file once to map name → id; the result is small.
          const file = await client.getFile(fileKey);
          const screens = client.extractScreens(file.document);
          if (screens.length === 0) {
            return this.errorResponse(
              `Figma file "${file.name}" has no top-level frames. Nothing to read.`
            );
          }

          // Remember the file so subsequent calls don't need it.
          config.figma.last_file_key = fileKey;
          saveConfig();

          if (!screenArg && urlNodeId) {
            targetNodeId = urlNodeId;
            const match = screens.find((s) => s.id === urlNodeId);
            if (match) targetMeta = match;
          } else if (!screenArg) {
            return this.errorResponse(
              `Pass 'screen' as the screen name or node id you want to read.\n` +
              `For example: read_figma_screen screen="Health Permission_iOS"\n` +
              `Available pages in this file: ${[...new Set(screens.map(s => s.page))].slice(0, 8).join(', ')}`
            );
          } else {
            const match = findScreenByName(screens, screenArg);
            if (!match) {
              const sample = screens.slice(0, 8).map((s) => `  - ${s.name} (${s.page})`).join('\n');
              return this.errorResponse(
                `No screen matches "${screenArg}" in "${file.name}".\n` +
                `Examples of available screens:\n${sample}\n` +
                `Try the exact name from list_figma_screens, or pass a node id like '1491:683'.`
              );
            }
            targetNodeId = match.id;
            targetMeta = match;
          }
        }

        // Fetch the node subtree (full design data for this one screen).
        const nodesResult = await client.getNodes(fileKey, [targetNodeId]);
        const nodeEntry = nodesResult.nodes[targetNodeId];
        if (!nodeEntry || !nodeEntry.document) {
          return this.errorResponse(
            `Figma returned no node for id "${targetNodeId}". The id may be wrong or the screen may have been deleted.\n` +
            `Try running list_figma_screens to see current ids.`
          );
        }
        const rootNode = nodeEntry.document;

        // Remember file for future calls.
        config.figma.last_file_key = fileKey;
        saveConfig();

        // Build the structured spec.
        const { tree, stats } = summarizeNodeTree(rootNode, {
          maxDepth: args.max_depth || 12,
          maxNodes: args.max_nodes || 400,
        });

        // Optionally render a PNG so the agent can visually verify.
        let imageUrl = null;
        let imageError = null;
        const wantImage = args.include_image !== false;
        if (wantImage) {
          try {
            const images = await client.getImageUrls(fileKey, [targetNodeId], {
              format: 'png',
              scale: args.image_scale || 2,
            });
            imageUrl = images[targetNodeId] || null;
          } catch (err) {
            // Image render is best-effort — never fail the whole call over it.
            imageError = err.message || String(err);
          }
        }

        const box = rootNode.absoluteBoundingBox || {};
        const screenSpec = {
          file: { key: fileKey, name: nodesResult.name },
          screen: {
            id: rootNode.id,
            name: rootNode.name || (targetMeta && targetMeta.name) || 'Untitled',
            page: targetMeta && targetMeta.page ? targetMeta.page : null,
            width: box.width ? Math.round(box.width) : null,
            height: box.height ? Math.round(box.height) : null,
            backgroundColor: rootNode.backgroundColor
              ? require("../Services/figma-client").figmaColorToHex(rootNode.backgroundColor)
              : null,
          },
          image: imageUrl ? { url: imageUrl, format: 'png', scale: args.image_scale || 2 } : null,
          imageError,
          stats: {
            nodeCount: stats.nodeCount,
            textCount: stats.textCount,
            truncated: stats.truncated,
          },
          tree,
        };

        // Render a compact human summary, then attach the full JSON spec so
        // the LLM can ingest both. Cap the JSON pretty-print indent to keep
        // tokens down on large screens.
        let out = `Figma screen loaded: ${screenSpec.screen.name}\n`;
        out += `File: ${screenSpec.file.name} (${fileKey})\n`;
        if (screenSpec.screen.page) out += `Page: ${screenSpec.screen.page}\n`;
        if (screenSpec.screen.width && screenSpec.screen.height) {
          out += `Size: ${screenSpec.screen.width}×${screenSpec.screen.height}\n`;
        }
        if (screenSpec.screen.backgroundColor) out += `Background: ${screenSpec.screen.backgroundColor}\n`;
        out += `Nodes: ${stats.nodeCount} (text nodes: ${stats.textCount})`;
        if (stats.truncated) out += ` — TRUNCATED at the limit; raise max_nodes/max_depth if you need more`;
        out += `\n`;
        if (imageUrl) {
          out += `Rendered PNG: ${imageUrl}\n`;
        } else if (imageError) {
          out += `Image render failed: ${imageError}\n`;
        }
        out += `\n--- DESIGN SPEC (use this to recreate the screen) ---\n`;
        out += JSON.stringify(screenSpec, null, 2);
        out += `\n--- END SPEC ---`;
        return this.textResponse(out);
      }

      case "suggest_figma_screens": {
        if (!config.figma || !config.figma.connected || !config.figma.token || isTokenMasked(config.figma.token)) {
          return this.errorResponse(
            `Figma is not connected yet.\n\n` + buildFigmaSetupGuide()
          );
        }
        const fileInput = args.file || config.figma.last_file_key;
        if (!fileInput) {
          return this.errorResponse(
            "No Figma file remembered. Pass 'file' as a Figma URL or file key, or run 'list_figma_screens' first."
          );
        }
        const fileKey = extractFileKey(fileInput);
        if (!fileKey) {
          return this.errorResponse(
            `Could not parse a Figma file key from "${fileInput}". Expected a Figma URL or bare file key.`
          );
        }

        const pageSize = args.page_size && args.page_size > 0 ? args.page_size : DEFAULT_PAGE_SIZE;
        const refresh = !!args.refresh;

        // Validate project_path before doing any work.
        const projectPath = args.project_path || getRepoPath();
        if (!projectPath) {
          return this.errorResponse(
            "No project path available. Pass 'project_path' or set REPO_PATH in your environment."
          );
        }
        let projectExists = false;
        try {
          projectExists = fs.existsSync(projectPath) && fs.statSync(projectPath).isDirectory();
        } catch (e) {
          projectExists = false;
        }
        if (!projectExists) {
          return this.errorResponse(
            `Project path does not exist or is not a directory: ${projectPath}\n` +
            `Pass a valid 'project_path' (an absolute folder path).`
          );
        }

        // Cache key combines file + project path so different contexts don't collide.
        const cacheKey = `${fileKey}::${projectPath}`;
        if (!config.figma._cache) config.figma._cache = {};
        let cache = config.figma._cache[cacheKey];

        if (refresh || !cache || !Array.isArray(cache.missing)) {
          const client = getFigmaClient();
          // refresh=true must bypass the in-memory file cache too, otherwise
          // "re-scan the project" would still read a stale file payload.
          const file = await client.getFile(fileKey, { forceRefresh: refresh });
          const screens = client.extractScreens(file.document);
          if (screens.length === 0) {
            return this.textResponse(
              `Figma file "${file.name}" has no top-level frames. Nothing to suggest.\n` +
              `Add FRAME nodes to your design pages and try again.`
            );
          }

          let scanResult;
          try {
            scanResult = collectProjectTokens(projectPath);
          } catch (err) {
            scanResult = { tokens: new Set(), filesScanned: 0, accessErrors: 1 };
          }

          const missing = screens.filter(s => !isScreenImplemented(s.name, scanResult.tokens));

          cache = {
            fileName: file.name,
            fileKey,
            projectPath,
            totalScreens: screens.length,
            missing,
            filesScanned: scanResult.filesScanned,
            accessErrors: scanResult.accessErrors,
            generatedAt: new Date().toISOString(),
          };
          config.figma._cache[cacheKey] = cache;
          config.figma.last_file_key = fileKey;
          saveConfig();
        }

        const total = cache.missing.length;

        // Build a leading warning if the scan was empty / partial — this makes
        // "every screen looks unimplemented" results actually trustworthy.
        let warning = '';
        if (cache.filesScanned === 0) {
          warning =
            `WARNING: Scanned ${cache.projectPath} but found 0 source files (.swift/.kt/.dart/.tsx/...).\n` +
            `Either the project is empty, only contains binaries/assets, or this process lacks read permission.\n` +
            `All Figma screens will be reported as "not implemented" until source files are present.\n\n`;
        } else if (cache.accessErrors > 0) {
          warning =
            `Note: ${cache.accessErrors} subdirectory could not be read during the scan — results may be incomplete.\n\n`;
        }

        if (total === 0) {
          return this.textResponse(
            warning +
            `Great news — every screen in "${cache.fileName}" appears to already be implemented in ${cache.projectPath}.\n` +
            `(Checked ${cache.totalScreens} Figma screens against ${cache.filesScanned} source files.)\n` +
            `Pass refresh=true if your project changed.`
          );
        }

        const offset = typeof args.offset === 'number'
          ? Math.max(0, args.offset)
          : ((args.page && args.page > 0 ? args.page - 1 : 0) * pageSize);

        const slice = cache.missing.slice(offset, offset + pageSize);

        if (slice.length === 0) {
          return this.textResponse(
            warning +
            `No more suggestions — you've reviewed all ${total} unimplemented screens from "${cache.fileName}".\n` +
            `Pass refresh=true to re-scan the project, or page=1 to start over.`
          );
        }

        let out = warning;
        out += `Suggestions from "${cache.fileName}" — screens not yet implemented in your project\n`;
        out += `Project: ${cache.projectPath}\n`;
        out += `Scanned: ${cache.filesScanned} source files\n`;
        out += `Total unimplemented: ${total} (Figma total: ${cache.totalScreens})\n`;
        out += `Showing ${offset + 1}–${offset + slice.length} of ${total}:\n\n`;
        for (let i = 0; i < slice.length; i++) {
          const s = slice[i];
          const dims = s.width && s.height ? ` (${s.width}×${s.height})` : '';
          out += `${offset + i + 1}. ${s.name}${dims}\n`;
          out += `   Page: ${s.page}\n`;
        }
        out += `\n`;
        const nextOffset = offset + slice.length;
        if (nextOffset < total) {
          out += `Show next ${Math.min(pageSize, total - nextOffset)}? Run 'suggest_figma_screens' with offset=${nextOffset}.\n`;
        } else {
          out += `That's everything. Run with refresh=true to re-check the project.\n`;
        }
        return this.textResponse(out);
      }

      default:
        return null;
    }
  }

  getPrompt() {
    return (
      this.loadPromptChunk("figma.md") ||
      `### Figma Connect
Use 'configure_figma' once to save the personal access token. Use 'figma_connection_test' to verify before reading. Use 'list_figma_screens' to read frames from a Figma file. Use 'suggest_figma_screens' to recommend ONLY screens not already implemented in the current project, 5 at a time. Never re-prompt for setup once 'config.figma.connected' is true.`
    );
  }
}

// ── Helpers: parse Figma URLs and resolve screens by name ────────────────

/**
 * Pull the `node-id` query parameter out of a Figma URL and return it in
 * API format (`1491:683`). Figma URLs use `1491-683` in the query string.
 */
function extractNodeIdFromUrl(input) {
  if (!input || typeof input !== 'string') return null;
  const m = input.match(/[?&]node-id=([^&]+)/);
  if (!m) return null;
  const raw = decodeURIComponent(m[1]);
  // Convert `1491-683` → `1491:683`. Leave already-colon ids alone.
  if (/^\d+-\d+$/.test(raw)) return raw.replace('-', ':');
  if (/^\d+:\d+$/.test(raw)) return raw;
  return null;
}

/**
 * Find a screen in a flat screen list by name. Tries exact match (case
 * insensitive) first, then prefix match, then substring. Returns null if
 * nothing meaningful matches so the caller can show a helpful error.
 */
function findScreenByName(screens, query) {
  if (!Array.isArray(screens) || !query) return null;
  const q = String(query).trim().toLowerCase();
  if (!q) return null;
  const exact = screens.find((s) => (s.name || '').toLowerCase() === q);
  if (exact) return exact;
  const prefix = screens.find((s) => (s.name || '').toLowerCase().startsWith(q));
  if (prefix) return prefix;
  const sub = screens.find((s) => (s.name || '').toLowerCase().includes(q));
  return sub || null;
}

// ── Helpers: detect implemented screens by scanning the project ──────────

function normalizeName(s) {
  return String(s || "")
    .replace(/\.[A-Za-z0-9]+$/, "")          // strip file extension
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")  // split camelCase: LoginScreen → Login Screen
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2") // split UPPERAcronym: HTTPRequest → HTTP Request
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenize(name) {
  // Split into words; reject very short tokens because they cause false positives.
  return normalizeName(name).split(/\s+/).filter(t => t.length >= 3);
}

/**
 * A Figma screen is "implemented" if every meaningful word from its name appears
 * in the set of tokens collected from the project. This is intentionally fuzzy:
 * "Login Screen" matches LoginViewController.swift, login_screen.dart, etc.
 */
function isScreenImplemented(screenName, projectTokens) {
  const tokens = tokenize(screenName);
  if (tokens.length === 0) return false;
  // Require ALL tokens to be present so partial-name collisions don't fire.
  for (const t of tokens) {
    if (!projectTokens.has(t)) return false;
  }
  return true;
}

/**
 * Walk the project directory (bounded depth + ignored dirs) and collect a Set
 * of normalized tokens from every source filename. Returns scan stats so the
 * caller can warn the user when the scan was empty or partial.
 */
function collectProjectTokens(rootDir, maxDepth = 8, maxFiles = 20000) {
  const tokens = new Set();
  let filesScanned = 0;
  let accessErrors = 0;
  if (!rootDir || !fs.existsSync(rootDir)) return { tokens, filesScanned, accessErrors };

  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      accessErrors++;
      continue;
    }
    for (const ent of entries) {
      if (filesScanned >= maxFiles) return { tokens, filesScanned, accessErrors };
      if (ent.name.startsWith(".") && ent.name !== ".") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(ext)) continue;
        filesScanned++;
        for (const tok of tokenize(ent.name)) tokens.add(tok);
      }
    }
  }
  return { tokens, filesScanned, accessErrors };
}

/**
 * The setup guide returned when the user asks to "connect figma" without
 * supplying a token. Walks them through generating one and calling configure_figma.
 */
function buildFigmaSetupGuide() {
  return [
    `How to connect Figma`,
    ``,
    `Figma Connect uses a personal access token (read scope is enough).`,
    `Follow these steps once — the agent will remember the token afterward.`,
    ``,
    `STEP 1 — Open your Figma account settings`,
    `   • Sign in at https://www.figma.com`,
    `   • Click your avatar (top-left) → "Settings"`,
    `   • Open the "Security" tab`,
    ``,
    `STEP 2 — Generate a personal access token`,
    `   • Scroll to "Personal access tokens"`,
    `   • Click "Generate new token"`,
    `   • Name it (e.g. "Project Guide Agent")`,
    `   • Expiration: pick whatever you're comfortable with`,
    `   • Scopes: "File content" → Read is sufficient`,
    `   • Click "Generate token" and COPY the value (you can only see it once)`,
    `   • Token format looks like:  figd_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`,
    ``,
    `STEP 3 — Save it to the agent`,
    `   Tell me: "configure figma with token figd_..."`,
    `   (or run the tool 'configure_figma' with token=<your token>)`,
    `   I will validate it immediately and confirm the connected user.`,
    ``,
    `STEP 4 — Read your designs`,
    `   Once connected, share a Figma file URL like`,
    `     https://www.figma.com/design/<key>/<name>`,
    `   and I'll list every screen and suggest which ones aren't built yet.`,
    ``,
    `Docs: https://www.figma.com/developers/api#access-tokens`,
  ].join('\n');
}

module.exports = FigmaSkill;
module.exports.buildFigmaSetupGuide = buildFigmaSetupGuide;
