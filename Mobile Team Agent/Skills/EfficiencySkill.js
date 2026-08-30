/// MARK: - Efficiency Skill
/// Prompt validation, requirement analysis, and code narrowing.
/// Stops the agent from silently assuming missing information, and keeps token
/// usage low by locating the smallest relevant set of files before any edit.

const { execFile } = require("child_process");
const { promisify } = require("util");
const fs = require("fs");
const path = require("path");
const BaseSkill = require("./Core/BaseSkill");

const execFileAsync = promisify(execFile);

// ── Heuristic markers ─────────────────────────────────────────────────────

const AMBIGUITY_MARKERS = [
  "properly", "appropriately", "as needed", "as required", "somehow", "etc",
  "and so on", "make it better", "improve it", "optimise it", "optimize it",
  "clean it up", "handle it", "the usual", "similar to", "like before",
  "something like", "best way", "whatever", "if needed", "as discussed",
  "fix the app", "make it work", "you decide", "standard way",
];

const SCOPE_MARKERS = [
  "all screens", "every screen", "entire app", "whole app", "everywhere",
  "across the app", "refactor", "rewrite", "migrate", "all files", "everything",
];

const CONSTRAINT_MARKERS = [
  "don't change", "do not change", "without changing", "backward compat",
  "no new dep", "without adding", "keep the same", "must not break",
  "only change", "offline", "performance", "security", "accessib",
  "localis", "localiz", "ios 1", "android 1", "min sdk", "deployment target",
];

const API_MARKERS = ["api", "endpoint", "request", "response", "payload", "backend", "service call", "integrat"];
const FLOW_MARKERS = ["auth", "login", "biometric", "onboarding", "signup", "sign up", "checkout", "payment", "session", "logout"];
const RISK_MARKERS = ["network", "storage", "permission", "offline", "token", "cache", "upload", "download", "background"];

const TYPE_MARKERS = [
  { type: "implementation", needsCode: true,  words: ["implement", "add ", "create ", "build ", "integrate", "wire up", "support "] },
  { type: "bugfix",         needsCode: true,  words: ["fix", "bug", "crash", "not working", "broken", "issue with", "fails", "error"] },
  { type: "refactor",       needsCode: true,  words: ["refactor", "clean up", "restructure", "rename", "extract", "migrate"] },
  { type: "review",         needsCode: false, words: ["review", "check my", "is it safe", "audit"] },
  { type: "tests",          needsCode: true,  words: ["unit test", "write tests", "test case", "coverage"] },
  { type: "explanation",    needsCode: false, words: ["explain", "how does", "what does", "why does", "walk me through"] },
  { type: "docs",           needsCode: false, words: ["document", "readme", "changelog", "write docs"] },
];

const OUTPUT_MARKERS = [
  { label: "code",           words: ["code", "implement", "fix", "add", "build", "write"] },
  { label: "explanation",    words: ["explain", "why", "how does", "understand"] },
  { label: "tests",          words: ["test", "coverage", "spec"] },
  { label: "documentation",  words: ["doc", "readme", "comment"] },
  { label: "implementation plan", words: ["plan", "approach", "steps", "strategy"] },
  { label: "commit message", words: ["commit message"] },
  { label: "Jira update",    words: ["jira", "ticket", "transition", "comment on"] },
];

// File/dir names never worth scanning.
const IGNORED_DIRS = new Set([
  "node_modules", ".git", "build", "dist", "coverage", "Pods", ".expo",
  "DerivedData", ".gradle", ".idea", "vendor", "__snapshots__", ".next",
]);

// Generated or vendored files that never answer a "where is this implemented" question.
const IGNORED_FILES = /(package-lock\.json|yarn\.lock|Podfile\.lock|\.lock$|\.min\.(js|css)$)/i;

// Source files answer "where is this implemented"; docs and config only mention it.
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".swift", ".kt", ".java", ".m", ".mm", ".h"]);

const DEFAULT_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".swift", ".kt", ".java", ".m", ".mm", ".h",
  ".json", ".md", ".yml", ".yaml", ".gradle", ".podspec", ".plist",
];

