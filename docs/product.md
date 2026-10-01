# Product scope

Papan is a personal desktop board for visual references and readable pages. The core loop is paste, select, collect, and revisit. The empty canvas teaches pasting directly; Add link remains a quiet fallback.

Collections keep layout and playback settings. Pins retain source context alongside optional tags and notes. Users choose whether to cache previews or download originals, and independently choose what clicking a pin does. Removing something is recoverable, and closing a tab is distinct from deleting its collection.

An optional local phone receiver extends capture to Android's share sheet. A small companion retains undelivered URLs; the desktop extracts all items into a configured collection. Pairing, revocation, durable receipts, and protected inbox entries preserve local ownership. A platform-neutral HTTP protocol prepares an iPhone Shortcut path, which has not been tested on an iPhone. [Mobile setup and limits](mobile-sharing.md).

The current release prioritizes local ownership, responsive browsing during saves, predictable media layout, and honest storage behavior. `.papan` files are lightweight lists; portable `.papan.zip` copies include the local media that makes them usable on another device.

No Papan account, cloud sync, collaboration, browser extension, feed scraping, or live-stream download is included. Public extraction runs first; an optional automatic browser-session fallback uses only the target site's cookies for X, Instagram, or YouTube when public access fails. Session values are never persisted or shared with the phone. Site extraction can still fail as platforms change. The app starts empty; the documentation demo is separate.

See the [user guide](usage.md), [architecture](architecture.md), [checks](verification.md), and [extractor research](extractors.md) for implementation details and limits.
