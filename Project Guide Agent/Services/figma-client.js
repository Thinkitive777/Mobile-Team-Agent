/// MARK: - Figma Client
/// HTTP client for the Figma REST API. Handles authentication, retries,
/// rate limiting, and read operations on files, frames, and components.

const {
  FigmaConnectionError,
  FigmaAuthError,
  FigmaRateLimitError,
  FigmaNetworkError,
  FigmaNotFoundError,
} = require('../Utils/errors');
const Logger = require('../Utils/logger');

const FIGMA_API_BASE = 'https://api.figma.com/v1';
const REQUEST_TIMEOUT_MS = 15000;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;
// Hard cap on how long we'll honor a `retry-after` from Figma. Figma's
// cost-based rate limiter has been observed returning values that are
// either bogus or expressed as wall-clock timestamps; either way we never
// want to block the agent for more than this many seconds.
const MAX_RETRY_AFTER_SEC = 30;

// ── Module-level caches + request dedup ──────────────────────────────────
// These live on the module (not the instance) so caching survives across
// the per-tool-call `new FigmaClient(...)` constructions in config-manager.
// TTLs are conservative — Figma files do change, but not faster than the
// agent re-reads them within a single session.
const FILE_CACHE_TTL_MS = 5 * 60 * 1000;
const NODES_CACHE_TTL_MS = 5 * 60 * 1000;
const IMAGE_CACHE_TTL_MS = 5 * 60 * 1000;

const _fileCache = new Map();   // fileKey -> { value, expires }
const _nodesCache = new Map();  // `${fileKey}:${idsKey}` -> { value, expires }
const _imageCache = new Map();  // `${fileKey}:${idsKey}:${fmt}:${scale}` -> { value, expires }

// Inflight Promise maps — concurrent identical requests share one network
// round-trip instead of independently hitting Figma.
const _fileInflight = new Map();
const _nodesInflight = new Map();
const _imageInflight = new Map();

function _cacheGet(map, key) {
  const entry = map.get(key);
  if (!entry) return null;
  if (entry.expires < Date.now()) {
    map.delete(key);
    return null;
  }
  return entry.value;
}

function _cacheSet(map, key, value, ttl) {
  map.set(key, { value, expires: Date.now() + ttl });
}

function _dedupe(inflightMap, key, fn) {
  const existing = inflightMap.get(key);
  if (existing) return existing;
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      inflightMap.delete(key);
    }
  })();
  inflightMap.set(key, promise);
  return promise;
}

/**
 * Walk a previously-fetched Figma document tree and locate a node by id.
 * Used to satisfy `getNodes` from a cached file response without paying
 * for a second `/nodes` API call.
 */
function findNodeInDocument(documentNode, nodeId) {
  if (!documentNode || !nodeId) return null;
  const stack = [documentNode];
  while (stack.length > 0) {
    const n = stack.pop();
    if (!n) continue;
    if (n.id === nodeId) return n;
    if (Array.isArray(n.children)) {
      for (const c of n.children) stack.push(c);
    }
  }
  return null;
}

function clearFigmaCache() {
  _fileCache.clear();
  _nodesCache.clear();
  _imageCache.clear();
}

/**
 * Extract a file key from any Figma URL or return the input if it already
 * looks like a key. Supports /file/<key>/, /design/<key>/, /proto/<key>/.
 */
function extractFileKey(input) {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();
  // URL form takes precedence — works for /file/, /design/, /proto/
  const m = trimmed.match(/figma\.com\/(?:file|design|proto)\/([A-Za-z0-9]+)/);
  if (m) return m[1];
  // Bare alphanumeric key (no slashes, no scheme). Real Figma keys are ~22
  // chars, but we accept anything with at least a few chars to stay flexible.
  if (/^[A-Za-z0-9]{4,}$/.test(trimmed)) return trimmed;
  return null;
}

class FigmaClient {
  constructor(token) {
    if (!token) {
      throw new FigmaConnectionError('Figma client requires a personal access token');
    }
    this.token = token;
  }

  // ── HTTP layer with timeout, retry, and rate-limit handling ───────────

