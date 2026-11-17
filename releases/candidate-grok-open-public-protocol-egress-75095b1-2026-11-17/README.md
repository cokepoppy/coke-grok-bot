# Public computer egress on all protocols

This release updates the Mac-local desktop broker and the four existing Grok user desktop network policies. Public IPv4 destinations have no port/protocol list. Existing private, cluster, link-local, loopback and per-tenant boundaries are preserved.

The immutable broker image is pinned in `artifacts/desktop-broker-image.txt`. The image is kept in the local Docker/K3D stores instead of duplicating a large image tar in this directory. `source/source.tar.gz`, the bundled broker, Dockerfile, and scripts are sufficient to rebuild and redeploy it.

See `operations/2026-11-17.md` for deployment evidence and the limits of verification.
