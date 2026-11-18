# noVNC cursor override

This directory contains the noVNC 1.6.0 `core/util/cursor.js` file with the
cursor scaling and clipping changes from noVNC PR #2077, pinned to upstream
commit `f870d809b90c0ff5e719fbedfba42f4ce3816062` in `opslag/noVNC`.

The upstream change was still an open, unmerged pull request on 2026-11-18, so
this is an explicit downstream override, not a claim that noVNC 1.6.0 already
contains the fix. It maps the remote cursor bitmap and pointer coordinates to
the scaled canvas rectangle and refreshes them when the viewer geometry
changes. It does not hide or replace the remote cursor.

The file retains the upstream MPL-2.0 header. The desktop image already
contains the noVNC distribution and its `LICENSE.txt`; this override replaces
only `/usr/share/novnc/core/util/cursor.js` in the Coke Grok desktop image.

SHA-256 of the vendored file:

```text
20ab397d1b9deec9caf377cf461c53b4fe58bc57ac6bc5b888824f21632d90b4
```
