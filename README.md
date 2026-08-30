# Community Application

A responsive community application wizard with server-side configuration, validated uploads, and Discord delivery.

## Local setup

Use Node.js 18 or newer and a PostgreSQL database.

```bash
npm install
cp .env.example .env
npm start
```

Set `DATABASE_URL`, `CONFIG_ENCRYPTION_KEY`, `MASTER_ADMIN_PASSWORD_HASH`, and `ADMIN_SESSION_SECRET` in `.env`. On first start, the server creates its configuration table and imports `config/communities.json` once. The legacy file is never served to browsers, and any legacy webhook is moved into the encrypted shared-webhook field. Treat any webhook previously committed to source control as compromised and rotate it.

Open an application with `/?community=community-a`. Open `/config-builder/` to access the password-protected master administration page.

## Master administration

The admin page lists active and inactive communities and lets an administrator add, edit, activate, deactivate, and remove communities. The complete nested application copy and upload configuration is saved durably in PostgreSQL with revision checks to prevent overwriting another administrator’s changes.

All communities use one encrypted shared Discord webhook. Administrators can replace or clear it from the admin page; the existing value is never returned or displayed. The public configuration endpoint returns only the selected active community’s UI settings.

## Application flow

Applicants provide personal details, community-center information, an application story, one experience file, required agreements, requested animal pictures, and a final review. Applicant sessions, session IDs, challenge tokens, rate limits, cooldowns, duplicate detection, fingerprints, and process-local applicant security state are not used. The server still validates all submitted fields, agreements, upload names, extensions, MIME types, signatures, and sizes.

Discord embeds include both the resolved community ID and display name. Uploaded files are sent as validated multipart attachments. Webhook failures return a generic delivery error without exposing configuration or stack traces.

## Vercel deployment

Set the four required secrets and `DATABASE_URL` as Vercel environment variables. `api/index.js` imports an Express app without starting a listener, and PostgreSQL provides persistence across serverless instances. Keep the database connection and encryption key private. The static boundary denies configuration, server, library, migration, package, and environment paths.

The effective upload policy is a 3 MB per-file limit and a 4 MB aggregate binary attachment target. The browser compresses supported images before constructing the multipart request; PDFs are not compressed. These limits intentionally leave headroom for multipart framing, JSON fields, and provider overhead. Vercel’s request-body limit is imposed by the selected plan and cannot be increased through `vercel.json`; verify the deployed plan before changing these values.

## Project structure

- `index.html`, `css/`, and `js/` contain the public applicant interface.
- `server/index.js` contains the import-safe Express app, admin APIs, application validation, upload inspection, and Discord formatting.
- `lib/config-store.js` contains PostgreSQL persistence and webhook encryption.
- `lib/config-validation.js` contains shared community-schema validation.
- `config-builder/` contains the authenticated master admin interface.
- `config/communities.json` is a one-time migration seed and is not publicly served.

## Checks

```bash
npm run check
npm test
```

Test locally with a configured PostgreSQL database before deployment. Do not commit `.env`, password hashes, encryption keys, webhook URLs, or migration exports.
