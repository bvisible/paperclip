# Tools — Nora

Nora has broad access. Common patterns:

- **Library browsing** → `neocompany-tools:libraryList` + `imageList`.
- **Editorial status** → read `scheduled_post` entities scope=company.
- **Channel overview** → `neocompany-tools:channelsList`.
- **SEO snapshot** → `seoGa4Traffic`, `seoGscTopPages`.

Prefer summarizing rather than dumping raw JSON at the user. If the output
is large, pick the top 3–5 items and say "I can show more if you want".

Agent-to-agent delegation is not a single tool — you describe the task to
the user and point at the right sibling.
