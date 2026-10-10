// Node: "Assemble + Compliance" — parse LLM JSON, insert tracked links, disclaimer, JSON-LD,
// then run the deterministic gate (mirrors cm_agent/assemble.py + compliance.py).
const cfg = $('Config').first().json;
const f = $('Extract Facts').first().json;
const attempt = $runIndex + 1;
const executionId = $execution.id;
const resp = $input.first().json;

const violations = [];
const V = (channel, rule, detail) => violations.push({ channel, rule, detail });

// ---------- parse + shape validation
let pack = null;
try {
  if (resp.error) throw new Error(`LLM HTTP error: ${JSON.stringify(resp.error).slice(0, 300)}`);
  const txt = (resp.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
  const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('no JSON object in response');
  pack = JSON.parse(txt.slice(s, e + 1));
  const str = (v) => typeof v === 'string' && v.trim().length > 0;
  const arr = (v) => Array.isArray(v);
  const ok = pack && str(pack.primary_keyword) && pack.blog && str(pack.blog.title) && str(pack.blog.slug)
    && str(pack.blog.meta_description) && str(pack.blog.body_markdown) && arr(pack.blog.faqs)
    && pack.blog.faqs.every((q) => str(q.question) && str(q.answer))
    && str(pack.facebook_post) && str(pack.x_post) && str(pack.instagram_caption)
    && arr(pack.instagram_hashtags) && pack.tiktok && str(pack.tiktok.hook) && arr(pack.tiktok.beats)
    && arr(pack.tiktok.on_screen_text) && str(pack.tiktok.cta);
  if (!ok) throw new Error('JSON does not match the required shape');
} catch (err) {
  V('all', 'SCHEMA_INVALID', String(err.message || err));
  return [{ json: { passed: false, attempt, violations, maxAttempts: cfg.maxAttempts } }];
}

// ---------- assemble
const utm = (url, source, medium) => {
  const u = new URL(url);
  u.searchParams.set('utm_source', source);
  u.searchParams.set('utm_medium', medium);
  u.searchParams.set('utm_campaign', 'cm_engine');
  u.searchParams.set('utm_content', `n8n-${executionId}`);
  return u.toString();
};
const fill = (t, cta, page) => t.split('{{CTA}}').join(cta).split('{{SERVICE_PAGE}}').join(page);
const DISCLAIMER = '\n\n---\n\n*Cyber Mfukoni is an independent private consultancy. We are not affiliated '
  + 'with the Government of Kenya or any state agency. Every service listed here can also be accessed '
  + 'directly through the relevant government portal; our fee covers professional assistance in addition '
  + 'to any statutory charges.*';
const priceOk = f.priceKes !== null && !f.priceAmbiguous;

const serviceLd = {
  '@context': 'https://schema.org', '@type': 'Service', name: f.h1 || f.title, url: f.url,
  areaServed: { '@type': 'Country', name: 'Kenya' },
  provider: { '@type': 'Organization', name: 'Cyber Mfukoni', url: cfg.siteBase },
};
if (priceOk) serviceLd.offers = { '@type': 'Offer', price: String(f.priceKes), priceCurrency: 'KES', url: f.requestUrl };
const faqLd = {
  '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: pack.blog.faqs.map((q) => ({ '@type': 'Question', name: q.question,
    acceptedAnswer: { '@type': 'Answer', text: q.answer } })),
};
const hashtags = pack.instagram_hashtags.map((h) => '#' + String(h).replace(/^#/, '').replace(/\s+/g, '')).join(' ');
const content = {
  primary_keyword: pack.primary_keyword,
  blog: {
    title: pack.blog.title,
    slug: pack.blog.slug,
    canonical_url: `${cfg.siteBase}/blog/${pack.blog.slug}`,
    meta_description: pack.blog.meta_description,
    body_markdown: fill(pack.blog.body_markdown, utm(f.requestUrl, 'blog', 'owned'), utm(f.url, 'blog', 'owned')) + DISCLAIMER,
    faqs: pack.blog.faqs,
    jsonld: [serviceLd, faqLd],
    og_image: `${cfg.ogImageEndpoint}?title=${encodeURIComponent(pack.blog.title)}`,
  },
  facebook: {
    message: fill(pack.facebook_post, utm(f.requestUrl, 'facebook', 'social'), utm(f.url, 'facebook', 'social')),
    link: utm(f.requestUrl, 'facebook', 'social'),
  },
  x: { text: fill(pack.x_post, utm(f.requestUrl, 'x', 'social'), utm(f.url, 'x', 'social')) },
  instagram: {
    caption: `${fill(pack.instagram_caption, 'link in bio', 'link in bio')}\n\n${hashtags}`.trim(),
    image_url: `${cfg.ogImageEndpoint}?title=${encodeURIComponent(f.h1 || pack.blog.title)}`,
  },
  tiktok: pack.tiktok,
};

// ---------- compliance
const AMOUNT = /\b(?:KES|KSh|Kshs?)\.?\s*([\d,]+(?:\.\d{1,2})?)|\b([\d,]+)\s*(?:shillings|bob)\b/gi;
const DAYS = /\b(\d{1,3})\s*(?:working\s+|business\s+)?days?\b/gi;
const URLRX = /https?:\/\/[^\s)\]>"']+/gi;
const AG = '(?:kra|ntsa|ecitizen|e-citizen|government|gok|tsc|kuccps|helb|immigration|nrb|brs|sha|nssf|police|dci)';
const IMPERSONATION = [
  new RegExp(`\\bofficial\\s+${AG}\\b`, 'gi'),
  new RegExp(`\\b${AG}[- ](?:approved|accredited|certified|authori[sz]ed)\\b`, 'gi'),
  new RegExp(`\\b(?:approved|accredited|authori[sz]ed|licensed)\\s+(?:by|agents?\\s+of)\\s+(?:the\\s+)?${AG}\\b`, 'gi'),
  new RegExp(`\\bwe\\s+are\\s+(?:the\\s+)?${AG}\\b`, 'gi'),
  new RegExp(`\\bon\\s+behalf\\s+of\\s+(?:the\\s+)?${AG}\\b`, 'gi'),
  /\bguarantee(?:d|s)?\b/gi,
  /\b100\s*%\s*(?:approval|success|guaranteed)\b/gi,
  /\b(?:skip|jump|beat)\s+the\s+queue\b/gi,
];
const xWeighted = (t) => {
  const urls = t.match(URLRX) || [];
  let n = 23 * urls.length;
  for (const ch of t.replace(URLRX, '')) {
    const cp = ch.codePointAt(0);
    const light = cp <= 0x10ff || (cp >= 0x2000 && cp <= 0x200d) || (cp >= 0x2010 && cp <= 0x201f)
      || (cp >= 0x2032 && cp <= 0x2037);
    n += light ? 1 : 2;
  }
  return n;
};

const b = content.blog;
const texts = {
  blog: [b.title, b.meta_description, b.body_markdown, ...b.faqs.map((q) => `${q.question}\n${q.answer}`)].join('\n'),
  facebook: content.facebook.message,
  x: content.x.text,
  instagram: content.instagram.caption,
  tiktok: [content.tiktok.hook, ...content.tiktok.beats, ...content.tiktok.on_screen_text, content.tiktok.cta].join('\n'),
};
for (const [ch, t] of Object.entries(texts)) {
  for (const m of t.matchAll(AMOUNT)) {
    const amt = Math.round(parseFloat((m[1] || m[2]).replace(/,/g, '')));
    if (!(priceOk && amt === f.priceKes)) V(ch, 'FEE_MISMATCH', `'${m[0]}' not in catalog fee ${priceOk ? f.priceKes : 'none-allowed'}`);
  }
  for (const m of t.matchAll(DAYS)) {
    if (parseInt(m[1], 10) !== f.turnaroundDays) V(ch, 'TURNAROUND_MISMATCH', `'${m[0]}' not in catalog turnaround ${f.turnaroundDays ?? 'none-allowed'}`);
  }
  for (const rx of IMPERSONATION) for (const m of t.matchAll(rx)) V(ch, 'IMPERSONATION_OR_CLAIM', `'${m[0]}'`);
  for (const url of t.match(URLRX) || []) {
    let h = '';
    try { h = new URL(url).hostname.toLowerCase(); } catch (e) { /* invalid */ }
    if (!(h === 'cybermfukoni.co.ke' || h.endsWith('.cybermfukoni.co.ke') || h.endsWith('.go.ke'))) V(ch, 'DISALLOWED_LINK', url);
  }
  if (t.includes('{{') || t.includes('}}')) V(ch, 'UNFILLED_PLACEHOLDER', 'template token left in output');
}
if (b.title.length > 60) V('blog', 'TITLE_LENGTH', `${b.title.length} > 60`);
if (b.meta_description.length < 70 || b.meta_description.length > 160) V('blog', 'META_LENGTH', `${b.meta_description.length} not in [70, 160]`);
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(b.slug)) V('blog', 'SLUG_FORMAT', b.slug);
if ((f.blogSlugs || []).includes(b.slug)) V('blog', 'SLUG_COLLISION', b.slug);
const words = (b.body_markdown.match(/\w+/g) || []).length;
if (words < 600) V('blog', 'BODY_TOO_SHORT', `${words} < 600 words`);
const card = [['faqs', b.faqs.length, 3, 6, 'blog'], ['tiktok_beats', content.tiktok.beats.length, 3, 6, 'tiktok'],
  ['tiktok_on_screen_text', content.tiktok.on_screen_text.length, 3, 6, 'tiktok'],
  ['instagram_hashtags', pack.instagram_hashtags.length, 3, 8, 'instagram']];
for (const [label, n, lo, hi, ch] of card) if (n < lo || n > hi) V(ch, 'CARDINALITY', `${label}: ${n} not in [${lo}, ${hi}]`);
const xw = xWeighted(content.x.text);
if (xw > 280) V('x', 'X_LENGTH', `${xw} > 280 weighted chars`);
if (content.instagram.caption.length > 2200) V('instagram', 'IG_CAPTION_LENGTH', '> 2200');

return [{ json: { passed: violations.length === 0, attempt, maxAttempts: cfg.maxAttempts, violations, content } }];
