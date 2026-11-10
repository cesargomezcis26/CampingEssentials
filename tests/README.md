# Integration checks

These development dependencies are separate from the static website:

```sh
cd tests
npm ci
npm test
```

`database.mjs` executes the actual setup SQL using PGlite (PostgreSQL in WASM), with mock `auth.users`, `auth.uid()`, and `auth.jwt()` definitions. It verifies RLS under separate database roles, including unauthorized reads/writes, invited joins, atomic item claims, claimant/organizer release permissions, display-name validation, stale-token email changes, unverified/anonymous account rejection, cross-trip/key reassignment, SQL-looking payloads, and revoked membership. It also exercises the incremental migrations and retention of existing data. It never connects to the hosted database.

`browser.cjs` starts its own local static server and uses the actual vendored SDK. All Supabase requests are intercepted with test responses; no test sign-in emails or hosted records are created. It tests the login gate, automatic trip opening, claim/release behavior, safe display-name rendering, absence of dropdowns, sign-out race protection, CSP, and responsive layout. The test exposes the real SDK client only in the intercepted test bundle to simulate sign-out during a request; production code has no such hook. It overrides the project configuration with a test publishable key.

The browser runner uses `/usr/bin/chromium` when present; otherwise install the Playwright browser with `npx playwright install chromium`. You can set `CHROMIUM_EXECUTABLE` to another Chromium executable.

These checks do not replace the hosted-project verification in `supabase/README.md`.