  async _fetchWithRetry(url, options = {}, retries = MAX_RETRIES) {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        const response = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            'X-Figma-Token': this.token,
            'Content-Type': 'application/json',
            ...(options.headers || {}),
          },
        });
        clearTimeout(timer);

        // Rate limit
        if (response.status === 429) {
          const rawRetry = parseInt(response.headers.get('retry-after') || '5', 10);
          // Figma occasionally returns nonsensical retry-after values (huge
          // numbers, possibly Unix timestamps). Cap to a hard ceiling so the
          // agent never blocks for more than MAX_RETRY_AFTER_SEC.
          const retrySec = Number.isFinite(rawRetry) && rawRetry > 0
            ? Math.min(rawRetry, MAX_RETRY_AFTER_SEC)
            : 5;
          Logger.warn('Figma rate limited', { attempt, rawRetry, willWaitSec: retrySec });
          // If the server is asking for an absurd wait, give up immediately —
          // retrying won't help and the user will get a clear error instead
          // of an apparent hang.
          if (rawRetry > MAX_RETRY_AFTER_SEC * 4) {
            throw new FigmaRateLimitError(
              `Figma API rate limit exceeded (server requested ${rawRetry}s wait). Try again in a minute.`
            );
          }
          if (attempt < retries) {
            await this._sleep(retrySec * 1000);
            continue;
          }
          throw new FigmaRateLimitError('Figma API rate limit exceeded after retries');
        }

        // Auth errors — no retry
        if (response.status === 401 || response.status === 403) {
          throw new FigmaAuthError(
            `Figma authentication failed (${response.status}). Token may be invalid, expired, or lack required scopes.`
          );
        }

        // Not found
        if (response.status === 404) {
          throw new FigmaNotFoundError(
            `Figma resource not found (404). The file key may be wrong or the token cannot access this file.`
          );
        }

        if (!response.ok) {
          const body = await response.text().catch(() => '');
          throw new FigmaConnectionError(
            `Figma API ${response.status}: ${response.statusText}`,
            { url, status: response.status, body: body.substring(0, 200) }
          );
        }

        return response;
      } catch (err) {
        if (err.name === 'AbortError') {
          Logger.warn('Figma request timeout', { attempt, url });
          if (attempt < retries) {
            await this._sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
            continue;
          }
          throw new FigmaNetworkError('Figma request timed out after retries');
        }
        if (
          err instanceof FigmaAuthError ||
          err instanceof FigmaRateLimitError ||
          err instanceof FigmaNotFoundError ||
          err instanceof FigmaConnectionError
        ) throw err;
        if (attempt < retries) {
          Logger.warn('Figma request failed, retrying', { attempt, error: err.message });
          await this._sleep(RETRY_BASE_DELAY_MS * Math.pow(2, attempt - 1));
          continue;
        }
        throw new FigmaNetworkError(`Figma network error: ${err.message}`);
      }
    }
  }

  _sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ── API methods ───────────────────────────────────────────────────────

  /** Validate the token by fetching the authenticated user. */
  async testConnection() {
    Logger.info('Testing Figma connection');
    const response = await this._fetchWithRetry(`${FIGMA_API_BASE}/me`);
    const data = await response.json();
    Logger.info('Figma connection successful', { user: data.handle || data.email });
    return {
      success: true,
      user: data.handle || data.email || 'Unknown',
      email: data.email || null,
      id: data.id || null,
    };
  }

  /**
   * Fetch a Figma file's structure. Returns the raw document tree along with
   * extracted top-level frames (screens) for convenient consumption.
   *
   * Cached in-memory for FILE_CACHE_TTL_MS. Concurrent calls for the same
   * file key share one network round-trip. Pass `forceRefresh: true` to
   * bypass the cache (used by `suggest_figma_screens refresh=true`).
   */
  async getFile(fileKeyOrUrl, { forceRefresh = false } = {}) {
    const fileKey = extractFileKey(fileKeyOrUrl);
    if (!fileKey) {
      throw new FigmaConnectionError(
        `Could not extract a Figma file key from "${fileKeyOrUrl}". ` +
        `Provide either the file key or a URL like https://www.figma.com/file/<key>/...`
      );
    }
    if (!forceRefresh) {
      const cached = _cacheGet(_fileCache, fileKey);
      if (cached) {
        Logger.debug('Figma file cache hit', { fileKey });
        return cached;
      }
    }
    return _dedupe(_fileInflight, fileKey, async () => {
      Logger.debug('Fetching Figma file', { fileKey });
      const response = await this._fetchWithRetry(`${FIGMA_API_BASE}/files/${encodeURIComponent(fileKey)}`);
      const data = await response.json();
      const out = {
        key: fileKey,
        name: data.name || 'Untitled',
        lastModified: data.lastModified || null,
        version: data.version || null,
        thumbnailUrl: data.thumbnailUrl || null,
        document: data.document || null,
      };
      _cacheSet(_fileCache, fileKey, out, FILE_CACHE_TTL_MS);
      return out;
    });
  }

  /**
   * Extract every top-level frame (screen) from a Figma document tree.
   * Returns a flat array of { id, name, page, width, height }.
   * Top-level FRAMES inside CANVAS pages are treated as screens.
   */
  extractScreens(documentNode) {
    if (!documentNode || !Array.isArray(documentNode.children)) return [];
    const screens = [];
    for (const page of documentNode.children) {
      if (page.type !== 'CANVAS') continue;
      const pageName = page.name || 'Page';
      for (const child of (page.children || [])) {
        // Treat FRAME and COMPONENT as screens (Figma "screen" pattern)
        if (child.type === 'FRAME' || child.type === 'COMPONENT' || child.type === 'COMPONENT_SET') {
          const box = child.absoluteBoundingBox || {};
          screens.push({
            id: child.id,
            name: child.name || 'Untitled',
            page: pageName,
            type: child.type,
            width: box.width ? Math.round(box.width) : null,
            height: box.height ? Math.round(box.height) : null,
          });
        }
      }
    }
    return screens;
  }

  /**
   * Fetch one or more specific nodes from a Figma file by id. Returns the
   * raw node objects keyed by id. Use this to read a single screen's full
   * subtree (text, fills, layout, children) without paying for the entire file.
   *
   * Caching strategy:
   *   1. Check the per-id nodes cache.
   *   2. If the parent file is already cached in memory, satisfy the request
   *      locally — `/v1/files` returns the full document tree with every
   *      property `summarizeNodeTree` reads, so the extra `/nodes` round-trip
   *      is pure waste in the common screen-read path.
   *   3. Otherwise dedupe and fetch.
   */
  async getNodes(fileKeyOrUrl, nodeIds) {
    const fileKey = extractFileKey(fileKeyOrUrl);
    if (!fileKey) {
      throw new FigmaConnectionError(`Could not extract a Figma file key from "${fileKeyOrUrl}".`);
    }
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
    if (ids.length === 0) {
      throw new FigmaConnectionError('getNodes requires at least one node id');
    }
    const idsKey = ids.slice().sort().join(',');
    const cacheKey = `${fileKey}:${idsKey}`;

    const cached = _cacheGet(_nodesCache, cacheKey);
    if (cached) {
      Logger.debug('Figma nodes cache hit', { fileKey, ids });
      return cached;
    }

    // Short-circuit: serve from a cached full-file response when possible.
    const cachedFile = _cacheGet(_fileCache, fileKey);
    if (cachedFile && cachedFile.document) {
      const nodes = {};
      let allFound = true;
      for (const id of ids) {
        const node = findNodeInDocument(cachedFile.document, id);
        if (!node) { allFound = false; break; }
        nodes[id] = { document: node };
      }
      if (allFound) {
        const synthetic = {
          key: fileKey,
          name: cachedFile.name,
          lastModified: cachedFile.lastModified,
          nodes,
        };
        _cacheSet(_nodesCache, cacheKey, synthetic, NODES_CACHE_TTL_MS);
        Logger.debug('Figma nodes served from cached file', { fileKey, ids });
        return synthetic;
      }
    }

    return _dedupe(_nodesInflight, cacheKey, async () => {
      const idParam = ids.map((id) => encodeURIComponent(id)).join(',');
      Logger.debug('Fetching Figma nodes', { fileKey, ids });
      const response = await this._fetchWithRetry(
        `${FIGMA_API_BASE}/files/${encodeURIComponent(fileKey)}/nodes?ids=${idParam}&geometry=paths`
      );
      const data = await response.json();
      const out = {
        key: fileKey,
        name: data.name || 'Untitled',
        lastModified: data.lastModified || null,
        nodes: data.nodes || {},
      };
      _cacheSet(_nodesCache, cacheKey, out, NODES_CACHE_TTL_MS);
      return out;
    });
  }

  /**
   * Render one or more nodes to image URLs. Figma signs the URLs for ~30
   * days, so we cache the response for IMAGE_CACHE_TTL_MS to avoid paying
   * for the same render on every screen re-read.
   */
  async getImageUrls(fileKeyOrUrl, nodeIds, { format = 'png', scale = 2 } = {}) {
    const fileKey = extractFileKey(fileKeyOrUrl);
    if (!fileKey) {
      throw new FigmaConnectionError(`Could not extract a Figma file key from "${fileKeyOrUrl}".`);
    }
    const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
    if (ids.length === 0) return {};
    const safeFormat = ['png', 'jpg', 'svg', 'pdf'].includes(format) ? format : 'png';
    const safeScale = Math.min(Math.max(Number(scale) || 1, 1), 4);
    const idsKey = ids.slice().sort().join(',');
    const cacheKey = `${fileKey}:${idsKey}:${safeFormat}:${safeScale}`;

    const cached = _cacheGet(_imageCache, cacheKey);
    if (cached) {
      Logger.debug('Figma image cache hit', { fileKey, ids });
      return cached;
    }

    return _dedupe(_imageInflight, cacheKey, async () => {
      const idParam = ids.map((id) => encodeURIComponent(id)).join(',');
      const url =
        `${FIGMA_API_BASE}/images/${encodeURIComponent(fileKey)}` +
        `?ids=${idParam}&format=${safeFormat}&scale=${safeScale}`;
      Logger.debug('Fetching Figma image URLs', { fileKey, ids, format: safeFormat, scale: safeScale });
      const response = await this._fetchWithRetry(url);
      const data = await response.json();
      if (data.err) {
        throw new FigmaConnectionError(`Figma image render failed: ${data.err}`);
      }
      const images = data.images || {};
      _cacheSet(_imageCache, cacheKey, images, IMAGE_CACHE_TTL_MS);
      return images;
    });
  }
}

