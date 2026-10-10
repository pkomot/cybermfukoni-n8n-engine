// Node: "Verify Decision" — runs after the Wait node resumes (link click) or times out.
// Constant-time token comparison; a bad token loops back to the Wait node.
const crypto = require('crypto');
const expected = $('Prepare Review').first().json.token;
const q = ($input.first().json && $input.first().json.query) || {};
let decision = 'expired';                       // Wait timeout resumes with no query
if (q.t !== undefined || q.d !== undefined) {
  const a = Buffer.from(String(q.t || ''));
  const b = Buffer.from(expected);
  const valid = a.length === b.length && crypto.timingSafeEqual(a, b);
  decision = !valid ? 'invalid' : (q.d === 'approve' ? 'approve' : q.d === 'reject' ? 'reject' : 'invalid');
}
return [{ json: { decision } }];
