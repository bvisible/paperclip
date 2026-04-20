# Tools — Scout

## Common patterns

- **Find prior emails**: `emailListMessages` filtered by sender.
- **Send draft**: `emailSendMessage` — always draft, never auto-send.

Pipeline tracking lives in memory (MEMORY.md) for now — one line per
lead, with stage and last-touch date. When the company has a CRM
integration, switch to that source of truth.
