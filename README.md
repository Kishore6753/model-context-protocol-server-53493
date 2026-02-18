# Project Repository

This repository contains a minimal Express backend and an MCP stdio server.

## Containers

- `mcp_backend_server/` - Express API (health endpoint) and MCP stdio server tools.
- `model-context-protocol-server-53492/database/` - PostgreSQL container (provides `db_connection.txt`).

## MCP Database Server (stdio)

See: `mcp_backend_server/docs/mcp-database-server.md`

Run:
```bash
cd mcp_backend_server
node src/mcp/stdio.js
```
