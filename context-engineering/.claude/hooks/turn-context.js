// UserPromptSubmit hook body. Run by turn-context.sh.
//
// 1. Saves the user's message so git-guard.sh can check Git permission.
// 2. Detects Fable 5 from the transcript and injects the warning instruction.
// 3. Injects a SHORT context-budget warning when usage crosses 80% or 90%.
//    The real percentage comes from statusline.js, which is the only place
//    Claude Code exposes it. Each warning fires once per session, not every turn.
//
// Prints nothing on a normal turn, so normal turns cost no extra tokens.
const fs = require("fs");
const path = require("path");

const stateDir = process.env.STATE_DIR || "/tmp/claude-team-guard";
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { return null; } };
const exists = (p) => { try { return fs.existsSync(p); } catch (e) { return false; } };

let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  let j = {};
  try { j = JSON.parse(d); } catch (e) { process.exit(0); }
  const sid = j.session_id || "none";
  const notes = [];

  // --- 1. Save the raw user message for the Git guard ---------------------
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, sid + ".prompt"), String(j.prompt || ""));
  } catch (e) {}

  // --- 2. Fable 5 detection ------------------------------------------------
  let model = "";
  try {
    const lines = fs.readFileSync(j.transcript_path, "utf8").trim().split("\n");
    for (let i = lines.length - 1; i >= 0 && !model; i--) {
      try {
        const e = JSON.parse(lines[i]);
        if (e && e.type === "assistant" && e.message && e.message.model) model = String(e.message.model);
      } catch (_) {}
    }
  } catch (e) {}

  const fableFlag = path.join(stateDir, sid + ".fable-ack");
  if (/fable/i.test(model)) {
    const acked = exists(fableFlag);
    let msg =
      "MODEL CHECK (from the transcript): the last assistant reply used model `" + model + "`.\n" +
      "This is Claude Fable 5.\n\n" +
      "Start EVERY reply while this model is active with this exact heading, on its own line:\n\n" +
      "# **⚠️ FABLE 5 IS ACTIVE — USAGE MAY BE HIGHER**\n";
    if (!acked) {
      msg +=
        "\nThis is the FIRST turn on Fable 5 in this session. After the heading, also ask:\n\n" +
        "> You are using Claude Fable 5. It may use more of the expensive team allocation.\n" +
        "> Do you want to continue with Fable 5 for this task?\n\n" +
        "Do not start heavy work until the user answers.\n" +
        "Do not say you switched the model. You cannot. Only the user can, with /model.\n";
      try { fs.writeFileSync(fableFlag, model); } catch (e) {}
    }
    notes.push(msg);
  } else {
    try { if (exists(fableFlag)) fs.unlinkSync(fableFlag); } catch (e) {}
  }

  // --- 3. Context budget ---------------------------------------------------
  const ctx = readJson(path.join(stateDir, sid + ".ctx"));
  const pct = ctx && typeof ctx.used_percentage === "number" ? ctx.used_percentage : null;
  if (pct !== null) {
    const band = pct >= 90 ? 90 : pct >= 80 ? 80 : 0;
    const bandFile = path.join(stateDir, sid + ".ctxband");
    let last = 0;
    try { last = parseInt(fs.readFileSync(bandFile, "utf8"), 10) || 0; } catch (e) {}
    if (band === 0 && last !== 0) { try { fs.writeFileSync(bandFile, "0"); } catch (e) {} }
    if (band > last) {
      try { fs.writeFileSync(bandFile, String(band)); } catch (e) {}
      if (band === 90) {
        notes.push(
          "CONTEXT BUDGET: about " + pct + "% of the context window is used.\n" +
          "Show this to the user once, at the END of your next reply, in two lines:\n\n" +
          "# **CONTEXT WARNING — ~" + pct + "% USED**\n" +
          "> Save a handoff before continuing: `/handoff` (task done) or `/checkpoint` (task ongoing), then `/compact`.\n\n" +
          "Do not repeat this warning on later turns. Do not run /compact yourself."
        );
      } else {
        notes.push(
          "CONTEXT BUDGET: about " + pct + "% of the context window is used.\n" +
          "Mention this once, in ONE short line at the end of your next reply:\n\n" +
          "# **CONTEXT WARNING — ~" + pct + "% USED**\n" +
          "> Consider `/checkpoint` → `/compact` before continuing.\n\n" +
          "Do not repeat it on later turns. Do not run /compact yourself."
        );
      }
    }
  }

  if (!notes.length) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: notes.join("\n\n"),
    },
  }));
});
