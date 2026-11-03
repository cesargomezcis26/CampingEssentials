# Starcamp security review

Reviewed 2026-11-03 against repository base commit `c41cebf` plus the local fixes described below. This is a source review and local test report, not a guarantee against all vulnerabilities or proof of hosted configuration.

## Result

No SQL-injection path was found in the reviewed application. Supabase requests send data through fixed table names, typed filters, and structured JSON. The SQL functions contain no dynamic SQL or interpolated statements. Tests confirm that SQL-looking names remain literal text, malformed UUID arguments are rejected, and numeric/boolean/length constraints are enforced.

Two privacy/authorization edge cases were reproduced against the original code and fixed locally:

| Finding | Conditions and impact | Fix |
| --- | --- | --- |
| Invitation acceptance trusted a stale JWT email | After changing a verified account email, an older still-valid token could accept an invitation for the previous email. This requires an applicable pending invitation; it is not arbitrary account takeover. | Resolve the current verified email from `auth.users` using a fixed-search-path helper, and use it for invitation acceptance. Regression fails on the old SQL and passes on the patched SQL. |
| Private data could reappear after sign-out | A trip request started before sign-out could finish afterward and repopulate private fields/labels on that browser. Server permissions were not bypassed; the response belonged to the earlier authorized session. | Reject results from older session generations and clear private names, IDs, account labels, and trip selection on sign-out. Regression fails on the old JS and passes on the patched JS. |

Additional hardening:

- Require current verified, non-anonymous accounts for trip permissions. This protects against accidental changes to authentication-provider settings.
- Re-enable RLS on all five application tables in the incremental migration, including if it was accidentally disabled. Revoke table permissions from PUBLIC as well as anon/authenticated before explicitly granting required operations. Definer functions deny PUBLIC/anon execution and use an empty search path.
- Apply a restrictive page Content Security Policy and no-referrer policy. Browser tests confirm blocking of injected inline scripts, event handlers, and unapproved script hosts. CSP supplements safe text rendering; no exploitable HTML-rendering sink was found.
- Refuse shared sign-in over an insecure public HTTP origin. Localhost development remains supported.
- Provide optional host response headers in `_headers`; deployment limits are explained below.

## Tests completed

Run `cd tests && npm ci && npm test` to repeat the suite. No hosted emails or hosted database writes are performed by these tests.

The PostgreSQL-compatible PGlite tests execute the actual setup/migration SQL with Supabase authentication shims and separate roles. They exercise:

- Owner creation and access; outsider reads/writes denied.
- Explicit invitation acceptance, stale-email rejection, and consumption/revocation.
- Shared field edits by members; membership and trip-detail edits restricted to the organizer.
- Personal-record privacy and protection against user-ID or destination-trip reassignment.
- No access for unverified accounts, anonymous authenticated accounts, or the anon role.
- SQL-looking text, malicious UUIDs, oversized fields, and invalid dates/numbers/booleans.
- No anonymous table reads, TRUNCATE, or definer-function execution; no inherited PUBLIC access.
- Both fresh setup and upgrading the original pre-fix schema pass the database regressions. Repeated incremental migration preserves existing private records and restores accidentally disabled RLS.

Chromium tests use the real vendored Supabase SDK with intercepted test API responses. They exercise sign-in, private trip loading, safe rendering, saving only edited fields, failed-save retention/retry, invitations, local fallback, no persisted authentication tokens, sign-out races, CSP enforcement, all three pages under their actual CSP without script errors, working checklist progress, and mobile widths from 320 to 1280px. These are simulated API responses, not a live Supabase integration test.

Dependency checks completed during this review:

- `npm audit` for the locked test dependencies: zero known advisories reported.
- `npm audit` for a resolved dependency graph of the pinned Supabase JS 2.118.0 package: zero known advisories reported. This checks registry advisories for the resolved graph, not every implementation detail inside a browser bundle.
- The committed vendor bundle was compared byte-for-byte with the published npm package, whose tarball integrity was verified against npm metadata.
- A targeted scan of all 39 historical blobs reachable in the available Git history found no high-confidence private-key, Supabase secret/service_role, GitHub-token, Google-OAuth-secret, or password-bearing PostgreSQL-URL matches. Pattern matching cannot rule out arbitrary passwords in other formats. The browser publishable key is intentionally public; there is no reason to rotate it solely because it is visible in the website.

## Apply the fixes

1. Deploy the changed HTML/JavaScript and `_headers` where supported. No changes have been committed, pushed, or deployed by this review.
2. For an existing database, run `supabase/migrations/20261103_security_hardening.sql` in Supabase SQL Editor. It preserves data and is repeatable. Fresh installations use the updated `supabase/setup.sql`. **Editing a GitHub SQL file does not apply the database change.**
3. Run `supabase/security-check.sql` to inspect actual hosted RLS, grants, function settings, and Storage policies. Any additional permissive policies added outside this repository must be reviewed; they can broaden access even with our policies installed.
4. Verify with owner, friend, unrelated, and signed-out accounts on the deployed HTTPS site. Test code replay/expiry, revoked membership, and direct API access as well as the UI. Keep tokens, email codes, SMTP passwords, and database passwords private.

## Remaining hosted checks and limits

The cloud network proxy denied access to the Supabase host. No Supabase administrative connector is available. Therefore this review did **not** inspect live RLS, Storage rules, Auth/SMTP settings, data, or hosting headers, and did not apply the migration. Local tests cannot certify a hosted project that has different policies/settings.

Before sharing widely:

- Confirm RLS and the migration in the hosted database. Leave database/service_role secrets out of all website files. A service_role or secret key bypasses the protections tested here.
- Check Supabase OTP-send and verification rate limits, email confirmation and secure email-change settings, code expiry, and SMTP delivery. A UI cooldown is not protection against a caller using the public API directly. For a public launch, configure Supabase-supported CAPTCHA and integrate its token into this website; **this site does not yet include a CAPTCHA widget**. Authenticated users can create their own trips; there are no per-account trip/storage quotas. Provider rate limits, quotas, and monitoring remain necessary against signup/email/database abuse.
- Verify the public photo bucket permits public viewing only as intended. The planner's policies do not protect Storage uploads/updates/deletes. No upload endpoint exists in the website; restrict bucket write policies separately and prefer JPEG/PNG/WebP with a size limit.
- Enable HTTPS on the host and verify actual response headers. GitHub Pages ignores `_headers`; page CSP and referrer meta tags still work, but anti-framing headers (`frame-ancestors` / X-Frame-Options), MIME protection, Permissions-Policy, and HSTS require host/proxy configuration. No claim is made that those optional headers are active on your live site.
- Keep GitHub and Supabase administrator accounts protected with MFA/passkeys and restrict collaborator permissions. Recheck dependency advisories periodically.

Group members are trusted to edit shared assignments: a member can change another person's shared packing label. These labels are not account identities or authorization. Personal checks remain private. Last-save-wins edits and multi-field partial saves are documented product limitations. An invitation remains pending until accepted or removed; there is no automatic invitation expiry or membership-management screen yet. Data already downloaded by an authorized member cannot be remotely erased by revoking membership. Supabase access tokens can remain valid until expiry after sign-out; no immediate global token invalidation is promised.
