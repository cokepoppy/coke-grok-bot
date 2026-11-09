# Operations log

## 2026-11-09

- Built and deployed Browser Task authorization candidate r3 to the existing Mac-local K3D owner namespace. Auth/Agent/Desktop image pins were verified; the persistent workspace PVC remained Bound and unchanged; the Broker image stayed fixed.
- Ran `npm run test:runtime` after generic policy refinements: 160/160 passed. `npm run build:deployment`, JavaScript syntax checks, and `git diff --check` passed.
- Started the requested Gmail flow through visible public Chrome and the product chat. The cloud computer was user-controlled at Google's account chooser. No credentials, messages, or mailbox data were touched; full Gmail E2E remains pending the user sign-in handoff.
- Do not deploy the next Desktop candidate while any Bot screen is user-owned. MySQL/PVC and unrelated namespaces remain out of scope.

- Built candidate source `f426c2b1ce5c0f0cfca8cd028a5f5be7ab2f9d12`; Auth image ID `sha256:3a3c8b589d2f1b83a176e5ddd7972d5acee36297b12928f8454a941bc31506ea`, shared Agent/Desktop image ID `sha256:e5d1067934dfb081f0e5aee356d1f544e9a12c0705b06222ef63948f17224db7` (linux/arm64).
