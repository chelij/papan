# Applied AI workflow: Papan and ComfyUI

## Problem

References used in creative AI workflows can become scattered across browser tabs, downloaded files, and workflow inputs. Papan collects images, videos, and articles locally; its ComfyUI extension turns selected references into node outputs.

## Workflow

1. Collect a reference in Papan.
2. For a suitable human video, optionally extract a local DWPose control video.
3. Grant the ComfyUI connection access to selected collections.
4. Select references in the Papan Board node and connect image/video outputs.
5. Keep the same saved output identities as the library changes.

[Desktop demonstration](../README.md) · [Extension screenshot and instructions](https://github.com/chelij/comfyui-papan#readme)

## Implementation decisions

| Need | Implementation and tradeoff | Evidence |
| --- | --- | --- |
| Local inference | DWPose through ONNX Runtime on CPU; optional model/tool setup adds capability without requiring a hosted inference service. | [Pose worker](../worker/pose.py) · [Pose orchestration](../src/pose.js) |
| Recoverable background work | A persisted queue with explicit failure, retry, cancellation, and duplicate checks; collection writes remain separate from media work. | [Download queue](../src/download-queue.js) |
| Access-aware integration | Explicit local app connections and collection grants; the node rechecks access during execution. | [Connection protocol](app-connections.md) · [Node implementation](https://github.com/chelij/comfyui-papan/blob/main/nodes.py) |
| Stable workflows | Reference identities and output mappings survive saved workflows, while unavailable references remain unavailable. | [Extension usage and limits](https://github.com/chelij/comfyui-papan#readme) |
| Independent components | Desktop owns formats and the provider protocol; Android and ComfyUI have separate repositories and compatibility requirements. | [Ecosystem](ecosystem.md) |

## Verification

The repository contains checks for queue/library behavior, pose handling, collection protection, app connections, and native desktop workflows. The desktop workflow runs source checks and packaged-app checks on Linux, Windows, and macOS.

- [Desktop workflow](../.github/workflows/desktop.yml)
- [Desktop tests](../test/)
- [ComfyUI backend tests](https://github.com/chelij/comfyui-papan/tree/main/tests)
- [Recorded checks, exact versions, and limitations](verification.md)

The [19 October 2026 desktop run](https://github.com/chelij/papan/actions/runs/39263018796) is recorded as successful. These are repository/CI records, not a fresh independent run of every workflow.

## Boundaries

Papan is a reference-management application with an AI pose-extraction component and ComfyUI integration. It does not train a model or establish generation quality. Site extraction can fail, the local connection has deployment constraints, and the verification record distinguishes tested environments from unverified ones.

The project does not currently publish measured customer adoption, time savings, pose accuracy, or comparative generation results.

## Try it

[Desktop releases](https://github.com/chelij/papan/releases) · [ComfyUI releases](https://github.com/chelij/comfyui-papan/releases) · [Android companion](https://github.com/chelij/papan-android)