// ── Color + node-tree helpers (used by `read_figma_screen`) ───────────────

/**
 * Convert a Figma color (0..1 floats per channel) to a #RRGGBB or #RRGGBBAA
 * hex string. Returns null if the color is missing.
 */
function figmaColorToHex(color, opacity) {
  if (!color) return null;
  const toByte = (v) => {
    const n = Math.round(Math.max(0, Math.min(1, Number(v) || 0)) * 255);
    return n.toString(16).padStart(2, '0');
  };
  const r = toByte(color.r);
  const g = toByte(color.g);
  const b = toByte(color.b);
  // Alpha can come from the color object OR from a per-paint `opacity`. Combine both.
  const colorAlpha = typeof color.a === 'number' ? color.a : 1;
  const paintAlpha = typeof opacity === 'number' ? opacity : 1;
  const a = Math.max(0, Math.min(1, colorAlpha * paintAlpha));
  if (a >= 0.999) return `#${r}${g}${b}`.toUpperCase();
  return `#${r}${g}${b}${toByte(a)}`.toUpperCase();
}

/**
 * Summarize a Figma `paints` array (fills/strokes) into a small array of
 * { type, color, opacity } objects. Solid colors get a hex string; gradients
 * record their stops; image fills are flagged so the agent knows an asset is
 * needed.
 */