// ── Detection helpers ─────────────────────────────────────────────────────

// Leading word boundary only, so prefix markers ("integrat", "localis") still match
// their inflections while short markers ("etc", "api") never match inside a longer word.
function has(text, markers) {
  return markers.filter((m) => new RegExp(`\\b${m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(text));
}

function detectType(text) {
  for (const t of TYPE_MARKERS) {
    if (t.words.some((w) => text.includes(w))) return t;
  }
  return { type: "general", needsCode: false, words: [] };
}

function detectInputs(raw) {
  const text = raw.toLowerCase();
  return {
    codeBlock: /```/.test(raw),
    filePath: /[\w./-]+\.(ts|tsx|js|jsx|swift|kt|java|m|mm|h|json|ya?ml|gradle|plist|md)\b/i.test(raw),
    symbol: /\b(function|class|const|struct|component|screen|hook|useEffect|useState)\b/i.test(raw),
    ticket: /[A-Z][A-Z0-9]+-\d+/.test(raw),
    url: /https?:\/\//.test(raw),
    design: ["figma", "screenshot", "design", "mockup", "attached image"].some((w) => text.includes(w)),
    logs: ["stack trace", "exception", "logcat", "error:", "traceback", "crash log"].some((w) => text.includes(w)),
  };
}

function detectOutputs(text) {
  return OUTPUT_MARKERS.filter((o) => o.words.some((w) => text.includes(w))).map((o) => o.label);
}

// ── Requirement analysis ──────────────────────────────────────────────────

function analyseRequest(raw, knownContext) {
  const text = raw.toLowerCase();
  const known = (knownContext || "").toLowerCase();
  const type = detectType(text);
  const inputs = detectInputs(raw);
  const outputs = detectOutputs(text);
  const ambiguity = has(text, AMBIGUITY_MARKERS);
  const scopeCreep = has(text, SCOPE_MARKERS);
  const constraints = has(text, CONSTRAINT_MARKERS);

  const critical = [];
  const important = [];
  const optional = [];

  // A code change with nothing to anchor it to cannot be implemented correctly.
  const knownAnchors = ["file", "code", "module", "screen", "component", "class", "function", "already read"];
  const hasAnchor = inputs.codeBlock || inputs.filePath || inputs.symbol || inputs.ticket ||
    knownAnchors.some((k) => known.includes(k));
  if (type.needsCode && !hasAnchor) {
    critical.push("Which file / module / function should change? No code, path, symbol, or ticket was referenced.");
  }

  // API work without a contract is the classic source of rework.
  if (has(text, API_MARKERS).length > 0 && !inputs.url && !inputs.codeBlock && !known.includes("api")) {
    critical.push("API contract — endpoint URL, method, request and response shape, error codes.");
  }

  // Multiple valid flows with no indication of which one.
  const flows = has(text, FLOW_MARKERS);
  if (flows.length > 0 && type.needsCode && !inputs.codeBlock && !known.includes(flows[0])) {
    critical.push(`Which ${flows[0]} flow is affected, and what is the expected behaviour on success and on failure?`);
  }

  // Vague wording on a change request means the acceptance criteria are unknown.
  if (ambiguity.length > 0 && type.needsCode) {
    critical.push(`Expected behaviour is ambiguous ("${ambiguity[0]}") — what does "done" look like?`);
  }

  if (scopeCreep.length > 0) {
    important.push(`Scope — "${scopeCreep[0]}" is broad. Confirm what is in scope and what must not be touched.`);
  }
  if (outputs.length === 0) {
    important.push("Expected output — code, explanation, tests, plan, or docs.");
  }
  if (constraints.length === 0 && type.needsCode) {
    important.push("Constraints — behaviour to preserve, dependency limits, supported OS versions, backward compatibility.");
  }
  const risky = has(text, RISK_MARKERS);
  if (risky.length > 0 && type.needsCode) {
    important.push(`Edge cases for ${risky.join(", ")} — empty/nil values, failure, permission denied, offline, retry.`);
  }
  if (type.needsCode && !inputs.design && has(text, ["ui", "screen", "layout", "button", "list"]).length > 0) {
    optional.push("Design reference (Figma frame or screenshot) for exact spacing, colours, and copy.");
  }
  optional.push("Test data or a sample account, if the change needs manual verification.");

  const verdict = critical.length > 0
    ? "NEED CLARIFICATION"
    : important.length > 0
      ? "PARTIALLY READY"
      : "READY";

  return { type: type.type, inputs, outputs, ambiguity, scopeCreep, constraints, critical, important, optional, verdict };
}

function renderAnalysis(raw, a) {
  const present = Object.entries(a.inputs).filter(([, v]) => v).map(([k]) => k);
  const lines = [];

  lines.push(`Requirement Analysis — ${a.type} request`);
  lines.push("");
  lines.push(`Inputs present: ${present.length ? present.join(", ") : "none detected"}`);
  lines.push(`Expected output: ${a.outputs.length ? a.outputs.join(", ") : "not stated"}`);
  lines.push(`Constraints stated: ${a.constraints.length ? a.constraints.join(", ") : "none"}`);
  lines.push("");

  if (a.critical.length) {
    lines.push("CRITICAL — blocks correct implementation, ask before writing code:");
    a.critical.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
    lines.push("");
  }
  if (a.important.length) {
    lines.push("IMPORTANT — affects the result, ask only if a wrong guess causes rework:");
    a.important.forEach((c, i) => lines.push(`  ${i + 1}. ${c}`));
    lines.push("");
  }
  if (a.optional.length) {
    lines.push("OPTIONAL — never blocks:");
    a.optional.forEach((c) => lines.push(`  - ${c}`));
    lines.push("");
  }

  lines.push(`VERDICT: ${a.verdict}`);
  lines.push("");

  if (a.verdict === "NEED CLARIFICATION") {
    lines.push("Next step: first check the conversation, the open ticket, the project files, and saved memory —");
    lines.push("drop every question already answered there. Ask only what remains, in one message:");
    lines.push("");
    lines.push("  **I need a few details before proceeding:**");
    lines.push("  1. **<question>** — <why it blocks>");
  } else if (a.verdict === "PARTIALLY READY") {
    lines.push("Next step: proceed now. State each assumption in one line so it can be corrected cheaply.");
    lines.push("Ask nothing that a reasonable default already covers.");
  } else {
    lines.push("Next step: implement immediately. Do not ask clarification questions.");
  }

  lines.push("");
  lines.push("Before reading code, run 'narrow_code_scope' to find the smallest relevant file set.");
  return lines.join("\n");
}

// ── Code narrowing ────────────────────────────────────────────────────────

function walkFiles(root, rel, out, budget) {
  if (out.length >= budget) return;
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch (_) {
    return;
  }
  for (const entry of entries) {
    if (out.length >= budget) return;
    if (entry.name.startsWith(".") && entry.name !== ".env.example") continue;
    if (IGNORED_DIRS.has(entry.name)) continue;
    const next = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) walkFiles(root, next, out, budget);
    else out.push(next);
  }
}

