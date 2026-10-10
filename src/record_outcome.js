// Node: "Record Outcome" — rejected / expired / blocked runs. No cooldown is applied,
// so the service stays eligible; the log keeps the reason for audit.
// Decision path: $input is the Verify Decision item. Blocked path: $input is the Telegram response.
const store = $getWorkflowStaticData('global');
store.log = store.log || [];
const f = $('Extract Facts').first().json;
const j = $input.first().json;
const entry = { executionId: $execution.id, slug: f.slug, status: j.decision || 'blocked', at: new Date().toISOString() };
if (!j.decision) entry.violations = $('Blocked Message').first().json.violations;
store.log.push(entry);
if (store.log.length > 500) store.log = store.log.slice(-500);
return [{ json: entry }];
