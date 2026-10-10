import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runNode } from './harness.mjs';

const CONFIG = runNode('config.js')[0].json;
const SVC = 'https://www.cybermfukoni.co.ke/government-agencies/kps-police-services/service/police-clearance-certificate-good-conduct';
const SITEMAP = `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc>https://www.cybermfukoni.co.ke/about</loc></url>
<url><loc>https://www.cybermfukoni.co.ke/government-agencies/kenya-revenue-authority/service/kra-nil-returns</loc></url>
<url><loc>${SVC}</loc></url>
<url><loc>https://www.cybermfukoni.co.ke/blog/how-to-create-an-ecitizen-account</loc></url>
<url><loc>https://www.cybermfukoni.co.ke/blog/category/tutorials</loc></url>
<url><loc>https://evil.example.com/government-agencies/a/service/b</loc></url></urlset>`;

const FACTS = {
  agency: 'kps-police-services', slug: 'police-clearance-certificate-good-conduct', url: SVC,
  requestUrl: 'https://app.cybermfukoni.co.ke/service-requests/create?agency=kps-police-services&service=police-clearance-certificate-good-conduct',
  reasons: ['no matching blog post'], blogSlugs: ['how-to-create-an-ecitizen-account'],
  h1: 'Police Clearance Certificate (Good Conduct)', title: '', metaDescription: '',
  priceKes: 1000, priceAmbiguous: false, turnaroundDays: 14, documents: ['ID Card'],
};

function pack({ fee = 'KES 1,000', days = '14 days', slug = 'good-conduct-certificate-guide', fb } = {}) {
  const filler = Array(60).fill('Prepare your ID card and eCitizen login before you begin the process.').join(' ');
  return {
    primary_keyword: 'certificate of good conduct',
    blog: {
      title: 'Certificate of Good Conduct in Kenya: Step-by-Step', slug,
      meta_description: 'How to apply for a Certificate of Good Conduct in Kenya: documents, steps and what to expect.',
      body_markdown: `## Overview\nWe process it for ${fee} and it takes about ${days}.\n\n## Steps\n${filler}\n\nSee {{SERVICE_PAGE}}.\n\n## Start\n{{CTA}}`,
      faqs: [0, 1, 2].map((i) => ({ question: `Q${i}?`, answer: `A${i}.` })),
    },
    facebook_post: fb ?? `Need a Good Conduct certificate? We handle it for ${fee}. Start: {{CTA}}`,
    x_post: `Good Conduct certificate sorted for ${fee}. {{CTA}}`,
    instagram_caption: 'Good Conduct certificate without the stress. Link in bio.',
    instagram_hashtags: ['GoodConduct', 'Kenya', 'eCitizen'],
    tiktok: { hook: 'Need a Good Conduct cert?', beats: ['a', 'b', 'c'], on_screen_text: ['1', '2', '3'], cta: 'Link in bio' },
  };
}
const llm = (obj) => ({ content: [{ type: 'text', text: 'Here you go:\n' + JSON.stringify(obj) }] });
const check = (resp, facts = FACTS, runIndex = 0) =>
  runNode('assemble_and_check.js', { nodes: { Config: CONFIG, 'Extract Facts': facts }, input: [resp], runIndex })[0].json;

test('select_target parses sitemap, ranks, honours cooldown', () => {
  const nodes = { Config: CONFIG, 'Fetch Sitemap': { data: SITEMAP }, 'GSC Page Stats': { error: { message: 'no creds' } } };
  const r = runNode('select_target.js', { nodes })[0].json;
  assert.equal(r.noCandidate, false);
  assert.deepEqual(r.blogSlugs, ['how-to-create-an-ecitizen-account']);
  assert.equal(r.runnersUp.length + 1, 2);                 // evil.example.com excluded
  const staticData = { history: { 'kra-nil-returns': new Date().toISOString(),
    'police-clearance-certificate-good-conduct': new Date().toISOString() } };
  assert.equal(runNode('select_target.js', { nodes, staticData })[0].json.noCandidate, true);
});

test('select_target uses GSC striking distance', () => {
  const nodes = { Config: CONFIG, 'Fetch Sitemap': { data: SITEMAP },
    'GSC Page Stats': { rows: [{ keys: [SVC], impressions: 900, clicks: 9, ctr: 0.01, position: 8.2 }] } };
  const r = runNode('select_target.js', { nodes })[0].json;
  assert.equal(r.target.slug, 'police-clearance-certificate-good-conduct');
  assert.ok(r.target.reasons.some((x) => x.startsWith('gsc:')));
});

test('extract_facts reads the H1 card only', () => {
  const html = readFileSync(new URL('./fixtures/service_page.html', import.meta.url), 'utf8');
  const sel = { target: { url: SVC, agency: FACTS.agency, slug: FACTS.slug, reasons: [] }, blogSlugs: [] };
  const f = runNode('extract_facts.js', { nodes: { 'Select Target': sel, 'Fetch Service Page': { data: html } } })[0].json;
  assert.equal(f.priceKes, 1000);
  assert.equal(f.priceAmbiguous, false);
  assert.equal(f.turnaroundDays, 14);
  assert.deepEqual(f.documents.slice(0, 2), ['ID Card', 'eCitizen Account']);
  assert.ok(f.requestUrl.endsWith('service=police-clearance-certificate-good-conduct'));
});

