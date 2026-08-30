// statusLine body. Run by statusline.sh.
//
// Shows: model | context usage | project | active task
// Also writes the real context percentage to a state file so that
// turn-context.js and /context can read it. Claude cannot see the status
// line, so this file is the only honest bridge to real context numbers.
const fs = require("fs");
const path = require("path");

let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  let j = {};
  try { j = JSON.parse(d); } catch (e) { process.stdout.write("claude"); return; }

  const stateDir = process.env.STATE_DIR || "/tmp/claude-team-guard";
  const sid = j.session_id || "none";
  const mid = (j.model && (j.model.id || j.model.display_name)) || "";
  const mname = (j.model && (j.model.display_name || j.model.id)) || "unknown model";
  const isFable = /fable/i.test(mid);

  const cw = j.context_window || {};
  const pct = typeof cw.used_percentage === "number" ? Math.round(cw.used_percentage) : null;

  // Bridge the real numbers to the hooks and to /context.
  if (pct !== null) {
    try {
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, sid + ".ctx"), JSON.stringify({
        used_percentage: pct,
        total_input_tokens: cw.total_input_tokens || null,
        context_window_size: cw.context_window_size || null,
        model: mid,
        at: new Date().toISOString(),
      }));
    } catch (e) {}
  }

  const parts = [];
  parts.push(isFable ? "⚠️  FABLE 5 — HIGH USAGE" : "● " + mname);

  if (pct !== null) {
    const mark = pct >= 90 ? "!! " : pct >= 80 ? "! " : "";
    parts.push(mark + "ctx " + pct + "%");
  }

  const dir = (j.workspace && j.workspace.current_dir) || j.cwd || "";
  if (dir) parts.push(path.basename(dir));

  // Active task name, if a checkpoint is open.
  try {
    const proj = (j.workspace && j.workspace.project_dir) || dir;
    const active = path.join(proj, ".claude", "checkpoints", "ACTIVE");
    if (fs.existsSync(active)) {
      const name = fs.readFileSync(active, "utf8").trim().slice(0, 40);
      if (name) parts.push("▸ " + name);
    }
  } catch (e) {}

  process.stdout.write(parts.join("  │  "));
});
