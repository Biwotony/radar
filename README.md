# Radar

## UI database access

The public housing UI must use `READONLY_DATABASE_URL`, not the writer `DATABASE_URL` used by ingestion, persistence, alerts, authentication, and saved-search mutations.

In production, point `READONLY_DATABASE_URL` at a dedicated Postgres login that can connect to the Radar database, use the application schema, and read only the tables required by the browse UI. It must not receive insert, update, delete, truncate, create, alter, or drop privileges.

Example provisioning SQL (adjust database/schema names and password handling to the deployment environment):

```sql
CREATE ROLE radar_ui LOGIN PASSWORD '<managed-secret>';

GRANT CONNECT ON DATABASE radar TO radar_ui;
GRANT USAGE ON SCHEMA public TO radar_ui;
GRANT SELECT ON TABLE
  public.listings,
  public.listing_source_items,
  public.source_items
TO radar_ui;
```

The UI connection string should then be configured as:

```text
READONLY_DATABASE_URL=postgresql://radar_ui:<managed-secret>@<host>:5432/radar
```

Do not grant this role membership in the writer role and do not reuse the writer credential for the public browse UI.

## Magic-link authentication

`/alerts` uses passwordless email ownership only. Raw magic-link and session tokens are never stored in Postgres; only SHA-256 hashes are persisted. Magic links expire after 15 minutes, are single-use, and requests for the same email are rate-limited before another message can be sent. Sessions use an `HttpOnly`, `SameSite=Lax` cookie and default to `Secure`.

Required server-side environment variables:

```text
DATABASE_URL=postgresql://<writer-role>:<managed-secret>@<host>:5432/radar
READONLY_DATABASE_URL=postgresql://radar_ui:<managed-secret>@<host>:5432/radar
APP_BASE_URL=https://<radar-host>
RESEND_API_KEY=<managed-secret>
AUTH_FROM_EMAIL=Radar <alerts@your-domain.example>
```

`AUTH_FROM_EMAIL` falls back to `ALERT_FROM_EMAIL` if omitted. For explicit local HTTP development only, set `AUTH_COOKIE_SECURE=false`; production should leave it unset so cookies remain Secure by default.
