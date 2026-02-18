# MCP Database Server (PostgreSQL, stdio)

This backend container includes an MCP stdio server that exposes **safe-by-default PostgreSQL tools**.

## Goals / Safety defaults

- **Read-only by default**: only `SELECT` is allowed unless explicitly enabled.
- **Single statement only**: multi-statement SQL is rejected.
- **Strict validation**: tool inputs are validated; unknown fields are rejected.
- **Safe limits**: queries default to a bounded row limit.
- **Structured logging**: JSON logs with redaction of secrets.

## Configuration

### Connection string discovery

The server reads the Postgres connection string from:

1. `database/db_connection.txt` (repo-relative), expected format like:
   - `psql postgresql://user:pass@host:port/dbname`
   - or just `postgresql://user:pass@host:port/dbname`

2. Environment variable overrides (take precedence):
   - `POSTGRES_URL` (full connection string), OR
   - `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT` (+ host derived from URL if provided)

Notes:
- The server does **not** log the full connection string.
- The existing `.env` for this container already includes the list of env vars available; database credentials come from the database container env.

### Behavior toggles (optional)

- `MCP_DB_READONLY` (default: `true`)
- `MCP_DB_ALLOW_ADMIN_TOOLS` (default: `false`)
- `MCP_DB_STATEMENT_TIMEOUT_MS` (default: `10000`)
- `MCP_DB_MAX_ROWS` (default: `100`)
- `MCP_DB_LOG_LEVEL` (default: `info`)

## How to run (stdio)

Run the MCP server as a stdio process:

```bash
node src/mcp/stdio.js
```

This process communicates over stdin/stdout using MCP protocol messages.

## Tools

### `db.query`
Execute a **read-only** SQL query (default allowlist: `SELECT` only).

Input:
```json
{
  "sql": "select * from my_table limit 10",
  "maxRows": 50
}
```

Output:
```json
{
  "rows": [ { "...": "..." } ],
  "rowCount": 10,
  "truncated": false
}
```

### `db.introspect.tables`
List tables and basic metadata (from `information_schema`).

### `db.introspect.describeTable`
Describe a table’s columns and types.

### Admin tools (disabled by default)
Require `MCP_DB_ALLOW_ADMIN_TOOLS=true`:
- `db.admin.execute` – allows non-SELECT statements with additional guardrails and explicit `confirm=true`.

## Error handling

Tool errors are returned with safe messages and stable error codes; internal stack traces and secrets are not exposed.
