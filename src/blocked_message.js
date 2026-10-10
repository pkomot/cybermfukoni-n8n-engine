// Node: "Blocked Message" — compliance still failing after maxAttempts.
const f = $('Extract Facts').first().json;
const { violations, attempt } = $input.first().json;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const lines = violations.slice(0, 15).map((v) => `• [${esc(v.channel)}] ${esc(v.rule)}: ${esc(v.detail).slice(0, 160)}`);
return [{
  json: {
    violations,
    text: [`<b>⛔ Blocked: ${esc(f.h1 || f.slug)}</b>`, `Compliance failed after ${attempt} attempts:`, ...lines,
      `Execution <code>${$execution.id}</code>`].join('\n').slice(0, 4096),
  },
}];
