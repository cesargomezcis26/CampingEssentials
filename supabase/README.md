# Starcamp shared camping plans

The website is branded Starcamp. Existing `campwell_*` database names and browser storage keys are retained for compatibility; no data migration is needed. Use Starcamp as the sender name and in the subjects and bodies of your Supabase authentication emails.

The static site still works on GitHub Pages. Supabase provides email sign-in and private database storage. Photos in your existing Storage bucket are unaffected.

## 1. Create the database objects

Open the SQL Editor in project `fjjnmksglgepvxvhxpoc`, paste the complete contents of [setup.sql](setup.sql), and run it once. It creates only new `campwell_*` tables, functions, and policies in a transaction. Do not disable Row Level Security. If an object already exists, stop and inspect it; do not drop existing tables to retry.

### Already created the tables?

Run [migrations/20261103_security_hardening.sql](migrations/20261103_security_hardening.sql) in SQL Editor instead of rerunning setup.sql. Then run [migrations/20261109_shared_claim_board.sql](migrations/20261109_shared_claim_board.sql) to add the claim board. Both preserve existing trip data. The hardening migration refreshes grants and makes invitation acceptance use the account's current verified email. Anonymous and unverified accounts cannot access the planner even if those sign-in options are accidentally enabled.

Afterward, run [security-check.sql](security-check.sql) and review the actual hosted policies and Storage rules. Extra policies created separately in your project require their own review: permissive policies are combined with OR. Saving these files in GitHub does not apply them to Supabase.

The database stores trip names/owners, invited emails, memberships, and item claims. A claim records the signed-in account and the display name shown to trip members. The account ID—not the displayed name—controls release permission. Only the claimant or trip organizer can release a claim. A unique database key prevents two people from claiming the same item.

## 2. Configure email sign-in

In Authentication settings:

- Enable the Email provider and email confirmations. Do not enable anonymous sign-ins for this workflow. Keep confirmation required for email changes.
- Set the Site URL to your deployed website URL. Configure any redirect allowlist narrowly for your actual site; this implementation uses typed codes instead of processing magic-link redirects.
- In the email templates used for Magic Link (and Confirm Signup for new accounts), include the one-time code variable `{{ .Token }}` so the recipient can enter it on the planning page. Keep the existing template if needed and add the code. The code length should be 6–10 digits for this page.
- Supabase's built-in mail service has delivery restrictions and low rate limits. Configure a supported SMTP provider in the Supabase dashboard for sending to friends outside your organization; store SMTP credentials only there. Check current Supabase email limits and test delivery to a friend before relying on it.
- Keep authentication rate limits enabled. Before broadly advertising public account creation, configure Supabase-supported CAPTCHA and integrate its token into the sign-in flow. This starter is intended for a small invited camping group and does not include a CAPTCHA widget.

Your dashboard login is separate from website sign-in. Email must be verified by the received code. Do not send passwords, SMTP secrets, database passwords, or secret/service_role keys to the website.

## 3. Public website configuration

`../supabase-config.js` contains the existing project URL and supplied **publishable** key. That key is intentionally public. All data access depends on the SQL policies, not secrecy of this key. The client only accepts modern `sb_publishable_` keys; never substitute a secret key.

The Supabase browser SDK is pinned and vendored in `../vendor/`; no runtime CDN or npm build is needed. Its origin, version, integrity, and license are recorded there.

Deploy all HTML, CSS, JS, and `vendor/` files together over HTTPS. Use `planning.html` to test. Do not use a development filesystem path as a public URL.

## 4. Use a shared trip

1. Enter your email on the planning page, request a code, then enter the email code.
2. Create a named private trip. If you have one trip, it opens automatically. Multiple trips appear as buttons—there are no dropdown controls.
3. Add the display name friends should see, then choose **I’ll bring it** beside an open item. It moves to **Items we have** with your name.
4. The claimant can release their item. The organizer can remove any claim when plans change. Claims cannot be edited or reassigned in place.
5. The board checks Supabase every six seconds while visible and whenever the tab becomes active again.
6. As organizer, enter a friend's email and choose **Allow email**. Privately send the planning page URL and trip ID. The button records permission but does not send an invitation email.
7. Your friend signs in with exactly that email and enters the trip ID to join. Knowing the ID alone never grants access. Invitations are consumed on acceptance.
8. Sign out on a shared device. Sessions are kept in memory, not browser localStorage, so reloading requires another sign-in. The display name is saved locally for convenience but provides no authorization.

## 5. Verify before sharing real trips

Use separate owner, invited-friend, and unrelated accounts:

- Owner can create a trip, invite a friend, see all claims, and remove a claim.
- Invited friend can accept, see all claims, claim an open item, and release only their own claim. They cannot invite another account.
- Two accounts trying to claim the same item produce one successful claim; the other account receives a conflict and refreshes.
- Unrelated and signed-out users cannot read or change trip records via the REST API, not just through the UI. Try an uninvited trip ID; acceptance must fail.
- Claim and release actions appear to other signed-in members after the automatic refresh interval.
- Email code delivery, session expiry/sign-out, and mobile layout work on your deployed HTTPS site.

Local automated policy checks and browser checks are in `../tests`. Browser checks simulate Supabase responses; they do not prove your hosted project is configured. The policy tests execute the real migration in PGlite with a small Supabase-auth shim. Hosted Supabase still needs the checks above. This cloud workspace could not reach the project's Supabase host because the network proxy blocked it.

## Revoke access or delete a trip

There is no membership-management screen yet. Use Supabase Table Editor (as project administrator) to remove the matching row from `campwell_members`; also remove any pending invitation for that email from `campwell_invitations`. An accepted invitation is consumed, so it cannot be reused after removal. Removing a trip from `campwell_trips` deletes its associated memberships, invitations, claims, and legacy form fields through foreign-key cascades. Take a backup first if needed. Normal website users have no direct trip-delete permission.

Trip dates, names, and invited email addresses are personal information. Keep database/admin access restricted, share only within the group, and delete old trips when no longer needed. Do not store credentials or sensitive documents in checklist text.

## Website security policy

Every page now includes a Content Security Policy and a no-referrer policy. Scripts must come from this website, connections and photos are limited to the configured Supabase host, and only the existing Google Fonts stylesheet/font hosts are allowed. Inline scripts and HTML event handlers are blocked. If you deliberately change the project host or add a third-party widget, review and update the policy in **all three HTML pages** and `_headers`; do not weaken it with `*`, `unsafe-inline`, or `unsafe-eval` to silence an error.

`_headers` adds anti-framing, MIME, permissions, and HTTPS response headers on Netlify/Cloudflare Pages. **GitHub Pages does not apply `_headers`**. The HTML policies still apply there, but `frame-ancestors`, X-Frame-Options, and the other response headers need a hosting provider/proxy that supports custom headers. Enable Enforce HTTPS in GitHub Pages settings. Shared sign-in is disabled on insecure public HTTP origins; localhost development remains supported.

The site has no visitor-upload feature. For the public photo bucket, restrict writes in Supabase Storage policies, limit allowed formats to images you use (for example JPEG/PNG/WebP), set a size limit, and upload only photos intended to be public. Strip location metadata from photos when needed.
