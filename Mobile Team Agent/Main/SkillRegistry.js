/// MARK: - Skill Registry
/// Central registry that collects all skill instances, aggregates their tools,
/// routes tool calls to the correct skill, and merges prompt chunks.

const Logger = require("../Utils/logger");
const fs = require("fs");
const path = require("path");
const https = require("https");

// ── Usage Tracker ────────────────────────────────────────────────────────
// Fire-and-forget webhook to Google Chat. Never blocks tool execution.
// Webhook URL is read from config at call time so it works after install.

function _trackUsage(toolName, userName) {
  try {
    const CONST = require("../Constants/constants");
    let webhookUrl = process.env.GCHAT_WEBHOOK_URL;

    if (!webhookUrl) {
      try {
        const configPath = path.join(CONST.CONFIG_DIR, "config.json");
        if (fs.existsSync(configPath)) {
          const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
          webhookUrl = cfg.tracking && cfg.tracking.webhook_url;
        }
      } catch (_) { /* best-effort */ }
    }

    if (!webhookUrl) return; // tracking not configured — skip silently

    const now = new Date();
    const timestamp = now.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
    const user = userName || "Unknown";

    const payload = JSON.stringify({
      text: `*[Agent Usage]* \`${toolName}\` used by *${user}* at ${timestamp}`,
    });

    const urlObj = new URL(webhookUrl);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };

    const req = https.request(options);
    req.on("error", () => { /* swallow — never surface to user */ });
    req.write(payload);
    req.end();
  } catch (_) { /* never throw from tracker */ }
}

class SkillRegistry {
  constructor() {
    this.skills = [];
  }

  /**
   * Registers a new skill instance.
   * @param {BaseSkill} skill 
   */
  register(skill) {
    this.skills.push(skill);
    Logger.info(`Registered skill: ${skill.name}`);
  }

  /**
   * Gets all tools from all registered skills.
   * @returns {Array} Array of tool objects for MCP.
   */
  getAllTools() {
    return this.skills.flatMap(skill => skill.getTools());
  }

  /**
   * Finds the skill that handles the requested tool and executes it.
   * @param {string} name - Tool name.
   * @param {object} args - Tool arguments.
   * @param {object} context - Shared execution context.
   * @returns {Promise<object>} Response object.
   */
  async handleTool(name, args, context) {
    // Fire-and-forget usage tracking — runs silently, never delays the response
    const userName = (context && context.preferences && context.preferences.display_name)
      || (context && context.preferences && context.preferences.greeting_name)
      || (context && context.config && context.config.jira && context.config.jira.email)
      || "Unknown";
    _trackUsage(name, userName);

    for (const skill of this.skills) {
      if (skill.hasTool(name)) {
        Logger.info(`Routing tool ${name} to ${skill.name}`);
        return await skill.handleTool(name, args, context);
      }
    }
    
    // If no skill found, throw error
    Logger.error(`Unknown tool called: ${name}`);
    return { content: [{ type: "text", text: `Error: Unknown tool ${name}` }], isError: true };
  }

  /**
   * Concatenates the prompt chunks from all registered skills.
   * (Useful for building dynamic system instructions).
   */
  getCombinedPrompt() {
    const corePath = path.join(__dirname, "..", "Skills", "prompts", "core.md");
    const corePrompt = fs.existsSync(corePath) ? fs.readFileSync(corePath, "utf-8").trim() : "";

    return [corePrompt, ...this.skills.map(s => s.getPrompt()).filter(p => p)]
      .filter(Boolean)
      .join("\n\n---\n\n");
  }
}

module.exports = SkillRegistry;
