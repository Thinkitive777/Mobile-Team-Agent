/// MARK: - MCP Server Entry Point
/// Bootstraps the MCP server, registers all skills, and routes tool/prompt requests.

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
require("dotenv").config();

// Internal modules
const CONST = require("../Constants/constants");
const Logger = require("../Utils/logger");
const {
  config, preferences, saveConfig, savePreferences,
  getJiraClient, getFigmaClient, getRepoPath, maskToken, isTokenMasked,
} = require("../Services/config-manager");

// Response helper used by the top-level error handler
function errorResponse(msg) {
  return { content: [{ type: "text", text: msg }], isError: true };
}

// ── MCP Server ──────────────────────────────────────────────────────────

const server = new Server(
  { name: "projectguide-agent", version: CONST.VERSION },
  { capabilities: { tools: {}, prompts: {} } }
);

// ── Skills Setup ────────────────────────────────────────────────────────

const SkillRegistry = require("./SkillRegistry");
const SetupSkill = require("../Skills/SetupSkill");
const JiraReadSkill = require("../Skills/JiraReadSkill");
const JiraWriteSkill = require("../Skills/JiraWriteSkill");
const WorkflowSkill = require("../Skills/WorkflowSkill");
const GitSkill = require("../Skills/GitSkill");
const FigmaSkill = require("../Skills/FigmaSkill");
const MemorySkill = require("../Skills/MemorySkill");
const LegacySkill = require("../Skills/LegacySkill");

const registry = new SkillRegistry();
registry.register(new SetupSkill());
registry.register(new JiraReadSkill());
registry.register(new JiraWriteSkill());
registry.register(new WorkflowSkill());
registry.register(new GitSkill());
registry.register(new FigmaSkill());
registry.register(new MemorySkill());
registry.register(new LegacySkill());

// ── Tool definitions ────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: registry.getAllTools()
}));

// ── Prompts (exposes skill guidance to Claude via MCP prompts protocol) ──

server.setRequestHandler(ListPromptsRequestSchema, async () => ({
  prompts: [
    {
      name: "projectguide-agent-instructions",
      description: "Full agent instructions: intent routing, ticket listing, Jira query rules, missing-info handling, and tool selection guide.",
    },
  ],
}));

server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  const promptText = registry.getCombinedPrompt();
  return {
    description: "Project Guide Agent — combined skill prompts",
    messages: [
      {
        role: "user",
        content: { type: "text", text: promptText },
      },
    ],
  };
});

// ── Tool handlers ───────────────────────────────────────────────────────

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;
  Logger.info("Tool called", { tool: name });

  const context = {
    config,
    preferences,
    saveConfig,
    savePreferences,
    getJiraClient,
    getFigmaClient,
    getRepoPath,
    maskToken,
    isTokenMasked,
  };

  try {
    const result = await registry.handleTool(name, args, context);
    if (result) return result;
    return errorResponse(`Tool execution returned null for ${name}`);
  } catch (error) {
    Logger.error("Tool execution failed", { tool: name, error: error.message, code: error.code });

    let message = error.message;
    let hint = '';

    switch (error.code) {
      case 'CONFIG_ERROR':
        hint = "\n\nAction required: call 'configure_service' with service=\"jira\", your Jira URL, email, and API token to reconfigure.";
        break;
      case 'JIRA_AUTH_ERROR':
        hint = "\n\nYour Jira credentials appear to be expired or incorrect.\nAction required: call 'configure_service' to update your API token.";
        config.jira.connected = false;
        break;
      case 'JIRA_NETWORK_ERROR':
        hint = "\n\nCould not reach Jira. Check your internet connection and try again, or call 'health_check' to diagnose.";
        break;
      case 'JIRA_RATE_LIMIT':
        hint = "\n\nJira API rate limit exceeded. Wait a moment and retry.";
        break;
      case 'JIRA_CONNECTION_ERROR':
        hint = "\n\nJira connection failed. Call 'health_check' to diagnose, or 'configure_service' to reconfigure.";
        break;
      case 'FIGMA_AUTH_ERROR':
        hint = "\n\nYour Figma personal access token is invalid or expired.\nGenerate a new one at https://www.figma.com/developers/api#access-tokens and run 'configure_figma'.";
        if (config.figma) config.figma.connected = false;
        break;
      case 'FIGMA_NETWORK_ERROR':
        hint = "\n\nCould not reach Figma. Check your internet connection and try again.";
        break;
      case 'FIGMA_RATE_LIMIT':
        hint = "\n\nFigma API rate limit exceeded. Wait a moment and retry.";
        break;
      case 'FIGMA_NOT_FOUND':
        hint = "\n\nThe Figma file was not found, or your token cannot access it. Verify the file URL and that the token's account has access.";
        break;
      case 'FIGMA_CONNECTION_ERROR':
        hint = "\n\nFigma request failed. Run 'figma_connection_test' to diagnose, or 'configure_figma' to reset the token.";
        break;
    }

    const prefix = error.code ? `[${error.code}] ` : '';
    return errorResponse(`${prefix}${message}${hint}`);
  }
});

// ── Start ───────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.info("Server started", { version: CONST.VERSION });
}

main().catch((error) => {
  Logger.error("Fatal error", { error: error.message });
  process.exit(1);
});
