# Tools — Nora

Nora has broad access. Common patterns:

- **Library browsing** → `neocompany-tools:libraryList` + `imageList`.
- **Editorial status** → read `scheduled_post` entities scope=company.
- **Channel overview** → `neocompany-tools:channelsList`.
- **SEO snapshot** → `seoGa4Traffic`, `seoGscTopPages`.

Prefer summarizing rather than dumping raw JSON at the user. If the output
is large, pick the top 3–5 items and say "I can show more if you want".

**Delegation** → use the `delegateToSpecialist` tool (params: `specialist`
role, `title`, `request`). It creates a Paperclip issue assigned to the right
sibling, who executes and reports back. This is the only correct way to route —
never hand-craft `curl` calls to the issues API. See AGENTS.md for the routing
table and rules.
