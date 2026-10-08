# Using Papan

To share links from Android, use **Receive from phone**, choose a collection, and pair the Android companion. [Mobile sharing setup and recovery](mobile-sharing.md).

## Start by pasting

Paste a public link anywhere on the canvas. Papan inspects it and lets you select media, edit the title, and choose a cover. The first save creates a collection. The small **Add link** button and **Ctrl/Cmd+K** are alternatives to pasting; neither is required for onboarding.

Click **+** after the last tab or press **Ctrl/Cmd+T** for a temporary **new tab**. Paste a link and choose **add to collection** to create a collection, or use **open a collection** to load an existing one. Unused tabs disappear when closed or when Papan restarts and never enter recently opened. A new collection starts as **new collection** in online mode, with preview size **35**, a **4-second** slideshow interval, collection frames, and autoplay. You can rename it and change its settings after the first save. **Ctrl/Cmd+W** closes the current tab; saved collections and their pins remain available from **Open collection**. Closing the last tab keeps Papan open.

Tags and personal notes are optional in the media picker. Choose **add to collection** to start a background save and return to the board. Pins appear when their files are ready. The pin count stays in the footer at the bottom of the window. **Activity** appears on its right while downloads, pose extraction, or mobile shares are unfinished. Its count combines queued and running work; failed and cancelled work stays available for recovery. Successful tasks disappear from Activity. The panel shows the current stage and item count, with cancel, retry, and dismiss actions where supported. Unfinished work is also available under **Open collection → unfinished activity…**. A failed download keeps its selection for retry. Downloads interrupted by quitting are marked as interrupted on the next launch; they do not silently restart network traffic. Accepted mobile shares resume automatically, and their saved receipts remain in **Receive from phone**.

Only individual posts and videos are supported. Papan tries public extraction first. If it fails for X, Instagram, or YouTube, it automatically looks for a signed-in session in an installed desktop browser and retries using that site's cookies. This also applies to links received from your phone. You do not need to select a browser. **Collection settings → Privacy → use browser sessions** disables fallback for the whole app.

Browser cookies stay in the short-lived local extraction process. They are not saved in Papan, exported with collections, or sent to the phone. Discovery checks the most recently used browser profiles and skips guest sessions; Firefox container logins are not currently used. The browser must be signed in to the site, and its password store must be unlocked. Windows Chrome/Edge cookie encryption can prevent session access; signing in using Firefox is an alternative. A platform can still block a link or remove its media. An old retry may need a fresh inspection if upstream media links have expired.

## Organize and find pins

Open a pin's **···** details, then **edit pin**, to change its title, cover, tags, notes, or collection. Choose **+ new collection…** in the collection dropdown to create a destination while editing. The new collection is selected automatically, and **save pin** saves your edits and moves the pin. Cancelling creation keeps the previous destination and your draft. Moving a pin to a collection that downloads originals first downloads the missing media in the background. If that fails, the original pin stays in place.

Under **board previews**, choose which saved items appear on the board and mark one as the **cover** to show first. You can select several videos. Click a video's thumbnail to open its own range editor, then drag the two handles to choose the start and end. The frames above the slider show both boundaries. Switching videos keeps each video's draft range. Arrow keys adjust a focused handle by 0.1 seconds; Shift+Arrow or Page Up/Down adjusts by one second. Handles cannot cross.

**Play clip** checks the active video's range. Move the end handle fully right to play through the end; **full video** resets that video's range, and **reset previews** restores the default selection of all visual media. Choose **save pin** to apply the changes. Closing the editor cancels the draft.

Preview choices affect the board only. The viewer still offers every saved item and plays complete videos. Clips loop when they are the only preview, or advance to the next selected item in an album. No media is trimmed or deleted. Selections and ranges travel with saved `.papan` lists and portable exports.

Search the current collection or **all collections**, including closed tabs. Locked collections are excluded until you unlock them. Searching across collections starts when you enter a search term or choose a filter. Search covers titles, authors, links, saved text, tags, and notes. Filters select images, videos, articles/text, a source domain, or a tag. Pins can match more than one media type. Search results identify their collection; clear the filters to return to the normal board.

Drag pins to reorder them within a collection. An outlined placeholder previews the new position; **Escape** cancels. Drag a pin onto another collection's tab to move it there; the destination highlights before you drop. Moving to an offline collection queues any missing originals and keeps the pin in its current collection until the download succeeds. Drag collection tabs to reorder those too. Focus a pin or tab and use **Alt+Left/Right** to reorder it. Dragging is disabled in results spanning multiple collections.

After removing a pin or collection, use the **undo** toast or **Ctrl/Cmd+Z** outside a text field. **Open collection → recently removed** retains the last 20 removals across restarts. Restoring a pin requires its parent collection to exist; restore the collection first when necessary. Restoration refuses duplicates and unavailable saved destinations rather than overwriting them.

