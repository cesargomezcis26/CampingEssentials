# Integration checks

These development dependencies are separate from the static website:

```sh
cd tests
npm ci
npm test
```

`database.mjs` executes the actual setup SQL using PGlite (PostgreSQL in WASM), with mock `auth.users`, `auth.uid()`, and `auth.jwt()` definitions. It verifies RLS under separate database roles, including unauthorized reads/writes, invited joins, member edits, personal isolation, validation, stale-token email changes, unverified/anonymous account rejection, cross-trip/key reassignment, SQL-looking payloads, and revoked membership. It also executes the incremental security migration twice to verify repeatability and retention of existing data. It never connects to the hosted database.

`browser.cjs` starts its own local static server and uses the actual vendored SDK. All Supabase requests are intercepted with test responses; no test sign-in emails or hosted records are created. It tests sign-in, loading, saving only changed fields, retrying failed saves, invitations, local fallback, sign-out, responsive layout, CSP blocking of injected scripts/handlers, and a delayed-response/sign-out race. The test exposes the real SDK client only in the intercepted test bundle to simulate sign-out during a request; production code has no such hook. It overrides the project configuration with a test publishable key.

The browser runner uses `/usr/bin/chromium` when present; otherwise install the Playwright browser with `npx playwright install chromium`. You can set `CHROMIUM_EXECUTABLE` to another Chromium executable.

These checks do not replace the hosted-project verification in `supabase/README.md`.
