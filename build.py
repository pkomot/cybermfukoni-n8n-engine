#!/usr/bin/env python3
"""Assemble workflows/cybermfukoni_content_engine.json from src/*.js.

Code-node bodies live in src/ so they can be linted and unit-tested with Node;
this script is the only writer of the workflow JSON. Run after editing src/.
"""
from __future__ import annotations

import json
import uuid
from pathlib import Path

ROOT = Path(__file__).parent
SRC = ROOT / "src"
OUT = ROOT / "workflows" / "cybermfukoni_content_engine.json"
NS = uuid.UUID("6c1d7f0e-3a52-4c5e-9b8e-0c7a1f2d9e41")   # stable node ids across rebuilds

RETRY = {"retryOnFail": True, "maxTries": 3, "waitBetweenTries": 5000}
CONTINUE = {"onError": "continueRegularOutput"}
CFG = "$('Config').first().json"
REVIEW = "$('Prepare Review').first().json"

nodes: list[dict] = []
connections: dict[str, dict] = {}


def node(name, type_, version, params, pos, **extra):
    nodes.append({
        "parameters": params, "id": str(uuid.uuid5(NS, name)), "name": name,
        "type": type_, "typeVersion": version, "position": list(pos), **extra,
    })
    return name


def code(name, file, pos, **extra):
    return node(name, "n8n-nodes-base.code", 2, {"jsCode": (SRC / file).read_text()}, pos, **extra)


def http(name, pos, params, **extra):
    return node(name, "n8n-nodes-base.httpRequest", 4.2, params, pos, **extra)


def if_bool(name, expr, pos):
    return node(name, "n8n-nodes-base.if", 1,
                {"conditions": {"boolean": [{"value1": f"={{{{ {expr} }}}}", "value2": True}]}}, pos)


def link(src, dst, out=0):
    outs = connections.setdefault(src, {"main": []})["main"]
    while len(outs) <= out:
        outs.append([])
    outs[out].append({"node": dst, "type": "main", "index": 0})


def telegram(name, text_expr, pos, keyboard=None):
    params = {
        "chatId": f"={{{{ {CFG}.telegramReviewerChatId }}}}",
        "text": f"={{{{ {text_expr} }}}}",
        "additionalFields": {"parse_mode": "HTML", "disable_web_page_preview": True,
                             "appendAttribution": False},
    }
    if keyboard:
        params["replyMarkup"] = "inlineKeyboard"
        params["inlineKeyboard"] = {"rows": [{"row": {"buttons": [
            {"text": t, "additionalFields": {"url": f"={{{{ {u} }}}}"}} for t, u in keyboard
        ]}}]}
    return node(name, "n8n-nodes-base.telegram", 1.2, params, pos,
                credentials={"telegramApi": {"id": "", "name": "Telegram reviewer bot"}}, **RETRY)


# ---------------------------------------------------------------- discovery
node("Weekday 07:45 EAT", "n8n-nodes-base.scheduleTrigger", 1.2,
     {"rule": {"interval": [{"field": "cronExpression", "expression": "45 7 * * 1-5"}]}}, (0, 300))
code("Config", "config.js", (220, 300))
http("Fetch Sitemap", (440, 300), {
    "url": f"={{{{ {CFG}.sitemapUrl }}}}",
    "options": {"response": {"response": {"responseFormat": "text"}}, "timeout": 30000},
}, **RETRY)
http("GSC Page Stats", (660, 300), {
    "method": "POST",
    "url": f"=https://www.googleapis.com/webmasters/v3/sites/{{{{ encodeURIComponent({CFG}.gscProperty) }}}}/searchAnalytics/query",
    "authentication": "genericCredentialType",
    "genericAuthType": "oAuth2Api",
    "sendBody": True,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({ startDate: new Date(Date.now() - 31*864e5).toISOString().slice(0,10), "
                "endDate: new Date(Date.now() - 3*864e5).toISOString().slice(0,10), dimensions: ['page'], rowLimit: 25000 }) }}",
    "options": {"timeout": 30000},
}, credentials={"oAuth2Api": {"id": "", "name": "Google Search Console (webmasters.readonly)"}},
   alwaysOutputData=True, **CONTINUE)
code("Select Target", "select_target.js", (880, 300))
if_bool("Has Target?", "!$json.noCandidate", (1100, 300))
http("Fetch Service Page", (1320, 280), {
    "url": "={{ $json.target.url }}",
    "options": {"response": {"response": {"responseFormat": "text"}}, "timeout": 30000},
}, **RETRY)
code("Extract Facts", "extract_facts.js", (1540, 280))

# ------------------------------------------------------- generate + gate
code("Build LLM Request", "build_request.js", (1760, 280))
http("Anthropic Messages", (1980, 280), {
    "method": "POST",
    "url": "https://api.anthropic.com/v1/messages",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendHeaders": True,
    "headerParameters": {"parameters": [{"name": "anthropic-version", "value": "2023-06-01"}]},
    "sendBody": True,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify($json.body) }}",
    "options": {"timeout": 180000},
}, credentials={"httpHeaderAuth": {"id": "", "name": "Anthropic x-api-key"}}, **RETRY, **CONTINUE)
code("Assemble + Compliance", "assemble_and_check.js", (2200, 280))
if_bool("Passed?", "$json.passed", (2420, 280))
node("Retry?", "n8n-nodes-base.if", 1, {"conditions": {"number": [{
    "value1": "={{ $json.attempt }}", "operation": "smaller", "value2": "={{ $json.maxAttempts }}"}]}},
     (2640, 480))
