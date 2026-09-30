# Collection encryption

Password protection is available from v0.2.0. It encrypts collection content and saved media at rest. Versions before v0.2.0 do not understand encrypted collections; use v0.2.0 or later to open them.

## Format and keys

`src/vault.js` implements the container using Node's built-in [scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback) and [AES-GCM](https://nodejs.org/api/crypto.html#cryptocreatecipherivalgorithm-key-iv-options). No new encryption dependency is installed.

A `.papan` encrypted container begins with the eight bytes `PAPANENC`. Its 100-byte header holds a 16-byte random salt, a wrapped 32-byte random data key, and two big-endian unsigned 64-bit numbers giving the encrypted manifest offset and length. Version 1 uses scrypt N=131072, r=8, p=1, a 32-byte output, and a 256 MiB allocation limit. The salt and magic are authenticated when wrapping the key. Passwords are 8–1,024 JavaScript characters; they are never trimmed, saved, or sent to the renderer from the main process.

Every sealed record contains a fresh random 12-byte nonce, a 16-byte authentication tag, and AES-256-GCM ciphertext. The JSON manifest is authenticated against the complete header and contains a format identifier, version, collection settings, pins, removal history, and media references. Imports validate the authenticated manifest before it enters the library.

Media is divided into independently authenticated 1 MiB chunks. Chunk authentication includes a random entry ID, chunk index, and total media size. Entries record offset, length, and extension inside the encrypted manifest. A requested byte range decrypts only the intersecting chunks and verifies each tag before releasing bytes. Media responses use `Cache-Control: no-store`; Chromium's HTTP disk cache is disabled and existing cache is cleared. The renderer receives an `encrypted` flag and opaque pin/item URLs, not keys or vault offsets.

Changing a password creates a new random data key and salt and re-encrypts the current media and metadata. An old key cannot decrypt future content. Local active/recovery vaults and the attached destination's current/previous files are updated; independent exports cannot be revoked or changed remotely. Keys are held in main-process memory only and their buffers are overwritten on lock or exit. JavaScript strings, decoded media, OS memory, and swap are outside any guarantee of secure memory erasure.

## Transactions and recovery

`src/protection.js` handles unlocked sessions and the conversion between ordinary media and encrypted entries. `library.json` persists a small stub for each protected board: ID, visible name, creation time, closed state, destination metadata, and vault filename. Pin contents and pin-removal history are omitted. Deleted protected boards retain a vault reference and restore locked.

Each save creates an immutable vault under `vaults/<uuid>.papan`, cloning the prior ciphertext when available and appending changed media and a new authenticated manifest. This avoids decrypting unchanged media for metadata edits. Filesystems with copy-on-write support can clone the ciphertext efficiently; others copy it. Password changes start a fresh container instead of cloning ciphertext under the old key. Current and previous snapshots retain their referenced vaults; unreferenced versions are collected. Append-only encrypted history can increase file size, so a later compaction feature may be appropriate for heavily edited large collections.

The new ciphertext is completed and synced before atomically replacing metadata. Encryption and password changes also replace recovery metadata so it does not preserve plaintext pins or an obsolete password. The same applies when moving a pin into a protected collection. Automatic external saves receive the prepared encrypted file; rollbacks keep large encrypted copies on disk instead of loading them into memory. Ordinary external JSON is bounded and kept in memory during rollback. Existing multi-volume crash-consistency limitations still apply.

After commit, a persisted cleanup list removes owned, unshared plaintext media and unused files in their directories. It is retried on startup if interrupted; a cleanup failure is reported in the app. Imported originals and files referenced by another ordinary collection are preserved. No secure-erasure or filesystem-snapshot guarantee is made. Failed transactions retain the prior library and attempt to restore external destinations; recovery failures preserve available copies and report the location.

Downloads belonging to protected collections store their payload, title, progress, errors, and result encrypted in `downloads.json`. An opaque record keeps only task ID, kind, state, creation time, and collection IDs visible. Interrupted work stays paused; unlocking is required to retry. Completed tasks are removed rather than retained as history. Lock/password operations wait for active saves and downloads to finish.

## Practical limits

- Collection names, filenames, destinations, sizes, task timing, and collection counts are visible.
- Unlocking exposes content to the running application. This does not defend against malware, a compromised OS, or another process able to inspect its memory.
- New downloads/conversions use private temporary directories while unlocked. Playback itself does not produce a decrypted disk copy. Interrupted staging is removed at startup.
- External originals, older exports, unprotected copies in other collections, OS backups, and recoverable remnants of formerly plaintext files are separate copies.
- There is no password recovery, keychain storage, inactivity timer, or automatic lock when changing tabs. Lock explicitly, close the tab, or quit.
- Manifest data is limited to 64 MiB and each media entry to 512 MiB. Encrypting or copying a large collection needs enough free disk space for its new container and recovery copy.

The format has automated round-trip, corruption, range, recovery, and UI tests; it has not had an independent cryptographic audit. See [verification](verification.md) for the precise runtime coverage.