Closing a tab with **×** keeps its collection and media. Reopen it through **Open collection**. **Ctrl+Tab** switches to the next open collection; **Ctrl+Shift+Tab** switches to the previous one. Both wrap at the ends and pause while a dialog is open. Left/Right and Home/End navigate focused tabs.

**Open collection → clear history** empties the recent list, including after a restart. Choose **all collections** in the dropdown to find every saved collection, including open tabs and entries cleared from history. Collections, pins, saved files, media, and **recently removed** are kept. Reopening and closing a collection adds it back to the recent list.

## Storage and opening behavior

The label below Papan shows the active collection's storage mode:

| Setting | Behavior |
| --- | --- |
| online / Cache previews | Keep smaller local image copies and full-duration silent video previews. Saved article text is local too. |
| offline / Download originals | Keep original media as well as previews. Changing an existing collection downloads missing originals before committing the setting. |

Pins always open in Papan's viewer first, preferring originals when present and otherwise showing the cached preview. **Open original ↗** in the viewer opens the source page in your browser. Switching back to online mode retains existing originals. Videos open muted with playback controls; original audio is available when the original contains it.

**Copy link** beside **Open original ↗** copies the pin's source link to the clipboard.

Image previews are WebP copies capped at 1280 pixels, preserving animation and proportions. Video previews retain the full duration, omit audio, and fit inside 720 × 720 at 24 fps. Smaller inputs are not enlarged. Each file is limited to 512 MiB, each pin to 50 selected items, and each download/conversion operation to five minutes.

Older video previews rebuild automatically through Activity when their collection is open or unlocked. Papan keeps the current saved media until its replacement is ready, and preserves pin details and preview ranges. The source must still be available; failed repairs can be retried from Activity.

## Extract poses for ControlNet

Open a video pin's **···** details and choose **extract pose**. For an album, use the viewer arrows to select the video first, then confirm **extract pose**. ComfyUI can be closed.

