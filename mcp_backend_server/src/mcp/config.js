const fs = require('fs');
const path = require('path');

/**
 * Very small, dependency-free configuration layer for the MCP DB server.
 * - Reads db connection from ../../database/db_connection.txt (repo-relative)
 * - Allows env overrides
 * - Provides safe defaults
 */

function parseConnectionFromDbConnectionTxt(raw) {
  // Accept either:
  //   "psql postgresql://user:pass@host:port/db"
  //   "postgresql://user:pass@host:port/db"
  const trimmed = String(raw || '').trim();
  if (!trimmed) return null;

  const parts = trimmed.split(/\s+/);
  const maybeUrl = parts.length === 1 ? parts[0] : parts[1];
  if (!maybeUrl) return null;

  if (
    maybeUrl.startsWith('postgresql://') ||
    maybeUrl.startsWith('postgres://')
  ) {
    return maybeUrl;
  }
  return null;
}

function readDbConnectionTxt() {
  // repo layout:
  // model-context-protocol-server-53493/mcp_backend_server/src/mcp/config.js
  // model-context-protocol-server-53492/database/db_connection.txt
  //
  // Within this mono-workspace, the database folder is a sibling workspace.
  // We read via a relative path from the backend container root:
  //   ../model-context-protocol-server-53492/database/db_connection.txt
  // But at runtime, we are in mcp_backend_server, so use process.cwd() + relative traversal.
  const candidates = [
    // Most common: repo root sibling workspace
    path.resolve(
      process.cwd(),
      '..',
      'model-context-protocol-server-53492',
      'database',
      'db_connection.txt'
    ),
    // Fallback: if database folder is mounted into backend container
    path.resolve(process.cwd(), 'database', 'db_connection.txt'),
  ];

  for (const filePath of candidates) {
    try {
      const raw = fs.readFileSync(filePath, 'utf8');
      const url = parseConnectionFromDbConnectionTxt(raw);
      if (url) return url;
    } catch {
      // ignore; try next candidate
    }
  }
  return null;
}

function envBool(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined) return defaultValue;
  if (typeof v !== 'string') return Boolean(v);
  const normalized = v.trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function envInt(name, defaultValue) {
  const v = process.env[name];
  if (v === undefined) return defaultValue;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : defaultValue;
}

// PUBLIC_INTERFACE
function loadMcpDbConfig() {
  /** Load MCP DB server configuration with safe defaults and env overrides. */
  const connectionString = process.env.POSTGRES_URL || readDbConnectionTxt();

  // Safe-by-default runtime configuration
  const readonly = envBool('MCP_DB_READONLY', true);
  const allowAdminTools = envBool('MCP_DB_ALLOW_ADMIN_TOOLS', false);

  const statementTimeoutMs = envInt('MCP_DB_STATEMENT_TIMEOUT_MS', 10_000);
  const maxRowsDefault = envInt('MCP_DB_MAX_ROWS', 100);

  // Logging
  const logLevel =
    process.env.MCP_DB_LOG_LEVEL || process.env.PGLOG_LEVEL || 'info';

  if (!connectionString) {
    return {
      ok: false,
      error:
        'Missing database connection string. Provide POSTGRES_URL or ensure database/db_connection.txt exists.',
      logLevel,
    };
  }

  return {
    ok: true,
    connectionString,
    readonly,
    allowAdminTools,
    statementTimeoutMs,
    maxRowsDefault,
    logLevel,
  };
}

module.exports = {
  loadMcpDbConfig,
};