code("Blocked Message", "blocked_message.js", (2860, 560))
telegram("Telegram Blocked", "$json.text", (3080, 560))
code("Record Outcome", "record_outcome.js", (4180, 620))

# ---------------------------------------------------------- human review
code("Prepare Review", "prepare_review.js", (2640, 200))
telegram("Telegram Review", "$json.text", (2860, 200),
         keyboard=[("✅ Approve", "$json.approveUrl"), ("❌ Reject", "$json.rejectUrl")])
node("Wait for Decision", "n8n-nodes-base.wait", 1.1, {
    "resume": "webhook", "httpMethod": "GET", "limitWait": True, "limitType": "afterTimeInterval",
    "resumeAmount": 48, "resumeUnit": "hours", "options": {},
}, (3080, 200), webhookId=str(uuid.uuid5(NS, "wait-for-decision")))
code("Verify Decision", "verify_decision.js", (3300, 200))
node("Approved?", "n8n-nodes-base.if", 1,
     {"conditions": {"string": [{"value1": "={{ $json.decision }}", "value2": "approve"}]}}, (3520, 200))
node("Invalid Token?", "n8n-nodes-base.if", 1,
     {"conditions": {"string": [{"value1": "={{ $json.decision }}", "value2": "invalid"}]}}, (3740, 400))

# ------------------------------------------------------------- publish chain
if_bool("Blog Enabled?", f"{CFG}.channels.includes('blog')", (3740, 100))
code("Sign Blog Payload", "sign_blog.js", (3960, 0))
http("Publish Blog", (4180, 0), {
    "method": "POST",
    "url": f"={{{{ {CFG}.blogWebhookUrl }}}}",
    "sendHeaders": True,
    "headerParameters": {"parameters": [
        {"name": "X-CM-Timestamp", "value": "={{ $json.ts }}"},
        {"name": "X-CM-Signature", "value": "={{ $json.signature }}"},
        {"name": "Idempotency-Key", "value": "={{ $json.slug }}"},
    ]},
    "sendBody": True, "contentType": "raw", "rawContentType": "application/json",
    "body": "={{ $json.body }}",
    "options": {"timeout": 30000},
}, **CONTINUE)

if_bool("Facebook Enabled?", f"{CFG}.channels.includes('facebook')", (4400, 100))
http("Publish Facebook", (4620, 0), {
    "method": "POST",
    "url": f"=https://graph.facebook.com/{{{{ {CFG}.metaGraphVersion }}}}/{{{{ {CFG}.facebookPageId }}}}/feed",
    "authentication": "predefinedCredentialType", "nodeCredentialType": "facebookGraphApi",
    "sendBody": True, "contentType": "form-urlencoded",
    "bodyParameters": {"parameters": [
        {"name": "message", "value": f"={{{{ {REVIEW}.content.facebook.message }}}}"},
        {"name": "link", "value": f"={{{{ {REVIEW}.content.facebook.link }}}}"},
    ]},
    "options": {"timeout": 30000},
}, credentials={"facebookGraphApi": {"id": "", "name": "Facebook Page token"}}, **CONTINUE)

if_bool("Instagram Enabled?", f"{CFG}.channels.includes('instagram')", (4840, 100))
http("IG Create Container", (5060, 0), {
    "method": "POST",
    "url": f"=https://graph.facebook.com/{{{{ {CFG}.metaGraphVersion }}}}/{{{{ {CFG}.instagramUserId }}}}/media",
    "authentication": "predefinedCredentialType", "nodeCredentialType": "facebookGraphApi",
    "sendBody": True, "contentType": "form-urlencoded",
    "bodyParameters": {"parameters": [
        {"name": "image_url", "value": f"={{{{ {REVIEW}.content.instagram.image_url }}}}"},
        {"name": "caption", "value": f"={{{{ {REVIEW}.content.instagram.caption }}}}"},
    ]},
    "options": {"timeout": 30000},
}, credentials={"facebookGraphApi": {"id": "", "name": "Facebook Page token"}}, **CONTINUE)
node("IG Processing Delay", "n8n-nodes-base.wait", 1.1, {"amount": 15, "unit": "seconds"}, (5280, 0),
     webhookId=str(uuid.uuid5(NS, "ig-delay")))
