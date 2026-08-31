# Radar

## UI database access

The public housing UI must use `READONLY_DATABASE_URL`, not the writer `DATABASE_URL` used by ingestion, persistence, and alert jobs.

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

Do not grant this role membership in the writer role and do not reuse the writer credential for the UI.
