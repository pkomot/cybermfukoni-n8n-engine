// Node: "Record Results" — end of the publish chain. Each publisher runs with
// "On Error: Continue", so its output is either the API response or { error }.
const store = $getWorkflowStaticData('global');
store.history = store.history || {};
store.log = store.log || [];
const review = $('Prepare Review').first().json;

const read = (name, pick) => {
  try {
    const item = $(name).first().json;
    if (item.error) return { status: 'failed', error: JSON.stringify(item.error).slice(0, 500) };
    return { status: 'published', ...pick(item) };
  } catch (e) {
    return { status: 'skipped' };               // node disabled or never reached
  }
};
const results = {
  blog: read('Publish Blog', (j) => ({ url: j.url || review.content.blog.canonical_url })),
  facebook: read('Publish Facebook', (j) => ({ id: j.id, url: j.id ? `https://www.facebook.com/${j.id}` : '' })),
  instagram: read('IG Publish', (j) => ({ id: j.id })),
  x: read('Publish X', (j) => ({ id: j.data && j.data.id, url: j.data ? `https://x.com/i/web/status/${j.data.id}` : '' })),
};
const ok = Object.values(results).filter((r) => r.status === 'published').length;
const attempted = Object.values(results).filter((r) => r.status !== 'skipped').length;
const status = attempted === 0 ? 'no_channels' : ok === attempted ? 'published' : ok ? 'partial' : 'failed';

if (ok > 0) store.history[review.slug] = new Date().toISOString();   // start cooldown
store.log.push({ executionId: $execution.id, slug: review.slug, status, results, at: new Date().toISOString() });
if (store.log.length > 500) store.log = store.log.slice(-500);

return [{ json: { status, slug: review.slug, results } }];
