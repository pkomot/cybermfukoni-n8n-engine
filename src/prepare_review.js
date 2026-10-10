// Node: "Prepare Review" — receives the PASSING compliance item. Builds the Telegram preview and
// signed one-time approve/reject links to this execution's Wait node.
// Requires NODE_FUNCTION_ALLOW_BUILTIN=crypto.
const crypto = require('crypto');
const f = $('Extract Facts').first().json;
const { content, attempt } = $input.first().json;
const token = crypto.randomBytes(24).toString('hex');
const base = $execution.resumeUrl;          // {N8N_URL}/webhook-waiting/{executionId}
const link = (d) => `${base}?d=${d}&t=${token}`;

const esc = (s, n) => {
  const t = String(s ?? '');
  const cut = t.length > n ? t.slice(0, n - 1) + '…' : t;
  return cut.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
};
const text = [
  `<b>Review: ${esc(f.h1 || f.slug, 120)}</b>`,
  `Fee: ${f.priceAmbiguous ? 'ambiguous (not mentioned)' : f.priceKes ?? 'n/a'} | Turnaround: ${f.turnaroundDays ?? 'n/a'} days | Attempt ${attempt}`,
  `Why: ${esc((f.reasons || []).join('; ') || 'rotation', 300)}`,
  '',
  `<b>Blog</b>: ${esc(content.blog.title, 120)}`,
  `<b>X</b>: ${esc(content.x.text, 300)}`,
  `<b>Facebook</b>: ${esc(content.facebook.message, 900)}`,
  `<b>Instagram</b>: ${esc(content.instagram.caption, 600)}`,
  '',
  `Execution <code>${$execution.id}</code> · links expire in 48 h`,
].join('\n').slice(0, 4096);

return [{
  json: {
    token, text, approveUrl: link('approve'), rejectUrl: link('reject'),
    slug: f.slug, content,
  },
}];
