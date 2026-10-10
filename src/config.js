// Node: "Config" — edit these values after import. Secrets live in n8n credentials, not here.
return [{
  json: {
    siteBase: 'https://www.cybermfukoni.co.ke',
    sitemapUrl: 'https://www.cybermfukoni.co.ke/sitemap.xml',
    ogImageEndpoint: 'https://www.cybermfukoni.co.ke/api/og',   // must return image/jpeg for Instagram
    blogWebhookUrl: 'https://www.cybermfukoni.co.ke/api/engine/posts',
    facebookPageId: 'REPLACE_PAGE_ID',
    instagramUserId: 'REPLACE_IG_USER_ID',
    metaGraphVersion: 'v23.0',
    telegramReviewerChatId: 'REPLACE_CHAT_ID',
    gscProperty: 'sc-domain:cybermfukoni.co.ke',
    channels: ['blog', 'facebook', 'instagram', 'x'],   // remove one to skip it (do not disable nodes)
    llmModel: 'claude-sonnet-5-5',
    maxAttempts: 3,          // 1 generation + 2 compliance-driven revisions
    cooldownDays: 30,
    // Verified windows only. MM-DD inclusive; may wrap the year end.
    seasonal: [
      { name: 'KRA individual income tax returns (deadline 30 June)', start: '05-15', end: '06-30',
        tokens: ['kra', 'returns', 'tax', 'itax', 'nil', 'p9'], boost: 1 },
    ],
  },
}];
