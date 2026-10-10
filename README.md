# cybermfukoni-n8n-engine

Importable n8n workflow that markets [cybermfukoni.co.ke](https://www.cybermfukoni.co.ke) on a
weekday schedule. It ranks services, generates a blog guide plus social posts with Claude, enforces
deterministic compliance with an LLM revision loop, waits for Telegram approval, then publishes.

Companion implementation: [`pkomot/cybermfukoni-langgraph-engine`](https://github.com/pkomot/cybermfukoni-langgraph-engine).
Both share the same ranking formula, compliance rules and blog ingestion contract.

## Flow

```
Weekday 07:45 EAT → Config → Fetch Sitemap → GSC Page Stats (optional) → Select Target → Has Target?
  → Fetch Service Page → Extract Facts → Build LLM Request → Anthropic Messages → Assemble + Compliance → Passed?
       ├ no  → Retry? ── yes → Build LLM Request (violations fed back; max 3 attempts)
       │               └ no  → Blocked Message → Telegram Blocked → Record Outcome
       └ yes → Prepare Review → Telegram Review (Approve / Reject links) → Wait for Decision (48 h)
                → Verify Decision → Approved?
                     ├ yes → [Blog] → [Facebook] → [Instagram: container → 15 s → publish] → [X]
                     │         → Record Results → Telegram Summary
                     └ no  → Invalid Token? ── yes → Wait for Decision
                                            └ no (reject/expired) → Record Outcome
```

## Repository layout

| Path | Purpose |
|---|---|
| `src/*.js` | Code-node bodies: the only place logic is edited |
| `build.py` | Generates `workflows/cybermfukoni_content_engine.json` from `src/` (stable node ids) |
| `workflows/` | Import this file into n8n |
| `tests/` | `node:test` suite running each Code node in a mocked n8n runtime (12 tests) |
| `docs/blog-ingestion-contract.md` | Contract for the Next.js route that receives posts |

```bash
npm run build   # regenerate workflow JSON after editing src/
npm test        # unit tests
npm run check   # build + fail if JSON drifted + tests (same as CI)
```

## Setup

**1. n8n instance environment**

| Variable | Value | Why |
|---|---|---|
| `WEBHOOK_URL` | public HTTPS base of your n8n | Approve/Reject links resolve to `$execution.resumeUrl` |
| `NODE_FUNCTION_ALLOW_BUILTIN` | `crypto` | Approval tokens, constant-time compare, blog HMAC |
| `CM_BLOG_WEBHOOK_SECRET` | shared HMAC secret | Read by `Sign Blog Payload` via `$env` |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE` | `false` | Only if your version blocks `$env` in Code nodes by default |
| `GENERIC_TIMEZONE` | `Africa/Nairobi` | Schedule is also pinned in workflow settings |

**2. Import** `workflows/cybermfukoni_content_engine.json`, open **Config** and replace `facebookPageId`,
`instagramUserId` and `telegramReviewerChatId`.

**3. Credentials** (names pre-filled on the nodes; select the matching credential on each):

| Credential | Type | Nodes |
|---|---|---|
| Anthropic x-api-key | Header Auth (`x-api-key: <key>`) | Anthropic Messages |
| Telegram reviewer bot | Telegram API | Telegram Review / Blocked / Summary |
| Facebook Page token | Facebook Graph API (long-lived Page token) | Publish Facebook, IG Create Container, IG Publish |
| X OAuth2 (tweet.write) | X OAuth2 API | Publish X |
| Google Search Console | OAuth2 (scope `webmasters.readonly`) | GSC Page Stats; optional, the run continues without it |

**4. First run:** set `channels: []` in Config, run once from the editor to verify generation and compliance,
then restore the channels and **activate** the workflow.

## Behaviour notes

- **Cooldown and audit log live in workflow static data.** n8n persists static data only for
  trigger-started (active) executions, not manual editor runs.
- **Turning off a channel:** remove it from `Config.channels`. Disabling a publisher node instead makes n8n
  pass the previous node's data through, and `Record Results` would misattribute it.
- **Publishers continue on error**, so one failing channel does not block the rest; failures appear in
  the Telegram summary and the log.
- **Instagram accepts JPEG only.** `ogImageEndpoint` must return `image/jpeg`.
- **Approval links are one-time and unguessable** (192-bit token, constant-time check). A wrong token
  re-arms the wait; no click within 48 h records `expired`.
- **No in-flow editing.** Reject and the service stays eligible for the next run. Edit-before-approve is
  supported in the LangGraph engine.

## Parity with the LangGraph engine

| Capability | n8n | LangGraph |
|---|---|---|
| Ranking (GSC + seasonal + coverage gap, cooldown) | ✓ | ✓ |
| Deterministic compliance + revision loop | ✓ | ✓ |
| Structured output enforcement | Prompted JSON + shape validation | Native JSON-schema output |
| Approve / reject | ✓ Telegram links | ✓ Telegram buttons + REST |
| Edit before publish | ✗ | ✓ |
| Publish idempotency | Per execution | Ledger rows per thread × channel |
| Ledger | Static data (last 500 runs) | SQL table |

## Verification status

- The Code-node logic is unit-tested (12 tests), and the graph wiring is checked for dangling connections.
- The workflow has **not yet been imported into a live n8n instance** from this repo. Node parameter shapes
  target n8n 1.x: HTTP Request v4.2, Telegram v1.2, Wait v1.1, IF v1, Code v2. After import, open each
  Telegram and HTTP node once to confirm the fields resolved.
