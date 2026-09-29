# Using Papan

## Start by pasting

Paste a public link anywhere on the canvas. Papan inspects it and lets you select media, edit the title, and choose a cover. The first save creates a collection. The small **Add link** button and **Ctrl/Cmd+K** are alternatives to pasting; neither is required for onboarding.

Tags and personal notes are optional in the media picker. Choose **add to collection** to start a background save and return to the board. Pins appear when their files are ready. The downloads panel shows the current stage and item count, with cancel, retry, and dismiss actions. A failed task keeps its selection for retry. Tasks interrupted by quitting are marked as interrupted on the next launch; they do not silently restart network traffic.

Only individual posts and videos are supported. A platform can block a public link, remove its media, or require an account. Papan does not import logins or browser cookies. An old retry may need a fresh inspection if upstream media links have expired.

## Organize and find pins

Open a pin's **···** details, then **edit pin**, to change its title, cover, tags, notes, or collection. Moving a pin to a collection that downloads originals first downloads the missing media in the background. If that fails, the original pin stays in place.

Search the current collection or **all collections**, including closed tabs. Search covers titles, authors, links, saved text, tags, and notes. Filters select images, videos, articles/text, a source domain, or a tag. Pins can match more than one media type. Search results identify their collection; clear the filters to return to the normal board.

Drag pins to reorder them within a collection. An outlined placeholder previews the new position; **Escape** cancels. Drag collection tabs to reorder those too. Focus a pin or tab and use **Alt+Left/Right** for the same operation. Reordering is disabled in results spanning multiple collections.

After removing a pin or collection, use the **undo** toast or **Ctrl/Cmd+Z** outside a text field. **Open collection → recently removed** retains the last 20 removals across restarts. Restoring a pin requires its parent collection to exist; restore the collection first when necessary. Restoration refuses duplicates and unavailable saved destinations rather than overwriting them.

Closing a tab with **×** keeps its collection and media. Reopen it through **Open collection**. Left/Right and Home/End navigate focused tabs.

## Storage and opening behavior

These are separate collection settings:

| Setting | Behavior |
| --- | --- |
| Cache previews | Keep smaller local image copies and full-duration silent video previews. Saved article text is local too. |
| Download originals | Keep original media as well as previews. Changing an existing collection downloads missing originals before committing the setting. |
| Open original page | Clicking a pin opens its source in the browser. |
| View saved media | Clicking opens the local viewer, preferring originals when present and otherwise showing the cached preview. |

Switching back to cached previews retains existing originals. Source links remain available in the viewer. Videos open muted with playback controls; original audio is available when the original contains it.

Image previews are WebP copies capped at 1280 pixels, preserving animation and proportions. Video previews retain the full duration, omit audio, and fit inside 720 × 720 at 24 fps. Smaller inputs are not enlarged. Each file is limited to 512 MiB, each pin to 50 selected items, and each download/conversion operation to five minutes.

## Save lists or export portable copies

| Format | Contains | How to use it |
| --- | --- | --- |
| `.papan` | Ordered pins, settings, tags, notes, text, source links, and absolute references to local media | **Save collection** chooses a destination. Subsequent edits update it automatically. **Save as…** chooses another destination. Media is not copied or moved. |
| `.papan.zip` | Collection metadata plus every available local preview and downloaded original referenced by it | **Collection settings → export portable copy…** creates an independent snapshot. **Open collection → browse** imports it into Papan's local storage with new IDs. |

A `.papan` list alone is not a portable backup. Its media references stop working if their files move or disappear. Reopening uses the saved file when possible and can fall back to the existing local copy with a notice when the destination is unavailable.

A portable copy includes what is already on disk. It does not fetch missing originals or convert cached previews into originals. Export fails if a referenced local file is missing. Imports reject unsafe paths, duplicate entries, symlinks, unsupported media, missing files, and oversized archives. Limits are 512 MiB per media file, 64 MiB for metadata, 50,000 media files, and 20 GiB total uncompressed content. Archive operations have a five-minute limit, so very large collections may need splitting. Import and export leave the existing collection untouched on failure.

## Layout and motion

Rows adapt to each pin's aspect ratio. **Layout density** runs from 1 (spacious) to 10 (compact), defaulting to 3. **Square frames** is an alternative to adaptive frames. Settings preview live; Save keeps them, while closing restores the saved values.

An album uses one stable frame based on the middle proportions of its visual items. A tied portrait/landscape pair balances toward a square. Slides crop to fill that frame; the cover chooses the starting slide. Missing dimensions have a bounded five-second lookup.

Visible videos play silently; albums advance through images at the chosen 1–10 second interval and let videos finish. Turn off autoplay and slideshows in settings. The app also respects reduced-motion preferences.

## Shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+V on the canvas | Inspect the pasted link |
| Ctrl/Cmd+K | Open Add link |
| Ctrl/Cmd+F | Search |
| Ctrl/Cmd+S | Save collection list |
| Ctrl/Cmd+Shift+S | Save list as… |
| Ctrl/Cmd+O | Open a collection |
| Ctrl/Cmd+Z outside inputs | Undo the latest removal |
| Alt+Left/Right on a pin or tab | Reorder |
| Escape | Close the active dialog/popover or cancel a drag |

## Local files and recovery

Data lives under Electron's per-user app directory:

- Linux: `~/.config/Papan/library`
- macOS: `~/Library/Application Support/Papan/library`
- Windows: `%APPDATA%\Papan\library`

`library.json` contains metadata, closed tabs, and recently removed items. `downloads.json` records queue state. `media/` holds local files. **Collection settings → open local library folder** opens this location; a chosen list destination has its own folder action.

Writes are serialized and atomically replace metadata. `library.previous.json` and each saved list's `.previous.papan` preserve the prior snapshot. Conflicting external edits or unavailable destinations reject the current edit. Collection files are single-writer documents, not a synchronization service. A failure while updating two lists attempts to restore both; recovery copies are preserved locally if a destination becomes inaccessible during rollback.

Media referenced by saved lists, recent removals, or the previous snapshot stays available. Other unreferenced media and interrupted staging files are collected at startup. Invalid existing metadata stops startup without replacing it. Back up the entire library for full recovery, or export individual portable collections. `PAPAN_DATA_DIR` selects a separate profile for development and tests.