async function listRepoFiles(repoPath) {
  try {
    const { stdout } = await execFileAsync("git", ["-C", repoPath, "ls-files", "--cached", "--others", "--exclude-standard"], { maxBuffer: 10 * 1024 * 1024 });
    const files = stdout.split("\n").filter(Boolean).filter((f) => !f.split("/").some((seg) => IGNORED_DIRS.has(seg)));
    if (files.length) return files;
  } catch (_) { /* not a git repo — fall through */ }
  const out = [];
  walkFiles(repoPath, "", out, 20000);
  return out;
}

async function grepMatches(repoPath, terms) {
  const counts = new Map();
  const samples = new Map();
  const args = ["-rIn", "--binary-files=without-match"];
  for (const dir of IGNORED_DIRS) args.push(`--exclude-dir=${dir}`);
  for (const t of terms) args.push("-e", t);
  args.push("-i", "--", ".");

  let stdout = "";
  try {
    ({ stdout } = await execFileAsync("grep", args, { cwd: repoPath, maxBuffer: 8 * 1024 * 1024 }));
  } catch (err) {
    stdout = err && err.stdout ? err.stdout : ""; // grep exits 1 on no match
  }

  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const first = line.indexOf(":");
    const second = line.indexOf(":", first + 1);
    if (first < 0 || second < 0) continue;
    const file = line.slice(0, first).replace(/^\.\//, "");
    const lineNo = line.slice(first + 1, second);
    const body = line.slice(second + 1).trim();
    counts.set(file, (counts.get(file) || 0) + 1);
    const bucket = samples.get(file) || [];
    if (bucket.length < 3) {
      bucket.push(`${lineNo}: ${body.length > 110 ? body.slice(0, 110) + "…" : body}`);
      samples.set(file, bucket);
    }
  }
  return { counts, samples };
}