http("IG Publish", (5500, 0), {
    "method": "POST",
    "url": f"=https://graph.facebook.com/{{{{ {CFG}.metaGraphVersion }}}}/{{{{ {CFG}.instagramUserId }}}}/media_publish",
    "authentication": "predefinedCredentialType", "nodeCredentialType": "facebookGraphApi",
    "sendBody": True, "contentType": "form-urlencoded",
    "bodyParameters": {"parameters": [
        {"name": "creation_id", "value": "={{ $('IG Create Container').first().json.id }}"},
    ]},
    "options": {"timeout": 30000},
}, credentials={"facebookGraphApi": {"id": "", "name": "Facebook Page token"}}, **CONTINUE)

if_bool("X Enabled?", f"{CFG}.channels.includes('x')", (5720, 100))
http("Publish X", (5940, 0), {
    "method": "POST",
    "url": "https://api.x.com/2/tweets",
    "authentication": "predefinedCredentialType", "nodeCredentialType": "twitterOAuth2Api",
    "sendBody": True, "specifyBody": "json",
    "jsonBody": f"={{{{ JSON.stringify({{ text: {REVIEW}.content.x.text }}) }}}}",
    "options": {"timeout": 30000},
}, credentials={"twitterOAuth2Api": {"id": "", "name": "X OAuth2 (tweet.write)"}}, **CONTINUE)
code("Record Results", "record_results.js", (6160, 100))
telegram("Telegram Summary",
         "`<b>${$json.status.toUpperCase()}</b>: ${$json.slug}\\n` + Object.entries($json.results)"
         ".map(([k, v]) => `${k}: ${v.status}${v.url ? ' ' + v.url : ''}${v.error ? ' — ' + v.error.slice(0, 120) : ''}`).join('\\n')",
         (6380, 100))

# ----------------------------------------------------------------- wiring
for a, b in [("Weekday 07:45 EAT", "Config"), ("Config", "Fetch Sitemap"), ("Fetch Sitemap", "GSC Page Stats"),
             ("GSC Page Stats", "Select Target"), ("Select Target", "Has Target?"),
             ("Fetch Service Page", "Extract Facts"), ("Extract Facts", "Build LLM Request"),
             ("Build LLM Request", "Anthropic Messages"), ("Anthropic Messages", "Assemble + Compliance"),
             ("Assemble + Compliance", "Passed?"), ("Blocked Message", "Telegram Blocked"),
             ("Telegram Blocked", "Record Outcome"), ("Prepare Review", "Telegram Review"),
             ("Telegram Review", "Wait for Decision"), ("Wait for Decision", "Verify Decision"),
             ("Verify Decision", "Approved?"), ("Sign Blog Payload", "Publish Blog"),
             ("Publish Blog", "Facebook Enabled?"), ("Publish Facebook", "Instagram Enabled?"),
             ("IG Create Container", "IG Processing Delay"), ("IG Processing Delay", "IG Publish"),
             ("IG Publish", "X Enabled?"), ("Publish X", "Record Results"),
             ("Record Results", "Telegram Summary")]:
    link(a, b)
link("Has Target?", "Fetch Service Page", 0)
link("Passed?", "Prepare Review", 0)
link("Passed?", "Retry?", 1)
link("Retry?", "Build LLM Request", 0)        # revision loop with violations as feedback
link("Retry?", "Blocked Message", 1)
link("Approved?", "Blog Enabled?", 0)
link("Approved?", "Invalid Token?", 1)
link("Invalid Token?", "Wait for Decision", 0)  # bad token: wait again
link("Invalid Token?", "Record Outcome", 1)     # reject / expired
for gate, target, nxt in [("Blog Enabled?", "Sign Blog Payload", "Facebook Enabled?"),
                          ("Facebook Enabled?", "Publish Facebook", "Instagram Enabled?"),
                          ("Instagram Enabled?", "IG Create Container", "X Enabled?"),
                          ("X Enabled?", "Publish X", "Record Results")]:
    link(gate, target, 0)
    link(gate, nxt, 1)

workflow = {
    "name": "Cyber Mfukoni — Content Engine",
    "nodes": nodes,
    "connections": connections,
    "settings": {"executionOrder": "v1", "timezone": "Africa/Nairobi", "saveManualExecutions": True,
                 "saveDataSuccessExecution": "all", "saveDataErrorExecution": "all"},
    "pinData": {},
    "active": False,
    "meta": {"templateCredsSetupCompleted": False},
}

if __name__ == "__main__":
    OUT.parent.mkdir(exist_ok=True)
    OUT.write_text(json.dumps(workflow, indent=2, ensure_ascii=False) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}: {len(nodes)} nodes")
