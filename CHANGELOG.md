# Release history

## 0.1.5 — 2026-09-21

Copy X posts as Markdown using the new Markdown button in each post's action row.

### Added

- Copy the author, canonical URL, publication date, content format, and post text as a structured Markdown document.
- Include engagement counts for views, likes, replies, reposts, and bookmarks.
- Add the experimental, read-only WebMCP tool `get_x_post_markdown` for posts loaded on the page.
- Show the currently assigned keyboard shortcut in settings and provide a button to open Chrome's shortcut settings.

### Privacy

- Metadata is processed locally from the rendered page and X responses the page already loaded, without additional network requests.
- Copied post data is not persisted by the extension.

## 0.1.4 — 2026-08-20

This is the first local release of X-max Schedule Time.

### Added

- Added fixed-delay scheduling.
- Added sequential-interval scheduling.
- Added a sequence reset control.
- Added rule-zone to browser-zone conversion.
- Added background operation of the native X schedule dialog.
- Added compact stacked notifications.
- Added reusable select and time-zone popover components.
- Added Manifest V3 service-worker and keyboard-command support.
- Added automated tests for scheduling, storage, selectors, and interface behavior.

### Privacy

- The extension uses the rendered X interface only.
- The extension does not use private X API endpoints.
- The extension does not make network requests.
