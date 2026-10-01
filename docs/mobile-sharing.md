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
5. Choose **pair a phone** on the desktop. Open the Android companion and tap **Pair desktop**: its camera opens immediately. Allow camera access when Android asks, then point it at the desktop QR to pair automatically. **Paste pairing link instead** works without camera access; you can also enter the complete pairing link in the setup screen. The link expires after five minutes and can be used once. The phone's system camera can still open the QR's pairing page and its **Open Papan companion** link.
6. In another app, share a link and choose **Papan**, or copy a link and tap **Paste link** in the companion. Paste reads the current clipboard only when tapped and queues the first HTTP/HTTPS URL in its text. Android does not expose clipboard history. The companion immediately attempts delivery and keeps undelivered links queued.

After pairing, setup collapses into **Connection settings**. **Paste link** is the single action for adding a copied link: it queues and attempts delivery in one tap. Camera frames are decoded on the phone and are never saved or sent to the desktop. Camera access is optional; pasting and ordinary share-sheet delivery work without it.

The desktop saves all extracted items, up to the existing 50-item limit, with the first item as cover. It uses the destination collection's preview/original storage setting. It skips a source already saved in that collection. Use **edit pin** afterward to change the cover or remove unwanted media.

## Delivery and recovery

- **Queued on phone:** the URL is in app-private storage but Papan has not acknowledged it. An unavailable desktop, locked destination, full inbox, or firewall block keeps the URL on the phone.
- **Received by Papan:** the desktop durably stored it. Extraction may still be running or may have failed. The phone checks the receipt rather than uploading again.
- **Saved in Papan:** the desktop committed the pin. The phone removes its queue entry only after seeing this receipt.

Android schedules background retries, but battery restrictions and force-stopping can defer them. Open the companion or use **Send pending / check saves** for an immediate attempt. For the first 30 seconds after opening or sharing, the foreground screen also checks pending deliveries and saves every 1.5 seconds between requests. The queue survives process restarts and reboots; reboot scheduling uses Android's persisted JobScheduler.

Desktop **Receive from phone → incoming links** shows progress, failed links, retry, and dismiss actions. Successful receipts stay until dismissed or cleared. The desktop accepts at most 100 unfinished links and 5,000 receipts; the phone holds at most 100 pending links. Clear saved receipts to reclaim receipt capacity. Clearing a receipt removes its status lookup, so first let the phone observe completed saves. It never removes the pin itself.

The destination is captured when the desktop accepts a link. Changing the default affects later acceptances. If the desktop's IP address changes, select the new address in desktop settings, then open **Connection settings → Update desktop address** in the Android companion with the same port. This retains the pairing key and queue. Replacing a pairing is blocked while the phone has pending entries; deliver or deliberately dismiss them first.

Revoking a paired device prevents new submissions and receipt checks. Links already accepted on the desktop remain. The Android companion preserves unresolved links and reports that it must be paired again. Dismissing an entry on the phone does not cancel an already accepted desktop save.

## Privacy and protection

The receiver is disabled initially, binds to the selected private IPv4 interface, and accepts only HTTP/HTTPS source links. It checks the exact Host header, rejects browser Origin requests, bounds JSON bodies, and requires a device-specific key. Pairing attempts are limited. Paired devices can submit links and read their own receipts; they cannot list collections, read pins/media, or change desktop settings.

**Transport uses ordinary HTTP. Use a trusted local network.** Links and pairing/authentication traffic are not encrypted in transit; someone able to inspect or alter that network traffic can see links or steal a pairing key. Collection encryption protects desktop storage, not the network connection or the Android queue. The phone stores its key and pending URLs in app-private files with Android backup disabled. Do not share the pairing link or copy the phone's private configuration.

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
| `POST /v1/shares` | `{ "id": "STABLE_REQUEST_ID", "url": "https://example.com/" }`; Bearer token | `202` accepted/pending, or `200` already saved; `id`, `state`, `received`, `error` |
| `GET /v1/shares/ID` | Bearer token | `200` receipt for that device's ID |

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

The Android integration check installs only `com.papan.share.test`, verifies its virtual display before interacting, and uses a disposable library and loopback-only USB tunnel. It checks clipboard paste/deduplication, immediate camera launch and live frames, rotated QR fixtures, pairing, actual media saving, and foreground completion. It restores the previously readable clipboard only if its own test value is still current, then removes its APK/tunnel. It refuses to run over an existing test package. `PAPAN_ANDROID_CAMERA_ONLY=1` skips clipboard checks and uses a share intent. Reports/screenshots go to `artifacts/android/ui` in the desktop checkout. This does not exercise optical scanning of a desktop screen or establish Wi-Fi reachability. The personal app and pairing are untouched.

The older `test:phone` optional Android path requires a dedicated disposable device/profile running the companion's `--debug` build of `com.papan.share`; do not use it with a personal pairing. `PAPAN_PHONE_PORT` selects an available/allowed test port. `PAPAN_PHONE_USB=1` adds a temporary loopback-only ADB reverse bridge.
