/// MARK: - Risk Model
/// Turns already-collected signals into an explainable merge-risk score.
///
/// This module is deliberately PURE: no git calls, no file reads, no model
/// calls. It takes a signals object and returns a number plus the reasoning
/// behind every point of it. That is what makes it unit-testable with fixtures
/// and what guarantees the same diff always scores the same.
///
/// Three rules the output must always satisfy:
///   1. Deterministic — no clock, no randomness, stable sort order.
///   2. Explainable  — every point traces to a named driver with evidence.
///   3. Bounded      — each driver is capped, the total clamps to 0-100.

const { RISK_WEIGHTS, RISK_BANDS } = require('../Constants/constants');

/// Native build inputs. Changing any of these forces every teammate to
/// rebuild — a cached build will not pick them up.
const NATIVE_PATTERNS = [
  /^ios\//i, /^android\//i, /(^|\/)Podfile(\.lock)?$/i,
  /\.gradle(\.kts)?$/i, /AndroidManifest\.xml$/i, /Info\.plist$/i,
];

/// Changes that alter how the app is built, configured or deployed rather
/// than what it does.
const MIGRATION_CONFIG_PATTERNS = [
  /(^|\/)migrations?\//i, /schema\.(prisma|sql|graphql)$/i,
  /^\.github\/workflows\//i, /(^|\/)\.env(\.[\w-]+)?$/i,
  /(^|\/)app\.(json|config\.(js|ts))$/i, /(^|\/)eas\.json$/i,
  /(^|\/)(babel|metro)\.config\.(js|ts|cjs)$/i,
];

/// Excluded from churn: machine-written files whose line counts say nothing
/// about how risky the change is.
const GENERATED_PATTERNS = [
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Podfile\.lock)$/i,
  /\.snap$/i, /\.generated\.[\w]+$/i, /(^|\/)dist\//i, /(^|\/)build\//i,
];

const LOCKFILE_PATTERN =
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|Podfile\.lock)$/i;

/// Evidence lists are truncated so a 200-file branch does not produce an
/// unreadable report. The count is always stated alongside.
const MAX_EVIDENCE = 6;

