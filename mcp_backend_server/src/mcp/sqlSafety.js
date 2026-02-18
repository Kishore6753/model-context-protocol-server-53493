const { z } = require('zod');

const SQL_INPUT_SCHEMA = z
  .object({
    sql: z.string().min(1).max(50_000),
    maxRows: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

const ADMIN_SQL_INPUT_SCHEMA = z
  .object({
    sql: z.string().min(1).max(50_000),
    confirm: z.literal(true),
  })
  .strict();

const DANGEROUS_KEYWORDS = [
  'drop',
  'alter',
  'truncate',
  'grant',
  'revoke',
  'create role',
  'create user',
  'copy',
  'vacuum',
  'analyze',
  'cluster',
  'reindex',
  'listen',
  'notify',
  'load',
  'do',
  'execute',
];

/**
 * Very conservative statement splitter check:
 * - rejects semicolons beyond a trailing one
 * - rejects multiple statements by looking for semicolons in the middle
 */
function assertSingleStatement(sql) {
  const normalized = sql.trim();

  // Allow at most one trailing semicolon
  const semicolons = [...normalized.matchAll(/;/g)].map((m) => m.index);
  if (semicolons.length === 0) return;

  const last = semicolons[semicolons.length - 1];
  const hasNonWhitespaceAfterLast = /\S/.test(normalized.slice(last + 1));
  if (hasNonWhitespaceAfterLast) {
    const err = new Error(
      'SQL must be a single statement (found content after semicolon).'
    );
    err.code = 'SQL_MULTI_STATEMENT';
    throw err;
  }
  if (semicolons.length > 1) {
    const err = new Error(
      'SQL must be a single statement (multiple semicolons found).'
    );
    err.code = 'SQL_MULTI_STATEMENT';
    throw err;
  }
}

function normalizeLeadingKeyword(sql) {
  const trimmed = sql.trim();
  const m = trimmed.match(/^([a-zA-Z]+)/);
  return (m ? m[1] : '').toLowerCase();
}

function assertReadonly(sql) {
  const kw = normalizeLeadingKeyword(sql);
  if (kw !== 'select' && kw !== 'with') {
    const err = new Error('Read-only mode only allows SELECT/WITH queries.');
    err.code = 'SQL_READONLY_VIOLATION';
    throw err;
  }
}

function assertNotDangerous(sql) {
  const lowered = sql.toLowerCase();
  for (const keyword of DANGEROUS_KEYWORDS) {
    if (lowered.includes(keyword)) {
      const err = new Error(
        `Statement contains a potentially dangerous keyword: ${keyword}`
      );
      err.code = 'SQL_DANGEROUS_KEYWORD';
      throw err;
    }
  }
}

// PUBLIC_INTERFACE
function validateQueryInput(input, { readonly }) {
  /** Validate and guard SQL query input according to safe defaults (single statement + readonly). */
  const parsed = SQL_INPUT_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const err = new Error('Invalid input.');
    err.code = 'VALIDATION_ERROR';
    err.details = parsed.error.flatten();
    throw err;
  }

  const { sql, maxRows } = parsed.data;

  assertSingleStatement(sql);
  assertNotDangerous(sql);
  if (readonly) assertReadonly(sql);

  return { sql, maxRows };
}

// PUBLIC_INTERFACE
function validateAdminExecuteInput(input) {
  /** Validate admin execute input; requires explicit confirm=true and single statement. */
  const parsed = ADMIN_SQL_INPUT_SCHEMA.safeParse(input);
  if (!parsed.success) {
    const err = new Error('Invalid input.');
    err.code = 'VALIDATION_ERROR';
    err.details = parsed.error.flatten();
    throw err;
  }
  const { sql } = parsed.data;
  assertSingleStatement(sql);
  assertNotDangerous(sql);
  return { sql };
}

module.exports = {
  validateQueryInput,
  validateAdminExecuteInput,
};
