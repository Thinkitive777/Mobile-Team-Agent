# Mobile Team Agent: Architecture Analysis & Recommendations

## 1. Executive Summary
The current implementation of the Mobile Team Agent relies on a unified, monolithic architecture. Both the system prompt (`agent_prompt.md`) and the core application logic (`Main/index.js`) handle all capabilities—ranging from Jira interactions and configuration management to report generation—in single, massive files. 

While this approach works for the current v3.1 feature set, **it is not optimal for future growth**. Transitioning to a **modular, skill-based architecture** is highly recommended. It will drastically improve codebase maintainability, allow the LLM to perform better by focusing only on relevant context, and enable scalable expansion to new integrations (e.g., GitHub PRs, Slack, Confluence) without risking regressions in core features.

---

## 2. Evaluation of the Current "Unified" Approach

### Scalability, Maintainability, and Performance
*   **Maintainability (Poor):** The `Main/index.js` file is over 2,000 lines long, containing a massive `switch` statement for routing over 25 different tools. Testing, debugging, or extending a single capability (like adding a new param to `list_tickets`) requires navigating and modifying the global orchestrator. 
*   **Scalability (Poor):** Every new feature adds to the same global namespace. If you want to introduce an entirely new domain (e.g., Code Review or Documentation), the `index.js` file and the single `agent_prompt.md` will become uncontrollably large and brittle.
*   **Performance / LLM Context (Suboptimal):** The LLM is forced to digest ~200 lines of rigorous rules encompassing *all* workflows (morning standups, blocker resolution, Jira JQL rules, EOD reports) for every single interaction. This "context bloat" consumes tokens unnecessarily and dilutes the LLM's attention, increasing the likelihood of hallucinations or poor tool selection.

### Identified Limitations of the Current Implementation
1.  **Prompt Overloading:** The system prompt explicitly fights against the LLM's confusion with rules like `"CRITICAL: Tool Routing Rules - NEVER use run_skill for operations..."`. This is a symptom of exposing too many tools and mixed intents simultaneously.
2.  **Coupled Tool Formatting:** Output generation (e.g., formatting ticket tables or insight strings) is tightly coupled with the tool routing logic inside the `index.js` switch cases, rather than separated into view/presentation layers.
3.  **Rigid Feature Set:** Adding experimental tools risks breaking core, stable workflows since they share the exact same runtime boundaries.

---

## 3. Should the Agent Dynamically Switch/Adapt Skills?
**Yes.** The agent should dynamically load context and tools based on the user's current goal. 

If a user simply says *"Good morning"*, the agent does not need the cognitive overhead of Jira's JQL syntax, transition states, or GitHub configuration rules. It only needs the `StandupSkill` context. 
By dynamically adapting skills, you achieve:
*   **Higher Accuracy:** The LLM is given hyper-focused instructions for the task at hand.
*   **Lower Token Usage:** Context windows are kept lean.
*   **Better UX:** The agent behaves more like a specialized workflow coordinator rather than a generic prompt interface.

---

## 4. Proposed High-Level Architecture (Skill Separation)

The recommended architecture moves from a monolithic MCP Server to a **Skill/Module Registry** pattern. 

### Core Components
1.  **Orchestrator (`Main/server.js`)**: 
    *   Handles connection lifecycle and session state.
    *   Acts as a router to delegate requests to registered Skills.
2.  **Skill Registry (`Main/SkillRegistry.js`)**:
    *   Dynamically registers/unregisters independent modules.
3.  **Specialized Skills (`Skills/`)**: 
    Each skill is a standalone class encapsulating its own tools, prompt instructions, and execution logic.
    *   `SetupSkill`: Tools for `configure_service`, `hardware_check`.
    *   `JiraReadSkill`: Tools for querying, listing, and analyzing workload.
    *   `JiraWriteSkill`: Tools for transitions, comments, and logging work.
    *   `WorkflowSkill`: Tools for morning standups and EOD reports.

### Code Structure Example
```text
/Mobile Team Agent
├── Main/
│   ├── server.js            # Minimal MCP server setup, delegates to Registry
│   └── SkillRegistry.js     # Manages loaded skills & global tool list
├── Skills/
│   ├── Core/                # Abstract base skill classes
│   │   └── BaseSkill.js     # interface: getTools(), getPrompts(), handleTool()
│   ├── Jira/
│   │   ├── JiraQuerySkill.js
│   │   ├── JiraActionSkill.js
│   │   └── JiraPrompt.md    # Focused prompt for Jira tasks only
│   ├── Workflow/
│   │   ├── StandupSkill.js
│   │   └── ReportingSkill.js
└── Services/
    └── (External Integrations like jira-client.js stay here)
```

---

## 5. Examples of Behavioral Differences Post-Implementation

### Before (Current Unified Approach)
*   *User:* "I'm having trouble with the PROJ-123 API."
*   *Agent's Internal State:* Tries to process this via the massive 191-line master prompt. Sees rules for Standups, EOD, JQL, Transitioning, and Blocker Detection at the same time.
*   *Outcome:* The LLM might unnecessarily invoke `analyze_workload` or try to parse Jira rules, diluting its ability to deeply assist with the API issue.

### After (Skill-Based Approach)
*   *User:* "Start my day."
*   *Orchestrator:* Detects workflow intent. Injects the `StandupSkill` prompt instructions and exposes only the `morning_standup`, `list_tickets`, and `health_check` tools.
*   *Outcome:* The LLM receives a hyper-focused context window. It flawlessly executes the morning standup routine without any distraction from Jira creation schemas or end-of-day logic.

*   *User:* "Let's update PROJ-123."
*   *Orchestrator:* Loads the `JiraWriteSkill`.
*   *Outcome:* The LLM context is now enriched specifically with rules about updating tickets, logging work, and assigning users, ensuring high-accuracy tool usage without "hallucinating" the deprecated `run_skill` flow.

---

## 6. Recommendations & Next Steps

**Recommendation: Move to a modular, skill-based system.** 

*   **Phase 1: Code Refactoring (Immediate).** Break the 2000-line `index.js` file into separate Javascript handler classes (e.g., `JiraTools.js`, `ReportingTools.js`). Have `index.js` merely import and register these tools. This provides immediate maintainability benefits without altering the LLM's experience.
*   **Phase 2: Prompt Decomposition (Short-term).** Break `agent_prompt.md` into smaller chunks (e.g., `prompts/standup.md`, `prompts/jira_write.md`). Map these prompt chunks to your code modules.
*   **Phase 3: Dynamic Context (Long-term).** Implement dynamic tool registration / dynamic instructions based on conversational intent, drastically optimizing token usage and agent focus.