class RiskModel {
  /**
   * @param {object} signals
   * @param {Array<{path: string}>} [signals.changedFiles]
   * @param {string[]}  [signals.conflicts]      paths git could not auto-merge
   * @param {number}    [signals.behind]         commits the target has that this branch lacks
   * @param {Object<string, number>} [signals.fanIn]  changed path -> importer count
   * @param {Array<{name: string, from: string, to: string}>} [signals.majorBumps]
   * @param {boolean}   [signals.lockfileChanged]
   * @param {boolean}   [signals.repoHasTests]   false disables the test-gap driver
   * @param {number}    [signals.testFileCount]  used only to word the disabled-driver note
   * @param {string[]}  [signals.untestedFiles]
   * @param {string[]}  [signals.fragilePaths]   paths with prior revert/hotfix commits
   * @param {number}    [signals.churnLines]     added+removed, generated files excluded
   * @returns {{score: number, band: string, drivers: Array, mitigations: string[], skipped: Array}}
   */
  static computeRisk(signals = {}) {
    const changedPaths = (signals.changedFiles || [])
      .map(file => (typeof file === 'string' ? file : file.path))
      .filter(Boolean);

    const drivers = [];
    const mitigations = [];
    const skipped = [];

    const add = (id, label, rawPoints, evidence, weight) => {
      const points = Math.min(Math.round(rawPoints), weight.cap);
      if (points <= 0) return;
      drivers.push({ id, label, points, evidence: this._trim(evidence) });
    };

    // ── Native code ────────────────────────────────────────────────────
    const native = changedPaths.filter(p => this._matchesAny(p, NATIVE_PATTERNS)).sort();
    if (native.length) {
      const weight = RISK_WEIGHTS.native_code;
      add('native_code', 'Native iOS/Android build inputs modified',
        weight.points, native, weight);
      mitigations.push('Native changes require a clean rebuild — say so in the PR description so nobody debugs a stale build.');
    }

    // ── Shared module fan-in ───────────────────────────────────────────
    const weightFanIn = RISK_WEIGHTS.shared_fanin;
    const heavy = Object.entries(signals.fanIn || {})
      .filter(([, count]) => count >= weightFanIn.minDependents)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (heavy.length) {
      const total = heavy.reduce((sum, [, count]) => sum + count, 0);
      add('shared_fanin',
        `Shared code with ${total} dependents across ${heavy.length} file(s)`,
        total * weightFanIn.points,
        heavy.map(([path, count]) => `${path} (${count} importers)`),
        weightFanIn);
      mitigations.push(`Smoke-test the features that import ${heavy[0][0]} — the change reaches ${heavy[0][1]} files.`);
    }

    // ── Dependency changes ─────────────────────────────────────────────
    const weightDep = RISK_WEIGHTS.dep_major;
    const majors = (signals.majorBumps || [])
      .slice()
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    if (majors.length) {
      add('dep_major', `${majors.length} major dependency bump(s)`,
        majors.length * weightDep.points,
        majors.map(bump => `${bump.name} ${bump.from} -> ${bump.to}`),
        weightDep);
      mitigations.push('Read the changelog for each major bump before merging — majors break APIs by definition.');
    } else if (signals.lockfileChanged) {
      // Lockfile churn alone is near-meaningless; it is scored once, flat.
      add('dep_lockfile', 'Lockfile changed with no major version bumps',
        weightDep.lockfileOnly, ['lockfile only'], { cap: weightDep.lockfileOnly });
    }

    // ── Test gap ───────────────────────────────────────────────────────
    const weightTest = RISK_WEIGHTS.test_gap;
    const untested = (signals.untestedFiles || []).slice().sort();
    if (signals.repoHasTests === false) {
      const count = Number(signals.testFileCount) || 0;
      skipped.push({
        id: 'test_gap',
        reason: count === 0
          ? 'Test-gap scoring disabled: this project has no test files, so the driver would fire on every file of every branch and never vary.'
          : `Test-gap scoring disabled: this project has only ${count} test file(s), which is generator boilerplate rather than a suite.`,
      });
    } else if (untested.length) {
      add('test_gap', `${untested.length} changed file(s) have no test`,
        untested.length * weightTest.points, untested, weightTest);
      mitigations.push(`Adding tests for the ${untested.length} uncovered file(s) is the cheapest way to drop this score.`);
    }

    // ── Migration / schema / config ────────────────────────────────────
    const configFiles = changedPaths
      .filter(p => this._matchesAny(p, MIGRATION_CONFIG_PATTERNS)).sort();
    if (configFiles.length) {
      const weight = RISK_WEIGHTS.migration_config;
      add('migration_config', 'Build, CI or environment configuration changed',
        weight.points, configFiles, weight);
      mitigations.push('Config changes affect everyone on merge — confirm CI is green on this branch first.');
    }

    // ── Predicted merge conflicts ──────────────────────────────────────
    const conflicts = (signals.conflicts || []).slice().sort();
    if (conflicts.length) {
      const weight = RISK_WEIGHTS.merge_conflicts;
      add('merge_conflicts', `${conflicts.length} file(s) will not auto-merge`,
        conflicts.length * weight.points, conflicts, weight);
      mitigations.push('Resolve conflicts on your branch before opening the PR rather than in the merge commit.');
    }

    // ── Branch staleness ───────────────────────────────────────────────
    const behind = Number(signals.behind) || 0;
    const weightStale = RISK_WEIGHTS.staleness;
    if (behind >= weightStale.per) {
      add('staleness', `Branch is ${behind} commits behind the target`,
        Math.floor(behind / weightStale.per) * weightStale.points,
        [`${behind} commits behind`], weightStale);
      mitigations.push(`Rebase on the target branch — ${behind} commits of drift is where most of these conflicts come from.`);
    }

    // ── Historically fragile paths ─────────────────────────────────────
    const fragile = (signals.fragilePaths || []).slice().sort();
    if (fragile.length) {
      const weight = RISK_WEIGHTS.fragile_paths;
      add('fragile_paths', `${fragile.length} path(s) have been reverted or hot-fixed before`,
        fragile.length * weight.points, fragile, weight);
    }

    // ── Churn ──────────────────────────────────────────────────────────
    const churn = Number(signals.churnLines) || 0;
    const weightChurn = RISK_WEIGHTS.churn;
    if (churn >= weightChurn.per) {
      add('churn', `${churn} lines changed (generated files excluded)`,
        Math.floor(churn / weightChurn.per) * weightChurn.points,
        [`${churn} lines`], weightChurn);
    }

    // Stable ordering: biggest contributor first, id as tiebreak so two
    // drivers worth the same points never swap places between runs.
    drivers.sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));

    const score = Math.max(0, Math.min(100,
      drivers.reduce((sum, driver) => sum + driver.points, 0)));

    return {
      score,
      band: this.bandFor(score),
      drivers,
      mitigations,
      skipped,
    };
  }

  /**
   * Maps a 0-100 score onto the repo's LOW/MEDIUM/HIGH vocabulary.
   */
  static bandFor(score) {
    for (const { max, band } of RISK_BANDS) {
      if (score <= max) return band;
    }
    return RISK_BANDS[RISK_BANDS.length - 1].band;
  }

  /**
   * Whether a path's line count should count toward churn.
   * Exported so collectors can exclude the same files consistently.
   */
  static isGenerated(filePath) {
    return this._matchesAny(filePath, GENERATED_PATTERNS);
  }

  static isLockfile(filePath) {
    return LOCKFILE_PATTERN.test(filePath);
  }

  // ── Internal helpers ──────────────────────────────────────────────────

  static _matchesAny(filePath, patterns) {
    return patterns.some(pattern => pattern.test(filePath));
  }

  static _trim(evidence) {
    if (evidence.length <= MAX_EVIDENCE) return evidence;
    const shown = evidence.slice(0, MAX_EVIDENCE);
    shown.push(`…and ${evidence.length - MAX_EVIDENCE} more`);
    return shown;
  }
}

module.exports = RiskModel;
