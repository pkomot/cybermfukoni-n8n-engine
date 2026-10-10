// Node: "Select Target" — rank services from the live sitemap (mirrors cm_agent/demand.py).
// score = 0.45*GSC striking-distance + 0.30*seasonal + 0.25*coverage gap; cooldown via static data.
const cfg = $('Config').first().json;
const xml = String($('Fetch Sitemap').first().json.data || '');
let gscRows = [];
try { gscRows = $('GSC Page Stats').first().json.rows || []; } catch (e) { gscRows = []; }

const host = new URL(cfg.siteBase).host;
const SERVICE = /^\/government-agencies\/([^/]+)\/service\/([^/]+)\/?$/;
const BLOG = /^\/blog\/((?!category\/)[^/]+)\/?$/;
const services = [];
const blogSlugs = [];
for (const m of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)) {
  let u;
  try { u = new URL(m[1]); } catch (e) { continue; }
  if (u.host !== host) continue;
  const s = u.pathname.match(SERVICE);
  if (s) { services.push({ url: u.href, agency: s[1], slug: s[2] }); continue; }
  const b = u.pathname.match(BLOG);
  if (b) blogSlugs.push(b[1]);
}
if (!services.length) throw new Error('Sitemap returned no service URLs');

const tokens = (slug) => new Set(slug.toLowerCase().split(/[-_]/).filter((t) => t.length > 2));
const jaccard = (a, b) => {
  const inter = [...a].filter((x) => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union ? inter / union : 0;
};

// Today in EAT (Africa/Nairobi, UTC+3, no DST).
const nowEat = new Date(Date.now() + 3 * 3600 * 1000);
const mmdd = (d) => [d.getUTCMonth() + 1, d.getUTCDate()];
const [tm, td] = mmdd(nowEat);
const inWindow = (start, end) => {
  const v = tm * 100 + td;
  const [sm, sd] = start.split('-').map(Number);
  const [em, ed] = end.split('-').map(Number);
  const s = sm * 100 + sd, e = em * 100 + ed;
  return s <= e ? v >= s && v <= e : v >= s || v <= e;
};

const gsc = {};
for (const r of gscRows) gsc[r.keys[0]] = r;
const gscRaw = (r) => (r ? r.impressions * (r.position >= 4 && r.position <= 20 ? 1 : 0.25) : 0);

const store = $getWorkflowStaticData('global');
store.history = store.history || {};
const cutoff = Date.now() - cfg.cooldownDays * 86400 * 1000;

const rows = services.filter((s) => !(store.history[s.slug] && Date.parse(store.history[s.slug]) >= cutoff));
const maxG = Math.max(0, ...rows.map((s) => gscRaw(gsc[s.url]))) || 1;
const blogTok = blogSlugs.map(tokens);

const ranked = rows.map((s) => {
  const t = tokens(s.slug);
  const g = gscRaw(gsc[s.url]) / maxG;
  let seasonal = 0;
  const reasons = [];
  for (const ev of cfg.seasonal) {
    if (inWindow(ev.start, ev.end) && ev.tokens.some((x) => t.has(x)) && ev.boost > seasonal) {
      seasonal = Math.min(ev.boost, 1);
      reasons.push(`seasonal: ${ev.name}`);
    }
  }
  const gap = t.size ? 1 - Math.max(0, ...blogTok.map((b) => jaccard(t, b))) : 0;
  if (g > 0) {
    const r = gsc[s.url];
    reasons.push(`gsc: ${Math.round(r.impressions)} impr, pos ${r.position.toFixed(1)}, ctr ${(r.ctr * 100).toFixed(2)}%`);
  }
  if (gap >= 0.8) reasons.push('no matching blog post');
  return { ...s, score: +(0.45 * g + 0.3 * seasonal + 0.25 * gap).toFixed(4), reasons };
}).sort((a, b) => b.score - a.score || a.slug.localeCompare(b.slug));

if (!ranked.length) return [{ json: { noCandidate: true, reason: 'all services in cooldown' } }];
return [{ json: { noCandidate: false, target: ranked[0], runnersUp: ranked.slice(1, 5), blogSlugs } }];
