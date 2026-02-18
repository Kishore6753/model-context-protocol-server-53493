const pino = require('pino');

// PUBLIC_INTERFACE
function createLogger({ level }) {
  /** Create a structured logger for the MCP server with redaction of secrets. */
  const transport =
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            singleLine: true,
          },
        }
      : undefined;

  return pino(
    {
      level: level || 'info',
      // Redact common secret fields
      redact: {
        paths: [
          'connectionString',
          '*.connectionString',
          'password',
          '*.password',
          'POSTGRES_URL',
          '*.POSTGRES_URL',
          'sql', // avoid logging raw SQL by default
          '*.sql',
        ],
        remove: true,
      },
    },
    transport
  );
}

module.exports = {
  createLogger,
};
