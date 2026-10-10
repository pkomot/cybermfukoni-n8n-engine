// Node: "Extract Facts" — deterministic facts from the target page (mirrors cm_agent/catalog.py).
// Price/turnaround come ONLY from the text between the H1 and the next h1-h4 heading,
// which keeps cross-sell prices (e.g. eCitizen setup) out.
const sel = $('Select Target').first().json;
const t = sel.target;
const html = String($('Fetch Service Page').first().json.data || '');

const decode = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&nbsp;/g, ' ');
const text = (s) => decode(s.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const h1m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
const titleM = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
const metaM = html.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i);
let block = '';
if (h1m) {
  const after = html.slice(h1m.index + h1m[0].length);
  const stop = after.search(/<h[1-4]\b/i);
  block = text(stop >= 0 ? after.slice(0, stop) : after).slice(0, 600);
}
const amounts = [...block.matchAll(/\b(?:KES|Kshs?\.?)\s*([\d,]+(?:\.\d{2})?)/gi)]
  .map((m) => Math.round(parseFloat(m[1].replace(/,/g, ''))));
const days = [...block.matchAll(/\b(\d{1,3})\s*(?:working\s+)?days?\b/gi)].map((m) => parseInt(m[1], 10));

let documents = [];
const docH = html.match(/<h[2-4]\b[^>]*>[^<]*(?:Require|Document)[^<]*<\/h[2-4]>([\s\S]*?)<\/(?:ul|ol)>/i);
if (docH) documents = [...docH[1].matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => text(m[1])).slice(0, 12);

let requestUrl = `https://app.cybermfukoni.co.ke/service-requests/create?agency=${t.agency}&service=${t.slug}`;
for (const m of html.matchAll(/href=["']([^"']*service-requests\/create[^"']*)["']/gi)) {
  const href = decode(m[1]);
  try { if (new URL(href).searchParams.get('service') === t.slug) { requestUrl = href; break; } } catch (e) { /* skip */ }
}

const priceAmbiguous = new Set(amounts).size > 1;
return [{
  json: {
    agency: t.agency,
    slug: t.slug,
    url: t.url,
    requestUrl,
    reasons: t.reasons,
    blogSlugs: sel.blogSlugs,
    h1: h1m ? text(h1m[1]) : '',
    title: titleM ? text(titleM[1]) : '',
    metaDescription: metaM ? decode(metaM[1]) : '',
    priceKes: amounts.length ? amounts[0] : null,
    priceAmbiguous,
    turnaroundDays: days.length ? days[0] : null,
    documents,
  },
}];
