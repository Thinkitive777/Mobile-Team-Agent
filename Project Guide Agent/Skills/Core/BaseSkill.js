/// MARK: - Base Skill
/// Abstract base class for all skills. Provides shared response helpers,
/// tool registration interface, prompt loading, and the handleTool contract.

const fs = require("fs");
const path = require("path");

class BaseSkill {
  constructor() {
    this.name = 'BaseSkill';
  }

  /**
   * Returns an array of tool objects that this skill provides.
   * Format matches MCP ListToolsRequestSchema.
   */
  getTools() {
    return [];
  }

  /**
   * Checks if this skill handles the given tool name.
   */
  hasTool(name) {
    return this.getTools().some(tool => tool.name === name);
  }

  /**
   * Build a successful text response in MCP content format.
   */
  textResponse(msg) {
    return { content: [{ type: "text", text: msg }] };
  }

  /**
   * Build an error response in MCP content format.
   */
  errorResponse(msg) {
    return { content: [{ type: "text", text: msg }], isError: true };
  }

  /**
   * Handles the execution of a tool. Must be overridden by subclasses.
   * @param {string} name - Name of the tool to execute.
   * @param {object} args - Arguments passed to the tool.
   * @param {object} context - Shared context (e.g., config, preferences, helpers).
   * @returns {Promise<object>} Content response format.
   */
  async handleTool(name, args, context) {
    throw new Error(`Tool ${name} not implemented in ${this.name}`);
  }

  /**
   * Returns the system prompt chunk for this specific skill.
   */
  getPrompt() {
    return '';
  }

  /**
   * Loads a prompt chunk from `Project Guide Agent/Skills/prompts/`.
   * Each skill should reference the appropriate file (e.g. `jira_read.md`).
   */
  loadPromptChunk(filename) {
    try {
      const promptPath = path.join(__dirname, "..", "prompts", filename);
      if (!fs.existsSync(promptPath)) return "";
      return fs.readFileSync(promptPath, "utf-8").trim();
    } catch (err) {
      return "";
    }
  }
}

module.exports = BaseSkill;
