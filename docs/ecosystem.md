# Papan ecosystem

Papan is one product family with three independently released components: capture links on Android, collect and organize references on desktop, then use saved references in ComfyUI. This page owns the component inventory, shared contracts, compatibility evidence, and tracking conventions. Detailed usage and implementation stay in the linked component documentation.

Release inventory checked on **7 October 2026** against each repository's published GitHub release.

## Components and ownership

| Component | Canonical source and responsibility | Published release | Release process |
| --- | --- | --- | --- |
| Desktop | [chelij/papan](https://github.com/chelij/papan): collections, extraction, storage, encryption, file formats, and local phone receiver | [v0.2.3](https://github.com/chelij/papan/releases/tag/v0.2.3) | `package.json` version; [desktop workflow](../.github/workflows/desktop.yml) checks and packages Linux x64, Windows x64, and macOS ARM64; matching release tag and [release notes](release-notes.md) |
| Android | [chelij/papan-android](https://github.com/chelij/papan-android): native capture, pairing, durable phone queue, and delivery | [v0.2.0](https://github.com/chelij/papan-android/releases/tag/v0.2.0) | Package and Android manifest versions agree; [build workflow](https://github.com/chelij/papan-android/blob/main/.github/workflows/android.yml) verifies disposable-key builds; maintainer publishes APK and checksum signed with the existing release key |
| ComfyUI | [chelij/comfyui-papan](https://github.com/chelij/comfyui-papan): saved-board reader, reference node, and workflow persistence | [v0.1.3](https://github.com/chelij/comfyui-papan/releases/tag/v0.1.3) | `VERSION` and `RELEASE_NOTES.md`; [release workflow](https://github.com/chelij/comfyui-papan/blob/main/.github/workflows/release.yml) checks and publishes the versioned ZIP and checksum on a matching tag |

The standalone ComfyUI repository is authoritative. Its frontend has fixes beyond the former embedded copy, and it already owns tests and releases. `extensions/comfyui-papan/README.md` remains only as a migration pointer; desktop no longer builds or publishes an extension. Make extension changes in `chelij/comfyui-papan`. There is no ongoing source mirror.

Version numbers describe each component's own releases. Compatibility follows the shared contracts below, rather than matching component version numbers. ComfyUI reads chosen saved files without requiring a running desktop application. The Android companion needs a running, reachable desktop receiver.

## Shared contracts

| Contract | Owner and consumers | Required behavior and reference |
| --- | --- | --- |
| Local phone protocol v1 | Desktop owns the server; Android consumes it | Pairing response version `1`; `/v1/pair` and `/v1/shares`; stable request IDs, durable acceptance, and saved receipts. Preserve pending URLs across retries, restart, and revocation. [Protocol and recovery](mobile-sharing.md#local-protocol-v1) |
| Ordinary `.papan` v1 | Desktop writes; desktop and ComfyUI read | JSON `papan-collection`, version `1`; IDs and referenced media remain meaningful. Absolute media paths must be accessible to the reader. [Saved-file behavior](usage.md#save-lists-or-export-portable-copies), [writer/validator](../src/collection-files.js) |
| Portable `.papan.zip` v1 | Desktop writes; desktop and ComfyUI read | ZIP with `collection.json` (`papan-bundle`, version `1`) and bounded relative `media/` entries; preserve media and reject unsafe paths. [Export/import](../src/portable.js), [archive validation](../worker/archive.py) |
| Encrypted `.papan` v1 | Desktop writes; desktop and ComfyUI read | `PAPANENC` container with authenticated `papan-encrypted` version `1` manifest and media chunks. Preserve password, corruption, and lock handling. [Encryption specification and limits](encryption.md) |
| Saved ComfyUI workflows | ComfyUI extension owns the persisted reader state | Board/item identities, selected output mappings, IMAGE/VIDEO/SECONDS connections, and retained references survive reload without silently rewiring. [Workflow storage](https://github.com/chelij/comfyui-papan#protected-boards-and-workflow-storage) |

Protection semantics cross these boundaries: phone transport is HTTP on a trusted LAN; desktop encryption protects stored collections; connected ComfyUI references become plaintext input files after unlocking. Preserve these disclosures when changing a contract.

## Compatibility and evidence

"Supported" describes the documented contract. "Checked" records the exact test scope; neither implies that every release pair or operating system has been exercised.

| Combination | Supported contract | Checked evidence and remaining gap |
| --- | --- | --- |
| Android v0.2.0 → desktop | Desktop **v0.2.1 or newer**, Android 8+, receiver protocol v1, as declared in the [Android guide](https://github.com/chelij/papan-android#use-it) | [Android v0.2.0 release evidence](https://github.com/chelij/papan-android/releases/tag/v0.2.0) records clipboard, camera, rotated QR fixtures, pairing, and actual saves on Samsung SM-S916B / Android 16 with an isolated test app and USB transport. Optical scanning, Wi-Fi reachability, and an exact published desktop/APK pair are not established by that check. |
| Desktop files → ComfyUI v0.1.3 | Ordinary, portable, and encrypted formats **v1**; encrypted desktop collections require desktop v0.2.0+. No blanket desktop version range is claimed. | [Fixture provenance](https://github.com/chelij/comfyui-papan/blob/v0.1.3/tests/fixtures/README.md) pins the native vault writer to desktop `c01beea`. On 7 October 2026 its bytes were confirmed identical to `src/vault.js` at desktop tag `v0.2.3`; all nine [file/endpoint tests](https://github.com/chelij/comfyui-papan/blob/v0.1.3/tests/test_board.py) passed locally with Python 3.13 using `python -m unittest discover -s tests -v`. These checks cover fixture-based formats and native encryption, rather than a full save/export from a packaged desktop followed by import. |
| ComfyUI v0.1.3 → ComfyUI runtime | Python 3.11+, native IMAGE/VIDEO support, and the extension requirements | [v0.1.3 notes](https://github.com/chelij/comfyui-papan/releases/tag/v0.1.3) record wire endpoints, connections, board switching, zoom/pan, saved workflows, and both renderers. The [guide](https://github.com/chelij/comfyui-papan#install) records Linux checks with ComfyUI 0.37.0 / frontend 1.53.6 and ComfyUI Desktop 0.39.0 / frontend 1.53.10. Windows and macOS extension behavior remain unverified. |

Desktop platform checks are recorded separately in [verification.md](verification.md). iPhone sharing is currently an [untested setup recipe](mobile-sharing.md#iphone-preparation), with no native iOS component or release.

## Next milestone

Establish reproducible compatibility evidence for the published components:

- [Android release-pair check](https://github.com/chelij/papan-android/issues/1): record exact released desktop/APK versions, optical QR pairing and delivery over Wi-Fi, queued delivery after reconnect, and a durable saved receipt.
- [Desktop exports → ComfyUI check](https://github.com/chelij/comfyui-papan/issues/1): open real ordinary, portable, and encrypted exports from a named desktop release in a named extension release, then verify media, unlock/corruption handling, connections, and workflow reload. Preserve fixture provenance.
- [ComfyUI platform checks](https://github.com/chelij/comfyui-papan/issues/2): verify installation, file opening, references, and workflow reload on Windows and macOS, or retain explicit platform limits.

The [coordinating milestone](https://github.com/chelij/papan/issues/1) links these component tasks and owns their combined acceptance criteria. The actionable backlog lives in [desktop issues](https://github.com/chelij/papan/issues), [Android issues](https://github.com/chelij/papan-android/issues), and [ComfyUI issues](https://github.com/chelij/comfyui-papan/issues). This page indexes the work; status stays in the issues.

## Tracking and upkeep

1. Search existing issues before creating work. File implementation tasks in the repository that owns the affected code. Include the user-visible result, smallest meaningful check, and relevant contract or version pair.
2. For work crossing repositories, create one coordinating issue in `chelij/papan` with links to component issues and acceptance criteria. Component issues link back. Track status in those issues; add a shared GitHub project when the backlog needs a combined view.
3. When a change affects another component, update this page's contract or compatibility entry and the coordinating issue in the same work. Record exact versions/commits, platform, check, evidence link, and limits. Mark unsupported or untested combinations explicitly.
4. Before publishing a release, check affected consumers and update the intended compatibility and limitations. After publication, update the release inventory with the actual tag/link and checked date. Retain evidence for unchanged behavior; a new tag alone does not establish a new release-pair test.
5. Add future components here before their first release: purpose, canonical repository, contract dependencies, release process, supported compatibility, and evidence. Keep component instructions pointed at this page rather than duplicating the inventory.