Pose extraction is optional. The setup popup shows local [DWPose](https://github.com/IDEA-Research/DWPose) processing, the remaining download size and requirements. **Setup details** expands the model/runtime information; installed tools show **Ready · no download needed**. Opening or cancelling downloads nothing. Confirm **download & extract pose** to fetch the standalone runtime from the matching Papan release and about **335 MiB** of Apache-2.0 models from the author's Hugging Face repository. The checked Linux x64 build needs about **452 MiB** total (117 MiB runtime + 335 MiB models); other builds report their own exact sizes. Allow at least 1 GiB free disk space plus space for video processing. No Python installation, GPU, or ComfyUI server is needed. Papan verifies pinned SHA-256 hashes before use and caches dependencies in private `library/pose-models/` storage. Subsequent runs work offline. Video frames stay on this computer.

The complete saved video is processed in two-second batches at 24 fps, with its proportions retained inside 720 × 720. Body, hand, and face skeletons are drawn on black. Papan attaches one silent pose video to the selected source video when all batches succeed. **extract pose** becomes **view pose**; click it to play the attachment, then **view original** to return. Pose attachments stay out of board previews, autoplay, slideshow rotation, album navigation, and cover editing. No separate pin is created. The source pin and its preview ranges stay intact; extraction always uses the complete saved media, preferring the original over its cached preview. Frame-rate conversion can change the duration by roughly one frame. Human pose detection may miss occluded limbs or non-human subjects: inspect the skeleton video before using it. If no clear human pose is detected throughout the video, extraction reports an error instead of saving a blank pin.

While watching the pose, **people** keeps all detections or up to **1–10** people. The limit starts with the largest visible detections, follows their overlapping positions across frames and batches, and avoids immediately switching to a background person during a short disappearance. After a one-second loss it can acquire another visible person. This selects by location, not identity; crossings and scene changes can confuse it. **Joint confidence** cycles through **30%, 50%, and 70%**; higher values hide uncertain joints but may also hide occluded limbs. Click **re-extract pose** to apply both settings from the original video. The old pose remains available until successful saving; failures and cancellation preserve it. The replacement keeps the pose item ID, source identity, original audio, and collection encryption. Settings are remembered with the attachment. Completion refreshes the open pose; imported ComfyUI boards need **Reload board**, or an updated upload, to pick up the new media.

After the pose runtime and models are installed, video cards show a compact stickman button in the upper-right corner on hover or keyboard focus. Its tooltip and accessible label say **extract pose** or **view pose**, and the action applies to the currently displayed album video. It replaces the redundant three-dot button; clicking the preview still opens all pin details. An extracted video also shows a transparent **pose** indicator at the right of the source line, with matching text/border and a contrasting outline. These card controls stay hidden before installation; the video-details action remains available for first-time setup. Attachment completion updates the card without replacing its playing preview.

**Activity** shows model-download and frame progress and offers cancel, retry, and dismiss. Cancellation stops the local worker and encoder. Failed or cancelled work leaves no partial pose attachment or staging media; completed model downloads remain cached. Interrupted tasks require an explicit retry after restarting Papan. Finish or dismiss pose tasks before switching back to an older Papan; older versions can read and dismiss them, but cannot run the new extraction action. Previously queued ComfyUI pose tasks run through the local backend when retried; their old port is ignored.

Save the collection and select the source pin's attached pose video in the ComfyUI Papan node. The current local extension shows **Pose available → Select pose** beside the source video; older extensions list it as another saved video item. Connect its `VIDEO` through **Get Video Components** to the H3 ControlNet patch's `control_video` input. Use the character picture for appearance, and keep the original video as the movement/camera reference and source audio. The skeleton video is the control input; extraction alone does not apply a ControlNet patch to an existing generation workflow.

For a protected collection, unlock it first and use the same **extract pose** action. Papan decrypts the source into a private temporary directory for the local worker; passwords and keys stay in Papan's main process. The pose attachment inherits the collection's encryption. Temporary plaintext is removed after completion, cancellation, or failure; interrupted staging is cleaned on the next launch. Wait for the task to finish before locking or changing protection. Pose attachments use the existing video format and work in saved lists and portable exports. Unlocking a saved collection in ComfyUI creates ordinary input files there, as with other encrypted references. A pin can hold up to 50 saved items including attachments. Earlier standalone pose pins are retained; this change applies to new extractions. Older desktop builds can open these files but may show attachments as ordinary album/preview videos.

## Save lists or export portable copies

| Format | Contains | How to use it |
| --- | --- | --- |
| `.papan` (unprotected) | Ordered pins, settings, tags, notes, text, source links, and absolute references to local media | **Save collection** chooses a destination. Subsequent edits update it automatically. **Save as…** chooses another destination. Media is not copied or moved. |
| `.papan` (encrypted) | Encrypted metadata, removal history, and saved media | Protect the collection first. **Save collection** and **export portable copy…** both keep encryption. Open the file and unlock it with the same password. |
| `.papan.zip` | Collection metadata plus every available local preview and downloaded original referenced by it | **Collection settings → Storage → export…** creates an independent snapshot. **Open collection → browse** imports it into Papan's local storage with new IDs. |

An unprotected `.papan` list alone is not a portable backup. Its media references stop working if their files move or disappear. Reopening uses the saved file when possible and can fall back to the existing local copy with a notice when the destination is unavailable.

A portable copy includes what is already on disk. It does not fetch missing originals or convert cached previews into originals. Export fails if a referenced local file is missing. Imports reject unsafe paths, duplicate entries, symlinks, unsupported media, missing files, and oversized archives. Limits are 512 MiB per media file, 64 MiB for metadata, 50,000 media files, and 20 GiB total uncompressed content. Archive operations have a five-minute limit, so very large collections may need splitting. Import and export leave the existing collection untouched on failure.

## Password protection

For an existing collection, open **Collection settings → Privacy → protect collection…**, enter a password of at least eight characters twice, and choose **encrypt collection**. This encrypts the pins, source links, saved text, tags, notes, preview choices, recently removed pins, and saved images/videos. The collection name and destination remain visible so you can recognize it.

Use the **Lock collection** padlock in the toolbar to lock it immediately. Closing its tab also locks it, and protected collections start locked when Papan restarts. Selecting a locked tab or opening an encrypted collection immediately asks for its password in a popup. The current board stays visible until the password is accepted; closing the popup leaves the target locked. If every open tab is locked at startup, Papan prompts for the first one. Locked pins cannot appear in search, be moved or edited, or serve media. Unlock a destination before dragging pins into it. Wait for running downloads and saves to finish before locking or changing protection.

The **Privacy** tab offers **change password…** and **remove password…** while unlocked. Both require the current password. Removing protection writes ordinary local media files again. There is no password recovery: keep your password and an encrypted export somewhere safe.

Protected saves and exports are self-contained encrypted `.papan` files. Automatic local and destination backups stay encrypted. Changing the password updates those current backups; copies exported earlier keep their original password. Older Papan versions cannot read encrypted collections.

Papan removes its unshared plaintext media copies after encryption commits. Imported originals outside the library, copies shared with unprotected collections, older exports, and system backups remain as they are. Playback decrypts media into memory without a plaintext playback file. Downloading and converting new media can use temporary files while unlocked; interrupted work is cleaned on the next launch. Protection is for stored collections, not other software reading an unlocked process, OS swap, or forensic recovery of previously deleted files. See the [format and recovery design](encryption.md).

## Layout and motion

Collection settings uses a compact panel with **General**, **Storage**, and **Privacy** tabs. General holds the name and layout controls, Storage holds download mode and file actions, and Privacy holds password protection and collection removal. Switching sections keeps your draft; the panel stays the same size, with its contents scrolling in short windows.

Scroll the mouse wheel over the board to move smoothly by one row per wheel step. The distance follows the current preview size and frame height, including the gap between rows, and adjusts when you resize the window. Zooming keeps the same pin in the top row; the next wheel step follows the new row boundaries. Rows stop beneath the header without a strip of the preceding row showing. Blank space below the pins lets the last row reach the top of the board. Reduced-motion preferences disable the animation.

Previews use equal-width columns that line up vertically across all rows, including a partial last row. **Collection frames** use the arithmetic average of the width-to-height ratios of all images and videos in the collection; text and unknown dimensions are excluded. Every pin uses that same frame, with media cropped to fill it. Filtering does not change the collection's frame shape. If no dimensions are known yet, frames start square and update as media loads. The viewer still shows the complete saved media. **Preview size** has 40 levels, from 1 (small) to 40 (large), defaulting to 35. Ctrl+wheel skips levels that produce the same columns at the current window width, so each step visibly changes the preview size until the zoom limit. Lower values make previews smaller; higher values make them larger. Hold **Ctrl** and scroll the mouse wheel anywhere below the header and above the footer, including blank space, to change and automatically save the size: up makes previews larger, down makes them smaller. Existing collections keep their saved preview size; only its displayed level changes to the new scale. Collections saved at the new intermediate or smaller sizes require an updated build when opened elsewhere. **Square frames** uses a fixed 1:1 shape instead. Settings preview live and save automatically when you close collection settings with **×**, **Escape**, or a click outside the popup. There is no Save settings button. If validation or saving fails, the dialog keeps your edits visible so you can correct the problem and close again, or choose **discard changes**. Creating a destination from the pin editor still opens a name/settings dialog; closing it cancels creation, and **create collection** confirms it.

An album uses one stable frame based on the middle proportions of its visual items. A tied portrait/landscape pair balances toward a square. Slides crop to fill that frame; the cover chooses the starting slide. Missing dimensions have a bounded five-second lookup.

Visible videos play silently; albums advance through images at the chosen 1–10 second interval and let videos finish. Turn off autoplay and slideshows in settings. The app also respects reduced-motion preferences.

## Shortcuts

Click outside a popup to dismiss it without activating a pin or button behind it. With nested popups, this closes only the top one. Pin edits still use **save pin**; dismissing the editor cancels its draft.

| Shortcut | Action |
| --- | --- |
| Ctrl/Cmd+V on the canvas | Inspect the pasted link |
| Ctrl/Cmd+K | Open Add link |
| Ctrl/Cmd+F | Search |
| Ctrl/Cmd+S | Save collection list |
| Ctrl/Cmd+Shift+S | Save list as… |
| Ctrl/Cmd+O | Open a collection |
| Ctrl/Cmd+T | New temporary tab |
| Ctrl/Cmd+W | Close the current collection tab |
| Ctrl+Tab / Ctrl+Shift+Tab | Next / previous open collection tab |
| Ctrl/Cmd+Z outside inputs | Undo the latest removal |
| Alt+Left/Right on a pin or tab | Reorder |
| Escape | Close the active dialog/popover or cancel a drag |

## Local files and recovery

Data lives under Electron's per-user app directory:

- Linux: `~/.config/Papan/library`
- macOS: `~/Library/Application Support/Papan/library`
- Windows: `%APPDATA%\Papan\library`

`library.json` contains ordinary metadata, closed tabs, and recently removed items. Protected collection entries contain a visible name and an encrypted-file reference; their contents live in `vaults/`. `downloads.json` records queue state. `media/` holds local files. **Collection settings → Storage → open local library folder** opens this location; a chosen list destination has its own folder action.

Writes are serialized and atomically replace metadata. `library.previous.json` and each saved list's `.previous.papan` preserve the prior snapshot. Enabling encryption or changing its password replaces recovery copies with the encrypted current state, so they do not retain plaintext or the old password. Conflicting external edits or unavailable destinations reject the current edit. Collection files are single-writer documents, not a synchronization service. A failure while updating two lists attempts to restore both; recovery copies are preserved locally if a destination becomes inaccessible during rollback.

Media referenced by saved lists, recent removals, or the previous snapshot stays available. Other unreferenced media and interrupted staging files are collected at startup. Invalid existing metadata stops startup without replacing it. Back up the entire library for full recovery, or export individual portable collections. `PAPAN_DATA_DIR` selects a separate profile for development and tests.
