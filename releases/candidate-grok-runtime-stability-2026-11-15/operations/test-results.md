# Verification

- `npm run test:runtime-pollers`: 2/2 passed.
- Scheduler, Browser User, sign-in boundary focused suite: 42/42 passed.
- `npm run test:runtime`: 209/209 passed.
- `COKE_GROK_TEST_MYSQL_PORT=13317 npm run test:runtime-mysql`: 20/20 passed on the existing fixed test MySQL container; it was stopped afterward.
- `npm run build:deployment`: passed.
- Public signed-in Browser/Computer Use: passed; see `public-e2e.md` for direct UI evidence and limits.
