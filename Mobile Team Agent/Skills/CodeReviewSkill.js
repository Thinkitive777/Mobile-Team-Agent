/// MARK: - Code Review Skill
/// Deep code review with React Native specific issue detection,
/// branch diff analysis, merge risk scoring, and breaking change detection.

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const BaseSkill = require('./Core/BaseSkill');

const execFileAsync = promisify(execFile);

// ── RN-specific issue patterns ────────────────────────────────────────────

const RN_ISSUE_PATTERNS = [
  // CRITICAL
  {
    severity: 'CRITICAL',
    pattern: /navigation\.(navigate|push|replace)\s*\(\s*['"`][^'"`]+['"`]\s*\)/g,
    issue: 'Untyped navigation call — route name is a raw string',
    fix: 'Use typed navigation: navigation.navigate("ScreenName" as never) or define RootStackParamList',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'CRITICAL',
    pattern: /AsyncStorage\.(setItem|getItem|removeItem)\s*\([^)]+\)\s*(?!\.then|\.catch|await)/g,
    issue: 'AsyncStorage call without await or .then/.catch — silent failure risk',
    fix: 'Always await AsyncStorage calls or handle the returned Promise',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'CRITICAL',
    pattern: /setState\s*\([^)]*\)\s*\/\/.*async|async.*setState/g,
    issue: 'Potential async setState after unmount — memory leak',
    fix: 'Use a cleanup ref: if (!isMounted.current) return; before setState',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },

  // HIGH
  {
    severity: 'HIGH',
    pattern: /useEffect\s*\(\s*\([^)]*\)\s*=>\s*\{[^}]*\}\s*,\s*\[\s*\]\s*\)/g,
    issue: 'useEffect with empty dependency array — possible stale closure',
    fix: 'Verify that no variables inside the effect need to be in the dependency array',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'HIGH',
    pattern: /<FlatList[^>]*(?!keyExtractor)/g,
    issue: 'FlatList without keyExtractor — causes key warnings and re-render issues',
    fix: 'Add keyExtractor={(item) => item.id.toString()} to every FlatList',
    fileFilter: /\.(tsx|jsx)$/,
  },
  {
    severity: 'HIGH',
    pattern: /<Image[^>]*(?!width|height)[^>]*\/>/g,
    issue: 'Image without explicit width/height — causes layout jumps (CLS)',
    fix: 'Always provide width and height props or use a fixed-size container',
    fileFilter: /\.(tsx|jsx)$/,
  },
  {
    severity: 'HIGH',
    pattern: /useEffect\s*\(.*=>\s*\{[\s\S]*?fetch|axios|api\b[\s\S]*?\},/g,
    issue: 'Direct API call inside useEffect — no cancellation, no loading state management',
    fix: 'Move to a custom hook using TanStack Query or add AbortController cleanup',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'HIGH',
    pattern: /console\.(log|warn|error|debug)\s*\(/g,
    issue: 'console.log left in production code',
    fix: 'Remove console statements before merging to main/production branches',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'HIGH',
    pattern: /catch\s*\(\s*\w*\s*\)\s*\{\s*\}/g,
    issue: 'Empty catch block — errors silently swallowed',
    fix: 'At minimum: console.error(e) or Sentry.captureException(e) in catch blocks',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },

  // MEDIUM
  {
    severity: 'MEDIUM',
    pattern: /style\s*=\s*\{\s*\{/g,
    issue: 'Inline style object — creates new object on every render',
    fix: 'Move to StyleSheet.create() outside the component',
    fileFilter: /\.(tsx|jsx)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /(['"`])(#[0-9a-fA-F]{3,8}|rgba?\([^)]+\))\1/g,
    issue: 'Hardcoded color value',
    fix: 'Move to src/constants/colors.ts and reference by name',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /import\s+.*\s+from\s+['"`](?!@|\.|\.\.)(?!react|react-native)[a-z]/g,
    issue: 'Possible missing absolute path alias — using deep relative imports',
    fix: 'Configure path aliases in tsconfig.json (e.g. @screens/, @hooks/) to avoid ../../..',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /Platform\.OS\s*===\s*['"`](ios|android)['"`]/g,
    issue: 'Platform.OS check without Platform.select — harder to maintain',
    fix: "Use Platform.select({ ios: valueA, android: valueB }) for cleaner cross-platform code",
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /any(?:\s*[;,\)]|\s*=)/g,
    issue: 'TypeScript any type used — defeats type safety',
    fix: 'Replace with proper types or unknown. Use type assertions sparingly.',
    fileFilter: /\.(tsx|ts)$/,
  },

  // ── Redundant / leftover logs ─────────────────────────────────────────────
  {
    severity: 'HIGH',
    pattern: /console\.(debug|info|verbose|trace)\s*\(/g,
    issue: 'console.debug/info/verbose/trace left in code',
    fix: 'Remove all console statements before merging — use a proper logger or remove entirely',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /logger\.(debug|verbose|trace)\s*\(/g,
    issue: 'Verbose/debug logger calls left in code',
    fix: 'Remove debug-level logger calls before merging to main',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },

  // ── Missing handling ──────────────────────────────────────────────────────
  {
    severity: 'CRITICAL',
    pattern: /\.then\s*\([^)]*\)\s*(?!\.catch)/g,
    issue: 'Promise .then() without .catch() — unhandled rejection risk',
    fix: 'Chain .catch(e => ...) or use try/await with try-catch',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'HIGH',
    pattern: /JSON\.parse\s*\([^)]+\)(?!\s*\/\/|\s*catch|\s*try)/g,
    issue: 'JSON.parse without try-catch — throws on malformed input',
    fix: 'Wrap JSON.parse in try-catch: try { JSON.parse(x) } catch { ... }',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'HIGH',
    pattern: /(?<!\bif\b.{0,30})\bisLoading\b(?!.*:)/g,
    issue: 'isLoading state referenced but may not be shown to user — missing loading UI',
    fix: 'Ensure isLoading renders an ActivityIndicator or skeleton before the main content',
    fileFilter: /\.(tsx|jsx)$/,
  },
  {
    severity: 'HIGH',
    pattern: /(?<!\bif\b.{0,30})\bisError\b(?!.*:)/g,
    issue: 'isError state referenced but may not render an error message to user',
    fix: 'Show a user-friendly error message or retry option when isError is true',
    fileFilter: /\.(tsx|jsx)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /<(ScrollView|FlatList|SectionList)[^>]*>(?![\s\S]*?(ListEmptyComponent|empty|noData|EmptyState))/g,
    issue: 'List/ScrollView without empty state handling',
    fix: 'Add ListEmptyComponent to FlatList/SectionList to handle the zero-item case',
    fileFilter: /\.(tsx|jsx)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /onPress\s*=\s*\{(?![^}]*disabled|[^}]*loading)[^}]*async/g,
    issue: 'Async onPress handler without disabled state — double-tap risk',
    fix: 'Disable the button while the async operation is in progress to prevent duplicate calls',
    fileFilter: /\.(tsx|jsx)$/,
  },

  // ── File and code placement ───────────────────────────────────────────────
  {
    severity: 'HIGH',
    pattern: /(?:fetch|axios)\s*\.\s*(?:get|post|put|delete|patch)\s*\(/g,
    issue: 'Direct API call — likely in wrong layer (screen or component)',
    fix: 'Move API calls to a service file (services/) or a custom hook (hooks/use*.ts)',
    fileFilter: /[Ss]creen\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /export\s+default\s+function\s+[A-Z][a-zA-Z]+/g,
    issue: 'Component defined in a non-component file (possible misplacement)',
    fix: 'Move React components to src/components/ or src/screens/ — keep service/util files free of JSX',
    fileFilter: /(?:service|util|helper|store|slice)\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /useSelector|useDispatch|useStore/g,
    issue: 'Redux/Zustand store access directly in a component — bypasses abstraction',
    fix: 'Wrap store access in a custom hook (e.g. useAuthStore()) to keep components clean',
    fileFilter: /[Ss]creen\.(tsx|jsx)$/,
  },

  // ── Reusability issues ────────────────────────────────────────────────────
  {
    severity: 'MEDIUM',
    pattern: /(\bconst\b[^=]+=\s*\d{3,}(?!\s*ms|\s*px|\s*s))/g,
    issue: 'Magic number in code — intent is unclear',
    fix: 'Extract to a named constant: const MAX_RETRY_COUNT = 3 in constants/',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /(['"`])((?:[A-Za-z0-9_\-\/]+\s*){4,})\1(?=.*\1\2\1)/g,
    issue: 'Duplicated string literal — reusability issue',
    fix: 'Extract repeated strings to a constants file or i18n key',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'LOW',
    pattern: /(<View[\s\S]{0,200}<\/View>)([\s\S]{0,500})\1/g,
    issue: 'Potentially duplicated JSX block — reusability opportunity',
    fix: 'Extract repeated JSX into a reusable component',
    fileFilter: /\.(tsx|jsx)$/,
  },

  // ── Library usage ─────────────────────────────────────────────────────────
  {
    severity: 'HIGH',
    pattern: /\bfetch\s*\(\s*['"`]https?:/g,
    issue: 'Raw fetch() used instead of configured axios/API client',
    fix: 'Use the project\'s configured API client (axios instance) for consistent baseURL, headers, and interceptors',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'HIGH',
    pattern: /import\s+.*\s+from\s+['"`]lodash['"`]/g,
    issue: 'Full lodash import — massive bundle size increase',
    fix: "Import only what you need: import debounce from 'lodash/debounce'",
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /import\s+.*\s+from\s+['"`]moment['"`]/g,
    issue: 'moment.js imported — deprecated and very heavy (300kb+)',
    fix: "Replace with date-fns or dayjs: import { format } from 'date-fns'",
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /new\s+Date\s*\(\s*\)\.toLocaleString|new\s+Date\s*\(\s*\)\.toLocaleDateString/g,
    issue: 'Native Date formatting used — inconsistent across platforms/locales',
    fix: "Use date-fns format() or dayjs().format() for consistent date formatting",
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /import\s+.*\s+from\s+['"`]react-native-vector-icons\/(?!MaterialIcons|Ionicons|FontAwesome5)/g,
    issue: 'Non-standard icon set imported — verify it is installed and linked',
    fix: 'Confirm the icon pack is in package.json and linked in the native project',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },

  // ── Typos (common misspellings in identifiers and strings) ────────────────
  {
    severity: 'LOW',
    pattern: /\b(recieve|occurence|seperate|definately|publically|successfull|paramters|enviroment|authentification|authenication|autherization|managment|responce|requets|resposne|cliend|lenght|hieght|widht|naviagtion|componenet|screeen|visiblity|diabled|pressabel)\b/gi,
    issue: 'Common spelling mistake in identifier or string',
    fix: 'Fix the typo: recieve→receive, seperate→separate, definately→definitely, etc.',
    fileFilter: /\.(tsx|ts|jsx|js|md)$/,
  },

  // ── Logic issues ──────────────────────────────────────────────────────────
  {
    severity: 'HIGH',
    pattern: /if\s*\(\s*(true|false)\s*\)/g,
    issue: 'Hardcoded boolean in if-condition — unreachable or always-executed branch',
    fix: 'Remove the dead branch or use the actual condition variable',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'HIGH',
    pattern: /return[\s\S]{0,5};\s*\n\s*(?!\/\/)[^\s}]/g,
    issue: 'Unreachable code after return statement',
    fix: 'Remove the dead code after the return, or move it before the return',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /===\s*undefined\s*===|===\s*null\s*===|null\s*===\s*null|undefined\s*===\s*undefined/g,
    issue: 'Tautological or redundant null/undefined check',
    fix: 'Simplify the condition — the comparison is always true or always false',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'MEDIUM',
    pattern: /\bsetState\b.*\bsetState\b/g,
    issue: 'Multiple setState calls in the same handler — causes multiple re-renders',
    fix: 'Batch updates with a single setState call or use useReducer for complex state',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },

  // LOW
  {
    severity: 'LOW',
    pattern: /\/\/\s*TODO|\/\/\s*FIXME|\/\/\s*HACK/gi,
    issue: 'TODO/FIXME comment found in code',
    fix: 'Create a Jira ticket for this and link it, or resolve before merging',
    fileFilter: /\.(tsx|ts|jsx|js)$/,
  },
  {
    severity: 'LOW',
    pattern: /function\s+[A-Z][a-zA-Z]*\s*\([^)]*\)\s*\{/g,
    issue: 'Function component declared with function keyword instead of arrow function',
    fix: 'Use arrow functions for consistency: const MyComponent = () => { }',
    fileFilter: /\.(tsx|jsx)$/,
  },
];

// ── Risk factors for files/areas ─────────────────────────────────────────

const HIGH_RISK_PATHS = [
  { pattern: /^ios\/|^android\//i, reason: 'Native code change — teammates must rebuild', level: 'CRITICAL' },
  { pattern: /package\.json$/, reason: 'Dependency change — verify no breaking version bumps', level: 'HIGH' },
  { pattern: /babel\.config|metro\.config/, reason: 'Bundler config — can break entire build', level: 'HIGH' },
  { pattern: /app\.json|app\.config/, reason: 'Expo app config change — may affect build pipeline', level: 'HIGH' },
  { pattern: /Podfile/, reason: 'iOS pods changed — all iOS devs must pod install', level: 'HIGH' },
  { pattern: /\.gradle$|build\.gradle/, reason: 'Android build config — affects Android build pipeline', level: 'HIGH' },
  { pattern: /navigation\//i, reason: 'Navigation structure changed — test all routes', level: 'HIGH' },
  { pattern: /store\/|redux\/|zustand\//i, reason: 'Global state changed — wide blast radius', level: 'MEDIUM' },
  { pattern: /services\//i, reason: 'Service layer changed — verify all callers', level: 'MEDIUM' },
  { pattern: /types\/|interfaces\//i, reason: 'Type definitions changed — check for breaking consumers', level: 'MEDIUM' },
  { pattern: /constants\//i, reason: 'Constants changed — verify all references', level: 'LOW' },
];

class CodeReviewSkill extends BaseSkill {
  constructor() {
    super();
    this.name = 'CodeReviewSkill';
  }

  getTools() {
    return [
      {
        name: 'review_branch',
        description: 'Deep code review of all changes in the current branch vs a target branch (default: main). Detects RN-specific issues, scores merge risk, and lists what must be fixed before merging.',
        inputSchema: {
          type: 'object',
          properties: {
            target_branch: { type: 'string', description: 'Branch to compare against (default: main)' },
            source_branch: { type: 'string', description: 'Branch being reviewed (default: current branch)' },
          },
        },
      },
      {
        name: 'detect_rn_issues',
        description: 'Scan a specific file or the entire current branch diff for React Native specific anti-patterns, performance issues, and common bugs.',
        inputSchema: {
          type: 'object',
          properties: {
            file_path: { type: 'string', description: 'Specific file to scan. If omitted, scans all changed files in current branch.' },
            target_branch: { type: 'string', description: 'Compare against this branch to find changed files (default: main)' },
          },
        },
      },
      {
        name: 'compare_with_branch',
        description: 'Compare the current branch with another branch and produce a merge readiness report: changed files, native changes, dependency changes, config changes, and overall risk level.',
        inputSchema: {
          type: 'object',
          properties: {
            target_branch: { type: 'string', description: 'Branch to compare against (default: main)' },
            source_branch: { type: 'string', description: 'Source branch (default: current branch)' },
          },
        },
      },
      {
        name: 'check_breaking_changes',
        description: 'Analyse what could break when merging the current branch: major package version bumps, removed navigation routes, API contract changes, type changes, and native file changes.',
        inputSchema: {
          type: 'object',
          properties: {
            target_branch: { type: 'string', description: 'Branch to compare against (default: main)' },
          },
        },
      },
    ];
  }

  async handleTool(name, args, context) {
    const { getRepoPath } = context;
    const repoPath = getRepoPath();

    switch (name) {

      case 'review_branch': {
        const target = args.target_branch || 'main';
        const source = args.source_branch || await this._currentBranch(repoPath);

        let out = `Branch Code Review\n`;
        out += `${'='.repeat(60)}\n`;
        out += `Reviewing: ${source} → ${target}\n\n`;

        // Get changed files
        const changedFiles = await this._getChangedFiles(target, source, repoPath);
        if (changedFiles.length === 0) {
          return this.textResponse(`No changes found between ${source} and ${target}.`);
        }

        out += `FILES CHANGED: ${changedFiles.length}\n`;
        out += `${'─'.repeat(40)}\n`;

        // Categorise changed files by risk
        const critical = [], high = [], medium = [], low = [];
        for (const file of changedFiles) {
          const risk = this._fileRiskLevel(file.path);
          const entry = `${file.status} ${file.path}${risk ? ` [${risk.level}: ${risk.reason}]` : ''}`;
          if (risk?.level === 'CRITICAL') critical.push(entry);
          else if (risk?.level === 'HIGH') high.push(entry);
          else if (risk?.level === 'MEDIUM') medium.push(entry);
          else low.push(entry);
        }

        if (critical.length) { out += `\nCRITICAL FILES (${critical.length}):\n`; critical.forEach(f => out += `  ${f}\n`); }
        if (high.length) { out += `\nHIGH RISK FILES (${high.length}):\n`; high.forEach(f => out += `  ${f}\n`); }
        if (medium.length) { out += `\nMEDIUM RISK FILES (${medium.length}):\n`; medium.forEach(f => out += `  ${f}\n`); }
        if (low.length) { out += `\nNORMAL FILES (${low.length}):\n`; low.forEach(f => out += `  ${f}\n`); }

        // Get full diff and run issue detection
        const diff = await this._getBranchDiff(target, source, repoPath);
        const issues = this._detectIssuesInDiff(diff);

        out += `\n${'='.repeat(60)}\n`;
        out += `RN ISSUE DETECTION\n`;
        out += `${'─'.repeat(40)}\n`;

        if (issues.length === 0) {
          out += `No RN-specific issues detected in the diff.\n`;
        } else {
          const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
          for (const issue of issues) bySeverity[issue.severity].push(issue);

          for (const [sev, list] of Object.entries(bySeverity)) {
            if (list.length === 0) continue;
            out += `\n[${sev}] (${list.length})\n`;
            for (const i of list) {
              out += `  Issue: ${i.issue}\n`;
              out += `  Fix:   ${i.fix}\n\n`;
            }
          }
        }

        // Overall risk score
        const riskScore = this._calculateRiskScore(changedFiles, issues);
        out += `${'='.repeat(60)}\n`;
        out += `MERGE RISK: ${riskScore.level}\n`;
        out += `Score: ${riskScore.score}/100 (higher = riskier)\n\n`;

        if (riskScore.mustFix.length > 0) {
          out += `MUST FIX BEFORE MERGE (${riskScore.mustFix.length}):\n`;
          riskScore.mustFix.forEach((f, i) => out += `  ${i + 1}. ${f}\n`);
        }
        if (riskScore.shouldFix.length > 0) {
          out += `\nSHOULD FIX (${riskScore.shouldFix.length}):\n`;
          riskScore.shouldFix.forEach((f, i) => out += `  ${i + 1}. ${f}\n`);
        }

        if (riskScore.level === 'LOW') {
          out += `\nVerdict: Branch looks clean. Safe to merge after standard review.\n`;
        } else if (riskScore.level === 'MEDIUM') {
          out += `\nVerdict: Some concerns to address. Fix MUST items before raising PR.\n`;
        } else {
          out += `\nVerdict: High risk — do NOT merge until CRITICAL and HIGH issues are resolved.\n`;
        }

        return this.textResponse(out);
      }

      case 'detect_rn_issues': {
        const target = args.target_branch || 'main';
        let content = '';
        let label = '';

        if (args.file_path) {
          const fullPath = path.isAbsolute(args.file_path) ? args.file_path : path.join(repoPath, args.file_path);
          if (!fs.existsSync(fullPath)) {
            return this.errorResponse(`File not found: ${fullPath}`);
          }
          content = fs.readFileSync(fullPath, 'utf-8');
          label = args.file_path;
        } else {
          const source = await this._currentBranch(repoPath);
          content = await this._getBranchDiff(target, source, repoPath);
          label = `all changed files vs ${target}`;
        }

        const issues = this._detectIssuesInContent(content, args.file_path || 'diff');

        let out = `RN Issue Detection — ${label}\n`;
        out += `${'='.repeat(60)}\n\n`;

        if (issues.length === 0) {
          out += `No RN-specific issues detected.\n`;
          return this.textResponse(out);
        }

        out += `Found ${issues.length} issue(s):\n\n`;
        const bySeverity = { CRITICAL: [], HIGH: [], MEDIUM: [], LOW: [] };
        for (const i of issues) bySeverity[i.severity].push(i);

        for (const [sev, list] of Object.entries(bySeverity)) {
          if (list.length === 0) continue;
          out += `[${sev}] — ${list.length} issue(s)\n`;
          out += `${'─'.repeat(40)}\n`;
          for (const i of list) {
            out += `  Issue: ${i.issue}\n`;
            out += `  Fix:   ${i.fix}\n\n`;
          }
        }

        return this.textResponse(out);
      }

      case 'compare_with_branch': {
        const target = args.target_branch || 'main';
        const source = args.source_branch || await this._currentBranch(repoPath);

        let out = `Branch Comparison: ${source} vs ${target}\n`;
        out += `${'='.repeat(60)}\n\n`;

        const changedFiles = await this._getChangedFiles(target, source, repoPath);
        if (changedFiles.length === 0) {
          return this.textResponse(`No differences found between ${source} and ${target}.`);
        }

        // Stats
        const added = changedFiles.filter(f => f.status === 'A');
        const modified = changedFiles.filter(f => f.status === 'M');
        const deleted = changedFiles.filter(f => f.status === 'D');
        const renamed = changedFiles.filter(f => f.status === 'R');

        out += `SUMMARY\n`;
        out += `${'─'.repeat(40)}\n`;
        out += `Added:    ${added.length} file(s)\n`;
        out += `Modified: ${modified.length} file(s)\n`;
        out += `Deleted:  ${deleted.length} file(s)\n`;
        if (renamed.length) out += `Renamed:  ${renamed.length} file(s)\n`;
        out += `Total:    ${changedFiles.length} file(s)\n\n`;

        // Native changes
        const nativeChanges = changedFiles.filter(f => /^ios\/|^android\//i.test(f.path));
        if (nativeChanges.length > 0) {
          out += `NATIVE CHANGES DETECTED (${nativeChanges.length})\n`;
          out += `${'─'.repeat(40)}\n`;
          out += `ACTION REQUIRED: All developers must rebuild after pulling this branch.\n`;
          nativeChanges.forEach(f => out += `  ${f.status} ${f.path}\n`);
          out += `\n`;
        }

        // Dependency changes
        const pkgChanged = changedFiles.some(f => f.path === 'package.json');
        if (pkgChanged) {
          out += `DEPENDENCY CHANGES\n`;
          out += `${'─'.repeat(40)}\n`;
          const pkgDiff = await this._getFileDiff(target, source, 'package.json', repoPath);
          const depChanges = this._parseDependencyChanges(pkgDiff);
          if (depChanges.added.length) out += `Added:   ${depChanges.added.join(', ')}\n`;
          if (depChanges.removed.length) out += `Removed: ${depChanges.removed.join(', ')}\n`;
          if (depChanges.upgraded.length) out += `Upgraded (check for breaking): ${depChanges.upgraded.join(', ')}\n`;
          out += `Run: npm install after pulling.\n\n`;
        }

        // Config changes
        const configChanges = changedFiles.filter(f =>
          /babel\.config|metro\.config|app\.json|app\.config|tsconfig|\.eslintrc/i.test(f.path)
        );
        if (configChanges.length > 0) {
          out += `CONFIG CHANGES (verify nothing breaks)\n`;
          out += `${'─'.repeat(40)}\n`;
          configChanges.forEach(f => out += `  ${f.status} ${f.path}\n`);
          out += `\n`;
        }

        // Navigation changes
        const navChanges = changedFiles.filter(f => /navigation\//i.test(f.path));
        if (navChanges.length > 0) {
          out += `NAVIGATION CHANGES — test all routes after merge\n`;
          out += `${'─'.repeat(40)}\n`;
          navChanges.forEach(f => out += `  ${f.status} ${f.path}\n`);
          out += `\n`;
        }

        // All files by risk
        out += `ALL CHANGED FILES BY RISK\n`;
        out += `${'─'.repeat(40)}\n`;
        for (const file of changedFiles) {
          const risk = this._fileRiskLevel(file.path);
          out += `  [${risk?.level || 'LOW'}] ${file.status} ${file.path}\n`;
          if (risk) out += `         ${risk.reason}\n`;
        }

        // Commits in this branch
        const commits = await this._getBranchCommits(target, source, repoPath);
        out += `\nCOMMITS IN THIS BRANCH (${commits.length})\n`;
        out += `${'─'.repeat(40)}\n`;
        commits.forEach(c => out += `  ${c.hash} ${c.message} (${c.author})\n`);

        // Risk level
        const riskScore = this._calculateRiskScore(changedFiles, []);
        out += `\nMERGE RISK: ${riskScore.level}\n`;
        if (nativeChanges.length) out += `Critical: Native changes require rebuild\n`;
        if (pkgChanged) out += `Important: Run npm install after merge\n`;

        return this.textResponse(out);
      }

      case 'check_breaking_changes': {
        const target = args.target_branch || 'main';
        const source = await this._currentBranch(repoPath);

        let out = `Breaking Change Analysis: ${source} vs ${target}\n`;
        out += `${'='.repeat(60)}\n\n`;

        const changedFiles = await this._getChangedFiles(target, source, repoPath);
        const breakingIssues = [];

        // 1. Package.json major version bumps
        const pkgChanged = changedFiles.some(f => f.path === 'package.json');
        if (pkgChanged) {
          const pkgDiff = await this._getFileDiff(target, source, 'package.json', repoPath);
          const majors = this._detectMajorVersionBumps(pkgDiff);
          if (majors.length > 0) {
            breakingIssues.push({
              level: 'CRITICAL',
              area: 'Dependencies',
              items: majors,
              action: 'Review each library\'s migration guide before merging',
            });
          }
        }

        // 2. Native changes
        const nativeChanges = changedFiles.filter(f => /^ios\/|^android\//i.test(f.path));
        if (nativeChanges.length > 0) {
          breakingIssues.push({
            level: 'CRITICAL',
            area: 'Native Code',
            items: nativeChanges.map(f => f.path),
            action: 'All team members must rebuild the app after pulling this branch',
          });
        }

        // 3. Deleted files
        const deletedFiles = changedFiles.filter(f => f.status === 'D');
        if (deletedFiles.length > 0) {
          breakingIssues.push({
            level: 'HIGH',
            area: 'Deleted Files',
            items: deletedFiles.map(f => f.path),
            action: 'Verify nothing imports these files — grep codebase for their names',
          });
        }

        // 4. Type/interface changes
        const typeChanges = changedFiles.filter(f => /types\/|interfaces\//i.test(f.path));
        if (typeChanges.length > 0) {
          breakingIssues.push({
            level: 'HIGH',
            area: 'Type Definitions',
            items: typeChanges.map(f => f.path),
            action: 'Type changes may break callers silently — run tsc --noEmit to check',
          });
        }

        // 5. Navigation changes
        const navChanges = changedFiles.filter(f => /navigation\//i.test(f.path));
        if (navChanges.length > 0) {
          breakingIssues.push({
            level: 'HIGH',
            area: 'Navigation',
            items: navChanges.map(f => f.path),
            action: 'Test every navigation flow — removed routes cause runtime crashes',
          });
        }

        // 6. Service/API changes
        const serviceChanges = changedFiles.filter(f => /services?\//i.test(f.path));
        if (serviceChanges.length > 0) {
          breakingIssues.push({
            level: 'MEDIUM',
            area: 'Services / API Layer',
            items: serviceChanges.map(f => f.path),
            action: 'Verify all callers of changed service functions are updated',
          });
        }

        // 7. Store changes
        const storeChanges = changedFiles.filter(f => /store\/|redux\/|zustand\//i.test(f.path));
        if (storeChanges.length > 0) {
          breakingIssues.push({
            level: 'MEDIUM',
            area: 'Global State',
            items: storeChanges.map(f => f.path),
            action: 'State shape changes affect all components reading from the store',
          });
        }

        if (breakingIssues.length === 0) {
          out += `No breaking changes detected.\n`;
          out += `This branch appears safe to merge from a compatibility standpoint.\n`;
          return this.textResponse(out);
        }

        out += `Found ${breakingIssues.length} areas of concern:\n\n`;

        const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
        breakingIssues.sort((a, b) => order[a.level] - order[b.level]);

        for (const issue of breakingIssues) {
          out += `[${issue.level}] ${issue.area}\n`;
          out += `${'─'.repeat(40)}\n`;
          issue.items.forEach(item => out += `  - ${item}\n`);
          out += `  Action: ${issue.action}\n\n`;
        }

        const hasCritical = breakingIssues.some(i => i.level === 'CRITICAL');
        const hasHigh = breakingIssues.some(i => i.level === 'HIGH');

        out += `${'='.repeat(60)}\n`;
        if (hasCritical) {
          out += `VERDICT: DO NOT MERGE — resolve CRITICAL issues first.\n`;
        } else if (hasHigh) {
          out += `VERDICT: MERGE WITH CAUTION — review all HIGH items with the team.\n`;
        } else {
          out += `VERDICT: LOW RISK — MEDIUM items are advisory, safe to merge.\n`;
        }

        return this.textResponse(out);
      }

      default:
        return null;
    }
  }

  // ── Private: Git helpers ─────────────────────────────────────────────────

  async _currentBranch(repoPath) {
    try {
      const { stdout } = await execFileAsync('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { maxBuffer: 1024 * 1024 });
      return stdout.trim();
    } catch (e) {
      return 'HEAD';
    }
  }

  async _getChangedFiles(target, source, repoPath) {
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repoPath, 'diff', '--name-status', `${target}...${source}`,
      ], { maxBuffer: 5 * 1024 * 1024 });

      if (!stdout.trim()) return [];

      return stdout.trim().split('\n').filter(Boolean).map(line => {
        const parts = line.split('\t');
        return { status: parts[0].trim().charAt(0), path: parts[parts.length - 1].trim() };
      });
    } catch (e) {
      // If three-dot fails try two-dot
      try {
        const { stdout } = await execFileAsync('git', [
          '-C', repoPath, 'diff', '--name-status', `${target}..${source}`,
        ], { maxBuffer: 5 * 1024 * 1024 });
        if (!stdout.trim()) return [];
        return stdout.trim().split('\n').filter(Boolean).map(line => {
          const parts = line.split('\t');
          return { status: parts[0].trim().charAt(0), path: parts[parts.length - 1].trim() };
        });
      } catch (e2) {
        return [];
      }
    }
  }

  async _getBranchDiff(target, source, repoPath) {
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repoPath, 'diff', `${target}...${source}`,
      ], { maxBuffer: 10 * 1024 * 1024 });
      return stdout;
    } catch (e) {
      return '';
    }
  }

  async _getFileDiff(target, source, filePath, repoPath) {
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repoPath, 'diff', `${target}...${source}`, '--', filePath,
      ], { maxBuffer: 2 * 1024 * 1024 });
      return stdout;
    } catch (e) {
      return '';
    }
  }

  async _getBranchCommits(target, source, repoPath) {
    try {
      const { stdout } = await execFileAsync('git', [
        '-C', repoPath, 'log', `${target}..${source}`, '--format=%h|%s|%an',
      ], { maxBuffer: 2 * 1024 * 1024 });
      if (!stdout.trim()) return [];
      return stdout.trim().split('\n').filter(Boolean).map(line => {
        const [hash, message, author] = line.split('|');
        return { hash, message, author };
      });
    } catch (e) {
      return [];
    }
  }

  // ── Private: Issue detection ─────────────────────────────────────────────

  _detectIssuesInDiff(diff) {
    return this._detectIssuesInContent(diff, 'diff');
  }

  _detectIssuesInContent(content, filename) {
    if (!content) return [];
    const found = [];
    const seenIssues = new Set();

    for (const pattern of RN_ISSUE_PATTERNS) {
      if (pattern.fileFilter && !pattern.fileFilter.test(filename) && filename !== 'diff') continue;
      const regex = new RegExp(pattern.pattern.source, pattern.pattern.flags);
      if (regex.test(content)) {
        const key = pattern.issue;
        if (!seenIssues.has(key)) {
          seenIssues.add(key);
          found.push({ severity: pattern.severity, issue: pattern.issue, fix: pattern.fix });
        }
      }
    }

    return found.sort((a, b) => {
      const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
      return order[a.severity] - order[b.severity];
    });
  }

  // ── Private: Risk scoring ────────────────────────────────────────────────

  _fileRiskLevel(filePath) {
    for (const riskFactor of HIGH_RISK_PATHS) {
      if (riskFactor.pattern.test(filePath)) {
        return { level: riskFactor.level, reason: riskFactor.reason };
      }
    }
    return null;
  }

  _calculateRiskScore(changedFiles, issues) {
    let score = 0;
    const mustFix = [];
    const shouldFix = [];

    // File risk
    for (const file of changedFiles) {
      const risk = this._fileRiskLevel(file.path);
      if (risk?.level === 'CRITICAL') { score += 30; mustFix.push(`Native/critical file changed: ${file.path}`); }
      else if (risk?.level === 'HIGH') { score += 15; mustFix.push(`High-risk file changed: ${file.path}`); }
      else if (risk?.level === 'MEDIUM') { score += 5; shouldFix.push(`Review: ${file.path}`); }
    }

    // Issue risk
    for (const issue of issues) {
      if (issue.severity === 'CRITICAL') { score += 25; mustFix.push(issue.issue); }
      else if (issue.severity === 'HIGH') { score += 15; mustFix.push(issue.issue); }
      else if (issue.severity === 'MEDIUM') { score += 5; shouldFix.push(issue.issue); }
      else { score += 2; }
    }

    // File count risk
    if (changedFiles.length > 30) { score += 10; shouldFix.push(`Large PR: ${changedFiles.length} files changed — consider splitting`); }
    else if (changedFiles.length > 15) { score += 5; }

    const level = score >= 50 ? 'HIGH' : score >= 20 ? 'MEDIUM' : 'LOW';
    return { score: Math.min(score, 100), level, mustFix, shouldFix };
  }

  // ── Private: Dependency parsing ──────────────────────────────────────────

  _parseDependencyChanges(diff) {
    const added = [], removed = [], upgraded = [];
    const addedLines = diff.match(/^\+\s+"[^"]+": "[^"]+"/gm) || [];
    const removedLines = diff.match(/^-\s+"[^"]+": "[^"]+"/gm) || [];

    const parseEntry = (line) => {
      const match = line.match(/"([^"]+)":\s*"([^"]+)"/);
      return match ? { name: match[1], version: match[2] } : null;
    };

    const addedMap = new Map();
    const removedMap = new Map();

    for (const line of addedLines) {
      const entry = parseEntry(line);
      if (entry && !entry.name.startsWith('@types')) addedMap.set(entry.name, entry.version);
    }
    for (const line of removedLines) {
      const entry = parseEntry(line);
      if (entry && !entry.name.startsWith('@types')) removedMap.set(entry.name, entry.version);
    }

    for (const [name, newVer] of addedMap) {
      if (removedMap.has(name)) {
        const oldVer = removedMap.get(name);
        const oldMajor = parseInt((oldVer.match(/\d+/) || ['0'])[0]);
        const newMajor = parseInt((newVer.match(/\d+/) || ['0'])[0]);
        if (newMajor > oldMajor) upgraded.push(`${name}: ${oldVer} → ${newVer} (MAJOR BUMP)`);
        else upgraded.push(`${name}: ${oldVer} → ${newVer}`);
        removedMap.delete(name);
      } else {
        added.push(`${name}@${newVer}`);
      }
    }
    for (const [name, ver] of removedMap) removed.push(`${name}@${ver}`);

    return { added, removed, upgraded };
  }

  _detectMajorVersionBumps(diff) {
    const changes = this._parseDependencyChanges(diff);
    return changes.upgraded.filter(u => u.includes('MAJOR BUMP'));
  }

  getPrompt() {
    return this.loadPromptChunk('code_review.md') || `### Code Review
Use 'review_branch' when a developer wants to review their changes before raising a PR — compares against main by default.
Use 'compare_with_branch' for a merge readiness report: native changes, dependency changes, config changes, and risk level.
Use 'check_breaking_changes' to find what could break consumers when this branch merges.
Use 'detect_rn_issues' to scan for React Native specific bugs, performance issues, and anti-patterns.
Always run 'review_branch' or 'compare_with_branch' when the user says "review my code", "check my PR", "is it safe to merge", "review before PR".`;
  }
}

module.exports = CodeReviewSkill;
