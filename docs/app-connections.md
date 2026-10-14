# Connect apps to your Papan library

Papan v0.3.2 includes a read-only library service for compatible applications on the same computer. Papan owns the library; each app gets its own access key and a chosen set of collections. No account or Picteus dependency is involved. The [ComfyUI extension v0.1.4](https://github.com/chelij/comfyui-papan#connect-papan) includes an adapter. Other applications, including Picteus, need their own adapter for the protocol below.

## Setup

1. Open **Connect apps** from the chain button in the toolbar, or the empty canvas.
2. Enable app connections and save the settings. The default address is `http://127.0.0.1:47779`. Choose a different port if it is already in use.
3. Enter an app name, select its collections, and create an access key. Unlock a protected collection in Papan before adding it.
4. Copy the connection into your app's Papan adapter. The copied JSON contains `version`, `endpoint`, and `token`. Papan shows the key once; save it before closing the dialog.

Use **change access** to edit the selected collections, or **revoke** to invalidate a key. A lost key requires revoking that app and creating a new connection. Disabling connections stops the listener but keeps grants for the next time you enable it. Grants survive restarting Papan; protected collections start locked.

Keep Papan open while connected apps use it. This version listens only on IPv4 loopback, with manual address/key configuration. LAN connections and mDNS/DNS-SD discovery are deferred. The phone receiver remains a separate feature and protocol.

## ComfyUI

In the updated Papan Board node, click **Connect Papan…**, paste the connection copied above, then choose **Open collection**. Papan and the **ComfyUI server** must run on the same computer; the browser may run elsewhere. This requires desktop v0.3.2 or newer and extension v0.1.4 or newer. Extension v0.1.3 continues using saved files and does not include this connection flow.

The extension stores the app key in ComfyUI's user directory and keeps it out of workflows and media URLs. Live previews stream through the ComfyUI backend; edits, locking and access changes refresh opened boards automatically. Unlock protected collections in Papan. Every execution checks current access, including cached workflows. Existing saved-file workflows retain their previous behavior.

Executing references creates ordinary ComfyUI input copies, and downstream nodes may retain outputs. Locking/revocation prevents new reads but cannot remove already delivered files or tensors. Live workflows require Papan access on subsequent runs and do not silently fall back to those copies. [Extension setup and storage](https://github.com/chelij/comfyui-papan#connect-papan), [adapter tracking](https://github.com/chelij/comfyui-papan/issues/5).

## Protected collections

Passwords and encryption keys stay in Papan's main process. Unlocking happens in Papan. An authorized app can read decrypted metadata and stream saved media while the collection is unlocked; stored vaults remain encrypted, and this service creates no plaintext playback files.

Locking hides pins and search results and cancels active streams. Revoking an app or removing a collection from its grant also cancels that access. Collection names and a locked flag remain visible to an app already granted that collection. Apps cannot unlock collections through the API. An app may retain metadata or bytes it already received; locking or revocation cannot recall those copies.

## Library protocol v1

The desktop owns this protocol. It does not change saved `.papan`, portable ZIP, encrypted vault, or phone protocol versions.

All routes are read-only. Send `Authorization: Bearer <token>` on every request except the capability handshake. Media URLs require the same header; credentials never appear in URLs. The exact `Host` must match the loopback address/port. Requests with an `Origin` header are rejected, with no CORS access. Use a native application, extension backend, or local app backend; a webpage cannot directly read this service.

| Request | Result |
| --- | --- |
| `GET /v1` | Public capability handshake: `service: "papan-library"`, `version: 1`, opaque stable `serverId`, and capabilities |
| `GET /v1/collections` | Granted collections: `id`, `name`, `createdAt`, `protected`, `locked` |
| `GET /v1/pins` | Saved pins from granted, unlocked collections |
| `GET /v1/search` | The same pin page with search filters |
| `GET /v1/pins/{pinId}/items/{itemId}/media?variant=original` | Locally saved original bytes; use `variant=preview` for a cached preview |
| `HEAD` on media | Content length/type and range support, without bytes |
| `GET /v1/events` | Authenticated server-sent events for this app's granted content |

Collections, pins and search return `{version: 1, revision, items, total, nextOffset}`. Use `offset` (default `0`) and `limit` (default `50`, maximum `200`). Pass `nextOffset` to fetch subsequent pages; `null` means complete. These are current views, not frozen snapshots. If a revision changes during pagination, restart the listing to avoid skipping or repeating pins.

Pin routes accept `collectionId`, `q`, `kind`, `source`, and `tag`. `q` searches titles, authors, notes, tags, saved text and source URLs, without case sensitivity. `kind` is `image`, `video`, or `text`; `source` is a hostname, ignoring a leading `www.`; `tag` is an exact, case-insensitive tag. Unicode and spaces are preserved. Query, tag and source limits are 500, 40 and 253 characters respectively. Unselected or locked collections never contribute results.

Pins contain their IDs, collection ID, title, notes, tags, source URL, author/text/engine when saved, creation date, cover and preview selections. Items contain IDs, kinds, dimensions, duration, saved text and pose attachment relationships/options when present. `previewUrl` and `originalUrl` exist only when Papan has the corresponding saved media. Online collections may have previews without downloaded originals. This service neither downloads missing media nor proxies source sites. No filesystem paths, vault references, passwords or encryption keys are returned.

Media responses use the existing authenticated range reader, support single byte ranges and seeking, and send `Cache-Control: no-store`. A successful response is `200`, or `206` for a range; an unsatisfiable range returns `416`. Clients must honor no-store and decide explicitly whether to import copies into their own library. Decryption corruption or an interrupted/revoked transfer can terminate the response before completion; clients must treat incomplete bodies as failures.

| Status | Meaning |
| --- | --- |
| `400` | Invalid pagination, filter, or media variant |
| `401` | Missing, invalid, or revoked app key |
| `403` | Untrusted host/origin |
| `404` | Unknown/ungranted resource or unavailable saved media; a previously known media URL also returns this after locking |
| `405` | Write method or unsupported HEAD request |
| `423` | A request explicitly selects a granted, locked collection; unlock it in Papan |
| `429` | Event connection limit reached |
| `503` | Protection is changing; retry after it finishes |

Errors return JSON with an `error` message. Disabling connections or quitting Papan closes the listener, so clients may instead receive a connection failure.

## Change notifications and reconnects

`/v1/events` sends a `ready` event immediately, then a `change` event when visible library data or access changes. Each carries `{revision, reset}` and an SSE `id` equal to the opaque revision. Events carry no pin metadata. The service sends heartbeat comments every 15 seconds. Each app may hold four event connections, with 64 total; stalled readers are disconnected.

On reconnect, send the last revision in `Last-Event-ID`. A matching cursor yields `ready` with `reset: false`. Missing/stale cursors, a process restart, or any `change` yield `reset: true`: refetch collections and the relevant pin/search pages. This protocol invalidates the current view; it does not replay a durable event log. Changes to ungranted collections do not advance an app's revision. Revocation closes its subscriptions. Library notifications occur after successful commits, including writes from downloads, edits, imports and protection changes. Changes to external media files outside Papan do not emit events. Protection transitions temporarily invalidate affected grants before a commit so active streams stop immediately; apps granted only unrelated collections keep their current view.

This Node.js example runs in an app backend with the copied connection object:

```js
const { endpoint, token } = connection;
const headers = { Authorization: `Bearer ${token}` };
const response = await fetch(`${endpoint}/v1/search?q=reference&limit=50`, { headers });
if (!response.ok) throw new Error(`Papan returned ${response.status}`);
const page = await response.json();
for (const pin of page.items) {
  for (const item of pin.items) {
    const url = item.originalUrl || item.previewUrl;
    if (!url) continue;
    const media = await fetch(url, { headers });
    if (!media.ok) throw new Error(`Media returned ${media.status}`);
    await media.body.cancel(); // Replace this with your app’s streaming media consumer.
  }
}
```

Use a streaming HTTP client for SSE so it can send the authorization and reconnect headers. Browser `EventSource` cannot supply this authentication header and browser origins are not allowed.

## Storage and checks

`library-service.json` in Papan's library directory stores the enabled flag, port, stable server ID and app grants, with only SHA-256 hashes of random 256-bit access keys. Writes replace the file atomically with POSIX owner-only permissions (`0600`). No changes are made to collection or vault formats. An invalid settings file is preserved and reported instead of silently resetting app access.

`test/library-service.test.js` exercises real loopback clients and actual library/vault storage. `npm run test:app-connections` checks the production Electron UI, preload and IPC on an isolated X display. [Verification and limits](verification.md#local-app-connections-12-october-2026), [implementation tracking](https://github.com/chelij/papan/issues/4).
