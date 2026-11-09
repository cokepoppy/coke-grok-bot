# Operations log

## 2026-11-09

- Built and deployed Browser Task authorization candidate r3 to the existing Mac-local K3D owner namespace. Auth/Agent/Desktop image pins were verified; the persistent workspace PVC remained Bound and unchanged; the Broker image stayed fixed.
- Ran `npm run test:runtime` after generic policy refinements: 160/160 passed. `npm run build:deployment`, JavaScript syntax checks, and `git diff --check` passed.
- Started the requested Gmail flow through visible public Chrome and the product chat. The cloud computer was user-controlled at Google's account chooser. No credentials, messages, or mailbox data were touched; full Gmail E2E remains pending the user sign-in handoff.
- Do not deploy the next Desktop candidate while any Bot screen is user-owned. MySQL/PVC and unrelated namespaces remain out of scope.
