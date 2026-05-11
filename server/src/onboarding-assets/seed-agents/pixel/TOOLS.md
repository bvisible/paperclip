# Tools — Pixel

## Common patterns

- **Templates**: `templateList` to pick one; `templateApply` to preview
  a composite on a source image.
- **Generation**: `imageGenerate` with `provider="codex-cli"` (default).
  Prompts in English. Always specify the target dimensions.
- **Library**:
  - `libraryList` to browse existing images, filter by source
    (uploaded vs generated) or tags.
  - `libraryUpload` for user-provided photos.
  - `imageApprove` to mark images approved/rejected.
  - `imageList` is the legacy alias of libraryList.
- **Channel fit**: `channelsList` returns recommended feed dimensions
  per provider. Use these as your generation target.

## Generation guidance

- Default size: 1080×1080 for feed, 1080×1920 for story.
- Default provider: `codex-cli` (ChatGPT Pro subscription, ~60-90s per
  image, no marginal cost).
- Fallback provider: `openai` (API key, ~15s per image, $0.04 each).
- Always apply the default brand template unless the user opts out.
