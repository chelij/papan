# Product scope

Papan is a personal desktop board for visual references and readable pages. The core loop is paste, select, collect, and revisit. The empty canvas teaches pasting directly; Add link remains a quiet fallback.

Collections keep layout and playback settings. Pins retain source context alongside optional tags and notes. Users choose whether to cache previews or download originals, and independently choose what clicking a pin does. Removing something is recoverable, and closing a tab is distinct from deleting its collection.

The current release prioritizes local ownership, responsive browsing during saves, predictable media layout, and honest storage behavior. `.papan` files are lightweight lists; portable `.papan.zip` copies include the local media that makes them usable on another device.

No account, cloud sync, collaboration, browser extension, feed scraping, live-stream download, or browser-cookie import is included. Public-only extraction can fail as sites change. The app starts empty; the documentation demo is separate.

See the [user guide](usage.md), [architecture](architecture.md), [checks](verification.md), and [extractor research](extractors.md) for implementation details and limits.
