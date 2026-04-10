/// MARK: - Figma Skill
/// Figma Connect integration: configures the Figma personal access token,
/// validates connectivity, reads design files, extracts screens/frames, and
/// recommends screens that are not yet implemented in the local project.

const fs = require("fs");
const path = require("path");
const BaseSkill = require("./Core/BaseSkill");
const { extractFileKey } = require("../Services/figma-client");

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
        description: "Configure Figma Connect by saving a personal access token. Token must be from https://www.figma.com/developers/api#access-tokens. Validates the token immediately.",
        inputSchema: {
          type: "object",
          properties: {
            token: { type: "string", description: "Figma personal access token" },
          },
          required: ["token"],
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
        const token = (args.token || "").trim();
        if (!token) return this.errorResponse("Figma token is required.");
        if (isTokenMasked(token)) {
          return this.errorResponse(
            "The provided token looks like a masked placeholder. Generate a real Figma personal access token at https://www.figma.com/developers/api#access-tokens"
          );
        }
        if (token.length < 20) {
          return this.errorResponse(
            "The provided token looks too short to be a valid Figma personal access token. Generate one at https://www.figma.com/developers/api#access-tokens"
          );
        }

        if (!config.figma) {
          config.figma = { connected: false, token: null, user: null, last_file_key: null };
        }
        config.figma.token = token;
        config.figma.connected = true;

        // Validate immediately so the user knows it works
        try {
          const client = getFigmaClient();
          const result = await client.testConnection();
          config.figma.user = result.user;
          saveConfig();
          let out = `Figma configured successfully.\n`;
          out += `Connected as: ${result.user}${result.email ? ` (${result.email})` : ''}\n`;
          out += `Token: ${maskToken(token)}\n\n`;
          out += `Next: use 'list_figma_screens' with a Figma file URL to read your designs.`;
          return this.textResponse(out);
        } catch (err) {
          // Roll back connection flag — token did not validate
          config.figma.connected = false;
          saveConfig();
          return this.errorResponse(
            `Figma token saved but validation failed: ${err.message}\n` +
            `Please double-check the token at https://www.figma.com/developers/api#access-tokens and re-run 'configure_figma'.`
          );
        }
      }

      case "figma_connection_test": {
        if (!config.figma || !config.figma.connected || !config.figma.token) {
          return this.errorResponse(
            "Figma is not configured. Run 'configure_figma' with your personal access token from https://www.figma.com/developers/api#access-tokens"
          );
        }
        const client = getFigmaClient();
        const result = await client.testConnection();
        // Refresh stored user
        config.figma.user = result.user;
        saveConfig();
        return this.textResponse(
          `Figma connection OK.\nUser: ${result.user}${result.email ? `\nEmail: ${result.email}` : ''}`
        );
      }

      case "list_figma_screens": {
        if (!config.figma || !config.figma.connected || !config.figma.token) {
          return this.errorResponse(
            "Figma is not connected. Run 'configure_figma' first."
          );
        }
        const fileInput = args.file || config.figma.last_file_key;
        if (!fileInput) {
          return this.errorResponse(
            "No Figma file specified and no previous file remembered. Pass 'file' as a Figma URL or file key."
          );
        }
        const fileKey = extractFileKey(fileInput);
        if (!fileKey) {
          return this.errorResponse(
            `Could not parse a Figma file key from "${fileInput}". Pass a URL like https://www.figma.com/file/<key>/Name or the bare file key.`
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

      case "suggest_figma_screens": {
        if (!config.figma || !config.figma.connected || !config.figma.token) {
          return this.errorResponse(
            "Figma is not connected. Run 'configure_figma' first."
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
            `Could not parse a Figma file key from "${fileInput}".`
          );
        }

        const pageSize = args.page_size && args.page_size > 0 ? args.page_size : DEFAULT_PAGE_SIZE;
        const refresh = !!args.refresh;

        // Cache key combines file + project path so different contexts don't collide.
        const projectPath = args.project_path || getRepoPath();
        const cacheKey = `${fileKey}::${projectPath}`;

        // We keep the last computed missing-screens list on config.figma._cache to
        // power "show next 5" without re-hitting the Figma API every page.
        if (!config.figma._cache) config.figma._cache = {};
        let cache = config.figma._cache[cacheKey];

        if (refresh || !cache || !Array.isArray(cache.missing)) {
          const client = getFigmaClient();
          const file = await client.getFile(fileKey);
          const screens = client.extractScreens(file.document);
          if (screens.length === 0) {
            return this.textResponse(
              `Figma file "${file.name}" has no frames. Nothing to suggest.`
            );
          }

          let implementedTokens;
          try {
            implementedTokens = collectProjectTokens(projectPath);
          } catch (err) {
            implementedTokens = new Set();
          }

          const missing = screens.filter(s => !isScreenImplemented(s.name, implementedTokens));

          cache = {
            fileName: file.name,
            fileKey,
            projectPath,
            totalScreens: screens.length,
            missing,
            generatedAt: new Date().toISOString(),
          };
          config.figma._cache[cacheKey] = cache;
          config.figma.last_file_key = fileKey;
          saveConfig();
        }

        const total = cache.missing.length;
        if (total === 0) {
          return this.textResponse(
            `Great news — every screen in "${cache.fileName}" appears to already be implemented in ${cache.projectPath}.\n` +
            `(Checked ${cache.totalScreens} Figma screens.)\n` +
            `Pass refresh=true if your project changed.`
          );
        }

        const offset = typeof args.offset === 'number'
          ? Math.max(0, args.offset)
          : ((args.page && args.page > 0 ? args.page - 1 : 0) * pageSize);

        const slice = cache.missing.slice(offset, offset + pageSize);

        if (slice.length === 0) {
          return this.textResponse(
            `No more suggestions — you've reviewed all ${total} unimplemented screens from "${cache.fileName}".\n` +
            `Pass refresh=true to re-scan the project, or page=1 to start over.`
          );
        }

        let out = `Suggestions from "${cache.fileName}" — screens not yet implemented in your project\n`;
        out += `Project: ${cache.projectPath}\n`;
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
 * of normalized tokens from every source filename. Cheap, no full file reads.
 */
function collectProjectTokens(rootDir, maxDepth = 8, maxFiles = 20000) {
  const tokens = new Set();
  if (!rootDir || !fs.existsSync(rootDir)) return tokens;

  let count = 0;
  const stack = [{ dir: rootDir, depth: 0 }];
  while (stack.length > 0) {
    const { dir, depth } = stack.pop();
    if (depth > maxDepth) continue;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      continue;
    }
    for (const ent of entries) {
      if (count >= maxFiles) return tokens;
      if (ent.name.startsWith(".") && ent.name !== ".") continue;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (IGNORED_DIRS.has(ent.name)) continue;
        stack.push({ dir: full, depth: depth + 1 });
      } else if (ent.isFile()) {
        const ext = path.extname(ent.name).toLowerCase();
        if (!SOURCE_EXTENSIONS.has(ext)) continue;
        count++;
        for (const tok of tokenize(ent.name)) tokens.add(tok);
      }
    }
  }
  return tokens;
}

module.exports = FigmaSkill;
