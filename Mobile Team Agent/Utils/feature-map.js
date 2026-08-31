/// MARK: - Feature Map
/// Answers "which features does this change put at risk?" without running
/// anything. Two mechanisms:
///
///   1. Direct  — a changed file living under the project's feature root
///                (src/domain/vitals/... -> "vitals") belongs to that feature.
///   2. Indirect — a changed file in shared code (src/services, src/redux,
///                navigation, common components) belongs to no feature, so
///                the importers of that file are traced one hop and their
///                features are reported instead.
///
/// The second case is the one that matters: a one-line edit to a shared API
/// client is exactly the change that looks harmless and breaks six screens.

const fs = require('fs');
const path = require('path');

const Logger = require('./logger');

/// Probed in order; the first directory that exists and holds subdirectories
/// wins. Covers domain-grouped projects (src/domain), this agent's own Expo
/// scaffold (src/features), and conventional RN CLI layouts (src/screens).
const FEATURE_ROOT_CANDIDATES = [
  'src/domain',
  'src/features',
  'src/modules',
  'src/screens',
  'app/features',
  'app/domain',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];
const RESOLVE_SUFFIXES = ['', '.ts', '.tsx', '.js', '.jsx', '.json',
  '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];

const IGNORED_DIRS = new Set([
  'node_modules', '.git', 'ios', 'android', 'build', 'dist', 'coverage',
  '.expo', '.next', 'vendor', 'Pods', '__snapshots__',
]);

/// Matches `from '...'`, `require('...')` and `import('...')`.
const IMPORT_PATTERN = /(?:from\s+|require\(\s*|import\(\s*)['"]([^'"]+)['"]/g;

const MAX_SCAN_FILES = 5000;

const TEST_FILE_PATTERN = /(\.(test|spec)\.(ts|tsx|js|jsx)$)|(^|\/)__tests__\//i;

/// `react-native init` ships a single boilerplate `__tests__/App.test.tsx`.
/// Counting that as "this project has tests" would switch on the test-gap
/// driver for every file of every branch, which is noise, not signal. A repo
/// needs more tests than the generator gave it to count as tested.
const MIN_MEANINGFUL_TESTS = 3;

class FeatureMap {
  /**
   * Finds the directory this project groups features under.
   * Returns null when no convention is recognised — callers should degrade to
   * "features unknown" rather than inventing names.
   * @returns {{root: string, features: string[]}|null}
   */
  static detectFeatureRoot(repoPath) {
    for (const candidate of FEATURE_ROOT_CANDIDATES) {
      const absolute = path.join(repoPath, candidate);
      let entries;
      try {
        entries = fs.readdirSync(absolute, { withFileTypes: true });
      } catch {
        continue;
      }

      const features = entries
        .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
        .map(entry => entry.name)
        .sort();

      if (features.length) return { root: candidate, features };
    }
    return null;
  }

  /**
   * The feature a repo-relative path belongs to, or null for shared code.
   */
  static featureOf(filePath, featureRoot) {
    if (!featureRoot || !filePath) return null;
    const prefix = `${featureRoot}/`;
    if (!filePath.startsWith(prefix)) return null;
    const remainder = filePath.slice(prefix.length);
    const [name] = remainder.split('/');
    // A loose file directly inside the root belongs to no feature.
    return (name && remainder.includes('/')) ? name : null;
  }

  /**
   * Walks the project's source files once and records, for every module, which
   * files import it. Relative specifiers are resolved by path arithmetic;
   * tsconfig `paths` aliases are honoured when present. Bare package imports
   * are ignored — a change to `react-native` is not this tool's problem.
   *
   * @returns {{importers: Map<string, Set<string>>, files: string[], truncated: boolean}}
   */
  static buildReverseImportIndex(repoPath) {
    const files = this._collectSourceFiles(repoPath);
    const truncated = files.length >= MAX_SCAN_FILES;
    const fileSet = new Set(files);
    const aliases = this._readPathAliases(repoPath);
    const importers = new Map();

    for (const file of files) {
      let contents;
      try {
        contents = fs.readFileSync(path.join(repoPath, file), 'utf8');
      } catch {
        continue;
      }

      IMPORT_PATTERN.lastIndex = 0;
      let match;
      while ((match = IMPORT_PATTERN.exec(contents)) !== null) {
        const target = this._resolveSpecifier(match[1], file, fileSet, aliases);
        if (!target || target === file) continue;
        if (!importers.has(target)) importers.set(target, new Set());
        importers.get(target).add(file);
      }
    }

    return { importers, files, truncated };
  }

  /**
   * Maps a set of changed files onto feature names.
   *
   * @param {string} repoPath
   * @param {string[]} changedPaths repo-relative paths from `git diff`
   * @returns {{featureRoot: string|null, knownFeatures: string[],
   *            direct: Array<{feature: string, files: string[]}>,
   *            indirect: Array<{feature: string, viaFiles: string[]}>,
   *            unmapped: string[], fanIn: Object<string, number>,
   *            truncated: boolean}}
   */
  static analyzeImpact(repoPath, changedPaths) {
    const detected = this.detectFeatureRoot(repoPath);
    const featureRoot = detected ? detected.root : null;

    const direct = new Map();
    const shared = [];

    for (const filePath of changedPaths) {
      const feature = this.featureOf(filePath, featureRoot);
      if (feature) {
        if (!direct.has(feature)) direct.set(feature, []);
        direct.get(feature).push(filePath);
      } else if (this._isSource(filePath)) {
        shared.push(filePath);
      }
    }

    const indirect = new Map();
    const fanIn = {};
    const unmapped = [];
    let truncated = false;

    if (shared.length) {
      let index;
      try {
        index = this.buildReverseImportIndex(repoPath);
      } catch (error) {
        Logger.debug('FeatureMap: import scan failed', {
          reason: (error.message || '').substring(0, 120),
        });
        index = { importers: new Map(), files: [], truncated: false };
      }

      for (const filePath of shared) {
        const dependents = index.importers.get(filePath) || new Set();
        fanIn[filePath] = dependents.size;

        let mapped = false;
        for (const dependent of dependents) {
          const feature = this.featureOf(dependent, featureRoot);
          if (!feature) continue;
          // Skip features already flagged by a direct change — they are
          // reported once, at the higher confidence level.
          if (direct.has(feature)) { mapped = true; continue; }
          if (!indirect.has(feature)) indirect.set(feature, new Set());
          indirect.get(feature).add(filePath);
          mapped = true;
        }
        if (!mapped) unmapped.push(filePath);
      }

      truncated = index.truncated;
    }

    return {
      featureRoot,
      knownFeatures: detected ? detected.features : [],
      direct: [...direct.entries()]
        .map(([feature, files]) => ({ feature, files: files.sort() }))
        .sort((a, b) => a.feature.localeCompare(b.feature)),
      indirect: [...indirect.entries()]
        .map(([feature, viaFiles]) => ({ feature, viaFiles: [...viaFiles].sort() }))
        .sort((a, b) => a.feature.localeCompare(b.feature)),
      unmapped: unmapped.sort(),
      fanIn,
      truncated,
    };
  }

  /**
   * Which changed source files have no test covering them.
   *
   * When a project has no meaningful test suite the caller is told so, and the
   * risk model disables its test-gap driver rather than firing it on every
   * file of every branch — a signal that never varies is not a signal.
   *
   * @returns {{repoHasTests: boolean, untested: string[], testFileCount: number}}
   */
  static analyzeTestCoverage(repoPath, changedPaths) {
    const all = this._collectSourceFiles(repoPath);
    const tests = all.filter(file => TEST_FILE_PATTERN.test(file));

    if (tests.length < MIN_MEANINGFUL_TESTS) {
      return { repoHasTests: false, untested: [], testFileCount: tests.length };
    }

    // Index tests by the base name they appear to cover, so both
    // `Foo.test.tsx` next to `Foo.tsx` and `__tests__/Foo.tsx` are found.
    const covered = new Set();
    for (const testFile of tests) {
      const base = path.basename(testFile)
        .replace(/\.(test|spec)\.(ts|tsx|js|jsx)$/i, '')
        .replace(/\.(ts|tsx|js|jsx)$/i, '');
      covered.add(base.toLowerCase());
    }

    const untested = changedPaths.filter(filePath => {
      if (!this._isSource(filePath)) return false;
      if (TEST_FILE_PATTERN.test(filePath)) return false;
      const base = path.basename(filePath).replace(/\.(ts|tsx|js|jsx)$/i, '');
      return !covered.has(base.toLowerCase());
    }).sort();

    return { repoHasTests: true, untested, testFileCount: tests.length };
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  static _isSource(filePath) {
    return SOURCE_EXTENSIONS.includes(path.extname(filePath));
  }

  static _collectSourceFiles(repoPath) {
    const found = [];
    const walk = (relativeDir) => {
      if (found.length >= MAX_SCAN_FILES) return;
      let entries;
      try {
        entries = fs.readdirSync(path.join(repoPath, relativeDir), { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (found.length >= MAX_SCAN_FILES) return;
        if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue;
        const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(relativePath);
        else if (this._isSource(relativePath)) found.push(relativePath);
      }
    };
    walk('');
    return found;
  }

  /**
   * Reads tsconfig `paths` so alias imports (`@/services/api`) resolve.
   * tsconfig files routinely contain comments and trailing commas, which
   * JSON.parse rejects — both are stripped before parsing.
   * @returns {Array<{prefix: string, targets: string[]}>}
   */
  static _readPathAliases(repoPath) {
    for (const name of ['tsconfig.json', 'jsconfig.json']) {
      let raw;
      try {
        raw = fs.readFileSync(path.join(repoPath, name), 'utf8');
      } catch {
        continue;
      }
      try {
        const stripped = raw
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|\s)\/\/.*$/gm, '$1')
          .replace(/,(\s*[}\]])/g, '$1');
        const parsed = JSON.parse(stripped);
        const options = parsed.compilerOptions || {};
        const paths = options.paths || {};
        const baseUrl = (options.baseUrl || '.').replace(/^\.\/?/, '');

        return Object.entries(paths).map(([alias, targets]) => ({
          prefix: alias.replace(/\*$/, ''),
          targets: (Array.isArray(targets) ? targets : [targets])
            .map(target => {
              const cleaned = String(target).replace(/\*$/, '').replace(/^\.\//, '');
              return baseUrl ? `${baseUrl}/${cleaned}` : cleaned;
            }),
        })).filter(entry => entry.prefix);
      } catch (error) {
        Logger.debug(`FeatureMap: could not parse ${name}`, {
          reason: (error.message || '').substring(0, 100),
        });
        return [];
      }
    }
    return [];
  }

  /**
   * Turns an import specifier into a repo-relative file path, or null when it
   * points outside the project (a node_modules package).
   */
  static _resolveSpecifier(specifier, fromFile, fileSet, aliases) {
    let base = null;

    if (specifier.startsWith('.')) {
      base = path.posix.normalize(
        path.posix.join(path.posix.dirname(fromFile), specifier)
      );
    } else {
      for (const alias of aliases) {
        if (!specifier.startsWith(alias.prefix)) continue;
        const remainder = specifier.slice(alias.prefix.length);
        for (const target of alias.targets) {
          const candidate = this._match(path.posix.normalize(`${target}${remainder}`), fileSet);
          if (candidate) return candidate;
        }
      }
      return null;
    }

    if (base.startsWith('..')) return null;
    return this._match(base, fileSet);
  }

  static _match(base, fileSet) {
    for (const suffix of RESOLVE_SUFFIXES) {
      const candidate = `${base}${suffix}`;
      if (fileSet.has(candidate)) return candidate;
    }
    return null;
  }
}

module.exports = FeatureMap;
