/**
 * Database references (postgres, mssql, mysql, oracle, snowflake, mongodb):
 * turns the reference's templates + input values into ONE statement with
 * driver-bound parameters (or a Mongo operation spec) and runs it through
 * lib/db-connector.
 *
 * Rules (all dialects):
 *  - The body template is parsed as JSON BEFORE values go in, then filled leaf
 *    by leaf — a value can never add, remove or re-key fields ({"sql", "params",
 *    "procedure", …}).
 *  - {{name}} in SQL text depends on what the input is:
 *      sql / plsql / query         the author's whole statement (raw, by design)
 *      table, pk_column, schema,
 *      function_name, procedure_name
 *                                  an identifier: validated (a.b.c, quoted parts ok)
 *      columns, order_by           a list of identifiers ("*", "1", "name DESC" ok)
 *      limit, offset (+ any number-typed input in a LIMIT/OFFSET/FETCH/TOP position)
 *                                  a non-negative integer (limit capped at maxRows)
 *      values, args                placeholders only ($1, ?, @p1, :1, :name, NULL, DEFAULT)
 *      set_clause                  col = placeholder [, …]
 *      where_clause                a condition written by the reference author; one
 *                                  statement only (no ";" or comments)
 *      anything else               a bound parameter (never spliced into the SQL).
 *                                  Inside a quoted literal ('%{{x}}%') the literal is
 *                                  rewritten to a concatenation with the parameter.
 *  - Legacy "@name" placeholders (path-template SQL) bind the input of that name.
 *  - mssql binds named parameters through request.input (no inlined literals).
 */

import { referenceInputText } from "./reference-input-utils";

export interface DatabaseReferenceRequest {
  integrationConfig: any;
  method: string;
  pathTemplate: string;
  bodyTemplate: string;
  inputs: any[];
  values: Record<string, any>;
  resultShape: "smart" | "rows";
  timeout?: number;
  /**
   * Custom reference writes: the body's {"sql"} statement (compiled by
   * lib/custom-references/write-sql) runs in a transaction — rolled back for a
   * dry run, or when more rows than maxAffected change.
   */
  write?: DatabaseWriteOptions;
}

export interface DatabaseWriteOptions {
  maxAffected?: number;
  dryRun?: boolean;
}

/** What a custom reference write returns from the database. */
export interface DatabaseWriteData {
  affected_rows: number;
  rows: any[];
  rolled_back: boolean;
  /** Dry run only: the statement as sent, with its bound parameters. */
  statement?: { sql: string; params: any };
}

export interface DatabaseReferenceResult {
  status: number;
  data: any;
  logUrl: string;
}

type Dialect = "postgres" | "mssql" | "mysql" | "oracle" | "snowflake";

const RAW_SQL_INPUTS = new Set(["sql", "plsql", "query"]);
const IDENTIFIER_INPUTS = new Set(["table", "pk_column", "schema", "function_name", "procedure_name", "view", "view_name", "table_name"]);
const IDENTIFIER_LIST_INPUTS = new Set(["columns", "order_by"]);
const INTEGER_INPUTS = new Set(["limit", "offset", "top", "page_size"]);
const PLACEHOLDER_LIST_INPUTS = new Set(["values", "args"]);
const SET_CLAUSE_INPUTS = new Set(["set_clause"]);
const CONDITION_INPUTS = new Set(["where_clause"]);
/** Body fields whose string value is JSON (Mongo specs, SQL params). */
const JSON_FIELDS = new Set(["params", "filter", "projection", "sort", "update", "document", "documents", "pipeline"]);

export class DatabaseReferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DatabaseReferenceError";
  }
}

// ─── Small helpers ───

const TOKEN_RE = /\{\{\s*(\w+)\s*\}\}/g;
const HAS_TOKEN = /\{\{\s*\w+\s*\}\}/;
const isEmpty = (v: unknown) => v === undefined || v === null || v === "";
const isPlainObject = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date);

function parseJsonValue(value: unknown, label: string): any {
  if (isEmpty(value)) return undefined;
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new DatabaseReferenceError(`Input "${label}" must be valid JSON`);
  }
}

