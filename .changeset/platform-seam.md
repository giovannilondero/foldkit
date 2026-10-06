---
'foldkit': minor
---

Add a `platform` option to `makeElement` and `makeApplication` so a runtime can render somewhere other than the browser DOM. A `Platform` supplies the snabbdom node API (`domApi`), the complete snabbdom module list (`modules`), and the render frame clock (`requestFrame`). `browserPlatform` is the default and keeps today's behavior. With any Platform other than `browserPlatform`, `makeApplication` skips the hydration lookup and never writes the document `<head>`.

The runtime also no longer assumes browser globals on this path: root mount, patch-failure recovery, and container restore go through `domApi`, `instanceof Element` checks are guarded for hosts without an `Element` global, and the deferred message drain falls back to `setTimeout(0)` when `MessageChannel` is missing.

`foldkit/runtime` now exports `Platform`, `browserPlatform`, `onUnmountModule`, `requireDispatch`, and the `DOMAPI`, `Module`, and `VNode` types.