test('build_request carries violations into the revision prompt', () => {
  const first = runNode('build_request.js', { nodes: { Config: CONFIG, 'Extract Facts': FACTS }, input: [FACTS] })[0].json;
  assert.equal(first.attempt, 1);
  assert.equal(first.body.model, 'claude-sonnet-5-5');
  const v = [{ channel: 'x', rule: 'FEE_MISMATCH', detail: "'KES 9'" }];
  const second = runNode('build_request.js', { nodes: { Config: CONFIG, 'Extract Facts': FACTS }, input: [{ attempt: 1, violations: v }] })[0].json;
  assert.equal(second.attempt, 2);
  assert.match(second.body.messages[0].content, /\[x\] FEE_MISMATCH/);
});

test('clean pack passes; links tracked; disclaimer and offer present', () => {
  const r = check(llm(pack()));
  assert.deepEqual(r.violations, []);
  assert.equal(r.passed, true);
  assert.match(r.content.facebook.message, /utm_source=facebook/);
  assert.match(r.content.blog.body_markdown, /independent private consultancy/);
  assert.equal(r.content.blog.jsonld[0].offers.price, '1000');
});

test('fee, turnaround, impersonation, link and slug violations', () => {
  const r = check(llm(pack({ fee: 'KSh 1,200', days: '3 working days', slug: 'how-to-create-an-ecitizen-account',
    fb: 'We are the official KRA partner, guaranteed! https://bit.ly/x {{CTA}}' })));
  const rules = new Set(r.violations.map((v) => v.rule));
  for (const x of ['FEE_MISMATCH', 'TURNAROUND_MISMATCH', 'IMPERSONATION_OR_CLAIM', 'DISALLOWED_LINK', 'SLUG_COLLISION']) {
    assert.ok(rules.has(x), x);
  }
  assert.equal(r.passed, false);
});

test('ambiguous price forbids amounts and drops offer', () => {
  const r = check(llm(pack()), { ...FACTS, priceAmbiguous: true });
  assert.ok(r.violations.some((v) => v.rule === 'FEE_MISMATCH'));
  assert.equal(r.content.blog.jsonld[0].offers, undefined);
});

test('malformed LLM output becomes a SCHEMA_INVALID violation with attempt count', () => {
  const r = check({ content: [{ type: 'text', text: 'sorry, no json' }] }, FACTS, 1);
  assert.equal(r.passed, false);
  assert.equal(r.attempt, 2);
  assert.equal(r.violations[0].rule, 'SCHEMA_INVALID');
});

test('prepare_review + verify_decision: one-time token round trip', () => {
  const comp = check(llm(pack()));
  const review = runNode('prepare_review.js', { nodes: { 'Extract Facts': FACTS }, input: [comp] })[0].json;
  assert.match(review.approveUrl, /^https:\/\/n8n\.example\/webhook-waiting\/42\?d=approve&t=[0-9a-f]{48}$/);
  const verify = (query) => runNode('verify_decision.js', { nodes: { 'Prepare Review': review }, input: [query ? { query } : {}] })[0].json.decision;
  assert.equal(verify({ d: 'approve', t: review.token }), 'approve');
  assert.equal(verify({ d: 'reject', t: review.token }), 'reject');
  assert.equal(verify({ d: 'approve', t: 'f'.repeat(48) }), 'invalid');
  assert.equal(verify({ d: 'approve' }), 'invalid');
  assert.equal(verify(null), 'expired');
});

test('sign_blog produces a verifiable HMAC', () => {
  const review = { content: check(llm(pack())).content };
  const out = runNode('sign_blog.js', { nodes: { 'Prepare Review': review }, env: { CM_BLOG_WEBHOOK_SECRET: 's3cret' } })[0].json;
  const expected = createHmac('sha256', 's3cret').update(`${out.ts}.${out.body}`).digest('hex');
  assert.equal(out.signature, `sha256=${expected}`);
  assert.throws(() => runNode('sign_blog.js', { nodes: { 'Prepare Review': review } }), /CM_BLOG_WEBHOOK_SECRET/);
});

test('record_results: partial publish, skipped channel, cooldown only on success', () => {
  const staticData = {};
  const review = { slug: FACTS.slug, content: check(llm(pack())).content };
  const r = runNode('record_results.js', { staticData, nodes: {
    'Prepare Review': review, 'Publish Blog': { url: 'https://www.cybermfukoni.co.ke/blog/x' },
    'Publish Facebook': { error: { message: 'token expired' } }, 'Publish X': { data: { id: '1' } },
  } })[0].json;
  assert.equal(r.status, 'partial');
  assert.equal(r.results.instagram.status, 'skipped');
  assert.equal(r.results.facebook.status, 'failed');
  assert.ok(staticData.history[FACTS.slug]);
  assert.equal(staticData.log.length, 1);
});

test('record_outcome logs reject and blocked without cooldown', () => {
  const staticData = {};
  runNode('record_outcome.js', { staticData, nodes: { 'Extract Facts': FACTS }, input: [{ decision: 'reject' }] });
  runNode('record_outcome.js', { staticData, input: [{ ok: true }],
    nodes: { 'Extract Facts': FACTS, 'Blocked Message': { violations: [{ rule: 'X' }] } } });
  assert.deepEqual(staticData.log.map((e) => e.status), ['reject', 'blocked']);
  assert.equal(staticData.history, undefined);
});
