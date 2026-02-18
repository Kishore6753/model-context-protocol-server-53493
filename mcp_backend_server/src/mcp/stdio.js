const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio');
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp');
const { z } = require('zod');

const { loadMcpDbConfig } = require('./config');
const { createLogger } = require('./logger');
const { createPgPool, runReadonlyQuery, runAdminExecute } = require('./pgClient');
const { validateQueryInput, validateAdminExecuteInput } = require('./sqlSafety');

/**
 * MCP Database Server (PostgreSQL) over stdio.
 *
 * Tools are safe-by-default (readonly, strict validation, bounded output).
 */

// PUBLIC_INTERFACE
async function main() {
  /** Entrypoint for the MCP database stdio server. */
  const cfg = loadMcpDbConfig();
  const logger = createLogger({ level: cfg.logLevel });

  if (!cfg.ok) {
    logger.error({ event: 'config_error' }, cfg.error);
    process.stderr.write(`${cfg.error}\n`);
    process.exit(1);
    return;
  }

  const server = new McpServer(
    {
      name: 'mcp-database-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  const pool = createPgPool({
    connectionString: cfg.connectionString,
    statementTimeoutMs: cfg.statementTimeoutMs,
    logger,
  });

  // --- Tools ---

  server.tool(
    'db.query',
    'Execute a safe, single-statement SQL query. Read-only by default (SELECT/WITH only). Results are truncated to maxRows.',
    {
      sql: z.string().min(1).describe('SQL query (single statement).'),
      maxRows: z
        .number()
        .int()
        .min(1)
        .max(10_000)
        .optional()
        .describe('Maximum rows to return (bounded).'),
    },
    async (input) => {
      const start = Date.now();
      try {
        const { sql, maxRows } = validateQueryInput(input, {
          readonly: cfg.readonly,
        });

        const result = await runReadonlyQuery({
          pool,
          sql,
          maxRows,
          maxRowsDefault: cfg.maxRowsDefault,
        });

        logger.info(
          { tool: 'db.query', ok: true, duration_ms: Date.now() - start },
          'tool_ok'
        );

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        const code = err && err.code ? err.code : 'DB_QUERY_ERROR';
        logger.warn(
          {
            tool: 'db.query',
            ok: false,
            code,
            duration_ms: Date.now() - start,
          },
          'tool_error'
        );

        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'Query failed.',
                  code,
                  details: err && err.details ? err.details : undefined,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.tool(
    'db.introspect.tables',
    'List tables in the current database (information_schema). Read-only.',
    {},
    async () => {
      const start = Date.now();
      try {
        const sql = `
          select table_schema, table_name
          from information_schema.tables
          where table_type = 'BASE TABLE'
            and table_schema not in ('pg_catalog', 'information_schema')
          order by table_schema, table_name
        `;

        const result = await runReadonlyQuery({
          pool,
          sql,
          maxRows: 1000,
          maxRowsDefault: 1000,
        });

        logger.info(
          {
            tool: 'db.introspect.tables',
            ok: true,
            duration_ms: Date.now() - start,
          },
          'tool_ok'
        );

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const code = err && err.code ? err.code : 'DB_INTROSPECT_ERROR';
        logger.warn(
          { tool: 'db.introspect.tables', ok: false, code },
          'tool_error'
        );
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: 'Introspection failed.', code },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  server.tool(
    'db.introspect.describeTable',
    'Describe a table columns (information_schema). Read-only.',
    {
      schema: z.string().min(1).describe('Schema name (e.g. public).'),
      table: z.string().min(1).describe('Table name.'),
    },
    async (input) => {
      const start = Date.now();
      try {
        const parsed = z
          .object({
            schema: z.string().min(1),
            table: z.string().min(1),
          })
          .strict()
          .parse(input);

        const sql = `
          select
            column_name,
            data_type,
            is_nullable,
            ordinal_position
          from information_schema.columns
          where table_schema = $1 and table_name = $2
          order by ordinal_position
        `;

        const client = await pool.connect();
        try {
          await client.query('begin read only');
          const res = await client.query(sql, [parsed.schema, parsed.table]);
          await client.query('commit');

          const result = {
            rows: res.rows,
            rowCount: res.rowCount,
            truncated: false,
          };

          logger.info(
            {
              tool: 'db.introspect.describeTable',
              ok: true,
              duration_ms: Date.now() - start,
            },
            'tool_ok'
          );

          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } finally {
          client.release();
        }
      } catch (err) {
        const code = err && err.code ? err.code : 'DB_DESCRIBE_ERROR';
        logger.warn(
          { tool: 'db.introspect.describeTable', ok: false, code },
          'tool_error'
        );
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                { error: 'Describe table failed.', code },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  // Admin tool: gated
  server.tool(
    'db.admin.execute',
    'ADMIN (disabled by default): Execute a single SQL statement. Requires confirm=true. Use only when explicitly enabled.',
    {
      sql: z.string().min(1).describe('SQL statement (single statement).'),
      confirm: z
        .literal(true)
        .describe('Must be true to acknowledge this is dangerous.'),
    },
    async (input) => {
      const start = Date.now();

      if (!cfg.allowAdminTools) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'Admin tools are disabled.',
                  code: 'ADMIN_DISABLED',
                  hint: 'Set MCP_DB_ALLOW_ADMIN_TOOLS=true to enable.',
                },
                null,
                2
              ),
            },
          ],
        };
      }

      try {
        const { sql } = validateAdminExecuteInput(input);
        const result = await runAdminExecute({ pool, sql });

        logger.info(
          { tool: 'db.admin.execute', ok: true, duration_ms: Date.now() - start },
          'tool_ok'
        );

        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        const code = err && err.code ? err.code : 'DB_ADMIN_ERROR';
        logger.warn({ tool: 'db.admin.execute', ok: false, code }, 'tool_error');
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  error: 'Admin execute failed.',
                  code,
                  details: err.details,
                },
                null,
                2
              ),
            },
          ],
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info(
    {
      event: 'mcp_server_started',
      readonly: cfg.readonly,
      allowAdminTools: cfg.allowAdminTools,
    },
    'MCP database server started (stdio)'
  );

  const shutdown = async () => {
    logger.info({ event: 'shutdown' }, 'Shutting down MCP database server');
    try {
      await pool.end();
    } catch {
      // ignore
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  process.stderr.write('Fatal error starting MCP database server.\n');
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
