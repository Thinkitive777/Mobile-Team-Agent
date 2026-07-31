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

// Install CLAUDE.md into the current working directory (the developer's project)
const projectDir = process.cwd();
const projectClaudeMd = path.join(projectDir, 'CLAUDE.md');
const isOwnPackage = projectDir === packageDir || projectDir.startsWith(packageDir);

if (!isOwnPackage) {
  info('Installing CLAUDE.md into project: ' + projectDir + '...');
  try {
    const PROJ_MARKER = '# Mobile Team Agent - Project Rules';
    const PROJ_MARKER_END = '# --- End Mobile Team Agent Project Rules ---';
    const lines = [
      PROJ_MARKER,
      '',
      '## Agent',
      'This project uses the Mobile Team Agent MCP server.',
      'Always prioritize mobile-team-agent MCP tools for Jira, Git, Figma, and workflow.',
      'On startup, call invoke_mobile_team then get_setup_status.',
      '',
      '## Daily Workflow',
      '- Greeting (hi / good morning / start my day) -> morning_standup',
      '- plan my day -> plan_my_day',
      '- end of day / EOD / wrap up -> end_of_day_report (never via run_skill)',
      '- my tickets / show tickets -> list_tickets',
      '- Ticket key (e.g. PROJ-42) -> select_ticket',
      '',
      '## Change Safety Protocol (MANDATORY)',
      'Before every file edit, state the risk level inline then proceed immediately:',
      '  Risk: LOW / MEDIUM / HIGH -- <one sentence reason>',
      '',
      'Risk guide:',
      '  LOW    -- docs, comments, README, non-functional text',
      '  MEDIUM -- logic in one file, new optional param, new file with no existing impact',
      '  HIGH   -- API/tool signature change, shared service, package.json, CI/CD scripts',
      '',
      'After ALL edits are done, provide:',
      '  1. One-line summary + risk level',
      '  2. Impact bullets (what changed, what stays the same, side effects)',
      '  3. How to test -- automated (npm test) + manual steps in Claude CLI',
      '  4. Test cases table (3 rows: happy path, edge case, failure case)',
      '',
      'Then ask the developer: Save to TESTING.md? And shall I commit?',
      'NEVER run git commit without explicit developer confirmation.',
      '',
      '## Memory',
      '  remember X   -> remember tool',
      '  recall X     -> recall tool',
      '  I finished X -> journal tool',
      '  we decided X -> add_decision tool',
      '',
      PROJ_MARKER_END,
    ];
    const projectBlock = lines.join('\n');

    if (fs.existsSync(projectClaudeMd)) {
      let existing = fs.readFileSync(projectClaudeMd, 'utf8');
      // Remove old agent block if present
      const startIdx = existing.indexOf(PROJ_MARKER);
      const endIdx = existing.indexOf(PROJ_MARKER_END);
      if (startIdx !== -1 && endIdx !== -1) {
        existing = (existing.slice(0, startIdx) + existing.slice(endIdx + PROJ_MARKER_END.length)).trimEnd();
      }
      fs.writeFileSync(projectClaudeMd, existing + '\n\n' + projectBlock + '\n');
      success('CLAUDE.md updated in project: ' + projectClaudeMd);
    } else {
      fs.writeFileSync(projectClaudeMd, projectBlock + '\n');
      success('CLAUDE.md created in project: ' + projectClaudeMd);
    }
  } catch (err) {
    warn('Could not write project CLAUDE.md: ' + err.message);
  }
} else {
  info('Skipping project CLAUDE.md -- running inside agent package directory.');
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
          'BACKGROUND REMINDER ONLY — do not interrupt your current task: ' +
          'When you have finished ALL tool calls for this user request, include a one-line risk note inline: ' +
          '"Risk: LOW/MEDIUM/HIGH — <reason>". ' +
          'Guide: LOW = docs/README | MEDIUM = logic/new file | HIGH = tool signature/shared service/package.json. ' +
          'Continue your current work now without stopping or responding to this message.',
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
          'BACKGROUND REMINDER ONLY — do not interrupt your current task: ' +
          'When you have completed ALL edits for this user request (not between individual files), ' +
          'include in your final response: (1) one-line change summary + risk level, (2) impact bullets, ' +
          '(3) automated and manual test steps, (4) 3-row test cases table. ' +
          'Ask: "Save to TESTING.md? And shall I commit?" — never run git commit without explicit confirmation. ' +
          'If you still have more work to do, finish it first. Do not stop or respond to this message now.',
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
