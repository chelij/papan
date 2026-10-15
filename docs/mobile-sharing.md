# Share links from your phone

Papan receives URLs directly from a paired phone on your local network. No cloud service, account, or app-store publication is involved. The desktop does extraction and media saving; the phone keeps links that have not been accepted yet.

## Android setup

1. Install the [Papan Android APK](https://github.com/chelij/papan-android/releases/latest) and use Papan desktop **0.2.1 or newer**. The companion source and build tools are in [papan-android](https://github.com/chelij/papan-android). For development, from that checkout you can use `adb install -r dist/Papan-Android-0.2.0.apk`; direct APK installation is also supported by Android, subject to the device's installation settings. [Android distribution](https://developer.android.com/distribute/marketing-tools/alternative-distribution), [developer verification and ADB](https://developer.android.com/developer-verification/guides/faq).
2. Connect the phone and desktop to the same reachable local network.
3. In desktop Papan, choose **Receive from phone** from the toolbar or empty canvas. Enable the receiver, select a collection (or **+ create Inbox collection**), choose the desktop's network address, and save the settings. Closed collections can receive pins too.
4. Allow incoming TCP connections to the selected port through the desktop firewall. The default is **47778**. Prefer a rule restricted to your local subnet. For example, on a UFW system with the subnet `192.168.1.0/24`:

   ```sh
   sudo ufw allow from 192.168.1.0/24 to any port 47778 proto tcp comment 'Papan phone sharing'
   ```

   To undo that rule:

   ```sh
   sudo ufw delete allow from 192.168.1.0/24 to any port 47778 proto tcp
   ```

   Use your actual subnet and chosen port. Do not forward this port through your router. Guest networks can isolate phones from desktops even when both have Wi-Fi access.
5. With the matching unreleased Android/desktop update, open Android **Connections → Pair desktop**, choose a nearby computer and approve the matching six-digit code in desktop Papan within two minutes. The receiver must be enabled. QR remains the fallback for older versions or networks that block discovery: choose **pair a phone** on desktop and **Scan QR** in the phone's nearby dialog. Android 0.2.0 opens its scanner directly. Allow camera access when Android asks, then point it at the desktop QR. **Paste pairing link instead** also works without camera access. The QR/link expires after five minutes and can be used once. The phone's system camera can still open the QR's pairing page and its **Open Papan companion** link.
6. In Android 0.3.0 development builds, share a link to **Papan**, use **Add link**, or tap **Paste link**, then choose a phone or desktop collection. Phone collections work independently and save the link before fetching previews. For remote browsing and destination selection, enable **allow paired phones to browse and add to open collections** in this desktop's receiver settings. This needs the matching desktop mobile-board patch. Android 0.2.0 retains its single desktop-default delivery behavior. Paste reads the clipboard only when tapped; Android exposes no clipboard history.

Android 0.3.0 uses **Connections** for pairing/address recovery, **On phone** for its local library, **Desktop** for open desktop collections and **Activity** for pending desktop deliveries. The destination picker captures the chosen collection ID before queuing. Older/offline desktops retain an explicit default-delivery choice. Camera frames are decoded on the phone and are never saved or sent to desktop; camera access remains optional.

The desktop saves all extracted items, up to the existing 50-item limit, with the first item as cover. It uses the destination collection's preview/original storage setting. It skips a source already saved in that collection. Use **edit pin** afterward to change the cover or remove unwanted media.

## Delivery and recovery

- **Queued on phone:** the URL is in app-private storage but Papan has not acknowledged it. An unavailable desktop, locked destination, full inbox, or firewall block keeps the URL on the phone.
- **Received by Papan:** the desktop durably stored it. Extraction may still be running or may have failed. The phone checks the receipt rather than uploading again.
- **Saved in Papan:** the desktop committed the pin. The phone removes its queue entry only after seeing this receipt.

Android schedules background retries, but battery restrictions and force-stopping can defer them. Open the companion or use **Send pending / check saves** for an immediate attempt. For the first 30 seconds after opening or sharing, the foreground screen also checks pending deliveries and saves every 1.5 seconds between requests. The queue survives process restarts and reboots; reboot scheduling uses Android's persisted JobScheduler.

Desktop **Activity** shows queued, running, and failed mobile shares alongside downloads and pose extraction. It shows download progress and waiting-for-unlock states, with retry for failed shares and dismiss for shares that are not running. Running shares must finish before dismissal. Saved shares disappear from Activity. **Receive from phone → incoming links** retains the same recovery controls and successful receipts until dismissed or cleared. The desktop accepts at most 100 unfinished links and 5,000 receipts; the phone holds at most 100 pending links. Clear saved receipts to reclaim receipt capacity. Clearing a receipt removes its status lookup, so first let the phone observe completed saves. It never removes the pin itself.

An explicit phone-selected destination is stored on the phone before delivery and captured by desktop acceptance. Retries and restart preserve it; a missing, closed or protected selected destination never falls back to another collection. Legacy shares without `collectionId` use the desktop default at acceptance. Changing the default affects only later default acceptances.

The matching unreleased apps recover the same pairing after a local IP/port change. Desktop checks its selected network interface every three seconds and rebinds/reannounces when that address changes. Android discovers the paired server through native DNS-SD after a connection failure or `401`, verifies a fresh challenge with the existing key, and only then updates the address and retries browsing/delivery. Searches are bounded to five seconds and throttled to once per paired server per fifteen seconds. Pending URL/ID/destination and credentials remain intact; a newer manual address edit takes precedence. This is connection recovery, with no synchronization between phone and desktop libraries.

If local discovery is blocked, use Android **Connections → Update desktop address** (0.2.0: **Connection settings**); the same pairing and queued IDs remain. Android retains one active desktop. **Pair desktop → Reconnect** works for that computer while links are pending. Replacing it with a different desktop stays blocked until links are sent or explicitly dismissed in Activity. Guest-network isolation, a stopped receiver or a revoked pairing still prevents access.

Revoking a paired device prevents new submissions and receipt checks. Links already accepted on the desktop remain. The Android companion preserves unresolved links and reports that it must be paired again. Dismissing an entry on the phone does not cancel an already accepted desktop save.

## Privacy and protection

The receiver and phone browsing are disabled initially. The receiver binds to the selected private IPv4 interface, checks the exact Host header, rejects browser Origin requests, bounds JSON bodies and requires a device key. Pairing attempts are limited. Ordinary paired-device access submits HTTP/HTTPS links and reads its own receipts. The separate browsing preference grants paired phones access to currently open collections and their saved media; it permits choosing an open destination, not changing desktop settings, editing/deleting pins or opening closed collections.

Protected collections always require the password on each phone, including when already unlocked on desktop. Authorization is memory-only and belongs to the paired device, current desktop unlock and phone app session. Matching clients send a random in-memory `X-Papan-Session` identity on browsing, media and selected-save requests. That grant lasts until app close rather than a timer; a new process cannot reuse it. Closing requests scoped removal. Desktop lock/close, revocation, protection changes, receiver disable or restart still revoke access. Legacy clients without this header keep their 15-minute lifetime. Android clears protected views and stops playback on backgrounding while retaining its app session; foreground checks clear open details and cached protected previews after access ends. Media requests remain authenticated, support byte ranges and use `no-store`; Android does not cache remote media to disk. Already delivered bytes cannot be recalled from a client.

**Transport uses ordinary HTTP. Use a trusted local network.** Links, passwords, media and pairing/authentication traffic are not encrypted in transit. Collection encryption protects desktop storage, not the connection, phone queue or local phone library. The phone stores its data and cached local media in app-private files with Android backup disabled. Do not share the pairing link or private configuration.

New links to locked destinations stay on the phone until the collection is unlocked. Already accepted entries for protected collections are encrypted in the desktop inbox using the collection key. Locked entries wait to resume. Protection changes recode inbox entries with rollback alongside existing library/download transactions. A running phone save must finish before changing collection protection.

Accepted queued work automatically resumes when Papan restarts, including after a interrupted save; the stable pin ID and source checks avoid duplicating a committed pin. Failed extraction requires explicit retry on the desktop. Disabling the receiver stops network acceptance; it does not discard accepted work.

## iPhone preparation

The receiver protocol is independent of Android. An Apple Shortcut can appear in the share sheet and send a JSON POST using **Get Contents of URL**, without distributing an iOS application. [Apple share-sheet setup](https://support.apple.com/guide/shortcuts/run-a-shortcut-from-another-app-apd163eb9f95/ios), [HTTP request setup](https://support.apple.com/guide/shortcuts/request-your-first-api-apd58d46713f/ios).

This is a setup recipe, not a signed/importable Shortcut or a claim of testing on iPhone:

1. Generate a fresh pairing link on the desktop. Extract the endpoint before `/pair` and the code after `#`.
2. Create a one-time pairing shortcut: **Get Contents of URL** for `ENDPOINT/v1/pair`, method **POST**, JSON body with `code` and `name` (for example `iPhone`). Save the response's `endpoint` and `token` privately for the sending shortcut. Delete the temporary pairing code.
3. Create **Send to Papan**, enable **Show in Share Sheet**, and accept URLs/text. Extract the first web URL from Shortcut Input.
4. Make a unique request ID from **Current Date** formatted `yyyyMMddHHmmssSSS`, a hyphen, and a **Random Number**. IDs can contain 8–100 ASCII letters, digits, underscores, and hyphens; Android uses UUIDs.
5. POST to `ENDPOINT/v1/shares` with the header `Authorization: Bearer TOKEN` and a JSON dictionary containing `id` and `url`. A `202` response means received, not saved.
6. To retry safely, keep the same dictionary and ID in a private pending file before sending. Read `GET ENDPOINT/v1/shares/ID` to check completion. Delete the pending file only after `state` is `saved`. A basic shortcut needs manual retry; it does not provide the Android companion's scheduled delivery.

Allow Shortcuts' requested network permissions. Local-network access and actual Shortcut behavior still require iPhone testing. A future native iOS share extension can use this same protocol without changing collection or extraction code.

## Local protocol v1

All API bodies/responses are JSON. No browser CORS access is provided. Source links must be complete HTTP/HTTPS URLs without embedded credentials and no longer than 8,192 characters. Bodies are limited to 16 KiB.

| Request | Body / authentication | Response |
| --- | --- | --- |
| `POST /v1/pair` | `{ "code": "QR_CODE", "name": "device name" }` | `201`: `version`, `endpoint`, `token`, `deviceId`, `serverId` |
| `POST /v1/pair-requests` | No bearer; `{ "id": "32_LOWERCASE_HEX", "name": "device name" }` | `202`: pending status, six-digit comparison `code`, `expiresAt`, `serverId`; explicit desktop approval required |
| `GET /v1/pair-requests/ID` | No bearer; random request ID is the temporary secret | `200`: pending/approved status and comparison code; approved response includes a one-use `pairingLink` for the existing `/v1/pair` flow |
| `POST /v1/pair-requests/ID/cancel` or `DELETE /v1/pair-requests/ID` | No bearer; POST body `{}` | `200`: cancelled; removes transient request and its unconsumed pairing link |
| `POST /v1/identity` | No bearer; `{ "serverId": "...", "deviceId": "...", "nonce": "64_LOWERCASE_HEX" }` | `200`: version, matching identities/nonce, current endpoint and HMAC proof; invalid/revoked identities return `401` |
| `POST /v1/shares` | `{ "id": "STABLE_REQUEST_ID", "url": "https://example.com/" }`; Bearer token | `202` accepted/pending, or `200` already saved; `id`, `state`, `received`, `error` |
| `GET /v1/shares/ID` | Bearer token | `200` receipt for that device's ID |
| `GET /v1/capabilities` | Bearer token | `version: 1`, `collections`, `selectedDestination`, optional `appSessionAccess`, `reconnect` and `phoneInitiatedPairing`; old desktops return `404` |
| `GET /v1/collections` | Bearer token; phone browsing enabled | `collections`: open collection IDs/names plus `protected` and phone-specific `locked` flags; authorized collections optionally include `preview` frame metadata |
| `POST /v1/collections/ID/unlock` | Bearer token; `{ "password": "..." }`; open protected collection | `unlocked`, `expiresIn: null` for app-session grants or `900` for legacy clients; up to five attempts per device/minute, including successful attempts |
| `GET /v1/collections/ID/pins?offset=0&limit=40&q=search` | Bearer token; current phone authorization | Bounded pages (maximum 50), optional full-collection search (500 characters), `pins`, `nextOffset`; media URLs include no filesystem paths or keys |
| `GET/HEAD /v1/collections/ID/pins/PIN/items/ITEM/media?variant=preview` | Bearer token; current authorization; `preview`, `original` or optional `thumbnail` | Saved preview/original bytes and ranges; thumbnail images use saved image media, video thumbnails are bounded JPEG covers; all use `no-store` and lock/close/revoke cancels transfer |
| `POST /v1/access/clear` | Bearer token; `{}` | Clears matching app-session password grants when `X-Papan-Session` is present; otherwise clears this phone's grants |

With `selectedDestination: true`, `POST /v1/shares` accepts optional `collectionId`. It must name an open collection accessible to this phone. Reusing an accepted ID with another destination returns `409`. Receipt polling and already accepted retries remain available after a destination locks/closes. Requests without `collectionId`, pairing responses and existing receiver/inbox storage remain protocol v1. Saved desktop `.papan`, portable and encrypted containers are unchanged.

Items with saved previews can include optional `thumbnailUrl`, an authenticated media URL with `variant=thumbnail`. Existing `previewUrl`/`originalUrl` keep their meanings and playback/range behavior. For videos, desktop generates a JPEG cover with each dimension at most 480 pixels, output at most 1 MiB and an eight-second conversion limit. Conversions run one at a time, read saved media only, and stream protected input directly from the vault without writing a decrypted cover or video to disk. Access is checked before work and again before delivery; cancellation/lock/revoke aborts it. Image thumbnails reuse saved image media. Android uses the optional cover for video cards and retains the previous image-preview fallback when the field is absent. Discovery contains no thumbnail or collection content.

Android configuration recreation, including rotation/resizing, preserves the existing password grant and reloads the selected board. Backgrounding keeps the app session; an actual app close ends it. Desktop lock/close/revocation/restart still end protected access. Only legacy clients retain the fifteen-minute limit. No password or app-session identity is persisted to support rotation.

### Nearby discovery and identity

An enabled receiver on a private IPv4 interface advertises `_papan-phone._tcp.` through DNS-SD/mDNS. Its instance is `Papan SERVER_ID`; TXT fields are `id`, `name`, `endpoint` and `version=1`. Discovery contains no credential. Loopback test receivers do not advertise. Desktop saves an optional `networkInterface` name in its existing receiver JSON v1, retains its stable server ID/devices, and follows that interface or the sole available private interface. Ambiguous replacement interfaces leave it offline. Rebinding clears transient pairing requests and current media connections while retaining durable shares/receipts and grants for the same running app and desktop unlock session. Networks must permit local mDNS (UDP 5353) as well as the receiver's TCP port; manual address/QR recovery remains available.

The discovery UDP socket listens on the wildcard address so multicast queries reach it; multicast membership and outgoing advertisements select the configured interface. The HTTP receiver remains bound to its selected private IPv4 address. The live multicast regression requires a distinct query reply after the initial announcement, so cached discovery records cannot hide a silent listener.

Android resolves at most eight results from a bounded discovery queue. For an existing pairing it verifies `/v1/identity` before sending its bearer to a discovered endpoint. The proof is lowercase-hex HMAC-SHA256 with `SHA256(UTF8(token))` bytes as key, over the UTF-8 string `papan-reconnect-v1\nSERVER_ID\nDEVICE_ID\nENDPOINT\nNONCE`. All returned fields must match; the nonce is 32 fresh random bytes in lowercase hex and the proof uses a constant-time comparison. Identity requests are limited to 60 per minute. The desktop uses its existing stored device key hash, so no raw bearer or new credential format is stored.

Phone-initiated requests use random 128-bit secret IDs and six-digit comparison codes. At most five requests wait for two minutes; creation shares the existing 20-per-minute pairing limit. Repeating an ID/name is idempotent, and changing its name returns `409`. Polling an expired/declined request returns `404`. Approving in the trusted desktop UI grants a one-use pairing link; it creates no saved device until `/v1/pair` consumes that link. Requests and links are memory-only and are cleared on receiver restart/rebind. Older clients retain QR/default delivery and can ignore new capabilities. Older providers retain manual/QR recovery. Saved collections, phone queue/library formats and encryption remain v1.

`X-Papan-Session` is an optional UUID-shaped, in-memory identity sent with the paired bearer key. A protected grant is usable only with the same device/session identity and current desktop unlock key. `/v1/access/clear` with this header clears only matching grants, so a delayed close cannot revoke a later session. Session IDs/passwords are never written to receiver or Android storage. `appSessionAccess` advertises support; existing version-1 clients without the header keep their original timed grants.

An unlocked collection's optional `preview` contains `fit` (`contain` or `cover`), `aspectRatio` and `measuredCount`. Like the desktop renderer, contain mode averages known visual-item proportions across the collection; cover mode is square. Pin items also expose existing optional `previewWidth`/`previewHeight`. Videos without saved dimensions are measured from decoded phone thumbnails, like desktop's renderer measures decoded media. The phone combines those observations with the server's known proportions, retains aligned rows and the visible reference through sizing, and keeps measurements with its bounded memory cache. Locked collections expose no frame metadata. Older providers retain square phone frames.

Phone pages also stop at approximately 1 MiB of pin JSON and continue with `nextOffset`. Text previews use up to 16,000 characters per field and 32,000 per pin, with `textTruncated` indicating a shortened preview. Full desktop text stays unchanged; the phone offers the original source link. This keeps rich text collections within the Android client's bounded response size.

States are `queued`, `running`, `failed`, and `saved`. Keep the same ID when retrying a submission; an ID reused with another URL returns `409`. Receipt IDs are scoped to the paired device. `401` means invalid/revoked pairing, `423` means destination unavailable/locked, `429` means capacity/rate limit, and `503` means a protection transaction is in progress. A missing/dismissed receipt returns `404`; check the desktop rather than blindly re-creating a received entry.

## Build and checks

The companion is maintained separately in [papan-android](https://github.com/chelij/papan-android), including its native Java/Camera2 source, checksum-pinned ZXing QR decoder, signing/build script, and isolated Android UI test runner. APKs include corresponding source and licenses. No Gradle or app-store account is required. [Build prerequisites and signing-key guidance](https://github.com/chelij/papan-android#build).

```sh
git clone https://github.com/chelij/papan-android.git
cd papan-android
# Set JAVA_HOME and ANDROID_HOME as described in the companion README.
npm run build:android
npm run build:android -- --test
```

From a desktop Papan checkout:

```sh
npm run check
npm test
xvfb-run -a npm run test:phone
PAPAN_ANDROID_DIR=/path/to/papan-android PAPAN_ADB=/path/to/adb npm run test:android-ui
```

`PAPAN_ANDROID_DIR` defaults to a sibling `../papan-android` checkout. Optional `PAPAN_ANDROID_SERIAL` selects the USB-debugging device. Unlock the phone first: Android blocks clipboard reads while locked, and the full test refuses to touch the clipboard in that state.

The Android integration check installs only `com.papan.share.test`, verifies its virtual display before interacting, and uses a disposable library and loopback-only USB tunnel. Native DNS-SD fixtures exercise nearby selection, matching-code approval and pairing without QR. A changed receiver endpoint exercises authenticated automatic recovery with the same queued request/destination; wrong-key proof and a stale discovery update after manual editing are rejected. It also checks clipboard paste/deduplication, Scan QR/live camera frames, rotated QR fixtures, actual media saving and foreground completion. It restores the previously readable clipboard only if its own test value is still current, then removes its APK/tunnel. It refuses to run over an existing test package. `PAPAN_ANDROID_CAMERA_ONLY=1` skips clipboard checks and uses a share intent. Reports/screenshots go to `artifacts/android/ui` in the desktop checkout. These isolated checks do not exercise optical scanning of a desktop screen or establish physical-phone Wi-Fi reachability. The personal app and pairing are untouched by this suite.

The older `test:phone` optional Android path requires a dedicated disposable device/profile running the companion's `--debug` build of `com.papan.share`; do not use it with a personal pairing. `PAPAN_PHONE_PORT` selects an available/allowed test port. `PAPAN_PHONE_USB=1` adds a temporary loopback-only ADB reverse bridge.
