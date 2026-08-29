# Community Application

A reusable, responsive community-volunteer application wizard with JSON-driven branding and copy, server-validated manual-review responses, secure uploads, and server-side Discord delivery.

## Run locally

Use Node.js 18 or newer. From this project folder, run:

```sh
npm install
cp .env.example .env
npm start
```

Then open `http://localhost:3000/?community=community-a`. The browser cannot load the app correctly through `file://`; use the Node server so the JSON configuration and API endpoints are available.

Discord delivery is optional for local evaluation. If the selected community’s `webhook` value is blank, a valid application is accepted and logged as a development no-op. When configured, each community webhook must be an HTTPS Discord webhook URL and is used only for submissions to that community. Protect the configuration file and keep it out of publicly served content.

## Community customization

Community-specific settings belong in `config/communities.json`. Add a community object, give it a unique key, and select it with `?community=your-community-key`. The `steps` object controls the eyebrow, title, and description for all nine application steps plus the success and next-step screens. The configuration also controls branding, instructions, agreements, manual-review prompts, animal requests, accepted uploads, footer text, form labels, placeholders, buttons, and the final review rows.

The `reviewFields` array controls the rows shown on the final review screen. Each row has a supported `id` (`name`, `contact`, `communityCenter`, `experienceFile`, or `animalPictures`), an editable `label`, and an `enabled` boolean. Unsupported or duplicate IDs are rejected at server startup. The `config-builder/index.html` editor exposes these controls in the Step 9 card.

Use `config-builder/index.html` as the separate admin-facing editor. Its cards follow the application’s step order, making each screen’s copy and related settings easier to find. It loads the current configuration, lets you add or remove communities, and generates protected JSON configuration content plus `.env` content containing only `PORT` and `TRUST_PROXY`. The JSON output includes each community’s webhook because the server selects delivery settings from the selected community. Use the builder locally or behind appropriate admin access, protect both generated outputs, and never publicly serve the JSON configuration.

Do not place private values in public JSON, client code, CSS, HTML, or assets. Because Discord webhooks are intentionally configured in JSON for per-community routing, `config/communities.json` is now a protected server-side configuration file rather than a browser-public asset. The builder is intended for local use or deployment behind appropriate admin access; it is not an application-user page.

## Manual-review responses

The nine-digit screen accepts any response containing exactly nine digits, such as `123456789`. Its input is masked while the applicant types. There is no equation, expected result, or mathematical correctness check. The date screen accepts any valid `YYYY-MM-DD` calendar date, including past, present, and future dates. Neither response is compared with today’s date. The server records both accepted responses against the secure session and forwards them to Discord with explicit `Manual review` labels.

The application session itself has no automatic timeout. Math and date challenge tokens remain session-bound, single-use, and valid for five minutes. If a token expires while its screen is open, the application requests a fresh token without discarding the overall application session. Client-side checks improve usability, but the server independently validates response formats and final submitted values.

## Project structure

`index.html` is the accessible application shell. `css/` contains design tokens, reusable component styles, and responsive rules. `js/` contains configuration loading, centralized state, rendering, client-side validation, manual-review requests, uploads, and flow orchestration. `server/index.js` contains the Express API, in-memory session and challenge stores, rate limiting, independent validation, upload inspection, duplicate protection, and Discord formatting. `config-builder/` contains the separate configuration editor, with its HTML shell, stylesheet, and browser JavaScript.

Frontend validation is for usability only. The server independently validates every field, required agreement, verification state, file count, size, filename, extension, declared MIME type, and file signature.

## Security behavior

Application sessions remain active until submission or server restart. Math and date challenge tokens are issued server-side, expire after five minutes, have attempt limits, and are single-use. They are associated with the session and a coarse IP/user-agent fingerprint. The API rate-limits requests, applies a successful-submission cooldown, detects submissions completed implausibly quickly, and rejects reuse of a submitted session. Duplicate community/email combinations are blocked for 24 hours.

The configuration is loaded server-side and must be protected. Discord receives sanitized text metadata plus validated upload files as multipart attachments; it does not receive unsanitized form values or any file content in logs or error responses. The webhook URL is read only from the selected community’s `webhook` configuration value. Error responses never return webhook details or stack traces.

## Console source-map notice

The project does not contain `installHook.js`, `installHook.js.map`, a `sourceMappingURL` reference, or a URL for `<anonymous code>`. Firefox errors naming those resources are normally emitted by an injected browser developer-tools extension rather than this application. Confirm by opening the application in a private window with extensions disabled, or disable the relevant developer-tools extension. Adding a fake map route to the application would hide an external tooling warning rather than correct an application defect.

## Production notes

Run behind HTTPS and a correctly configured reverse proxy. Set `TRUST_PROXY=true` only if the proxy overwrites untrusted forwarding headers. Protect `config/communities.json`, including its webhook values, from public serving and source-control exposure; if the application and API share a host, configure static serving so the configuration directory is not directly reachable. Replace the in-memory session, rate-limit, and duplicate stores with Redis or another shared, atomic store before running multiple server instances. Because sessions no longer expire automatically, use a durable store with an operational retention policy in production to avoid unbounded memory growth. Add durable application storage if Discord alone is not an acceptable system of record. Configure monitoring, backups, retention, privacy notices, and deletion procedures appropriate to the information collected.

The animal upload check validates file properties and completion, not image semantics. If the production threat model requires proving that uploaded pictures contain requested animals, add a server-side image-classification or moderated verification service; never trust a browser-only assertion.

## Checks

Run `npm run check` to syntax-check the server and browser modules, including the configuration builder. Test the full workflow with valid and invalid communities, missing fields, invalid and oversized files, mismatched file signatures, expired and reused challenges, duplicate submissions, webhook failure, keyboard-only navigation, and desktop/mobile viewport sizes before deployment.
