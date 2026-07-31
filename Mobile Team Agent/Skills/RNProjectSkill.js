/// MARK: - React Native Project Skill
/// Handles RN project scaffolding (CLI + Expo), architecture analysis,
/// and opinionated library recommendations for mobile teams.

const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const BaseSkill = require('./Core/BaseSkill');

const execFileAsync = promisify(execFile);

// ── RN Library recommendations per feature ────────────────────────────────

const RN_LIBRARY_MAP = {
  navigation: {
    cli: {
      package: '@react-navigation/native @react-navigation/native-stack @react-navigation/bottom-tabs react-native-screens react-native-safe-area-context',
      name: 'React Navigation v7',
      reason: 'Industry standard for CLI projects. Full control, no Expo dependency.',
      setup: `// App.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
const Stack = createNativeStackNavigator();
export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}`,
      note: 'Run: cd ios && pod install after installing',
    },
    expo: {
      package: 'expo-router',
      name: 'Expo Router v4',
      reason: 'File-based routing, works natively with Expo SDK. Best choice for Expo projects.',
      setup: `// app/_layout.tsx
import { Stack } from 'expo-router';
export default function RootLayout() {
  return <Stack />;
}
// app/index.tsx → maps to "/" route automatically`,
      note: 'Set main to "expo-router/entry" in package.json',
    },
  },
  state: {
    simple: {
      package: 'zustand',
      name: 'Zustand',
      reason: 'Minimal boilerplate, no providers needed, works great for most RN apps.',
      setup: `// store/authStore.ts
import { create } from 'zustand';
interface AuthStore {
  user: User | null;
  setUser: (user: User | null) => void;
}
export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  setUser: (user) => set({ user }),
}));`,
    },
    complex: {
      package: '@reduxjs/toolkit react-redux',
      name: 'Redux Toolkit',
      reason: 'Best for large teams with complex shared state, time-travel debugging, and strict data flow.',
      setup: `// store/index.ts
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
export const store = configureStore({ reducer: { auth: authReducer } });
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;`,
    },
  },
  networking: {
    package: 'axios @tanstack/react-query',
    name: 'Axios + TanStack Query',
    reason: 'Axios handles HTTP, TanStack Query handles caching, loading states, retries, and background refresh automatically.',
    setup: `// services/api.ts
import axios from 'axios';
export const api = axios.create({ baseURL: process.env.API_URL, timeout: 10000 });
api.interceptors.request.use((config) => {
  const token = useAuthStore.getState().token;
  if (token) config.headers.Authorization = \`Bearer \${token}\`;
  return config;
});

// hooks/useUser.ts
import { useQuery } from '@tanstack/react-query';
export const useUser = (id: string) =>
  useQuery({ queryKey: ['user', id], queryFn: () => api.get(\`/users/\${id}\`).then(r => r.data) });`,
  },
  storage: {
    performance: {
      package: 'react-native-mmkv',
      name: 'MMKV',
      reason: '30x faster than AsyncStorage. C++ based, synchronous reads. Best for frequent reads (auth tokens, preferences).',
      setup: `// storage/storage.ts
import { MMKV } from 'react-native-mmkv';
export const storage = new MMKV();
// usage: storage.set('token', value) / storage.getString('token')`,
      note: 'Requires pod install for iOS. Not available in Expo Go — use with custom dev client.',
    },
    simple: {
      package: '@react-native-async-storage/async-storage',
      name: 'AsyncStorage',
      reason: 'Works everywhere including Expo Go. Fine for non-frequent reads.',
      setup: `import AsyncStorage from '@react-native-async-storage/async-storage';
await AsyncStorage.setItem('key', JSON.stringify(value));
const data = JSON.parse(await AsyncStorage.getItem('key') ?? 'null');`,
    },
  },
  forms: {
    package: 'react-hook-form zod @hookform/resolvers',
    name: 'React Hook Form + Zod',
    reason: 'RHF minimizes re-renders. Zod gives you runtime type-safe validation with TypeScript inference.',
    setup: `// screens/LoginScreen.tsx
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
const schema = z.object({ email: z.string().email(), password: z.string().min(8) });
type FormData = z.infer<typeof schema>;
const { control, handleSubmit, formState: { errors } } = useForm<FormData>({
  resolver: zodResolver(schema),
});`,
  },
  testing: {
    package: 'jest @testing-library/react-native @testing-library/jest-native',
    name: 'Jest + React Native Testing Library',
    reason: 'RNTL tests behavior not implementation. Industry standard — avoids Enzyme which is unmaintained.',
    setup: `// jest.config.js
module.exports = {
  preset: 'react-native',
  setupFilesAfterFramework: ['@testing-library/jest-native/extend-expect'],
  transformIgnorePatterns: ['node_modules/(?!(react-native|@react-native|@react-navigation)/)'],
};`,
  },
  ui: {
    tailwind: {
      package: 'nativewind tailwindcss',
      name: 'NativeWind',
      reason: 'Tailwind CSS for React Native. Best for teams who know Tailwind web. Consistent design tokens.',
      setup: `// tailwind.config.js
module.exports = { content: ['./src/**/*.{js,jsx,ts,tsx}'], presets: [require('nativewind/preset')] };
// babel.config.js: add 'nativewind/babel' to plugins`,
    },
    components: {
      package: '@gluestack-ui/themed',
      name: 'Gluestack UI',
      reason: 'Accessible, unstyled, fully typed RN component library. Works with NativeWind.',
      setup: `import { GluestackUIProvider } from '@gluestack-ui/themed';
// Wrap your root with <GluestackUIProvider config={config}>`,
    },
  },
  auth: {
    package: '@supabase/supabase-js',
    name: 'Supabase Auth',
    reason: 'Full auth (email, OAuth, magic link) with built-in Row Level Security. Open source.',
    setup: `// services/supabase.ts
import { createClient } from '@supabase/supabase-js';
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
// login: await supabase.auth.signInWithPassword({ email, password })`,
  },
  analytics: {
    package: '@segment/analytics-react-native',
    name: 'Segment',
    reason: 'Routes events to any downstream tool (Mixpanel, Amplitude, BigQuery). Swap destination without code change.',
    setup: `// analytics/index.ts
import { createClient } from '@segment/analytics-react-native';
export const analytics = createClient({ writeKey: SEGMENT_KEY });
// usage: analytics.track('Button Pressed', { screen: 'Home' })`,
  },
  crash: {
    package: '@sentry/react-native',
    name: 'Sentry',
    reason: 'Industry standard crash reporting with source maps, release tracking, and performance monitoring.',
    setup: `// index.js
import * as Sentry from '@sentry/react-native';
Sentry.init({ dsn: SENTRY_DSN, tracesSampleRate: 0.2 });`,
  },
};

