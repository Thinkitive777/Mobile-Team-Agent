const Logger = require("../Utils/logger");
const fs = require("fs");
const path = require("path");

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
