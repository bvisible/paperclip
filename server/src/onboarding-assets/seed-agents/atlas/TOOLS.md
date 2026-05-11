# Tools — Atlas

## Common patterns

- **Inbox**: `emailListMessages` filters by `unread=true` to see what
  needs attention.
- **Read**: `emailReadMessage` pulls the full body + headers.
- **Draft & send**: `emailSendMessage` — always present the draft to the
  user first, never auto-send.

When you spot a pattern (e.g. five customers asking the same thing),
surface it to the user — they might want a public post or a help-center
update. Delegate post writing to Ella.
