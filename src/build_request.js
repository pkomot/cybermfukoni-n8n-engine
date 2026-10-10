// Node: "Build LLM Request" — first pass from Extract Facts; later passes receive the
// compliance output (violations) through the revision loop.
const cfg = $('Config').first().json;
const f = $('Extract Facts').first().json;
const incoming = $input.first().json;
const feedback = Array.isArray(incoming.violations) ? incoming.violations : [];
const attempt = (incoming.attempt || 0) + 1;

const system = `You are the content strategist for Cyber Mfukoni, an independent private
consultancy in Kenya that helps citizens and businesses complete government processes
(eCitizen, KRA, NTSA, BRS, TSC, KUCCPS and others) for a service fee.
Audience: Kenyans on mobile, often first-time portal users. Voice: clear Kenyan English;
social posts may use light, natural Sheng/Swahili phrases.

HARD RULES (violations are rejected automatically):
1. Fees and turnaround: state ONLY the values in FACTS, written exactly as "KES <amount>" and
   "<n> days". If FACTS gives null, mention no amount and no number of days. No statutory fees.
2. Never imply affiliation with, approval by, or acting on behalf of any government body.
   Never use "official", "guarantee", "100% approval", "skip the queue".
3. Links: only the placeholders {{CTA}} (request form) and {{SERVICE_PAGE}} (service page).
   Never write raw URLs. Instagram caption: no links, say "link in bio".
4. Do not invent requirements; use FACTS.documents or refer readers to the service page.
5. Blog: step-by-step guide, H2/H3 only, >= 600 words, 3-6 FAQs.

OUTPUT: a single JSON object and nothing else, exactly this shape:
{"primary_keyword": str,
 "blog": {"title": str (<=60 chars), "slug": str (lowercase-hyphenated, unique),
          "meta_description": str (70-160 chars), "body_markdown": str (uses {{SERVICE_PAGE}} once,
          ends with a call to action linking {{CTA}}), "faqs": [{"question": str, "answer": str}] (3-6)},
 "facebook_post": str (80-180 words, ends with {{CTA}}),
 "x_post": str (<= 250 chars including {{CTA}}),
 "instagram_caption": str (<= 1500 chars),
 "instagram_hashtags": [str] (3-8, no # prefix),
 "tiktok": {"hook": str, "beats": [str] (3-6), "on_screen_text": [str] (3-6), "cta": str}}`;

const facts = {
  service_name: f.h1 || f.title,
  agency_slug: f.agency,
  fee_kes: f.priceAmbiguous ? null : f.priceKes,
  turnaround_days: f.turnaroundDays,
  documents: f.documents,
  page_summary: f.metaDescription,
  existing_blog_slugs_to_avoid: f.blogSlugs.slice(0, 200),
};
let user = `FACTS:\n${JSON.stringify(facts, null, 2)}\n\nWHY THIS SERVICE NOW:\n` +
  ((f.reasons || []).map((r) => `- ${r}`).join('\n') || '- rotation');
if (feedback.length) {
  user += '\n\nYOUR PREVIOUS DRAFT WAS REJECTED BY THE COMPLIANCE GATE. Fix every item and change ' +
    'nothing else unnecessarily:\n' + feedback.map((v) => `- [${v.channel}] ${v.rule}: ${v.detail}`).join('\n');
}

return [{
  json: {
    attempt,
    body: {
      model: cfg.llmModel,
      max_tokens: 8000,
      temperature: 0.4,
      system,
      messages: [{ role: 'user', content: user }],
    },
  },
}];