function summarizePaints(paints) {
  if (!Array.isArray(paints) || paints.length === 0) return [];
  const out = [];
  for (const p of paints) {
    if (p.visible === false) continue;
    if (p.type === 'SOLID') {
      const hex = figmaColorToHex(p.color, p.opacity);
      if (hex) out.push({ type: 'solid', color: hex });
    } else if (p.type && p.type.startsWith('GRADIENT_')) {
      const stops = (p.gradientStops || []).map((s) => ({
        position: typeof s.position === 'number' ? Number(s.position.toFixed(3)) : null,
        color: figmaColorToHex(s.color),
      }));
      out.push({ type: p.type.toLowerCase(), stops });
    } else if (p.type === 'IMAGE') {
      out.push({ type: 'image', imageRef: p.imageRef || null, scaleMode: p.scaleMode || null });
    }
  }
  return out;
}

/**
 * Walk a Figma node subtree and produce a compact spec object. Caps total
 * nodes and depth so a single screen never blows up the response.
 */
function summarizeNodeTree(rootNode, options = {}) {
  const maxDepth = options.maxDepth || 12;
  const maxNodes = options.maxNodes || 400;
  const stats = { nodeCount: 0, truncated: false, textCount: 0 };
  const rootBox = rootNode && rootNode.absoluteBoundingBox;

  function walk(node, depth) {
    if (!node || node.visible === false) return null;
    if (stats.nodeCount >= maxNodes) {
      stats.truncated = true;
      return null;
    }
    stats.nodeCount++;

    const box = node.absoluteBoundingBox || null;
    const summary = {
      id: node.id,
      type: node.type,
      name: node.name || '',
    };

    if (box && rootBox) {
      summary.bounds = {
        x: Math.round(box.x - rootBox.x),
        y: Math.round(box.y - rootBox.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    } else if (box) {
      summary.bounds = {
        x: Math.round(box.x),
        y: Math.round(box.y),
        w: Math.round(box.width),
        h: Math.round(box.height),
      };
    }

    const fills = summarizePaints(node.fills);
    if (fills.length > 0) summary.fills = fills;
    const strokes = summarizePaints(node.strokes);
    if (strokes.length > 0) {
      summary.strokes = strokes;
      if (typeof node.strokeWeight === 'number') summary.strokeWeight = node.strokeWeight;
    }

    if (typeof node.cornerRadius === 'number' && node.cornerRadius > 0) {
      summary.cornerRadius = node.cornerRadius;
    } else if (Array.isArray(node.rectangleCornerRadii)) {
      summary.cornerRadii = node.rectangleCornerRadii;
    }

    if (node.opacity != null && node.opacity < 1) summary.opacity = Number(node.opacity.toFixed(2));

    if (node.layoutMode && node.layoutMode !== 'NONE') {
      summary.autoLayout = {
        direction: node.layoutMode, // HORIZONTAL or VERTICAL
        spacing: node.itemSpacing || 0,
        padding: {
          top: node.paddingTop || 0,
          right: node.paddingRight || 0,
          bottom: node.paddingBottom || 0,
          left: node.paddingLeft || 0,
        },
        align: node.primaryAxisAlignItems || null,
        crossAlign: node.counterAxisAlignItems || null,
      };
    }

    if (node.type === 'TEXT') {
      stats.textCount++;
      const style = node.style || {};
      summary.text = {
        content: node.characters || '',
        fontFamily: style.fontFamily || null,
        fontWeight: style.fontWeight || null,
        fontSize: style.fontSize || null,
        lineHeight: style.lineHeightPx || null,
        letterSpacing: style.letterSpacing || null,
        align: style.textAlignHorizontal || null,
        verticalAlign: style.textAlignVertical || null,
        // Text color usually lives on the first solid fill of the TEXT node.
        color: fills.find((f) => f.type === 'solid')?.color || null,
      };
    }

    if (node.componentId || node.type === 'INSTANCE') {
      summary.component = {
        id: node.componentId || null,
        name: node.name || null,
      };
    }

    if (depth < maxDepth && Array.isArray(node.children) && node.children.length > 0) {
      const kids = [];
      for (const child of node.children) {
        const c = walk(child, depth + 1);
        if (c) kids.push(c);
        if (stats.nodeCount >= maxNodes) {
          stats.truncated = true;
          break;
        }
      }
      if (kids.length > 0) summary.children = kids;
    }

    return summary;
  }

  const tree = walk(rootNode, 0);
  return { tree, stats };
}

module.exports = FigmaClient;
module.exports.extractFileKey = extractFileKey;
module.exports.figmaColorToHex = figmaColorToHex;
module.exports.summarizePaints = summarizePaints;
module.exports.summarizeNodeTree = summarizeNodeTree;
module.exports.findNodeInDocument = findNodeInDocument;
module.exports.clearFigmaCache = clearFigmaCache;
