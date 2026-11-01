# Grok Bot website demo UI checkpoint

This checkpoint freezes the accepted homepage demo UI on the existing `main` line. It is not a claim that the full Grok Bot product is complete: real Pi/DeepSeek task execution, Browser User, Computer User, persistent cloud-computer behavior, tenant isolation, and public end-to-end acceptance remain separate work.

The source archive and small build archive are tracked. The 80 MB OCI image archive is kept locally at `images/coke-grok-auth-ui-checkpoint-linux-arm64.tar` and intentionally excluded from Git; it contains both the checkpoint image and the verified currently deployed rollback image. The committed checksum file includes the image archive hash, so `verify.sh` requires the local image payload to be present.

No K3D workload was changed to create this checkpoint. `install.sh` and `rollback.sh` are prepared only; both require an explicit `--apply` argument and the expected local K3D context. MySQL and PVC state are preserved by the rollback procedure.