// ── Standard folder structure ──────────────────────────────────────────────

const FOLDER_STRUCTURE = [
  'src/screens',
  'src/components',
  'src/components/common',
  'src/hooks',
  'src/services',
  'src/store',
  'src/navigation',
  'src/utils',
  'src/types',
  'src/constants',
  'src/assets/images',
  'src/assets/fonts',
  '__tests__/screens',
  '__tests__/components',
  '__tests__/hooks',
  '__tests__/services',
  '__tests__/utils',
];

// ── Anti-patterns to detect ────────────────────────────────────────────────

const ARCH_ANTIPATTERNS = [
  {
    check: (files) => files.filter(f => f.match(/screens?\//i) && f.match(/api|fetch|axios/i)).length > 0,
    issue: 'API calls found directly in screen files',
    fix: 'Move to src/services/ and call via custom hooks',
    severity: 'HIGH',
  },
  {
    check: (files) => !files.some(f => f.includes('src/hooks')),
    issue: 'No hooks/ folder found',
    fix: 'Create src/hooks/ for reusable stateful logic — keeps screens thin',
    severity: 'MEDIUM',
  },
  {
    check: (files) => !files.some(f => f.includes('src/services')),
    issue: 'No services/ folder found',
    fix: 'Create src/services/ for API, storage, and external service integrations',
    severity: 'MEDIUM',
  },
  {
    check: (files) => !files.some(f => f.includes('src/types') || f.includes('src/types')),
    issue: 'No types/ folder found',
    fix: 'Create src/types/ for shared TypeScript interfaces and enums',
    severity: 'LOW',
  },
  {
    check: (files) => !files.some(f => f.match(/__tests__|\.test\.|\.spec\./)),
    issue: 'No test files found in the project',
    fix: 'Add __tests__/ folder and start with unit tests for services and hooks',
    severity: 'HIGH',
  },
  {
    check: (files) => !files.some(f => f.match(/tsconfig|\.ts$|\.tsx$/)),
    issue: 'No TypeScript found — project appears to be plain JavaScript',
    fix: 'Consider migrating to TypeScript for better type safety and IDE support',
    severity: 'MEDIUM',
  },
];

// ── Helper: walk directory recursively ────────────────────────────────────

function walkDir(dir, fileList = [], maxDepth = 5, currentDepth = 0) {
  if (currentDepth > maxDepth) return fileList;
  if (!fs.existsSync(dir)) return fileList;
  const IGNORE = new Set(['node_modules', '.git', 'build', 'dist', 'android', 'ios', '.expo', 'coverage']);
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (e) {
    return fileList;
  }
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkDir(full, fileList, maxDepth, currentDepth + 1);
    } else {
      fileList.push(full);
    }
  }
  return fileList;
}

