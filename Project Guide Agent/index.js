const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require("@modelcontextprotocol/sdk/types.js");
const { z } = require("zod");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CONFIG_DIR = path.join(os.homedir(), ".projectguide-agent");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

// Ensure config directory exists
if (!fs.existsSync(CONFIG_DIR)) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

// Load or initialize config
let config = {
  jira: { connected: false, url: null, token: null },
  figma: { connected: false, token: null },
  github: { connected: false, token: null, user: null },
  developer_mode: false,
};

if (fs.existsSync(CONFIG_FILE)) {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch (e) {
    console.error("Error loading config:", e);
  }
}

function saveConfig() {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Mock Ticket Data with Descriptions
const MOCK_TICKETS = [
  { id: "PROJ-1", title: "Setup Project Architecture", importance: "High", dueDate: "2026-03-25", service: "Jira", description: "Define the core architecture for the new Project Guide Agent, including MCP server structure and binary distribution." },
  { id: "PROJ-2", title: "Design Landing Page", importance: "Medium", dueDate: "2026-03-26", service: "Figma", description: "Create a modern, responsive landing page design in Figma. Focus on glassmorphism and clear call-to-actions." },
  { id: "PROJ-3", title: "API Documentation", importance: "Low", dueDate: "2026-03-27", service: "Jira", description: "Document all MCP tools and skills for external developers." },
  { id: "PROJ-4", title: "Fix Login Bug", importance: "High", dueDate: "2026-03-24", service: "Jira", description: "Users are reporting a 401 error when trying to authenticate with GitHub during the setup flow." },
];

const server = new Server(
  {
    name: "projectguide-agent",
    version: "1.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "get_setup_status",
        description: "MANDATORY: Check this first on startup. Returns connection status for Jira, Figma, and GitHub and suggests onboarding steps.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "configure_service",
        description: "Connects or updates a service configuration (Jira, Figma, GitHub).",
        inputSchema: {
          type: "object",
          properties: {
            service: { type: "string", enum: ["jira", "figma", "github"] },
            url: { type: "string", description: "Jira instance URL (for Jira only)" },
            token: { type: "string", description: "API Token or Access Token" },
            user: { type: "string", description: "GitHub username (for GitHub only)" },
          },
          required: ["service", "token"],
        },
      },
      {
        name: "list_tickets",
        description: "Lists all tickets from connected services, prioritized by importance and date.",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "analyze_artifact",
        description: "Reads and summarizes a ticket description or a Figma design.",
        inputSchema: {
          type: "object",
          properties: {
            artifact_id: { type: "string", description: "The ID of the ticket or design to analyze (e.g., PROJ-1)" },
          },
          required: ["artifact_id"],
        },
      },
      {
        name: "run_skill",
        description: "Executes a specialized command (skill) started with \.",
        inputSchema: {
          type: "object",
          properties: {
            skill: { type: "string", description: "The skill to run (e.g., file-info, developer-mode)" },
            args: { type: "string", description: "Arguments for the skill" },
          },
          required: ["skill"],
        },
      },
      {
        name: "invoke_projectguide",
        description: "Call this tool whenever the user types 'invoke projectguide-agent', 'start agent', or 'init' to activate the Project Guide Agent's professional setup and ticketing flow.",
        inputSchema: {
          type: "object",
          properties: {
            reason: { type: "string", description: "Reason for invocation (e.g., user requested it)" },
          },
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  switch (name) {
    case "invoke_projectguide": {
      const status = config;
      let mission = "Project Guide Agent ACTIVATED.\n\n";

      const missing = [];
      if (!config.jira.connected) missing.push("Jira");
      if (!config.figma.connected) missing.push("Figma");
      if (!config.github.connected) missing.push("GitHub");

      if (missing.length > 0) {
        mission += `I see that the following services are not yet connected: ${missing.join(", ")}.\n`;
        mission += `Please start by asking the user if they would like to connect ${missing[0]} now. Use the 'configure_service' tool when they provide details.`;
      } else {
        mission += "All services are connected! Please list the prioritized tickets using 'list_tickets' and ask the user what they want to work on.";
      }

      return { content: [{ type: "text", text: mission }] };
    }

    case "get_setup_status": {
      const missing = [];
      if (!config.jira.connected) missing.push("Jira");
      if (!config.figma.connected) missing.push("Figma");
      if (!config.github.connected) missing.push("GitHub");

      let suggestion = "";
      if (missing.length > 0) {
        suggestion = `Suggested Next Step: You should connect ${missing[0]} to unlock more features!`;
      } else {
        suggestion = "All systems connected! You are ready to go.";
      }

      return {
        content: [{ type: "text", text: JSON.stringify({ status: config, suggestion }, null, 2) }],
      };
    }

    case "configure_service": {
      const { service, url, token, user } = args;
      if (service === "jira") {
        if (!url) return { content: [{ type: "text", text: "Error: Jira requires a URL." }], isError: true };
        config.jira = { connected: true, url, token: "********" };
      } else if (service === "figma") {
        config.figma = { connected: true, token: "********" };
      } else if (service === "github") {
        config.github = { connected: true, token: "********", user: user || "unknown" };
      }
      saveConfig();
      return { content: [{ type: "text", text: `Successfully connected ${service}!` }] };
    }

    case "list_tickets": {
      const prioritized = [...MOCK_TICKETS].sort((a, b) => {
        const priorityScore = { High: 3, Medium: 2, Low: 1 };
        if (priorityScore[b.importance] !== priorityScore[a.importance]) {
          return priorityScore[b.importance] - priorityScore[a.importance];
        }
        return new Date(a.dueDate) - new Date(b.dueDate);
      });

      let output = "Prioritized Ticket List:\n\n";
      prioritized.forEach((t) => {
        output += `- [${t.importance}] ${t.id}: ${t.title} (Due: ${t.dueDate}) via ${t.service}\n`;
      });

      return { content: [{ type: "text", text: output }] };
    }

    case "analyze_artifact": {
      const ticket = MOCK_TICKETS.find(t => t.id === args.artifact_id);
      if (!ticket) return { content: [{ type: "text", text: `Artifact ${args.artifact_id} not found.` }], isError: true };

      return {
        content: [{ type: "text", text: `Analysis of ${ticket.id} (${ticket.title}):\n\nDescription: ${ticket.description}\n\nSuggested Approach: Based on the description, this task requires focused work on ${ticket.service} integration.` }],
      };
    }

    case "run_skill": {
      const { skill, args: skillArgs } = args;
      if (skill === "developer-mode") {
        config.developer_mode = !config.developer_mode;
        saveConfig();
        return { content: [{ type: "text", text: `Developer Mode is now ${config.developer_mode ? "ENABLED" : "DISABLED"}. I will now provide more technical details.` }] };
      }

      if (skill === "file-info") {
        const targetPath = skillArgs || ".";
        try {
          const stats = fs.statSync(targetPath);
          return {
            content: [{ type: "text", text: `File Info for "${targetPath}":\n- Type: ${stats.isDirectory() ? "Directory" : "File"}\n- Size: ${stats.size} bytes\n- Last Modified: ${stats.mtime}` }],
          };
        } catch (e) {
          return { content: [{ type: "text", text: `Error reading file info: ${e.message}` }], isError: true };
        }
      }

      return { content: [{ type: "text", text: `Unknown skill: ${skill}` }], isError: true };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Project Guide Agent v1.1.0 (Advanced) running on stdio");
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});
