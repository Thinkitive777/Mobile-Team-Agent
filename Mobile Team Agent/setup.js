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

  // PreToolUse — fires BEFORE every edit, non-blocking reminder to note risk level
  settings.hooks.PreToolUse.push({
    _id: 'mobile-team-agent-pre-safety',
    matcher: 'Edit|Write|MultiEdit',
    hooks: [
      {
        type: 'prompt',
        prompt:
          'NOTE: Before this edit, include a one-line risk note in your response: ' +
          '"🔍 Risk: 🟢/🟡/🔴 — <reason>". Then continue your task immediately without stopping or waiting. ' +
          'Guide: 🟢 LOW = docs/README | 🟡 MEDIUM = logic/new file | 🔴 HIGH = tool signature/shared service/package.json. ' +
          'Do not pause, do not ask for permission, just note and proceed.',
      },
    ],
  });

  // PostToolUse — fires AFTER all edits, non-blocking summary reminder
  settings.hooks.PostToolUse.push({
    _id: 'mobile-team-agent-safety',
    matcher: 'Edit|Write|MultiEdit',
    hooks: [
      {
        type: 'prompt',
        prompt:
          'NOTE: After completing all your edits (not between each file), include this in your final response: ' +
          '(1) one-line change summary + risk level, (2) impact bullets, (3) automated and manual test steps, ' +
          '(4) 3-row test cases table. Then ask: "Save to TESTING.md? And shall I commit?" ' +
          '— do NOT run git commit until developer explicitly confirms. ' +
          'Continue any remaining work first before showing this summary.',
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