class RNProjectSkill extends BaseSkill {
  constructor() {
    super();
    this.name = 'RNProjectSkill';
  }

  getTools() {
    return [
      {
        name: 'setup_rn_project',
        description: 'Scaffold a new React Native project (CLI or Expo) with the correct folder structure, TypeScript config, ESLint, Prettier, Jest, and an opinionated library stack based on the features you need.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Project name (e.g. MyApp)' },
            type: { type: 'string', enum: ['cli', 'expo'], description: 'cli = React Native CLI, expo = Expo (managed or bare)' },
            features: {
              type: 'array',
              items: { type: 'string', enum: ['navigation', 'state', 'networking', 'storage', 'forms', 'testing', 'ui', 'auth', 'analytics', 'crash'] },
              description: 'Features to install libraries for',
            },
            state_complexity: { type: 'string', enum: ['simple', 'complex'], description: 'simple = Zustand, complex = Redux Toolkit (default: simple)' },
            storage_priority: { type: 'string', enum: ['performance', 'simple'], description: 'performance = MMKV, simple = AsyncStorage (default: performance)' },
            output_path: { type: 'string', description: 'Where to create the project (default: current directory)' },
          },
          required: ['name', 'type'],
        },
      },
      {
        name: 'analyze_rn_architecture',
        description: 'Scan an existing React Native project and report what is correctly structured, what is missing, and what anti-patterns exist. Compares against RN best practices.',
        inputSchema: {
          type: 'object',
          properties: {
            project_path: { type: 'string', description: 'Absolute path to the RN project root (default: current repo path)' },
          },
        },
      },
      {
        name: 'recommend_libraries',
        description: 'Get an opinionated library recommendation for a specific React Native feature with install command, reasoning, and minimal setup code.',
        inputSchema: {
          type: 'object',
          properties: {
            feature: {
              type: 'string',
              enum: ['navigation', 'state', 'networking', 'storage', 'forms', 'testing', 'ui', 'auth', 'analytics', 'crash'],
              description: 'The feature you need a library for',
            },
            project_type: { type: 'string', enum: ['cli', 'expo'], description: 'CLI or Expo project (affects navigation recommendation)' },
            state_complexity: { type: 'string', enum: ['simple', 'complex'], description: 'For state feature: simple=Zustand, complex=Redux Toolkit' },
            storage_priority: { type: 'string', enum: ['performance', 'simple'], description: 'For storage feature: performance=MMKV, simple=AsyncStorage' },
            ui_style: { type: 'string', enum: ['tailwind', 'components'], description: 'For UI feature: tailwind=NativeWind, components=Gluestack' },
          },
          required: ['feature'],
        },
      },
    ];
  }

  async handleTool(name, args, context) {
    const { getRepoPath } = context;

    switch (name) {

      case 'setup_rn_project': {
        const { name: appName, type, features = [], output_path, state_complexity = 'simple', storage_priority = 'performance' } = args;

        if (!appName || !appName.match(/^[a-zA-Z][a-zA-Z0-9_]*$/)) {
          return this.errorResponse('Project name must start with a letter and contain only letters, numbers, or underscores (e.g. MyApp, orders_app).');
        }

        const basePath = output_path || getRepoPath();
        const projectPath = path.join(basePath, appName);

        let out = `React Native Project Setup Plan\n`;
        out += `${'='.repeat(60)}\n\n`;
        out += `Project: ${appName}\n`;
        out += `Type: ${type === 'expo' ? 'Expo (Managed Workflow)' : 'React Native CLI'}\n`;
        out += `Output: ${projectPath}\n`;
        out += `Features: ${features.length > 0 ? features.join(', ') : 'base only'}\n\n`;

        // Step 1: Init command
        out += `STEP 1 — Initialize Project\n`;
        out += `${'─'.repeat(40)}\n`;
        if (type === 'expo') {
          out += `npx create-expo-app@latest ${appName} --template blank-typescript\n`;
          out += `cd ${appName}\n\n`;
        } else {
          out += `npx @react-native-community/cli@latest init ${appName} --template react-native-template-typescript\n`;
          out += `cd ${appName}\n\n`;
        }

        // Step 2: Folder structure
        out += `STEP 2 — Create Folder Structure\n`;
        out += `${'─'.repeat(40)}\n`;
        const mkdirCmds = FOLDER_STRUCTURE.map(f => `mkdir -p ${f}`).join(' && ');
        out += `${mkdirCmds}\n\n`;

        // Step 3: Libraries
        const librariesToInstall = [];
        const setupNotes = [];
        const iosNotes = [];

        for (const feature of features) {
          const rec = this._getLibraryRec(feature, { type, state_complexity, storage_priority });
          if (!rec) continue;
          librariesToInstall.push(rec.package);
          if (rec.note) {
            if (rec.note.toLowerCase().includes('pod')) iosNotes.push(`${rec.name}: ${rec.note}`);
            else setupNotes.push(`${rec.name}: ${rec.note}`);
          }
        }

        if (librariesToInstall.length > 0) {
          out += `STEP 3 — Install Libraries\n`;
          out += `${'─'.repeat(40)}\n`;
          out += `npm install ${librariesToInstall.join(' ')}\n\n`;
        }

        if (type === 'cli' && iosNotes.length > 0) {
          out += `STEP 4 — iOS Pod Install (run after npm install)\n`;
          out += `${'─'.repeat(40)}\n`;
          out += `cd ios && pod install && cd ..\n\n`;
        }

        // Step 4: Config files
        out += `STEP ${type === 'cli' && iosNotes.length > 0 ? 5 : 4} — Config Files to Create\n`;
        out += `${'─'.repeat(40)}\n`;
        out += this._generateConfigFiles(type, features);

        // Step 5: Architecture rules
        out += `\nARCHITECTURE RULES (enforce in code review)\n`;
        out += `${'─'.repeat(40)}\n`;
        out += `- screens/     Only JSX + local state + hook calls. No API calls, no business logic.\n`;
        out += `- components/  Reusable, dumb UI. Props in, renders out. No store access.\n`;
        out += `- hooks/       All stateful logic. useXxx naming. One concern per hook.\n`;
        out += `- services/    All external I/O (API, storage, analytics). Pure async functions.\n`;
        out += `- store/       Global state only. No UI logic. Actions must be testable.\n`;
        out += `- types/       Shared TypeScript interfaces and enums only.\n`;
        out += `- constants/   App-wide strings, numbers, colors, routes. Never hardcode inline.\n`;

        if (setupNotes.length > 0) {
          out += `\nSETUP NOTES\n`;
          out += `${'─'.repeat(40)}\n`;
          for (const note of setupNotes) out += `- ${note}\n`;
        }

        out += `\nREADY. Run the commands above in order.\n`;
        out += `Tip: Use 'analyze_rn_architecture' after setup to verify the structure.\n`;

        return this.textResponse(out);
      }

      case 'analyze_rn_architecture': {
        const projectPath = args.project_path || getRepoPath();

        if (!fs.existsSync(projectPath)) {
          return this.errorResponse(`Path does not exist: ${projectPath}`);
        }

        const pkgPath = path.join(projectPath, 'package.json');
        if (!fs.existsSync(pkgPath)) {
          return this.errorResponse(`No package.json found at ${projectPath}. Is this a React Native project root?`);
        }

        let pkg = {};
        try {
          pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        } catch (e) {
          return this.errorResponse(`Could not read package.json: ${e.message}`);
        }

        const allFiles = walkDir(projectPath);
        const relativeFiles = allFiles.map(f => path.relative(projectPath, f));

        // Detect project type
        const isExpo = !!(pkg.dependencies?.expo || pkg.devDependencies?.expo);
        const isTypeScript = relativeFiles.some(f => f.match(/\.tsx?$/));
        const hasNavigation = !!(pkg.dependencies?.['@react-navigation/native'] || pkg.dependencies?.['expo-router']);
        const hasState = !!(pkg.dependencies?.zustand || pkg.dependencies?.['@reduxjs/toolkit']);
        const hasNetworking = !!(pkg.dependencies?.axios || pkg.dependencies?.['@tanstack/react-query']);
        const hasTesting = !!(pkg.devDependencies?.['@testing-library/react-native'] || pkg.devDependencies?.jest);

        // Check expected folders
        const expectedFolders = ['src/screens', 'src/components', 'src/hooks', 'src/services', 'src/types'];
        const foundFolders = expectedFolders.filter(folder =>
          relativeFiles.some(f => f.startsWith(folder))
        );
        const missingFolders = expectedFolders.filter(f => !foundFolders.includes(f));

        // Run antipattern checks
        const issues = ARCH_ANTIPATTERNS
          .filter(p => p.check(relativeFiles))
          .sort((a, b) => {
            const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
            return order[a.severity] - order[b.severity];
          });

        let out = `React Native Architecture Analysis\n`;
        out += `${'='.repeat(60)}\n\n`;
        out += `Project: ${path.basename(projectPath)}\n`;
        out += `Type: ${isExpo ? 'Expo' : 'React Native CLI'}\n`;
        out += `TypeScript: ${isTypeScript ? 'Yes' : 'No (consider migrating)'}\n`;
        out += `Version: ${pkg.version || 'unknown'} | RN: ${pkg.dependencies?.['react-native'] || 'unknown'}\n\n`;

        // Installed libraries
        out += `INSTALLED LIBRARIES\n`;
        out += `${'─'.repeat(40)}\n`;
        out += `Navigation:  ${hasNavigation ? (pkg.dependencies?.['expo-router'] ? 'Expo Router' : 'React Navigation') : 'NOT INSTALLED'}\n`;
        out += `State:       ${hasState ? (pkg.dependencies?.zustand ? 'Zustand' : 'Redux Toolkit') : 'NOT INSTALLED'}\n`;
        out += `Networking:  ${hasNetworking ? 'Axios / TanStack Query' : 'NOT INSTALLED'}\n`;
        out += `Testing:     ${hasTesting ? 'React Native Testing Library' : 'NOT INSTALLED'}\n`;
        out += `Forms:       ${pkg.dependencies?.['react-hook-form'] ? 'React Hook Form' : 'NOT INSTALLED'}\n`;
        out += `Storage:     ${pkg.dependencies?.['react-native-mmkv'] ? 'MMKV' : (pkg.dependencies?.['@react-native-async-storage/async-storage'] ? 'AsyncStorage' : 'NOT INSTALLED')}\n\n`;

        // Folder structure
        out += `FOLDER STRUCTURE\n`;
        out += `${'─'.repeat(40)}\n`;
        for (const folder of expectedFolders) {
          const exists = foundFolders.includes(folder);
          out += `${exists ? '[OK]' : '[MISSING]'} ${folder}/\n`;
        }
        out += `\n`;

        // Issues
        if (issues.length === 0) {
          out += `ISSUES: None found. Architecture looks solid.\n\n`;
        } else {
          out += `ISSUES (${issues.length})\n`;
          out += `${'─'.repeat(40)}\n`;
          for (const issue of issues) {
            out += `[${issue.severity}] ${issue.issue}\n`;
            out += `       Fix: ${issue.fix}\n\n`;
          }
        }

        // Missing library recommendations
        const missing = [];
        if (!hasNavigation) missing.push('navigation');
        if (!hasState) missing.push('state');
        if (!hasNetworking) missing.push('networking');
        if (!hasTesting) missing.push('testing');
        if (!pkg.dependencies?.['react-hook-form']) missing.push('forms');

        if (missing.length > 0) {
          out += `MISSING LIBRARIES\n`;
          out += `${'─'.repeat(40)}\n`;
          out += `Run 'recommend_libraries' for: ${missing.join(', ')}\n\n`;
        }

        const score = Math.max(0, 100 - (missingFolders.length * 10) - (issues.filter(i => i.severity === 'HIGH').length * 20) - (issues.filter(i => i.severity === 'MEDIUM').length * 10));
        out += `ARCHITECTURE SCORE: ${score}/100\n`;
        if (score >= 80) out += `Status: Good shape. Address the issues above to improve further.\n`;
        else if (score >= 50) out += `Status: Needs work. Focus on HIGH severity issues first.\n`;
        else out += `Status: Significant structural issues. Refactoring recommended before scaling the team.\n`;

        return this.textResponse(out);
      }

      case 'recommend_libraries': {
        const { feature, project_type = 'cli', state_complexity = 'simple', storage_priority = 'performance', ui_style = 'tailwind' } = args;

        const rec = this._getLibraryRec(feature, { type: project_type, state_complexity, storage_priority, ui_style });

        if (!rec) {
          return this.errorResponse(`No recommendation found for feature "${feature}". Valid options: ${Object.keys(RN_LIBRARY_MAP).join(', ')}`);
        }

        let out = `Library Recommendation: ${feature.toUpperCase()}\n`;
        out += `${'='.repeat(60)}\n\n`;
        out += `Recommended: ${rec.name}\n`;
        out += `Package:     ${rec.package}\n\n`;
        out += `Why: ${rec.reason}\n\n`;
        out += `Install:\n`;
        out += `  npm install ${rec.package}\n`;
        if (project_type === 'cli' && rec.note?.toLowerCase().includes('pod')) {
          out += `  cd ios && pod install && cd ..\n`;
        }
        out += `\nMinimal Setup:\n`;
        out += `${'─'.repeat(40)}\n`;
        out += (rec.setup || 'See library documentation for setup.') + '\n';

        if (rec.note) {
          out += `\nNote: ${rec.note}\n`;
        }

        return this.textResponse(out);
      }

      default:
        return null;
    }
  }

  // ── Private helpers ──────────────────────────────────────────────────────

  _getLibraryRec(feature, opts = {}) {
    const map = RN_LIBRARY_MAP;
    switch (feature) {
      case 'navigation': return opts.type === 'expo' ? map.navigation.expo : map.navigation.cli;
      case 'state': return opts.state_complexity === 'complex' ? map.state.complex : map.state.simple;
      case 'networking': return map.networking;
      case 'storage': return opts.storage_priority === 'simple' ? map.storage.simple : map.storage.performance;
      case 'forms': return map.forms;
      case 'testing': return map.testing;
      case 'ui': return opts.ui_style === 'components' ? map.ui.components : map.ui.tailwind;
      case 'auth': return map.auth;
      case 'analytics': return map.analytics;
      case 'crash': return map.crash;
      default: return null;
    }
  }

  _generateConfigFiles(type, features) {
    let out = '';

    // tsconfig
    out += `tsconfig.json:\n`;
    out += `  { "extends": "${type === 'expo' ? 'expo/tsconfig.base' : '@react-native/typescript-config/tsconfig.json'}" }\n\n`;

    // eslint
    out += `.eslintrc.js:\n`;
    out += `  module.exports = { root: true, extends: ['@react-native'], rules: {\n`;
    out += `    'no-console': 'warn', 'react-hooks/exhaustive-deps': 'error' } };\n\n`;

    // prettier
    out += `.prettierrc.js:\n`;
    out += `  module.exports = { semi: true, singleQuote: true, trailingComma: 'all', printWidth: 100 };\n\n`;

    // jest
    if (features.includes('testing')) {
      out += `jest.config.js:\n`;
      out += `  module.exports = { preset: '${type === 'expo' ? 'jest-expo' : 'react-native'}',\n`;
      out += `    setupFilesAfterFramework: ['@testing-library/jest-native/extend-expect'],\n`;
      out += `    transformIgnorePatterns: ['node_modules/(?!(react-native|@react-native|@react-navigation|expo)/)'] };\n\n`;
    }

    // babel
    out += `babel.config.js:\n`;
    out += `  module.exports = { presets: ['${type === 'expo' ? 'babel-preset-expo' : 'module:@react-native/babel-preset'}']`;
    if (features.includes('ui')) out += `,\n    plugins: ['nativewind/babel']`;
    out += ` };\n`;

    return out;
  }

  getPrompt() {
    return this.loadPromptChunk('rn_project.md') || `### React Native Project Setup
Use 'setup_rn_project' when starting a new RN project (CLI or Expo) — it generates the full setup plan with correct libraries and folder structure.
Use 'analyze_rn_architecture' to audit an existing project's structure and detect anti-patterns.
Use 'recommend_libraries' when a developer asks what library to use for navigation, state, networking, storage, forms, testing, UI, auth, analytics, or crash reporting.`;
  }
}

module.exports = RNProjectSkill;
