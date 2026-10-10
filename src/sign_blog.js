// Node: "Sign Blog Payload" — HMAC-SHA256 over `${ts}.${body}` (docs/blog-ingestion-contract.md).
// Requires NODE_FUNCTION_ALLOW_BUILTIN=crypto and env CM_BLOG_WEBHOOK_SECRET readable by Code nodes.
const crypto = require('crypto');
const secret = $env.CM_BLOG_WEBHOOK_SECRET;
if (!secret) throw new Error('CM_BLOG_WEBHOOK_SECRET is not set (or env access is blocked)');
const b = $('Prepare Review').first().json.content.blog;
const payload = {
  slug: b.slug, title: b.title, meta_description: b.meta_description, body_markdown: b.body_markdown,
  faqs: b.faqs, jsonld: b.jsonld, og_image: b.og_image, canonical_url: b.canonical_url,
};
const body = JSON.stringify(payload);
const ts = String(Math.floor(Date.now() / 1000));
const sig = crypto.createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
return [{ json: { body, ts, signature: `sha256=${sig}`, slug: b.slug } }];
