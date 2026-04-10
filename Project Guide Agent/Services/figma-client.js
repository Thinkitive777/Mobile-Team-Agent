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
          const retrySec = parseInt(response.headers.get('retry-after') || '5', 10);
          Logger.warn('Figma rate limited', { attempt, retrySec });
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
   */
  async getFile(fileKeyOrUrl) {
    const fileKey = extractFileKey(fileKeyOrUrl);
    if (!fileKey) {
      throw new FigmaConnectionError(
        `Could not extract a Figma file key from "${fileKeyOrUrl}". ` +
        `Provide either the file key or a URL like https://www.figma.com/file/<key>/...`
      );
    }
    Logger.debug('Fetching Figma file', { fileKey });
    const response = await this._fetchWithRetry(`${FIGMA_API_BASE}/files/${encodeURIComponent(fileKey)}`);
    const data = await response.json();
    return {
      key: fileKey,
      name: data.name || 'Untitled',
      lastModified: data.lastModified || null,
      version: data.version || null,
      thumbnailUrl: data.thumbnailUrl || null,
      document: data.document || null,
    };
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
}

module.exports = FigmaClient;
module.exports.extractFileKey = extractFileKey;
