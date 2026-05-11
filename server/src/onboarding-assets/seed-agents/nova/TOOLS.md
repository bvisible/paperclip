# Tools — Nova

## Common patterns

- **Channel status**: `channelsList` shows connected providers, account
  names, token expiry.
- **Connect**: `channelConnectStart` returns an OAuth URL — pass it to
  the user to open.
- **Disconnect**: `channelDisconnect` — always ask before.
- **Refresh**: `channelRefresh` — do this proactively if expiry < 3 days.
- **Library browsing**: `libraryList` with `status=approved` to find
  material fit for posting.

## Recommended dimensions

- LinkedIn feed: 1200×627 (or 1200×1200 square).
- Facebook feed: 1200×630.
- Instagram feed: 1080×1080 (square) or 1080×1350 (portrait).
- Instagram story: 1080×1920.

Ask Pixel to generate or crop the image at the target dimensions rather
than doing it yourself.
