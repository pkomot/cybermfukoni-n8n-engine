# Blog ingestion contract

The engine publishes blog posts by calling a route you add to the Next.js site.
The site's CMS/data layer is not visible from outside, so persistence is yours to implement;
this document fixes the wire contract. The LangGraph engine (`pkomot/cybermfukoni-langgraph-engine`) uses the identical contract.

## Request

`POST {CM_BLOG_WEBHOOK_URL}`

| Header | Value |
|---|---|
| `Content-Type` | `application/json` |
| `X-CM-Timestamp` | Unix seconds |
| `X-CM-Signature` | `sha256=` + hex HMAC-SHA256 of `{timestamp}.{raw_body}` with the shared secret |
| `Idempotency-Key` | the post slug |

Body:

```json
{
  "slug": "good-conduct-certificate-guide",
  "title": "Certificate of Good Conduct in Kenya: Step-by-Step",
  "meta_description": "…",
  "body_markdown": "## Overview …",
  "faqs": [{"question": "…", "answer": "…"}],
  "jsonld": [{"@type": "Service", "…": "…"}, {"@type": "FAQPage", "…": "…"}],
  "og_image": "https://www.cybermfukoni.co.ke/api/og?title=…",
  "canonical_url": "https://www.cybermfukoni.co.ke/blog/good-conduct-certificate-guide"
}
```

## Receiver requirements

1. Reject if `|now - timestamp| > 300` s (replay window).
2. Recompute the HMAC over the **raw** body bytes; compare in constant time.
3. Treat `Idempotency-Key` as unique: a repeat returns the existing post with `200`.
4. Render each `jsonld` object in its own `<script type="application/ld+json">`.
5. Add the URL to `sitemap.xml` with a correct `lastmod`.
6. Respond `201` (or `200` on repeat) with `{"url": "<public url>"}`; any 4xx/5xx is recorded as a failed publish.

## Reference verifier (App Router)

```ts
// app/api/engine/posts/route.ts
import { createHmac, timingSafeEqual } from "node:crypto";

export async function POST(req: Request) {
  const ts = req.headers.get("x-cm-timestamp") ?? "";
  const sig = (req.headers.get("x-cm-signature") ?? "").replace(/^sha256=/, "");
  const raw = await req.text();
  if (!/^\d+$/.test(ts) || Math.abs(Date.now() / 1000 - Number(ts)) > 300)
    return new Response("stale", { status: 401 });
  const expected = createHmac("sha256", process.env.CM_BLOG_WEBHOOK_SECRET!)
    .update(`${ts}.${raw}`).digest("hex");
  const a = Buffer.from(sig, "hex"), b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b))
    return new Response("bad signature", { status: 401 });

  const post = JSON.parse(raw);
  // TODO: upsert `post` into your blog store keyed by post.slug, then revalidate the path.
  return Response.json({ url: post.canonical_url }, { status: 201 });
}
```
