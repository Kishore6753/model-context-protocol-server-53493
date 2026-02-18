const { Pool } = require('pg');

/**
 * NOTE: We purposefully keep pool defaults conservative.
 * Pool is created once and shared across tool invocations.
 */

// PUBLIC_INTERFACE
function createPgPool({ connectionString, statementTimeoutMs, logger }) {
  /** Create a pg.Pool with safe defaults (timeouts, limited size). */
  const pool = new Pool({
    connectionString,
    max: 5,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: statementTimeoutMs, // forwarded as server parameter
    query_timeout: statementTimeoutMs,
    application_name: 'mcp-database-server',
  });

  pool.on('error', (err) => {
    logger.error({ err, event: 'pg_pool_error' }, 'Postgres pool error');
  });

  return pool;
}

// PUBLIC_INTERFACE
async function runReadonlyQuery({ pool, sql, maxRows, maxRowsDefault }) {
  /** Run a query in a read-only transaction with bounded results. */
  const effectiveMaxRows = maxRows || maxRowsDefault;

  // Enforce a LIMIT by wrapping in a subquery.
  // Conservative approach: no SQL parsing, always wrap.
  const limitedSql = `select * from (${sql}) as mcp_subq limit ${effectiveMaxRows}`;

  const client = await pool.connect();
  try {
    await client.query('begin read only');
    const res = await client.query(limitedSql);
    await client.query('commit');

    const truncated = res.rows.length >= effectiveMaxRows;
    return {
      rows: res.rows,
      rowCount: res.rowCount,
      truncated,
      maxRows: effectiveMaxRows,
    };
  } catch (e) {
    try {
      await client.query('rollback');
    } catch {
      // ignore
    }
    throw e;
  } finally {
    client.release();
  }
}

// PUBLIC_INTERFACE
async function runAdminExecute({ pool, sql }) {
  /** Execute a single (potentially mutating) SQL statement. Intended for gated admin mode only. */
  const client = await pool.connect();
  try {
    const res = await client.query(sql);
    return {
      command: res.command,
      rowCount: res.rowCount,
    };
  } finally {
    client.release();
  }
}

module.exports = {
  createPgPool,
  runReadonlyQuery,
  runAdminExecute,
};