/** Fill {{tokens}} in a JSON template leaf by leaf (values never change the structure). */
function fillJson(node: any, values: Record<string, any>, key?: string): any {
  if (typeof node === "string") {
    const whole = /^\{\{\s*(\w+)\s*\}\}$/.exec(node);
    if (whole) {
      const value = values[whole[1]];
      if (key && JSON_FIELDS.has(key)) return parseJsonValue(value, whole[1]);
      return value === undefined ? "" : value;
    }
    return node.replace(TOKEN_RE, (_m, name) => referenceInputText(values[name]));
  }
  if (Array.isArray(node)) return node.map((item) => fillJson(item, values));
  if (isPlainObject(node)) {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, fillJson(v, values, k)]));
  }
  return node;
}

// ─── SQL scanning ───

type Segment =
  | { kind: "text"; text: string }
  | { kind: "literal"; text: string } // a complete '…' literal, quotes included
  | { kind: "ident"; text: string } // "…", `…`, […]
  | { kind: "comment"; text: string }
  | { kind: "dollar"; text: string }; // pg $tag$…$tag$

/** Split SQL into code / literal / quoted-identifier / comment segments. */
export function scanSql(sql: string, dialect: Dialect): Segment[] {
  const out: Segment[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ kind: "text", text: buf }); buf = ""; } };
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === "'" || ((c === "N" || c === "n" || c === "E" || c === "e") && next === "'" && !/\w/.test(sql[i - 1] ?? ""))) {
      flush();
      let j = c === "'" ? i + 1 : i + 2;
      const backslash = dialect === "mysql" || ((c === "E" || c === "e") && dialect === "postgres");
      while (j < sql.length) {
        if (backslash && sql[j] === "\\") { j += 2; continue; }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") { j += 2; continue; }
          break;
        }
        j++;
      }
      out.push({ kind: "literal", text: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === '"' || c === "`" || (c === "[" && dialect === "mssql")) {
      flush();
      const close = c === "[" ? "]" : c;
      let j = i + 1;
      while (j < sql.length && sql[j] !== close) j++;
      out.push({ kind: "ident", text: sql.slice(i, j + 1) });
      i = j + 1;
      continue;
    }
    if (c === "-" && next === "-") {
      flush();
      let j = i;
      while (j < sql.length && sql[j] !== "\n") j++;
      out.push({ kind: "comment", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "/" && next === "*") {
      flush();
      const end = sql.indexOf("*/", i + 2);
      const j = end < 0 ? sql.length : end + 2;
      out.push({ kind: "comment", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "$" && dialect === "postgres") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        flush();
        const end = sql.indexOf(tag[0], i + tag[0].length);
        const j = end < 0 ? sql.length : end + tag[0].length;
        out.push({ kind: "dollar", text: sql.slice(i, j) });
        i = j;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return out;
}

/** True when `fragment` holds a statement separator or a comment outside literals. */
function hasStatementBreak(fragment: string, dialect: Dialect): boolean {
  return scanSql(fragment, dialect).some((s) => s.kind === "comment" || (s.kind === "text" && s.text.includes(";")));
}

// ─── Validation of structural inputs ───

const IDENT_PART = String.raw`(?:[A-Za-z_][A-Za-z0-9_$#]*|"[^"\u0000]{1,128}"|\[[^\]\u0000]{1,128}\]|\`[^\`\u0000]{1,128}\`)`;
const IDENT_RE = new RegExp(`^${IDENT_PART}(?:\\.${IDENT_PART}){0,2}$`);
const ORDER_ITEM_RE = new RegExp(`^(?:${IDENT_PART}(?:\\.${IDENT_PART}){0,2}|\\d{1,3})(?:\\s+(?:ASC|DESC))?(?:\\s+NULLS\\s+(?:FIRST|LAST))?$`, "i");
const COLUMN_ITEM_RE = new RegExp(`^(?:\\*|${IDENT_PART}(?:\\.${IDENT_PART}){0,2}(?:\\.\\*)?)(?:\\s+(?:AS\\s+)?${IDENT_PART})?$`, "i");

function validIdentifier(value: unknown, name: string): string {
  const text = String(value ?? "").trim();
  if (!IDENT_RE.test(text)) {
    throw new DatabaseReferenceError(`Input "${name}" must be a table / column name (letters, digits, _; schema.name; or a quoted name), got "${text.slice(0, 60)}"`);
  }
  return text;
}

function validIdentifierList(value: unknown, name: string): string {
  const text = String(value ?? "").trim();
  if (!text) return name === "columns" ? "*" : "1";
  const items = text.split(",").map((s) => s.trim());
  const re = name === "order_by" ? ORDER_ITEM_RE : COLUMN_ITEM_RE;
  for (const item of items) {
    if (!re.test(item)) throw new DatabaseReferenceError(`Input "${name}" must be a comma-separated list of column names, got "${item.slice(0, 60)}"`);
  }
  return items.join(", ");
}

function validInteger(value: unknown, name: string, maxRows: number): string {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) throw new DatabaseReferenceError(`Input "${name}" must be a whole number ≥ 0`);
  const capped = name === "limit" || name === "top" || name === "page_size" ? Math.min(n, maxRows) : n;
  return String(capped);
}

const PLACEHOLDER_RE: Record<Dialect, RegExp> = {
  postgres: /^\$\d{1,4}$/,
  mysql: /^\?$/,
  snowflake: /^(\?|:\d{1,4})$/,
  mssql: /^@[A-Za-z_][A-Za-z0-9_]{0,127}$/,
  oracle: /^:(\d{1,4}|[A-Za-z_][A-Za-z0-9_]{0,127})$/,
};
const placeholderOk = (item: string, dialect: Dialect) => PLACEHOLDER_RE[dialect].test(item) || /^(NULL|DEFAULT)$/i.test(item);

function validPlaceholderList(value: unknown, name: string, dialect: Dialect): string {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const items = text.split(",").map((s) => s.trim());
  for (const item of items) {
    if (!placeholderOk(item, dialect)) {
      throw new DatabaseReferenceError(`Input "${name}" must list parameter placeholders (${dialect === "postgres" ? "$1, $2" : dialect === "mssql" ? "@p1, @p2" : dialect === "oracle" ? ":1, :2" : "?, ?"}) and pass the values in params, got "${item.slice(0, 60)}"`);
    }
  }
  return items.join(", ");
}

function validSetClause(value: unknown, name: string, dialect: Dialect): string {
  const text = String(value ?? "").trim();
  const items = text.split(",").map((s) => s.trim());
  for (const item of items) {
    const m = /^(.+?)\s*=\s*(.+)$/.exec(item);
    if (!m || !IDENT_RE.test(m[1].trim()) || !placeholderOk(m[2].trim(), dialect)) {
      throw new DatabaseReferenceError(`Input "${name}" must be "column = placeholder" pairs (values go in params), got "${item.slice(0, 60)}"`);
    }
  }
  return items.join(", ");
}

function validCondition(value: unknown, name: string, dialect: Dialect): string {
  const text = String(value ?? "").trim();
  if (hasStatementBreak(text, dialect)) throw new DatabaseReferenceError(`Input "${name}" must be a single condition (no ";" or SQL comments)`);
  const segs = scanSql(text, dialect);
  const last = segs[segs.length - 1];
  if (last && (last.kind === "literal" || last.kind === "ident") && !/['"`\]]$/.test(last.text)) {
    throw new DatabaseReferenceError(`Input "${name}" has an unterminated quote`);
  }
  return text;
}

// ─── SQL compilation ───

interface CompiledSql {
  sql: string;
  params: any[] | Record<string, any> | undefined;
  /** The statement is the author's own raw SQL (multi-statement scripts allowed on pg). */
  rawOnly: boolean;
}

const BIND_MARK = "\u0000B";
const markOf = (index: number) => `${BIND_MARK}${index}\u0000`;
const MARK_RE = /\u0000B(\d+)\u0000/g;

function isNumberInput(inputs: Map<string, any>, name: string) {
  const t = String(inputs.get(name)?.type ?? "").toLowerCase();
  return t === "number" || t === "integer";
}

/**
 * Compile a SQL template with {{tokens}} / legacy @names into dialect SQL with
 * bound parameters. `explicit` are the template's own params ($1/?/@p1/:1).
 */
export function compileSql(
  template: string,
  dialect: Dialect,
  values: Record<string, any>,
  inputList: any[],
  explicit: unknown,
  maxRows: number,
): CompiledSql {
  const inputs = new Map<string, any>(inputList.map((i) => [String(i.name), i]));
  const binds: any[] = [];
  /** mssql: legacy @name placeholders stay as written and bind by name. */
  const mssqlNamed: Record<string, any> = {};
  const bind = (value: unknown) => {
    binds.push(value === undefined ? null : value);
    return markOf(binds.length - 1);
  };
  let rawOnly = false;
  let rawCount = 0;
  const trimmed = template.trim();

  const structural = (name: string, value: unknown, before: string): string | null => {
    if (RAW_SQL_INPUTS.has(name)) {
      rawCount++;
      return referenceInputText(value);
    }
    if (IDENTIFIER_INPUTS.has(name)) return validIdentifier(value, name);
    if (IDENTIFIER_LIST_INPUTS.has(name)) return validIdentifierList(value, name);
    if (INTEGER_INPUTS.has(name)) return validInteger(isEmpty(value) ? (name === "offset" ? 0 : maxRows) : value, name, maxRows);
    if (isNumberInput(inputs, name) && /\b(LIMIT|OFFSET|FETCH\s+(NEXT|FIRST)|TOP)\s*\(?\s*$/i.test(before)) return validInteger(value, name, maxRows);
    if (PLACEHOLDER_LIST_INPUTS.has(name)) return validPlaceholderList(value, name, dialect);
    if (SET_CLAUSE_INPUTS.has(name)) return validSetClause(value, name, dialect);
    if (CONDITION_INPUTS.has(name)) return validCondition(value, name, dialect);
    return null;
  };

  const concat = (parts: string[]) => {
    if (dialect === "mysql" || dialect === "snowflake") return `CONCAT(${parts.join(", ")})`;
    if (dialect === "mssql") return `(${parts.join(" + ")})`;
    return `(${parts.join(" || ")})`;
  };
  const castText = (mark: string) =>
    dialect === "postgres" ? `CAST(${mark} AS text)` : dialect === "mssql" ? `CAST(${mark} AS NVARCHAR(MAX))` : dialect === "oracle" ? `TO_CHAR(${mark})` : mark;

  let out = "";
  for (const seg of scanSql(template, dialect)) {
    if (seg.kind === "comment" || seg.kind === "dollar") {
      out += seg.text;
      continue;
    }
    if (seg.kind === "ident") {
      // "{{table}}" inside quotes: the value must be a plain name part.
      out += seg.text.replace(TOKEN_RE, (_m, name) => {
        const v = String(values[name] ?? "");
        if (!/^[^"`\]\u0000]{1,128}$/.test(v)) throw new DatabaseReferenceError(`Input "${name}" is not a valid quoted name`);
        return v;
      });
      continue;
    }
    if (seg.kind === "literal") {
      if (!HAS_TOKEN.test(seg.text)) { out += seg.text; continue; }
      // '%{{name}}%' → CONCAT('%', <param>, '%')
      const prefix = /^[NnEe]/.test(seg.text) ? seg.text[0] : "";
      const body = seg.text.slice(prefix.length + 1, -1);
      const parts: string[] = [];
      let last = 0;
      for (const m of body.matchAll(TOKEN_RE)) {
        const before = body.slice(last, m.index);
        if (before) parts.push(`${prefix}'${before}'`);
        parts.push(castText(bind(values[m[1]] == null ? "" : referenceInputText(values[m[1]]))));
        last = (m.index ?? 0) + m[0].length;
      }
      const tail = body.slice(last);
      if (tail) parts.push(`${prefix}'${tail}'`);
      // '{{x}}' alone is just the parameter.
      const lone = /^'?\{\{\s*\w+\s*\}\}'?$/.test(body) ? markOf(binds.length - 1) : null;
      out += lone ?? concat(parts);
      continue;
    }
    // Code: {{tokens}} and legacy @name.
    let text = seg.text;
    let piece = "";
    let last = 0;
    for (const m of text.matchAll(/\{\{\s*(\w+)\s*\}\}|(?<![@\w])@([A-Za-z_]\w*)/g)) {
      piece += text.slice(last, m.index);
      last = (m.index ?? 0) + m[0].length;
      if (m[1]) {
        const name = m[1];
        const before = out + piece;
        const s = structural(name, values[name], before);
        piece += s ?? bind(values[name]);
      } else {
        const name = m[2];
        // Only inputs of this reference; mssql's own @p1 / @@VERSION stay as written.
        if (inputs.has(name) && !RAW_SQL_INPUTS.has(name)) {
          if (dialect === "mssql") {
            mssqlNamed[name] = values[name] === undefined ? null : values[name];
            piece += m[0];
          } else piece += bind(values[name]);
        } else piece += m[0];
      }
    }
    piece += text.slice(last);
    out += piece;
  }
  const namedCount = Object.keys(mssqlNamed).length;
  rawOnly = rawCount > 0 && binds.length === 0 && namedCount === 0 && /^\{\{\s*(sql|plsql|query)\s*\}\}$/.test(trimmed);
  if (!/\{\{/.test(template) && binds.length === 0 && namedCount === 0) rawOnly = true; // the author's own SQL text

  return finalizeBinds(out, dialect, binds, explicit, rawOnly, mssqlNamed);
}

/** Replace bind marks with dialect placeholders and merge with the template's explicit params. */
function finalizeBinds(sqlText: string, dialect: Dialect, binds: any[], explicit: unknown, rawOnly: boolean, mssqlNamed: Record<string, any> = {}): CompiledSql {
  const hasExplicit = Array.isArray(explicit) ? explicit.length > 0 : isPlainObject(explicit) && Object.keys(explicit).length > 0;
  if (binds.length === 0 && Object.keys(mssqlNamed).length === 0) {
    return { sql: sqlText, params: hasExplicit ? (explicit as any) : undefined, rawOnly };
  }
  switch (dialect) {
    case "postgres": {
      const base = Array.isArray(explicit) ? explicit : [];
      if (hasExplicit && !Array.isArray(explicit)) throw new DatabaseReferenceError("params must be a JSON array for PostgreSQL");
      return { sql: sqlText.replace(MARK_RE, (_m, i) => `$${base.length + Number(i) + 1}`), params: [...base, ...binds], rawOnly: false };
    }
    case "mssql": {
      const named: Record<string, any> = Array.isArray(explicit)
        ? Object.fromEntries(explicit.map((v, i) => [`p${i + 1}`, v]))
        : isPlainObject(explicit) ? { ...explicit } : {};
      Object.assign(named, mssqlNamed);
      binds.forEach((v, i) => { named[`_in${i + 1}`] = v; });
      return { sql: sqlText.replace(MARK_RE, (_m, i) => `@_in${Number(i) + 1}`), params: named, rawOnly: false };
    }
    case "oracle": {
      if (Array.isArray(explicit) && explicit.length) throw new DatabaseReferenceError("Use either {{inputs}} in the SQL or a params array, not both (Oracle)");
      const named: Record<string, any> = isPlainObject(explicit) ? { ...explicit } : {};
      binds.forEach((v, i) => { named[`in_${i + 1}`] = v; });
      return { sql: sqlText.replace(MARK_RE, (_m, i) => `:in_${Number(i) + 1}`), params: named, rawOnly: false };
    }
    default: {
      // mysql / snowflake: positional "?" in text order, explicit params fill the author's own "?".
      if (hasExplicit && !Array.isArray(explicit)) throw new DatabaseReferenceError("params must be a JSON array");
      const queue = Array.isArray(explicit) ? [...explicit] : [];
      const ordered: any[] = [];
      let sqlOut = "";
      for (const seg of scanSql(sqlText, dialect)) {
        if (seg.kind !== "text") { sqlOut += seg.text; continue; }
        sqlOut += seg.text.replace(/\u0000B(\d+)\u0000|\?/g, (m, i) => {
          if (m === "?") { ordered.push(queue.shift()); return "?"; }
          ordered.push(binds[Number(i)]);
          return "?";
        });
      }
      return { sql: sqlOut, params: ordered, rawOnly: false };
    }
  }
}

// ─── Execution ───

const SQL_START = /^\s*(SELECT|INSERT|UPDATE|DELETE|MERGE|EXEC|EXECUTE|CALL|WITH|CREATE|ALTER|DROP|DECLARE|SHOW|BEGIN|VALUES|TABLE|TRUNCATE|GRANT|REVOKE|SET|DESCRIBE|DESC|EXPLAIN|USE|LIST|PUT|COPY)\b/i;
const READ_START = /^\s*(SELECT|WITH|SHOW|VALUES|TABLE|DESCRIBE|DESC|EXPLAIN)\b/i;

function parseSpec(bodyTemplate: string): Record<string, any> | null {
  const text = (bodyTemplate ?? "").trim();
  if (!text.startsWith("{")) return null;
  try {
    const parsed = JSON.parse(text);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    throw new DatabaseReferenceError("The reference body template is not valid JSON");
  }
}

/** The template's params: "{{params}}" (JSON text or value), an array / object of {{tokens}}, or absent. */
function resolveExplicitParams(node: unknown, values: Record<string, any>): any {
  if (node === undefined || node === null || node === "") return undefined;
  const filled = fillJson(node, values, "params");
  if (typeof filled === "string") return parseJsonValue(filled, "params");
  if (filled === undefined || filled === null) return undefined;
  if (Array.isArray(filled) || isPlainObject(filled)) return filled;
  return [filled];
}

/** Inputs that shape the call rather than being procedure arguments. */
const NON_ARGUMENT_INPUTS = new Set(["procedure_name", "params", "args", "function_name", "sql", "plsql"]);

export async function executeDatabaseReference(req: DatabaseReferenceRequest): Promise<DatabaseReferenceResult> {
  const { executeMongoOperation, executeQuery, executeStoredProcedure, parseDbConfig, defaultMaxRows, assertIdentifier } = await import("@/lib/db-connector");

  const ic = req.integrationConfig ?? {};
  const connConfig = parseDbConfig({
    ...ic,
    auth_config: {
      ...(ic.auth_config ?? {}),
      username: ic.db_config?.username ?? ic.auth_config?.username ?? "",
      password: ic.db_config?.password ?? ic.auth_config?.password ?? "",
    },
  });
  if (!connConfig) throw new Error("Database integration is missing connection details");
  const dbType = connConfig.type;
  const logUrl = `db://${dbType}/${connConfig.database}`;
  const maxRows = defaultMaxRows();
  const timeoutMs = req.timeout && req.timeout > 0 ? req.timeout : undefined;
  const values = req.values ?? {};
  const inputs = req.inputs ?? [];
  const rowsShape = req.resultShape === "rows";

  const spec = parseSpec(req.bodyTemplate);

  // ── MongoDB ──
  if (dbType === "mongodb") {
    if (!spec) throw new DatabaseReferenceError("MongoDB references need a JSON operation body");
    const op = fillJson(spec, values);
    const result: any = await executeMongoOperation(connConfig, op, { maxRows, timeoutMs });
    const data = rowsShape ? (Array.isArray(result?.documents) ? result.documents : result) : result;
    return { status: 200, data, logUrl };
  }
  const dialect = dbType as Dialect;

  // ── Custom reference write: one compiled statement in a transaction ──
  if (req.write) {
    const sqlText = typeof spec?.sql === "string" ? spec.sql : "";
    if (!sqlText.trim()) throw new DatabaseReferenceError("The write statement is empty");
    const compiled = compileSql(sqlText, dialect, values, inputs, undefined, maxRows);
    const result = await executeQuery(connConfig, compiled.sql, compiled.params, {
      maxRows,
      timeoutMs,
      transaction: { rollback: !!req.write.dryRun, ...(req.write.maxAffected !== undefined ? { maxAffected: req.write.maxAffected } : {}) },
    });
    const data: DatabaseWriteData = {
      affected_rows: Number(result.rowCount ?? 0),
      rows: result.rows ?? [],
      rolled_back: !!result.rolledBack,
      ...(req.write.dryRun ? { statement: { sql: compiled.sql, params: compiled.params ?? [] } } : {}),
    };
    return { status: 200, data, logUrl };
  }

  // ── Procedure call body {"procedure": …, "params": …} ──
  const procedureTemplate = typeof spec?.procedure === "string" ? spec.procedure : "";
  if (procedureTemplate) {
    const name = assertIdentifier(String(fillJson(procedureTemplate, values) ?? "").trim(), "procedure name");
    const explicit = resolveExplicitParams(spec?.params, values);
    const args = Array.isArray(explicit)
      ? Object.fromEntries(explicit.map((v, i) => [`p${i + 1}`, v]))
      : isPlainObject(explicit) ? explicit : {};
    const result = await executeStoredProcedure(connConfig, name, args, { maxRows, timeoutMs });
    return { status: 200, data: procedureData(result, rowsShape), logUrl };
  }

  // ── SQL text: body {"sql": …} / raw SQL body / SQL in the path (legacy) ──
  let sqlTemplate = typeof spec?.sql === "string" ? spec.sql : "";
  if (!sqlTemplate && !spec && SQL_START.test(req.bodyTemplate ?? "")) sqlTemplate = req.bodyTemplate;
  const path = req.pathTemplate ?? "";
  const pathIsSql = !(path.startsWith("/") && path.includes("_internal"));
  if (!sqlTemplate && pathIsSql && path.trim()) sqlTemplate = path;

  const method = String(req.method ?? "").toUpperCase();

  // Legacy EXEC references: the path is the procedure name, inputs are its arguments.
  if (method === "EXEC" && sqlTemplate && !/\s/.test(sqlTemplate.replace(/^\s*(EXEC|EXECUTE|CALL)\s+/i, "").trim().replace(/\(\s*\)$/, ""))) {
    const name = assertIdentifier(sqlTemplate.replace(/^\s*(EXEC|EXECUTE|CALL)\s+/i, "").trim().replace(/\(\s*\)$/, ""), "procedure name");
    const args: Record<string, any> = {};
    for (const input of inputs) if (!NON_ARGUMENT_INPUTS.has(input.name)) args[input.name] = values[input.name];
    const result = await executeStoredProcedure(connConfig, name, args, { maxRows, timeoutMs });
    return { status: 200, data: procedureData(result, rowsShape), logUrl };
  }

  if (!sqlTemplate.trim()) {
    throw new DatabaseReferenceError("No SQL query found. Ensure the reference body (sql) or path template contains a SQL statement.");
  }

  const explicit = resolveExplicitParams(spec?.params, values);
  const compiled = compileSql(sqlTemplate, dialect, values, inputs, explicit, maxRows);
  const finalSql = compiled.sql.trim();
  if (!finalSql) throw new DatabaseReferenceError("The SQL statement is empty");

  // mssql "EXEC name" (no arguments written) runs the procedure with the given params.
  const bareExec = /^\s*EXEC(UTE)?\s+([^\s(;]+)\s*;?\s*$/i.exec(finalSql);
  if (dialect === "mssql" && bareExec) {
    const name = assertIdentifier(bareExec[2], "procedure name");
    const args = Array.isArray(compiled.params)
      ? Object.fromEntries(compiled.params.map((v, i) => [`p${i + 1}`, v]))
      : isPlainObject(compiled.params) ? compiled.params : {};
    const result = await executeStoredProcedure(connConfig, name, args, { maxRows, timeoutMs });
    return { status: 200, data: procedureData(result, rowsShape), logUrl };
  }

  // Read templates (/_internal/db/query) that only read run in a read-only
  // transaction where supported, so a crafted condition cannot write.
  const isFunctionTemplate = /\{\{\s*(function_name|procedure_name)\s*\}\}/.test(sqlTemplate);
  // The "Run Query" template ({{sql}}) runs the caller's statement as written.
  const callerStatement = /^\s*\{\{\s*(sql|plsql|query)\s*\}\}\s*$/.test(sqlTemplate);
  const readOnly = /\/_internal\/db\/query\b/.test(path) && !isFunctionTemplate && !callerStatement && READ_START.test(finalSql);

  const result = await executeQuery(connConfig, finalSql, compiled.params, {
    maxRows,
    timeoutMs,
    readOnly,
    allowMultiStatement: compiled.rawOnly,
  });
  const rows = result.rows ?? [];
  if (rowsShape) return { status: 200, data: rows, logUrl };

  const isWriteOp = /^\s*(INSERT|UPDATE|DELETE|MERGE)\b/i.test(finalSql);
  if (isWriteOp) {
    return {
      status: 200,
      data: { affected_rows: result.rowCount ?? rows.length, rows: rows.length > 0 ? rows : undefined },
      logUrl,
    };
  }

  // A single-row fetch (TOP 1 / LIMIT 1 / ROWNUM = 1, or WHERE … with one row)
  // returns the row object rather than a one-element array (unchanged contract).
  // Catalogue listings (list_tables / list_views) are always lists.
  const isListing = /\b(information_schema|ALL_TABLES|ALL_VIEWS)\b|^\s*SHOW\b/i.test(finalSql);
  const isSingleRowQuery = !isListing && (
    /\b(TOP\s+1|LIMIT\s+1|ROWNUM\s*=\s*1)\b/i.test(finalSql) ||
    (rows.length === 1 && /\bWHERE\b/i.test(finalSql) && !/\bOFFSET\b/i.test(finalSql)));
  if (isSingleRowQuery && rows.length <= 1) return { status: 200, data: rows[0] ?? null, logUrl };

  return { status: 200, data: rows, logUrl };
}

function procedureData(result: any, rowsShape: boolean) {
  const rows = result?.rows ?? [];
  if (rowsShape) return rows;
  // Unchanged contract: a driver that reports output parameters (mssql, oracle) → { rows, output }.
  return result?.output ? { rows, output: result.output } : rows;
}
