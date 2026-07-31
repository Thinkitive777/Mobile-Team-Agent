#!/usr/bin/env node
/// MARK: - Mobile Team Agent Setup
/// Registers the MCP server with Claude CLI globally.
/// Run via: npx mobile-team-agent setup

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CYAN  = '\x1b[36m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED   = '\x1b[31m';
const NC    = '\x1b[0m';

const info    = (m) => console.log(`${CYAN}[INFO]${NC}  ${m}`);
const success = (m) => console.log(`${GREEN}[OK]${NC}    ${m}`);
const warn    = (m) => console.log(`${YELLOW}[WARN]${NC}  ${m}`);
const fail    = (m) => console.log(`${RED}[FAIL]${NC}  ${m}`);

console.log('');
console.log(`${CYAN}============================================${NC}`);
console.log(`${CYAN}  Mobile Team Agent — Setup${NC}`);
console.log(`${CYAN}============================================${NC}`);
console.log('');

// Find where this package is installed globally
const packageDir = path.resolve(__dirname);
const entryPoint = path.join(packageDir, 'Main', 'index.js');

if (!fs.existsSync(entryPoint)) {
  fail(`Could not find Main/index.js at: ${entryPoint}`);
  process.exit(1);
}
info(`Package found at: ${packageDir}`);
info(`Entry point: ${entryPoint}`);

// Check Claude CLI
let claudeOk = false;
try {
  execSync('claude --version', { stdio: 'pipe' });
  claudeOk = true;
} catch (_) {}

if (!claudeOk) {
  fail('Claude CLI not found. Install it first:');
  console.log('    npm install -g @anthropic-ai/claude-code');
  process.exit(1);
}
success('Claude CLI found');

// Remove old registrations (projectguide-agent + any prior mobile-team-agent)
const removeOld = (name) => {
  for (const scope of ['-s user', '-s project', '']) {
    try {
      execSync(`claude mcp remove ${name} ${scope}`.trim(), { stdio: 'pipe' });
    } catch (_) {}
  }
};
info('Removing old MCP registrations...');
removeOld('projectguide-agent');
removeOld('mobile-team-agent');

// Register mobile-team-agent at user scope (global — all directories)
info('Registering mobile-team-agent with Claude CLI (user scope)...');
const result = spawnSync(
  'claude',
  ['mcp', 'add', 'mobile-team-agent', '-s', 'user', '--', 'node', entryPoint],
  { stdio: 'pipe', encoding: 'utf8' }
);

let registered = false;

if (result.status === 0) {
  registered = true;
  success('MCP server registered globally (user scope)');
} else {
  warn(`claude mcp add failed: ${(result.stderr || '').trim()}`);
  warn('Attempting direct config write to ~/.claude.json...');

  const claudeJson = path.join(os.homedir(), '.claude.json');
  try {
    let config = {};
    if (fs.existsSync(claudeJson)) {
      config = JSON.parse(fs.readFileSync(claudeJson, 'utf8'));
    }
    if (!config.mcpServers) config.mcpServers = {};

    // Remove old entries
    delete config.mcpServers['projectguide-agent'];

    config.mcpServers['mobile-team-agent'] = {
      type: 'stdio',
      command: 'node',
      args: [entryPoint],
      env: {},
    };
    fs.writeFileSync(claudeJson, JSON.stringify(config, null, 2));
    registered = true;
    success(`MCP config written to ${claudeJson}`);
  } catch (err) {
    fail(`Could not write to ~/.claude.json: ${err.message}`);
  }
}

if (!registered) {
  fail('Automatic registration failed. Run this manually:');
  console.log(`    claude mcp add mobile-team-agent -s user -- node "${entryPoint}"`);
  process.exit(1);
}

// Install CLAUDE.md to ~/.claude/CLAUDE.md
const claudeMdSource = path.join(packageDir, 'CLAUDE.md');
const globalClaudeDir = path.join(os.homedir(), '.claude');
const globalClaudeMd = path.join(globalClaudeDir, 'CLAUDE.md');
const MARKER = '# --- Mobile Team Agent Instructions ---';
const MARKER_END = '# --- End Mobile Team Agent Instructions ---';

if (fs.existsSync(claudeMdSource)) {
  info('Installing agent instructions to ~/.claude/CLAUDE.md...');
  try {
    fs.mkdirSync(globalClaudeDir, { recursive: true });
    const agentInstructions = fs.readFileSync(claudeMdSource, 'utf8');
    const block = `\n${MARKER}\n${agentInstructions}\n${MARKER_END}\n`;

    if (fs.existsSync(globalClaudeMd)) {
      let existing = fs.readFileSync(globalClaudeMd, 'utf8');
      // Remove old block if present
      existing = existing.replace(
        new RegExp(`\\n?${MARKER}[\\s\\S]*?${MARKER_END}\\n?`, 'g'),
        ''
      );
      fs.writeFileSync(globalClaudeMd, existing + block);
    } else {
      fs.writeFileSync(globalClaudeMd, block);
    }
    success(`Agent instructions installed at ${globalClaudeMd}`);
  } catch (err) {
    warn(`Could not install CLAUDE.md: ${err.message}`);
  }
}

// Install Change Safety Protocol hook into ~/.claude/settings.json
info('Installing Change Safety Protocol hook to ~/.claude/settings.json...');
const globalSettingsPath = path.join(globalClaudeDir, 'settings.json');
try {
  fs.mkdirSync(globalClaudeDir, { recursive: true });

  let settings = {};
  if (fs.existsSync(globalSettingsPath)) {
    try {
      settings = JSON.parse(fs.readFileSync(globalSettingsPath, 'utf8'));
    } catch (_) {
      warn('Could not parse existing settings.json — will merge carefully');
    }
  }

  if (!settings.hooks) settings.hooks = {};
  if (!settings.hooks.PreToolUse) settings.hooks.PreToolUse = [];
  if (!settings.hooks.PostToolUse) settings.hooks.PostToolUse = [];

  // Remove any existing mobile-team-agent hook entries to avoid duplicates
  settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(
    (h) => h._id !== 'mobile-team-agent-pre-safety'
  );
  settings.hooks.PostToolUse = settings.hooks.PostToolUse.filter(
    (h) => h._id !== 'mobile-team-agent-safety'
  );

  // PreToolUse — fires BEFORE every edit, enforces risk assessment upfront
  settings.hooks.PreToolUse.push({
    _id: 'mobile-team-agent-pre-safety',
    matcher: 'Edit|Write|MultiEdit',
    hooks: [
      {
        type: 'prompt',
        prompt:
          'You are about to edit or create a file. You MUST perform a Risk Assessment BEFORE proceeding.\n\n' +
          'State the following inline RIGHT NOW before making any changes:\n\n' +
          '🔍 Risk Assessment: 🟢 LOW / 🟡 MEDIUM / 🔴 HIGH\n' +
          'Reason: <why this risk level — what specifically is being changed>\n' +
          'Affected: <file(s) and which tools/features they impact>\n' +
          'Dependencies: <other files/services that may be affected>\n' +
          'Breaking: <yes/no — are any existing tool names, required params, or APIs being changed>\n\n' +
          'Risk level guide:\n' +
          '🟢 LOW    — Docs, comments, README, non-functional text\n' +
          '🟡 MEDIUM — Logic change in one tool/skill, new optional param, new file with no existing impact\n' +
          '🔴 HIGH   — MCP tool signature change, shared service (jira-client/config-manager/memory-manager), index.js, SkillRegistry.js, package.json deps, install/setup scripts\n\n' +
          'Do NOT proceed with the edit until the risk assessment is shown.',
      },
    ],
  });

  // PostToolUse — fires AFTER every edit, enforces impact summary + commit gate
  settings.hooks.PostToolUse.push({
    _id: 'mobile-team-agent-safety',
    matcher: 'Edit|Write|MultiEdit',
    hooks: [
      {
        type: 'prompt',
        prompt:
          'A file was just edited or created. You MUST now provide the full Impact Summary:\n\n' +
          '## 📋 Change Summary\n' +
          '**What changed:** <one-line description>\n' +
          '**Files modified:** <list>\n' +
          '**Risk level:** 🟢/🟡/🔴\n\n' +
          '### Impact\n' +
          '- What behaviour changed and why\n' +
          '- What stays the same\n' +
          '- Side effects on other tools or files\n\n' +
          '### How to Test\n' +
          '#### Automated\n' +
          '- [ ] npm run validate\n' +
          '- [ ] npm test\n' +
          '- [ ] <specific command for changed area>\n\n' +
          '#### Manual (in Claude CLI)\n' +
          '- [ ] <exact phrase to trigger the changed tool>\n' +
          '- [ ] <what to verify in the response>\n' +
          '- [ ] <edge case to check>\n\n' +
          '### Test Cases\n' +
          '| # | Input | Expected Output | Pass? |\n' +
          '|---|-------|----------------|-------|\n' +
          '| 1 | <happy path> | <expected> | ☐ |\n' +
          '| 2 | <edge case> | <expected> | ☐ |\n' +
          '| 3 | <failure case> | <error/fallback> | ☐ |\n\n' +
          'Then ask: "Would you like me to save this summary to README / TESTING.md, or keep it here? And shall I commit these changes?"\n\n' +
          'NEVER commit without explicit developer confirmation.',
      },
    ],
  });

  fs.writeFileSync(globalSettingsPath, JSON.stringify(settings, null, 2));
  success(`Change Safety Protocol hook installed at ${globalSettingsPath}`);
} catch (err) {
  warn(`Could not install settings.json hook: ${err.message}`);
  warn('You can add it manually — see CLAUDE.md Change Safety Protocol section.');
}

console.log('');
console.log(`${GREEN}============================================${NC}`);
console.log(`${GREEN}  Setup Complete!${NC}`);
console.log(`${GREEN}============================================${NC}`);
console.log('');
console.log('  How to use:');
console.log('    1. Open any terminal directory');
console.log('    2. Run: claude');
console.log('    3. Say: "invoke mobile-team-agent"');
console.log('    4. Or say: "Good morning" for daily standup');
console.log('');
console.log('  First-time:');
console.log('    - "configure jira" — connect your Jira instance');
console.log('    - "configure figma" — connect Figma (optional)');
console.log('');