// ── Prompt template ───────────────────────────────────────────────────────

function renderTemplate(task) {
  const goal = task ? task.trim() : "<what needs to be achieved>";
  return [
    "Copy this, fill it in, and the task can usually be completed in one cycle:",
    "",
    "```text",
    `Goal:`,
    `${goal}`,
    "",
    "Context:",
    "Relevant existing behaviour, files, architecture, or background.",
    "",
    "Scope:",
    "What should change — and what must NOT change.",
    "",
    "Requirements:",
    "Expected functional / UI / business behaviour.",
    "",
    "Constraints:",
    "Technical, security, compatibility, dependency, or project constraints.",
    "",
    "Inputs:",
    "Code, screenshots, API contracts, configuration, logs.",
    "",
    "Expected Output:",
    "Code / explanation / tests / plan / docs / Jira update.",
    "",
    "Validation:",
    "How the implementation should be tested or verified.",
    "```",
    "",
    "Only the sections that are actually unclear matter — a request that already",
    "carries enough information does not need this format.",
  ].join("\n");
}

// ── Skill ─────────────────────────────────────────────────────────────────

class EfficiencySkill extends BaseSkill {
  constructor() {
    super();
    this.name = "EfficiencySkill";
  }

  getTools() {
    return [
      {
        name: "analyze_request",
        description: "Validate a development request before implementing it: checks goal, scope, inputs, expected output, constraints and edge cases, classifies missing information as CRITICAL / IMPORTANT / OPTIONAL, and returns a READY / PARTIALLY READY / NEED CLARIFICATION verdict. Use on vague or large requests — not on clear ones.",
        inputSchema: {
          type: "object",
          properties: {
            request: { type: "string", description: "The developer's request, verbatim" },
            known_context: { type: "string", description: "What is already known from the conversation, ticket, or files — so it is not asked again" },
          },
          required: ["request"],
        },
      },
      {
        name: "narrow_code_scope",
        description: "Find the smallest relevant set of files for a feature or symbol before reading or editing code. Ranks files by name and content matches and returns matched lines, so only the files that matter are opened.",
        inputSchema: {
          type: "object",
          properties: {
            feature: { type: "string", description: "Feature, module, screen, symbol, or keyword (e.g. 'biometric login', 'end_of_day_report')" },
            repo_path: { type: "string", description: "Project path (defaults to the configured repo)" },
            extensions: { type: "string", description: "Comma-separated extensions to restrict the search (e.g. '.ts,.tsx')" },
            max_files: { type: "number", description: "Maximum files to return (default 12)" },
          },
          required: ["feature"],
        },
      },
      {
        name: "prompt_template",
        description: "Return the standard prompt structure (goal, context, scope, requirements, constraints, inputs, expected output, validation) to help the developer write a complete request in one shot.",
        inputSchema: {
          type: "object",
          properties: {
            task: { type: "string", description: "Optional task description to pre-fill the Goal line" },
          },
        },
      },
    ];
  }

  async handleTool(name, args, context) {
    switch (name) {
      case "analyze_request": {
        const request = (args.request || "").trim();
        if (!request) return this.errorResponse("No request text supplied — pass the developer's request verbatim as 'request'.");
        return this.textResponse(renderAnalysis(request, analyseRequest(request, args.known_context)));
      }

      case "narrow_code_scope": {
        const feature = (args.feature || "").trim();
        if (!feature) return this.errorResponse("No feature supplied — pass a feature, module, screen, or symbol name as 'feature'.");

        const repoPath = args.repo_path || context.getRepoPath();
        if (!fs.existsSync(repoPath)) {
          return this.errorResponse(`Path not found: ${repoPath}. Pass 'repo_path', or configure the project path first.`);
        }

        const maxFiles = Math.max(1, Math.min(Number(args.max_files) || 12, 50));
        const exts = args.extensions
          ? args.extensions.split(",").map((e) => e.trim()).filter(Boolean).map((e) => (e.startsWith(".") ? e : `.${e}`))
          : DEFAULT_EXTENSIONS;

        // Exact phrase first — a symbol like "end_of_day_report" must not be
        // shredded into generic tokens. Only fall back to tokens if nothing matches.
        const terms = [...new Set(
          feature.split(/[\s,/_-]+/).map((t) => t.trim()).filter((t) => t.length > 2)
        )];

        const allFiles = (await listRepoFiles(repoPath))
          .filter((f) => exts.includes(path.extname(f)))
          .filter((f) => !IGNORED_FILES.test(path.basename(f)));
        if (allFiles.length === 0) {
          return this.textResponse(`No files with extensions ${exts.join(", ")} found under ${repoPath}.`);
        }

        let { counts, samples } = await grepMatches(repoPath, [feature]);
        let usedTerms = [feature];
        let mode = "exact phrase";
        if (counts.size === 0 && terms.length > 0) {
          ({ counts, samples } = await grepMatches(repoPath, terms));
          usedTerms = terms;
          mode = `keywords: ${terms.join(", ")}`;
        }

        const scored = allFiles.map((file) => {
          const lower = file.toLowerCase();
          const base = path.basename(lower);
          let score = 0;
          for (const t of usedTerms) {
            const term = t.toLowerCase();
            if (base.includes(term)) score += 10;
            else if (lower.includes(term)) score += 5;
          }
          const hits = counts.get(file) || 0;
          score += Math.min(hits, 20) * (CODE_EXTENSIONS.has(path.extname(lower)) ? 1.5 : 0.6);
          return { file, score, hits };
        }).filter((f) => f.score > 0)
          .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

        if (scored.length === 0) {
          return this.textResponse(
            `No files matched "${feature}" in ${repoPath} (${allFiles.length} files scanned).\n\n` +
            `Try a different term, a symbol name from the code, or ask the developer which module owns this feature — do not guess.`
          );
        }

        const top = scored.slice(0, maxFiles);
        const lines = [];
        lines.push(`Narrowed scope for "${feature}" — ${top.length} of ${scored.length} matching files (${allFiles.length} scanned, matched on ${mode})`);
        lines.push("");
        top.forEach((f, i) => {
          lines.push(`${i + 1}. ${f.file}${f.hits ? `  (${f.hits} match${f.hits === 1 ? "" : "es"})` : "  (name match)"}`);
          for (const s of samples.get(f.file) || []) lines.push(`     ${s}`);
        });
        lines.push("");
        lines.push("Read only these files. If the top 2–3 answer the question, stop there.");
        if (scored.length > top.length) {
          lines.push(`${scored.length - top.length} lower-ranked files were left out — raise 'max_files' only if the top set proves insufficient.`);
        }
        return this.textResponse(lines.join("\n"));
      }

      case "prompt_template":
        return this.textResponse(renderTemplate(args.task));

      default:
        return this.errorResponse(`Unknown tool ${name} in ${this.name}`);
    }
  }

  getPrompt() {
    return this.loadPromptChunk("efficiency.md") || `### Efficiency Skill
Before implementing, check existing context first, never assume missing details, and ask only what blocks a correct implementation.
Use 'narrow_code_scope' to find the smallest relevant file set before reading code.
Use 'analyze_request' on vague requests, and 'prompt_template' when the developer wants a reusable prompt structure.`;
  }
}

module.exports = EfficiencySkill;
