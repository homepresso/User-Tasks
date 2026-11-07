/**
 * Contract tests for the database connectors (postgres, mssql, mysql, oracle,
 * snowflake, mongodb) and SFTP: every reference template runs through the
 * real runtime (lib/reference-executor → lib/db-reference / lib/sftp-executor)
 * and the statement / operation handed to the driver layer is recorded.
 *
 * The driver layer (lib/db-connector) is replaced by recorders for the
 * template table; its own behaviour (binding, pool keys, Mongo guards, egress)
 * is tested further down against the real module with the drivers mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:dns/promises', () => ({ lookup: async () => [{ address: '93.184.216.34', family: 4 }] }))

interface DbCall { kind: 'query' | 'proc' | 'mongo'; sql?: string; name?: string; params?: any; spec?: any; opts?: any; type?: string }
const calls: DbCall[] = vi.hoisted(() => [] as any[])
const state = vi.hoisted(() => ({ queryRows: [{ id: 1 }] as any[] }))

vi.mock('@/lib/db-connector', async (importOriginal) => {
  const actual: any = await importOriginal()
  return {
    ...actual,
    executeQuery: vi.fn(async (config: any, sql: string, params: any, opts: any) => {
      calls.push({ kind: 'query', type: config.type, sql, params, opts })
      return { rows: state.queryRows, fields: [], rowCount: state.queryRows.length, duration: 0 }
    }),
    executeStoredProcedure: vi.fn(async (config: any, name: string, params: any, opts: any) => {
      actual.assertIdentifier(name, 'procedure name')
      calls.push({ kind: 'proc', type: config.type, name, params, opts })
      return { rows: [{ ok: 1 }], fields: [], rowCount: 1, duration: 0, ...(config.type === 'mssql' ? { output: {}, returnValue: 0 } : {}) }
    }),
    executeMongoOperation: vi.fn(async (config: any, spec: any, opts: any) => {
      calls.push({ kind: 'mongo', type: config.type, spec, opts })
      return { documents: [{ _id: 'a' }], count: 1 }
    }),
  }
})

// ── Fake drivers for the real db-connector tests ──

const mssqlState = vi.hoisted(() => ({ inputs: [] as [string, any, any][], queries: [] as string[], executed: [] as string[] }))
vi.mock('mssql', async () => {
  const { EventEmitter } = await import('node:events')
  class Request extends EventEmitter {
    stream = false
    input(name: string, type: any, value: any) { mssqlState.inputs.push([name, type?.declaration ?? type?.name ?? String(type), value]); return this }
    query(text: string) {
      mssqlState.queries.push(text)
      setTimeout(() => {
        this.emit('recordset', { id: {} })
        this.emit('row', { id: 1 })
        this.emit('done', { rowsAffected: [1] })
      }, 0)
      return this
    }
    async execute(name: string) { mssqlState.executed.push(name); return { recordset: [{ id: 1 }], rowsAffected: [1], output: {}, returnValue: 0 } }
    cancel() {}
  }
  class ConnectionPool extends EventEmitter {
    connected = false
    constructor(public config: any) { super() }
    async connect() { this.connected = true; return this }
    request() { return new Request() }
    async close() { this.connected = false }
  }
  const t = (name: string) => Object.assign(() => ({ name }), { declaration: name })
  const sql: any = { ConnectionPool, Int: { name: 'Int' }, BigInt: { name: 'BigInt' }, Float: { name: 'Float' }, Bit: { name: 'Bit' }, DateTime2: { name: 'DateTime2' }, MAX: -1 }
  sql.NVarChar = (len: number) => ({ name: `NVarChar(${len})` })
  sql.VarBinary = (len: number) => ({ name: `VarBinary(${len})` })
  void t
  return { default: sql }
})

const mongoState = vi.hoisted(() => ({ options: [] as any[], uris: [] as string[], ops: [] as any[] }))
vi.mock('mongodb', () => {
  const cursor = (docs: any[], log: any) => {
    const c: any = { sort: (s: any) => { log.sort = s; return c }, skip: (n: number) => { log.skip = n; return c }, limit: (n: number) => { log.limit = n; return c }, toArray: async () => docs }
    return c
  }
  class MongoClient {
    constructor(uri: string, options: any) { mongoState.uris.push(uri); mongoState.options.push(options) }
    async connect() { return this }
    async close() {}
    db() {
      return {
        admin: () => ({ command: async () => ({ ok: 1 }) }),
        listCollections: () => ({ toArray: async () => [{ name: 'orders' }] }),
        collection: (name: string) => ({
          find: (filter: any, opts: any) => { const log: any = { op: 'find', name, filter, opts }; mongoState.ops.push(log); return cursor([{ _id: 1 }], log) },
          findOne: async (filter: any) => { mongoState.ops.push({ op: 'findOne', filter }); return { _id: 1 } },
          deleteMany: async (filter: any) => { mongoState.ops.push({ op: 'deleteMany', filter }); return { deletedCount: 3 } },
          updateMany: async (filter: any, update: any) => { mongoState.ops.push({ op: 'updateMany', filter, update }); return { modifiedCount: 3 } },
          aggregate: (pipeline: any[], opts: any) => { mongoState.ops.push({ op: 'aggregate', pipeline, opts }); return { toArray: async () => [{ _id: 1 }] } },
          countDocuments: async (filter: any) => { mongoState.ops.push({ op: 'count', filter }); return 7 },
          insertMany: async (docs: any[]) => ({ insertedCount: docs.length }),
        }),
      }
    }
  }
  return { MongoClient }
})

const snowflakeState = vi.hoisted(() => ({ options: [] as any[] }))
vi.mock('snowflake-sdk', () => {
  const createConnection = (options: any) => {
    snowflakeState.options.push(options)
    return {
      connect: (cb: any) => cb(null),
      execute: ({ complete }: any) => complete(null, { getColumns: () => [], getNumRows: () => 0 }, []),
      destroy: (cb: any) => cb?.(),
    }
  }
  return { default: { createConnection }, createConnection }
})

import { runConnectorTemplate } from './helpers/connector-contract'
import { getConnectorDefinition } from '@/lib/connectors/registry'

const lastCall = () => calls[calls.length - 1]

beforeEach(() => {
  calls.length = 0
  state.queryRows = [{ id: 1 }]
})

// ─────────────────────────────────────────────────────────────────────────────
// Every template of every database connector
// ─────────────────────────────────────────────────────────────────────────────

interface Case { inputs: Record<string, any>; expect: Partial<DbCall> & { readOnly?: boolean } }

const SQL_CASES: Record<string, Record<string, Case>> = {
  postgres: {
    query: { inputs: { sql: 'SELECT *\nFROM "Customers"\nWHERE id = $1', params: '[42]' }, expect: { kind: 'query', sql: 'SELECT *\nFROM "Customers"\nWHERE id = $1', params: [42], readOnly: false } },
    list_records: { inputs: { table: 'public.customers', columns: 'id, name', where_clause: "WHERE status = 'active'", order_by: 'id DESC', limit: 10, offset: 5 }, expect: { sql: "SELECT id, name FROM public.customers WHERE status = 'active' ORDER BY id DESC LIMIT 10 OFFSET 5", params: undefined, readOnly: true } },
    get_record: { inputs: { table: 'public.customers', pk_column: 'id', pk_value: '42' }, expect: { sql: 'SELECT * FROM public.customers WHERE id = $1 LIMIT 1', params: ['42'], readOnly: true } },
    insert_record: { inputs: { table: 'customers', columns: 'name, email', values: '$1, $2', params: '["Ada", "ada@example.com"]' }, expect: { sql: 'INSERT INTO customers (name, email) VALUES ($1, $2) RETURNING *', params: ['Ada', 'ada@example.com'], readOnly: false } },
    update_record: { inputs: { table: 'customers', set_clause: 'name = $1, status = $2', where_clause: 'id = $3', params: '["Ada", "active", 7]' }, expect: { sql: 'UPDATE customers SET name = $1, status = $2 WHERE id = $3 RETURNING *', params: ['Ada', 'active', 7] } },
    delete_record: { inputs: { table: 'customers', where_clause: 'id = $1', params: '[7]' }, expect: { sql: 'DELETE FROM customers WHERE id = $1 RETURNING *', params: [7] } },
    execute: { inputs: { sql: 'CREATE TABLE t (id int); INSERT INTO t VALUES (1)' }, expect: { sql: 'CREATE TABLE t (id int); INSERT INTO t VALUES (1)', params: undefined } },
    list_tables: { inputs: {}, expect: { sql: 'SELECT table_name, table_type FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name', params: ['public'], readOnly: true } },
    list_views: { inputs: { schema: 'sales' }, expect: { sql: 'SELECT table_name AS view_name, view_definition FROM information_schema.views WHERE table_schema = $1 ORDER BY table_name', params: ['sales'], readOnly: true } },
    call_function: { inputs: { function_name: 'public.get_active_users', args: '$1', params: '[30]' }, expect: { sql: 'SELECT * FROM public.get_active_users($1)', params: [30], readOnly: false } },
  },
  mssql: {
    query: { inputs: { sql: 'SELECT * FROM dbo.Customers WHERE Id = @p1', params: '[42]' }, expect: { sql: 'SELECT * FROM dbo.Customers WHERE Id = @p1', params: [42] } },
    list_records: { inputs: { table: 'dbo.Customers', where_clause: "WHERE Status = N'Active'", order_by: 'Id', limit: 25, offset: 50 }, expect: { sql: "SELECT * FROM dbo.Customers WHERE Status = N'Active' ORDER BY Id OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY", readOnly: true } },
    get_record: { inputs: { table: '[dbo].[Customers]', pk_column: 'Id', pk_value: '42' }, expect: { sql: 'SELECT TOP 1 * FROM [dbo].[Customers] WHERE Id = @p1', params: ['42'] } },
    insert_record: { inputs: { table: 'dbo.Customers', columns: 'Name, Email', values: '@p1, @p2', params: '["Ada", "ada@example.com"]' }, expect: { sql: 'INSERT INTO dbo.Customers (Name, Email) OUTPUT INSERTED.* VALUES (@p1, @p2)', params: ['Ada', 'ada@example.com'] } },
    update_record: { inputs: { table: 'dbo.Customers', set_clause: 'Name = @p1', where_clause: 'Id = @p2', params: '["Ada", 7]' }, expect: { sql: 'UPDATE dbo.Customers SET Name = @p1 OUTPUT INSERTED.* WHERE Id = @p2', params: ['Ada', 7] } },
    delete_record: { inputs: { table: 'dbo.Customers', where_clause: 'Id = @p1', params: '[7]' }, expect: { sql: 'DELETE FROM dbo.Customers OUTPUT DELETED.* WHERE Id = @p1', params: [7] } },
    execute: { inputs: { sql: 'UPDATE dbo.T SET x = 1' }, expect: { sql: 'UPDATE dbo.T SET x = 1' } },
    list_tables: { inputs: {}, expect: { sql: 'SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_TYPE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = @p1 ORDER BY TABLE_NAME', params: ['dbo'] } },
    list_views: { inputs: { schema: 'sales' }, expect: { sql: 'SELECT TABLE_SCHEMA, TABLE_NAME AS VIEW_NAME FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = @p1 ORDER BY TABLE_NAME', params: ['sales'] } },
    stored_procedure: { inputs: { procedure_name: 'dbo.usp_GetCustomers', params: '{"Region": "EMEA", "Top": 5}' }, expect: { kind: 'proc', name: 'dbo.usp_GetCustomers', params: { Region: 'EMEA', Top: 5 } } },
  },
  mysql: {
    query: { inputs: { sql: 'SELECT * FROM orders WHERE id = ?', params: '[3]' }, expect: { sql: 'SELECT * FROM orders WHERE id = ?', params: [3] } },
    list_records: { inputs: { table: 'shop.orders', limit: 10, offset: 0 }, expect: { sql: 'SELECT * FROM shop.orders  ORDER BY 1 LIMIT 10 OFFSET 0', readOnly: true } },
    get_record: { inputs: { table: '`orders`', pk_column: 'id', pk_value: '3' }, expect: { sql: 'SELECT * FROM `orders` WHERE id = ? LIMIT 1', params: ['3'] } },
    insert_record: { inputs: { table: 'orders', columns: 'sku, qty', values: '?, ?', params: '["A-1", 2]' }, expect: { sql: 'INSERT INTO orders (sku, qty) VALUES (?, ?)', params: ['A-1', 2] } },
    update_record: { inputs: { table: 'orders', set_clause: 'qty = ?', where_clause: 'id = ?', params: '[5, 3]' }, expect: { sql: 'UPDATE orders SET qty = ? WHERE id = ?', params: [5, 3] } },
    delete_record: { inputs: { table: 'orders', where_clause: 'id = ?', params: '[3]' }, expect: { sql: 'DELETE FROM orders WHERE id = ?', params: [3] } },
    execute: { inputs: { sql: 'TRUNCATE TABLE staging' }, expect: { sql: 'TRUNCATE TABLE staging' } },
    // database defaults to the connector's database (template var), and to DATABASE() when empty.
    list_tables: { inputs: {}, expect: { sql: "SELECT TABLE_NAME, TABLE_TYPE, TABLE_ROWS, ENGINE FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = COALESCE(NULLIF(?, ''), DATABASE()) ORDER BY TABLE_NAME", params: ['fake-database'], readOnly: true } },
    list_views: { inputs: { database: 'shop' }, expect: { sql: "SELECT TABLE_NAME AS VIEW_NAME, VIEW_DEFINITION FROM INFORMATION_SCHEMA.VIEWS WHERE TABLE_SCHEMA = COALESCE(NULLIF(?, ''), DATABASE()) ORDER BY TABLE_NAME", params: ['shop'] } },
    call_procedure: { inputs: { procedure_name: 'get_active_users', args: '?, ?', params: '[30, "EU"]' }, expect: { kind: 'query', sql: 'CALL get_active_users(?, ?)', params: [30, 'EU'], readOnly: false } },
  },
  oracle: {
    query: { inputs: { sql: 'SELECT * FROM employees' }, expect: { sql: 'SELECT * FROM employees', params: undefined } },
    list_records: { inputs: { table: 'HR.EMPLOYEES', where_clause: 'WHERE DEPARTMENT_ID = 10', limit: 20, offset: 0 }, expect: { sql: 'SELECT * FROM HR.EMPLOYEES WHERE DEPARTMENT_ID = 10 ORDER BY 1 OFFSET 0 ROWS FETCH NEXT 20 ROWS ONLY', readOnly: true } },
    get_record: { inputs: { table: 'HR.EMPLOYEES', pk_column: 'EMPLOYEE_ID', pk_value: '100' }, expect: { sql: 'SELECT * FROM HR.EMPLOYEES WHERE EMPLOYEE_ID = :1 AND ROWNUM = 1', params: ['100'] } },
    insert_record: { inputs: { table: 'HR.JOBS', columns: 'JOB_ID, JOB_TITLE', values: ':1, :2', params: '["DEV", "Developer"]' }, expect: { sql: 'INSERT INTO HR.JOBS (JOB_ID, JOB_TITLE) VALUES (:1, :2)', params: ['DEV', 'Developer'] } },
    update_record: { inputs: { table: 'HR.JOBS', set_clause: 'JOB_TITLE = :1', where_clause: 'JOB_ID = :2', params: '["Dev", "DEV"]' }, expect: { sql: 'UPDATE HR.JOBS SET JOB_TITLE = :1 WHERE JOB_ID = :2', params: ['Dev', 'DEV'] } },
    delete_record: { inputs: { table: 'HR.JOBS', where_clause: 'JOB_ID = :1', params: '["DEV"]' }, expect: { sql: 'DELETE FROM HR.JOBS WHERE JOB_ID = :1', params: ['DEV'] } },
    execute: { inputs: { sql: 'UPDATE t SET x = :v', params: '{"v": 1}' }, expect: { sql: 'UPDATE t SET x = :v', params: { v: 1 } } },
    list_tables: { inputs: {}, expect: { sql: 'SELECT OWNER, TABLE_NAME, NUM_ROWS, LAST_ANALYZED FROM ALL_TABLES WHERE OWNER = NVL(UPPER(:1), USER) ORDER BY TABLE_NAME', params: [''] } },
    list_views: { inputs: { schema: 'hr' }, expect: { sql: 'SELECT OWNER, VIEW_NAME, TEXT_LENGTH FROM ALL_VIEWS WHERE OWNER = NVL(UPPER(:1), USER) ORDER BY VIEW_NAME', params: ['hr'] } },
    call_procedure: { inputs: { procedure_name: 'HR.UPDATE_SALARY', params: '{"p_emp_id": 100, "p_amount": 5000}' }, expect: { kind: 'proc', name: 'HR.UPDATE_SALARY', params: { p_emp_id: 100, p_amount: 5000 } } },
    call_function: { inputs: { function_name: 'HR.GET_DEPT', args: ':1', params: '[10]' }, expect: { sql: 'SELECT HR.GET_DEPT(:1) AS RESULT FROM DUAL', params: [10], readOnly: false } },
    plsql_block: { inputs: { plsql: 'BEGIN HR.RAISE(:id); END;', params: '{"id": 7}' }, expect: { sql: 'BEGIN HR.RAISE(:id); END;', params: { id: 7 } } },
  },
  snowflake: {
    query: { inputs: { sql: 'SELECT * FROM SALES WHERE REGION = ?', params: '["EU"]' }, expect: { sql: 'SELECT * FROM SALES WHERE REGION = ?', params: ['EU'] } },
    list_records: { inputs: { table: 'DB.PUBLIC.SALES', columns: 'ID, AMOUNT', order_by: 'ID', limit: 100, offset: 0 }, expect: { sql: 'SELECT ID, AMOUNT FROM DB.PUBLIC.SALES  ORDER BY ID LIMIT 100 OFFSET 0' } },
    get_record: { inputs: { table: 'SALES', pk_column: 'ID', pk_value: '9' }, expect: { sql: 'SELECT * FROM SALES WHERE ID = ? LIMIT 1', params: ['9'] } },
    insert_record: { inputs: { table: 'SALES', columns: 'ID, AMOUNT', values: '?, ?', params: '[9, 12.5]' }, expect: { sql: 'INSERT INTO SALES (ID, AMOUNT) VALUES (?, ?)', params: [9, 12.5] } },
    update_record: { inputs: { table: 'SALES', set_clause: 'AMOUNT = ?', where_clause: 'ID = ?', params: '[13, 9]' }, expect: { sql: 'UPDATE SALES SET AMOUNT = ? WHERE ID = ?', params: [13, 9] } },
    delete_record: { inputs: { table: 'SALES', where_clause: 'ID = ?', params: '[9]' }, expect: { sql: 'DELETE FROM SALES WHERE ID = ?', params: [9] } },
    execute: { inputs: { sql: 'ALTER WAREHOUSE W SUSPEND' }, expect: { sql: 'ALTER WAREHOUSE W SUSPEND' } },
    list_tables: { inputs: {}, expect: { sql: 'SHOW TABLES IN SCHEMA PUBLIC' } },
    list_views: { inputs: { schema: 'MY_DB.REPORTING' }, expect: { sql: 'SHOW VIEWS IN SCHEMA MY_DB.REPORTING' } },
    call_procedure: { inputs: { procedure_name: 'MY_DB.PUBLIC.REFRESH', args: '?', params: '["2026-10"]' }, expect: { kind: 'query', sql: 'CALL MY_DB.PUBLIC.REFRESH(?)', params: ['2026-10'] } },
  },
}

const MONGO_CASES: Record<string, Case> = {
  find: { inputs: { collection: 'orders', filter: '{"status": "open", "note": "say \\"hi\\""}', projection: '{"total": 1}', sort: '{"createdAt": -1}', limit: 20, skip: 40 }, expect: { spec: { operation: 'find', collection: 'orders', filter: { status: 'open', note: 'say "hi"' }, projection: { total: 1 }, sort: { createdAt: -1 }, limit: 20, skip: 40 } } },
  find_one: { inputs: { collection: 'orders', filter: { _id: 'abc' } }, expect: { spec: { operation: 'findOne', collection: 'orders', filter: { _id: 'abc' } } } },
  insert_one: { inputs: { collection: 'orders', document: '{"sku": "A-1", "qty": 2}' }, expect: { spec: { operation: 'insertOne', collection: 'orders', document: { sku: 'A-1', qty: 2 } } } },
  insert_many: { inputs: { collection: 'orders', documents: [{ sku: 'A' }, { sku: 'B' }] }, expect: { spec: { operation: 'insertMany', collection: 'orders', documents: [{ sku: 'A' }, { sku: 'B' }] } } },
  update_one: { inputs: { collection: 'orders', filter: '{"_id": "abc"}', update: '{"$set": {"status": "closed"}}' }, expect: { spec: { operation: 'updateOne', collection: 'orders', filter: { _id: 'abc' }, update: { $set: { status: 'closed' } } } } },
  update_many: { inputs: { collection: 'orders', filter: '{"status": "open"}', update: '{"$set": {"flag": true}}' }, expect: { spec: { operation: 'updateMany', collection: 'orders', filter: { status: 'open' }, update: { $set: { flag: true } }, allow_all: 'false' } } },
  delete_one: { inputs: { collection: 'orders', filter: '{"_id": "abc"}' }, expect: { spec: { operation: 'deleteOne', collection: 'orders', filter: { _id: 'abc' } } } },
  delete_many: { inputs: { collection: 'orders', filter: '{"status": "void"}' }, expect: { spec: { operation: 'deleteMany', collection: 'orders', filter: { status: 'void' }, allow_all: 'false' } } },
  aggregate: { inputs: { collection: 'orders', pipeline: '[{"$group": {"_id": "$status", "n": {"$sum": 1}}}]' }, expect: { spec: { operation: 'aggregate', collection: 'orders', pipeline: [{ $group: { _id: '$status', n: { $sum: 1 } } }] } } },
  list_collections: { inputs: {}, expect: { spec: { operation: 'listCollections' } } },
  count: { inputs: { collection: 'orders', filter: '' }, expect: { spec: { operation: 'countDocuments', collection: 'orders', filter: {} } } },
}

describe('database connector templates', () => {
  for (const [connector, cases] of Object.entries(SQL_CASES)) {
    it(`${connector}: every template has a contract case`, () => {
      const def = getConnectorDefinition(connector)!
      expect(Object.keys(cases).sort()).toEqual(def.referenceTemplates.map((t) => t.key).sort())
    })
    for (const [template, c] of Object.entries(cases)) {
      it(`${connector}.${template}`, async () => {
        const { result } = await runConnectorTemplate({ connector, template, inputs: c.inputs })
        expect(result.status).toBe(200)
        const call = lastCall()
        expect(call.type).toBe(connector)
        expect(call.kind).toBe(c.expect.kind ?? 'query')
        if (c.expect.sql !== undefined) expect(call.sql).toBe(c.expect.sql)
        if (c.expect.name !== undefined) expect(call.name).toBe(c.expect.name)
        if ('params' in c.expect) expect(call.params).toEqual(c.expect.params)
        if (c.expect.readOnly !== undefined) expect(call.opts.readOnly).toBe(c.expect.readOnly)
        expect(call.opts.timeoutMs).toBe(5000)
        expect(call.opts.maxRows).toBeGreaterThan(0)
        expect(result.log?.url).toMatch(new RegExp(`^db://${connector}/`))
      })
    }
  }

  it('mongodb: every template has a contract case', () => {
    expect(Object.keys(MONGO_CASES).sort()).toEqual(getConnectorDefinition('mongodb')!.referenceTemplates.map((t) => t.key).sort())
  })
  for (const [template, c] of Object.entries(MONGO_CASES)) {
    it(`mongodb.${template}`, async () => {
      const { result } = await runConnectorTemplate({ connector: 'mongodb', template, config: { connection_string: 'mongodb+srv://cluster0.example.net', database: 'shop' }, inputs: c.inputs })
      expect(result.status).toBe(200)
      expect(lastCall().kind).toBe('mongo')
      expect(lastCall().spec).toEqual(c.expect.spec)
    })
  }
})

// ─────────────────────────────────────────────────────────────────────────────
// Injection and templating
// ─────────────────────────────────────────────────────────────────────────────

describe('SQL templating is injection-safe', () => {
  it('a value cannot re-key the JSON body (get_record pk_value stays a bound parameter)', async () => {
    const evil = '1"],"sql":"DELETE FROM users RETURNING *","params":["'
    await runConnectorTemplate({ connector: 'postgres', template: 'get_record', inputs: { table: 'users', pk_column: 'id', pk_value: evil } })
    expect(lastCall().sql).toBe('SELECT * FROM users WHERE id = $1 LIMIT 1')
    expect(lastCall().params).toEqual([evil])
  })

  it.each([
    ['users; DROP TABLE users', 'table'],
    ['users WHERE 1=1 --', 'table'],
    ['id = 1 OR 1', 'pk_column'],
  ])('rejects %s as an identifier', async (value, field) => {
    const inputs = { table: 'users', pk_column: 'id', pk_value: '1', [field]: value }
    await expect(runConnectorTemplate({ connector: 'postgres', template: 'get_record', inputs })).rejects.toThrow(new RegExp(`Input "${field}" must be a table / column name`))
    expect(calls).toHaveLength(0)
  })

  it('rejects stacked statements and comments in a where_clause', async () => {
    for (const where_clause of ['id = 1; DROP TABLE t', 'id = 1 -- x', 'id = 1 /* x */']) {
      await expect(runConnectorTemplate({ connector: 'mssql', template: 'delete_record', inputs: { table: 'dbo.T', where_clause, params: '[]' } })).rejects.toThrow(/single condition/)
    }
    // A ";" inside a literal is fine.
    await runConnectorTemplate({ connector: 'mssql', template: 'delete_record', inputs: { table: 'dbo.T', where_clause: "Name = 'a;b'", params: '[]' } })
    expect(lastCall().sql).toBe("DELETE FROM dbo.T OUTPUT DELETED.* WHERE Name = 'a;b'")
  })

  it('set_clause, values and args accept placeholders only', async () => {
    await expect(runConnectorTemplate({ connector: 'postgres', template: 'update_record', inputs: { table: 't', set_clause: "name = 'x'", where_clause: 'id = $1', params: '[1]' } })).rejects.toThrow(/column = placeholder/)
    await expect(runConnectorTemplate({ connector: 'postgres', template: 'insert_record', inputs: { table: 't', columns: 'a', values: "(SELECT pg_sleep(10))", params: '[]' } })).rejects.toThrow(/placeholders/)
    await expect(runConnectorTemplate({ connector: 'mysql', template: 'call_procedure', inputs: { procedure_name: 'p', args: '1); DROP TABLE t; --', params: '[]' } })).rejects.toThrow(/placeholders/)
    await expect(runConnectorTemplate({ connector: 'postgres', template: 'list_records', inputs: { table: 't', columns: 'a, (select 1)' } })).rejects.toThrow(/column names/)
  })

  it('caps limit at the row cap and requires whole numbers', async () => {
    process.env.DB_MAX_ROWS = '50'
    try {
      await runConnectorTemplate({ connector: 'postgres', template: 'list_records', inputs: { table: 't', limit: 100000 } })
      expect(lastCall().sql).toBe('SELECT * FROM t  ORDER BY 1 LIMIT 50 OFFSET 0')
      expect(lastCall().opts.maxRows).toBe(50)
    } finally {
      delete process.env.DB_MAX_ROWS
    }
  })

  it('procedure names are identifiers; empty params are no arguments (not the template inputs)', async () => {
    await runConnectorTemplate({ connector: 'mssql', template: 'stored_procedure', inputs: { procedure_name: 'dbo.usp_X', params: '' } })
    expect(lastCall()).toMatchObject({ kind: 'proc', name: 'dbo.usp_X', params: {} })
    await expect(runConnectorTemplate({ connector: 'oracle', template: 'call_procedure', inputs: { procedure_name: 'X(1); EXECUTE IMMEDIATE \'DROP TABLE T\'', params: '' } })).rejects.toThrow(/Invalid procedure name/)
  })

  it('oracle without params binds nothing (no NJS-005)', async () => {
    await runConnectorTemplate({ connector: 'oracle', template: 'query', inputs: { sql: 'SELECT 1 FROM DUAL', params: '' } })
    expect(lastCall().params).toBeUndefined()
  })

  it('invalid params JSON is an error, not a silently different query', async () => {
    await expect(runConnectorTemplate({ connector: 'postgres', template: 'query', inputs: { sql: 'SELECT $1', params: '[1,' } })).rejects.toThrow(/"params" must be valid JSON/)
  })
})

describe('custom / legacy SQL references (path_template SQL, @name placeholders)', () => {
  const legacy = (sql: string, inputs: { name: string; type?: string }[], method = 'POST') => (ref: Record<string, any>) => {
    ref.request_config = { method, path_template: sql, body_template: '', headers: {} }
    ref.inputs = inputs.map((i) => ({ name: i.name, type: i.type ?? 'string', required: false, default_value: '' }))
  }

  it('mssql: @name binds by name through request.input; values are never inlined', async () => {
    await runConnectorTemplate({
      connector: 'mssql', template: 'query', inputs: { a: 'x@b', b: "1; DROP TABLE t--'" },
      mutateReference: legacy('SELECT * FROM t WHERE a = @a AND b = @b AND v = @@VERSION', [{ name: 'a' }, { name: 'b' }]),
    })
    expect(lastCall().sql).toBe('SELECT * FROM t WHERE a = @a AND b = @b AND v = @@VERSION')
    expect(lastCall().params).toEqual({ a: 'x@b', b: "1; DROP TABLE t--'" })
  })

  it('reference-builder list / get / insert / update / delete shapes', async () => {
    await runConnectorTemplate({ connector: 'mssql', template: 'query', inputs: { limit: 25, offset: 0 }, mutateReference: legacy('SELECT * FROM [dbo].[Orders] ORDER BY 1 OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY', [{ name: 'limit', type: 'number' }, { name: 'offset', type: 'number' }]) })
    expect(lastCall().params).toEqual({ limit: 25, offset: 0 })
    await runConnectorTemplate({ connector: 'postgres', template: 'query', inputs: { id: '5', name: "O'Brien" }, mutateReference: legacy("UPDATE public.people SET name = @name WHERE id = @id AND email <> 'a@example.com'", [{ name: 'name' }, { name: 'id' }]) })
    expect(lastCall().sql).toBe("UPDATE public.people SET name = $1 WHERE id = $2 AND email <> 'a@example.com'")
    expect(lastCall().params).toEqual(["O'Brien", '5'])
    await runConnectorTemplate({ connector: 'mysql', template: 'query', inputs: { sku: 'A', qty: 2 }, mutateReference: legacy('INSERT INTO orders (sku, qty) VALUES (@sku, @qty)', [{ name: 'sku' }, { name: 'qty', type: 'number' }]) })
    expect(lastCall()).toMatchObject({ sql: 'INSERT INTO orders (sku, qty) VALUES (?, ?)', params: ['A', 2] })
  })

  it('legacy EXEC references call the procedure with their inputs', async () => {
    await runConnectorTemplate({ connector: 'mssql', template: 'query', inputs: { Region: 'EU', Top: 3 }, mutateReference: legacy('dbo.usp_Report', [{ name: 'Region' }, { name: 'Top', type: 'number' }], 'EXEC') })
    expect(lastCall()).toMatchObject({ kind: 'proc', name: 'dbo.usp_Report', params: { Region: 'EU', Top: 3 } })
    // reference-builder's "EXEC name @p = @p" runs as a batch with named parameters.
    await runConnectorTemplate({ connector: 'mssql', template: 'query', inputs: { Region: 'EU' }, mutateReference: legacy('EXEC [dbo].[usp_Report] @Region = @Region', [{ name: 'Region' }], 'EXEC') })
    expect(lastCall()).toMatchObject({ kind: 'query', sql: 'EXEC [dbo].[usp_Report] @Region = @Region', params: { Region: 'EU' } })
  })

  it('{{input}} in custom SQL is a bound parameter, also inside quotes', async () => {
    await runConnectorTemplate({ connector: 'postgres', template: 'query', inputs: { q: "x' OR '1'='1", id: 3 }, mutateReference: (ref) => {
      ref.request_config = { method: 'POST', path_template: '/_internal/db/query', body_template: JSON.stringify({ sql: "SELECT * FROM t WHERE name LIKE '%{{q}}%' AND id = {{id}} AND code = '{{q}}'" }), headers: {} }
      ref.inputs = [{ name: 'q', type: 'string', required: false, default_value: '' }, { name: 'id', type: 'number', required: false, default_value: '' }]
    } })
    expect(lastCall().sql).toBe("SELECT * FROM t WHERE name LIKE ('%' || CAST($1 AS text) || '%') AND id = $2 AND code = $3")
    expect(lastCall().params).toEqual(["x' OR '1'='1", 3, "x' OR '1'='1"])
    expect(lastCall().opts.readOnly).toBe(true)
  })

  it('mysql: {{input}} binds keep their position among the author\'s own "?"', async () => {
    await runConnectorTemplate({ connector: 'mysql', template: 'query', inputs: { region: 'EU', params: '[10]' }, mutateReference: (ref) => {
      ref.request_config = { method: 'POST', path_template: '/_internal/db/query', body_template: JSON.stringify({ sql: "SELECT * FROM t WHERE region = {{region}} AND qty > ? AND tag LIKE '%?%'", params: '{{params}}' }), headers: {} }
      ref.inputs = [{ name: 'region', type: 'string', required: false, default_value: '' }, { name: 'params', type: 'string', required: false, default_value: '' }]
    } })
    expect(lastCall().sql).toBe("SELECT * FROM t WHERE region = ? AND qty > ? AND tag LIKE '%?%'")
    expect(lastCall().params).toEqual(['EU', 10])
  })
})

describe('result shapes', () => {
  it('smart (API callers) unchanged: write → affected_rows; single-row fetch → the row', async () => {
    state.queryRows = [{ id: 7, name: 'Ada' }]
    const get = await runConnectorTemplate({ connector: 'postgres', template: 'get_record', inputs: { table: 't', pk_column: 'id', pk_value: '7' } })
    expect(get.result.data).toEqual({ id: 7, name: 'Ada' })
    const del = await runConnectorTemplate({ connector: 'postgres', template: 'delete_record', inputs: { table: 't', where_clause: 'id = $1', params: '[7]' } })
    expect(del.result.data).toEqual({ affected_rows: 1, rows: [{ id: 7, name: 'Ada' }] })
    const proc = await runConnectorTemplate({ connector: 'mssql', template: 'stored_procedure', inputs: { procedure_name: 'dbo.p', params: '{}' } })
    expect(proc.result.data).toEqual({ rows: [{ ok: 1 }], output: {} })
  })

  it("'rows' (workflow engine) is always the row array", async () => {
    const { executeDatabaseReference } = await import('@/lib/db-reference')
    const def = getConnectorDefinition('postgres')!
    const integrationConfig = def.buildIntegrationConfig({ host: 'db.example.com', port: '5432', database: 'app', ssl: 'verify-full' }, { username: 'u', password: 'fake-password' })
    const tpl = def.referenceTemplates.find((t) => t.key === 'get_record')!
    state.queryRows = [{ id: 7 }]
    const res = await executeDatabaseReference({ integrationConfig, method: 'POST', pathTemplate: tpl.pathTemplate, bodyTemplate: tpl.bodyTemplate!, inputs: tpl.inputs, values: { table: 't', pk_column: 'id', pk_value: '7' }, resultShape: 'rows', timeout: 1000 })
    expect(res.data).toEqual([{ id: 7 }])
    const proc = getConnectorDefinition('mssql')!.referenceTemplates.find((t) => t.key === 'stored_procedure')!
    const mssqlConfig = getConnectorDefinition('mssql')!.buildIntegrationConfig({ host: 'sql.example.com', port: '1433', database: 'app' }, { username: 'u', password: 'p' })
    const resProc = await executeDatabaseReference({ integrationConfig: mssqlConfig, method: 'POST', pathTemplate: proc.pathTemplate, bodyTemplate: proc.bodyTemplate!, inputs: proc.inputs, values: { procedure_name: 'dbo.p', params: '' }, resultShape: 'rows' })
    expect(resProc.data).toEqual([{ ok: 1 }])
  })
})

describe('mongodb templating', () => {
  it('invalid JSON in a filter is an error (not {})', async () => {
    await expect(runConnectorTemplate({ connector: 'mongodb', template: 'delete_many', config: { connection_string: 'mongodb://db.example.com', database: 'shop' }, inputs: { collection: 'orders', filter: "{status: 'x'}" } })).rejects.toThrow(/"filter" must be valid JSON/)
    expect(calls).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// lib/db-connector (real module, drivers mocked)
// ─────────────────────────────────────────────────────────────────────────────

type DbConnector = typeof import('@/lib/db-connector')
const real = () => vi.importActual<DbConnector>('@/lib/db-connector')
const base = { host: 'db.example.com', port: 1433, database: 'app', username: 'u', password: 'fake-password' }

describe('db-connector: pools, binding, egress', () => {
  afterEach(async () => {
    const m = await real()
    await m.closeDbPools()
    delete process.env.ALLOW_PRIVATE_EGRESS
    mssqlState.inputs.length = 0
    mssqlState.queries.length = 0
    mssqlState.executed.length = 0
    mongoState.options.length = 0
    mongoState.uris.length = 0
    mongoState.ops.length = 0
    snowflakeState.options.length = 0
  })

  it('pool keys include the password (no reuse across credentials)', async () => {
    const { dbPoolKey } = await real()
    const a = dbPoolKey({ type: 'postgres', ...base })
    expect(dbPoolKey({ type: 'postgres', ...base })).toBe(a)
    expect(dbPoolKey({ type: 'postgres', ...base, password: 'other-fake' })).not.toBe(a)
    expect(dbPoolKey({ type: 'postgres', ...base, tlsMode: 'verify-full' })).not.toBe(a)
    expect(a).not.toContain('fake-password')
  })

  it('mssql binds array params as @p1.. and objects by name, with types', async () => {
    const { executeQuery } = await real()
    const r = await executeQuery({ type: 'mssql', ...base }, 'SELECT * FROM t WHERE a = @p1 AND b = @p2 AND c = @p3', ['x', 5, null])
    expect(r.rows).toEqual([{ id: 1 }])
    expect(mssqlState.inputs).toEqual([['p1', 'NVarChar(-1)', 'x'], ['p2', 'Int', 5], ['p3', 'NVarChar(-1)', null]])
    mssqlState.inputs.length = 0
    await executeQuery({ type: 'mssql', ...base }, 'SELECT @Region', { Region: 'EU', '@Top': 3.5 })
    expect(mssqlState.inputs).toEqual([['Region', 'NVarChar(-1)', 'EU'], ['Top', 'Float', 3.5]])
    await expect(executeQuery({ type: 'mssql', ...base }, 'SELECT 1', { 'a; DROP': 1 })).rejects.toThrow(/Invalid parameter name/)
  })

  it('procedure names are validated for every dialect', async () => {
    const { executeStoredProcedure } = await real()
    for (const type of ['mssql', 'mysql', 'oracle', 'snowflake', 'postgres'] as const) {
      await expect(executeStoredProcedure({ type, ...base }, 'p(1); DROP TABLE t', {})).rejects.toThrow(/Invalid procedure name/)
    }
    await executeStoredProcedure({ type: 'mssql', ...base }, '[dbo].[usp_X]', { Region: 'EU' })
    expect(mssqlState.executed).toEqual(['[dbo].[usp_X]'])
  })

  it('refuses private / loopback / metadata database hosts unless ALLOW_PRIVATE_EGRESS', async () => {
    const { executeQuery, testConnection } = await real()
    for (const host of ['10.0.0.5', '127.0.0.1', '169.254.169.254', 'db.internal']) {
      await expect(executeQuery({ type: 'mssql', ...base, host }, 'SELECT 1')).rejects.toThrow(/not allowed/)
    }
    const t = await testConnection({ type: 'postgres', ...base, host: '127.0.0.1', port: 5432 })
    expect(t.success).toBe(false)
    expect(t.message).toMatch(/not allowed/)
    process.env.ALLOW_PRIVATE_EGRESS = 'true'
    await expect(executeQuery({ type: 'mssql', ...base, host: '10.0.0.5' }, 'SELECT 1')).resolves.toMatchObject({ rows: [{ id: 1 }] })
    // Metadata stays blocked.
    await expect(executeQuery({ type: 'mssql', ...base, host: '169.254.169.254' }, 'SELECT 1')).rejects.toThrow(/not allowed/)
  })

  it('executeQuery refuses MongoDB configs (no fall-through to Postgres)', async () => {
    const { executeQuery } = await real()
    await expect(executeQuery({ type: 'mongodb', ...base, connectionString: 'mongodb://db.example.com' }, 'SELECT 1')).rejects.toThrow(/MongoDB references run operations/)
  })

  it('TLS settings: verify-full / require / legacy', async () => {
    const { parseDbConfig } = await real()
    const pg = getConnectorDefinition('postgres')!
    const fresh = parseDbConfig(pg.buildIntegrationConfig({ host: 'h.example.com', port: '5432', database: 'd', ssl: 'verify-full', ca_cert: '-----BEGIN CERTIFICATE-----FAKE' }, { username: 'u', password: 'p' }))!
    expect(fresh).toMatchObject({ tlsMode: 'verify-full', ssl: true, caCert: '-----BEGIN CERTIFICATE-----FAKE' })
    // A connector stored before the setting existed keeps "require" (no certificate check).
    const stored = parseDbConfig(pg.buildIntegrationConfig({ host: 'h.example.com', port: '5432', database: 'd' }, { username: 'u', password: 'p' }))!
    expect(stored).toMatchObject({ tlsMode: 'require', ssl: true })
    expect(parseDbConfig({ db_config: { db_type: 'postgres', host: 'h', database: 'd' } })).toMatchObject({ ssl: false, tlsMode: undefined })
  })

  it('snowflake: key-pair auth uses SNOWFLAKE_JWT; account cannot steer the host', async () => {
    const { testConnection, parseDbConfig } = await real()
    const def = getConnectorDefinition('snowflake')!
    const cfg = parseDbConfig(def.buildIntegrationConfig({ account: 'xy12345.us-east-1', warehouse: 'W', database: 'DB', schema: 'PUBLIC' }, { username: 'SVC', auth_method: 'key_pair', private_key: '-----BEGIN PRIVATE KEY-----FAKE', private_key_passphrase: 'fake-pass' }))!
    const res = await testConnection(cfg)
    expect(res.success).toBe(true)
    expect(snowflakeState.options[0]).toMatchObject({ account: 'xy12345.us-east-1', username: 'SVC', authenticator: 'SNOWFLAKE_JWT', privateKey: '-----BEGIN PRIVATE KEY-----FAKE', privateKeyPass: 'fake-pass' })
    expect(snowflakeState.options[0].password).toBeUndefined()
    // Stored password connectors keep password auth.
    const legacy = parseDbConfig({ base_url: 'snowflake://acct/DB/PUBLIC', auth_type: 'basic', auth_config: { username: 'u', password: 'fake-pw' }, headers: { _executor: 'database', db_type: 'snowflake', account: 'acct', database: 'DB' } })!
    await testConnection(legacy)
    expect(snowflakeState.options[1]).toMatchObject({ password: 'fake-pw' })
    const bad = await testConnection({ ...cfg, account: 'evil.example.com/x' })
    expect(bad).toMatchObject({ success: false, message: 'Invalid Snowflake account identifier' })
  })
})

describe('db-connector: MongoDB guards', () => {
  const mongo = { type: 'mongodb' as const, host: '', port: 0, database: 'shop', username: 'app', password: 'fake-password', connectionString: 'mongodb://h1.example.com:27017,h2.example.com:27017/?replicaSet=rs0' }
  afterEach(async () => {
    await (await real()).closeDbPools()
    mongoState.ops.length = 0
    mongoState.options.length = 0
    mongoState.uris.length = 0
  })

  it('connects multi-host URIs with credentials as an option and an egress-checked lookup', async () => {
    const { executeMongoOperation } = await real()
    await executeMongoOperation(mongo, { operation: 'countDocuments', collection: 'orders', filter: '{}' })
    expect(mongoState.uris[0]).toBe('mongodb://h1.example.com:27017,h2.example.com:27017/?replicaSet=rs0')
    expect(mongoState.options[0].auth).toEqual({ username: 'app', password: 'fake-password' })
    expect(typeof mongoState.options[0].lookup).toBe('function')
    const looked = await new Promise<any>((resolve) => mongoState.options[0].lookup('h1.example.com', { all: true }, (err: any, res: any) => resolve({ err, res })))
    expect(looked.res).toEqual([{ address: '93.184.216.34', family: 4 }])
    await expect(executeMongoOperation({ ...mongo, connectionString: 'mongodb://10.1.1.1:27017' }, { operation: 'listCollections' })).rejects.toThrow(/not allowed/)
  })

  it('refuses server-side JavaScript and write stages', async () => {
    const { executeMongoOperation } = await real()
    await expect(executeMongoOperation(mongo, { operation: 'find', collection: 'orders', filter: { $where: 'sleep(1000)' } })).rejects.toThrow(/\$where/)
    await expect(executeMongoOperation(mongo, { operation: 'find', collection: 'orders', filter: { a: { $nor: [{ $function: {} }] } } })).rejects.toThrow(/\$function/)
    await expect(executeMongoOperation(mongo, { operation: 'aggregate', collection: 'orders', pipeline: [{ $match: {} }, { $out: 'stolen' }] })).rejects.toThrow(/\$out/)
    await expect(executeMongoOperation(mongo, { operation: 'aggregate', collection: 'orders', pipeline: [{ $merge: { into: { db: 'admin', coll: 'x' } } }] })).rejects.toThrow(/\$merge/)
    await expect(executeMongoOperation(mongo, { operation: 'aggregate', collection: 'orders', pipeline: [{ $group: { _id: null, a: { $accumulator: {} } } }] })).rejects.toThrow(/\$accumulator/)
    await expect(executeMongoOperation(mongo, { operation: 'find', collection: 'system.users' })).rejects.toThrow(/Invalid collection/)
  })

  it('deleteMany / updateMany refuse an empty filter unless allow_all', async () => {
    const { executeMongoOperation } = await real()
    await expect(executeMongoOperation(mongo, { operation: 'deleteMany', collection: 'orders', filter: '{}' })).rejects.toThrow(/empty filter/)
    await expect(executeMongoOperation(mongo, { operation: 'updateMany', collection: 'orders', filter: {}, update: { $set: { a: 1 } }, allow_all: 'false' })).rejects.toThrow(/empty filter/)
    await expect(executeMongoOperation(mongo, { operation: 'deleteMany', collection: 'orders', filter: '{status: x}' })).rejects.toThrow(/valid JSON/)
    expect(mongoState.ops.filter((o) => o.op === 'deleteMany' || o.op === 'updateMany')).toHaveLength(0)
    await expect(executeMongoOperation(mongo, { operation: 'deleteMany', collection: 'orders', filter: {}, allow_all: 'true' })).resolves.toEqual({ deletedCount: 3 })
  })

  it('caps find / aggregate and sets maxTimeMS', async () => {
    const { executeMongoOperation } = await real()
    await executeMongoOperation(mongo, { operation: 'find', collection: 'orders', filter: {}, limit: 1_000_000, skip: -5 }, { maxRows: 200, timeoutMs: 4000 })
    const find = mongoState.ops.find((o) => o.op === 'find')
    expect(find).toMatchObject({ limit: 200, opts: { maxTimeMS: 4000 } })
    expect(find.skip).toBeUndefined()
    await executeMongoOperation(mongo, { operation: 'aggregate', collection: 'orders', pipeline: [{ $match: { a: 1 } }] }, { maxRows: 200 })
    expect(mongoState.ops.find((o) => o.op === 'aggregate').pipeline).toEqual([{ $match: { a: 1 } }, { $limit: 201 }])
  })

  it('credentials typed into the connection string move to auth_config (build + upgrade on read)', async () => {
    const def = getConnectorDefinition('mongodb')!
    const built = def.buildIntegrationConfig({ connection_string: 'mongodb+srv://app:s%40cret@cluster0.example.net/?retryWrites=true', database: 'shop' }, {})
    expect(built.base_url).toBe('mongodb+srv://cluster0.example.net/?retryWrites=true')
    expect(built.headers?.connection_string).toBe('mongodb+srv://cluster0.example.net/?retryWrites=true')
    expect(built.auth_config).toEqual({ username: 'app', password: 's@cret' })
    const stored = { base_url: 'mongodb://app:old-fake@db.example.com/shop', auth_type: 'basic', auth_config: { username: '', password: '' }, headers: { _executor: 'database', db_type: 'mongodb', connection_string: 'mongodb://app:old-fake@db.example.com/shop', database: 'shop' } }
    const upgraded = def.upgradeIntegrationConfig!(stored)
    expect(upgraded.base_url).toBe('mongodb://db.example.com/shop')
    expect(upgraded.headers.connection_string).toBe('mongodb://db.example.com/shop')
    expect(upgraded.auth_config).toEqual({ username: 'app', password: 'old-fake' })
    expect(def.upgradeIntegrationConfig!(upgraded)).toEqual(upgraded)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// SFTP (executor with an in-memory server)
// ─────────────────────────────────────────────────────────────────────────────

import type { SftpConnectOptions, SftpSession, SftpStat } from '@/lib/sftp-executor'

const FP = 'SHA256:FakeFingerprintForTests0000000000000000000000'

function memoryServer(files: Record<string, string | Buffer>, links: Record<string, string> = {}) {
  const fs = new Map<string, Buffer | 'dir'>()
  const addDirs = (p: string) => { const parts = p.split('/').filter(Boolean); let cur = ''; for (const part of parts.slice(0, -1)) { cur += `/${part}`; fs.set(cur, 'dir') } }
  fs.set('/', 'dir')
  for (const [p, c] of Object.entries(files)) {
    if (p.endsWith('/')) { addDirs(`${p}x`); fs.set(p.replace(/\/$/, ''), 'dir'); continue }
    addDirs(p)
    fs.set(p, Buffer.isBuffer(c) ? c : Buffer.from(c))
  }
  const err = (code: number, message: string) => Object.assign(new Error(message), { code })
  const stat = (p: string): SftpStat => {
    const v = fs.get(p)
    if (!v) throw err(2, 'No such file')
    return { size: v === 'dir' ? 4096 : v.length, mode: v === 'dir' ? 0o40755 : 0o100644, mtime: 1_700_000_000, atime: 1_700_000_000, isDirectory: v === 'dir', isFile: v !== 'dir', isSymbolicLink: false }
  }
  const log: { op: string; args: any[] }[] = []
  let connectOptions: SftpConnectOptions | null = null
  const session: SftpSession = {
    list: async (p) => { log.push({ op: 'list', args: [p] }); stat(p); return [...fs.keys()].filter((k) => k !== p && k.startsWith(p === '/' ? '/' : `${p}/`) && !k.slice(p.length + 1).includes('/')).map((k) => ({ name: k.split('/').pop()!, stat: stat(k) })) },
    stat: async (p) => stat(p),
    realpath: async (p) => { for (const [from, to] of Object.entries(links)) if (p === from || p.startsWith(`${from}/`)) return to + p.slice(from.length); stat(p); return p },
    read: async (p) => { log.push({ op: 'read', args: [p] }); const v = fs.get(p); if (!v || v === 'dir') throw err(2, 'No such file'); return v },
    write: async (p, data, flags) => {
      log.push({ op: 'write', args: [p, data.toString('utf8'), flags] })
      const existing = fs.get(p)
      if (flags === 'wx' && existing) throw err(4, 'Failure')
      fs.set(p, flags === 'a' && existing && existing !== 'dir' ? Buffer.concat([existing, data]) : data)
    },
    unlink: async (p) => { log.push({ op: 'unlink', args: [p] }); stat(p); fs.delete(p) },
    rename: async (a, b, overwrite) => { log.push({ op: 'rename', args: [a, b, overwrite] }); const v = fs.get(a); if (!v) throw err(2, 'No such file'); fs.delete(a); fs.set(b, v) },
    mkdir: async (p) => { log.push({ op: 'mkdir', args: [p] }); if (fs.has(p)) throw err(4, 'Failure'); fs.set(p, 'dir') },
    rmdir: async (p) => { log.push({ op: 'rmdir', args: [p] }); fs.delete(p) },
    chmod: async (p, mode) => { log.push({ op: 'chmod', args: [p, mode] }); stat(p) },
    close: () => { log.push({ op: 'close', args: [] }) },
  }
  const factory = async (options: SftpConnectOptions) => {
    connectOptions = options
    const { SftpError } = await import('@/lib/sftp-executor')
    // As connectSsh2 reports a host key the verifier refused.
    if (!options.fingerprint && !options.allowUnpinned) throw new SftpError(`SFTP host key not pinned: set Host Key Fingerprint to ${FP} after confirming it with the server administrator`, 495, 'host_key')
    if (options.fingerprint && options.fingerprint !== FP) throw new SftpError(`SFTP host key mismatch: server presented ${FP}, expected ${options.fingerprint}`, 495, 'host_key')
    return session
  }
  return { fs, log, factory, get connectOptions() { return connectOptions } }
}

const SFTP_CONFIG = { host: 'sftp.example.com', port: '22', default_path: '/home/app', host_key_fingerprint: FP, restrict_to_default_path: 'true' }
const SFTP_CREDS = { auth_method: 'password', username: 'app', password: 'fake-password' }

describe('sftp connector', () => {
  let server: ReturnType<typeof memoryServer>
  beforeEach(async () => {
    server = memoryServer({ '/home/app/in/a.csv': 'id,name\n1,Ada\n', '/home/app/in/b.bin': Buffer.from([0, 1, 2, 255]), '/home/app/out/': '', '/etc/passwd': 'root:x' }, { '/home/app/escape': '/etc' })
    const { __setSftpSessionFactory } = await import('@/lib/sftp-executor')
    __setSftpSessionFactory(server.factory)
  })
  afterEach(async () => {
    const { __setSftpSessionFactory } = await import('@/lib/sftp-executor')
    __setSftpSessionFactory(null)
  })
  const run = (template: string, inputs: Record<string, any>, config: Record<string, any> = {}) =>
    runConnectorTemplate({ connector: 'sftp', template, config: { ...SFTP_CONFIG, ...config }, credentials: SFTP_CREDS, inputs })

  const SFTP_CASES: Record<string, { inputs: Record<string, any>; data: (d: any) => void }> = {
    list_directory: { inputs: { path: 'in' }, data: (d) => expect(d).toMatchObject({ path: '/home/app/in', count: 2, files: [{ name: 'a.csv', path: '/home/app/in/a.csv', type: 'file', size: 14 }, { name: 'b.bin', type: 'file' }] }) },
    download_file: { inputs: { remote_path: '/home/app/in/a.csv' }, data: (d) => expect(d).toMatchObject({ filename: 'a.csv', path: '/home/app/in/a.csv', size: 14, encoding: 'utf8', content: 'id,name\n1,Ada\n' }) },
    upload_file: { inputs: { remote_path: 'out/new.txt', content: 'hello "world"\n' }, data: (d) => expect(d).toEqual({ path: '/home/app/out/new.txt', size: 14, mode: 'overwrite' }) },
    delete_file: { inputs: { remote_path: 'in/a.csv' }, data: (d) => expect(d).toEqual({ status: 'deleted', path: '/home/app/in/a.csv' }) },
    rename_move: { inputs: { from_path: 'in/a.csv', to_path: 'out/a.csv' }, data: (d) => expect(d).toEqual({ status: 'renamed', from_path: '/home/app/in/a.csv', to_path: '/home/app/out/a.csv' }) },
    create_directory: { inputs: { path: 'out/2026/10' }, data: (d) => expect(d).toEqual({ path: '/home/app/out/2026/10', created: true }) },
    remove_directory: { inputs: { path: 'out' }, data: (d) => expect(d).toEqual({ status: 'removed', path: '/home/app/out' }) },
    file_stat: { inputs: { path: 'in/a.csv' }, data: (d) => expect(d).toMatchObject({ path: '/home/app/in/a.csv', size: 14, permissions: '0644', isDirectory: false, isFile: true, modifyTime: '2023-11-14T22:13:20.000Z' }) },
    chmod: { inputs: { path: 'in/a.csv', mode: '600' }, data: (d) => expect(d).toEqual({ status: 'changed', path: '/home/app/in/a.csv', mode: '0600' }) },
    file_exists: { inputs: { path: 'in/missing.csv' }, data: (d) => expect(d).toEqual({ exists: false, type: null, path: '/home/app/in/missing.csv' }) },
  }

  it('every template has a contract case', () => {
    expect(Object.keys(SFTP_CASES).sort()).toEqual(getConnectorDefinition('sftp')!.referenceTemplates.map((t) => t.key).sort())
  })
  for (const [template, c] of Object.entries(SFTP_CASES)) {
    it(`sftp.${template}`, async () => {
      const { result, requests } = await run(template, c.inputs)
      expect(requests).toHaveLength(0) // never the HTTP path
      expect(result.status).toBe(200)
      c.data(result.data)
      expect(result.log?.url).toMatch(/^sftp:\/\/sftp\.example\.com\//)
      expect(server.connectOptions).toMatchObject({ host: 'sftp.example.com', address: '93.184.216.34', port: 22, username: 'app', password: 'fake-password', fingerprint: FP })
      expect(server.log[server.log.length - 1].op).toBe('close')
    })
  }

  it('chmod applies the octal mode; upload modes and encodings', async () => {
    await run('chmod', { path: 'in/a.csv', mode: '0755' })
    expect(server.log.find((l) => l.op === 'chmod')?.args).toEqual(['/home/app/in/a.csv', 0o755])
    expect((await run('chmod', { path: 'in/a.csv', mode: 'rwx' })).result).toMatchObject({ status: 400, data: { code: 'bad_mode' } })
    await run('upload_file', { remote_path: 'out/b64.bin', content: Buffer.from('bin!').toString('base64'), encoding: 'base64' })
    expect(server.fs.get('/home/app/out/b64.bin')?.toString()).toBe('bin!')
    await run('upload_file', { remote_path: 'out/b64.bin', content: 'data:text/plain;base64,' + Buffer.from('+more').toString('base64'), mode: 'append' })
    expect(server.fs.get('/home/app/out/b64.bin')?.toString()).toBe('bin!+more')
    const again = await run('upload_file', { remote_path: 'out/b64.bin', content: 'x', mode: 'create' })
    expect(again.result.status).toBe(500)
  })

  it('downloads binary files as base64', async () => {
    const { result } = await run('download_file', { remote_path: 'in/b.bin' })
    expect(result.data).toMatchObject({ filename: 'b.bin', encoding: 'base64', content: Buffer.from([0, 1, 2, 255]).toString('base64'), size: 4 })
  })

  it('keeps paths inside the default path (.. and symlinks)', async () => {
    for (const [template, inputs] of [
      ['download_file', { remote_path: '/etc/passwd' }],
      ['download_file', { remote_path: '../../etc/passwd' }],
      ['download_file', { remote_path: 'escape/passwd' }],
      ['list_directory', { path: '/' }],
      ['rename_move', { from_path: 'in/a.csv', to_path: '/tmp/a.csv' }],
      ['upload_file', { remote_path: '../x.txt', content: 'x' }],
      ['create_directory', { path: '/home/other' }],
    ] as const) {
      const { result } = await run(template, inputs)
      expect(result.status, `${template} ${JSON.stringify(inputs)}`).toBe(403)
      expect(result.data.code).toBe('outside_root')
    }
    expect(server.log.filter((l) => l.op === 'read' || l.op === 'write' || l.op === 'rename')).toHaveLength(0)
    // Unrestricted connectors can reach the whole server.
    const open = await run('download_file', { remote_path: '/etc/passwd' }, { restrict_to_default_path: 'false' })
    expect(open.result.data.content).toBe('root:x')
  })

  it('requires a pinned host key (the error reports the server fingerprint)', async () => {
    await expect(run('file_stat', { path: 'in' }, { host_key_fingerprint: '' })).rejects.toThrow(/Host Key Fingerprint to SHA256:/)
    await expect(run('file_stat', { path: 'in' }, { host_key_fingerprint: 'SHA256:other' })).rejects.toThrow(/host key mismatch/)
  })

  it('refuses private hosts and caps transfers', async () => {
    await expect(run('file_stat', { path: 'in' }, { host: '192.168.1.10' })).rejects.toThrow(/not allowed/)
    process.env.SFTP_MAX_BYTES = '10'
    try {
      expect((await run('download_file', { remote_path: 'in/a.csv' })).result).toMatchObject({ status: 413, data: { code: 'too_large' } })
      expect((await run('upload_file', { remote_path: 'out/big.txt', content: 'x'.repeat(11) })).result).toMatchObject({ status: 413 })
    } finally {
      delete process.env.SFTP_MAX_BYTES
    }
  })

  it('private-key auth sends the key and passphrase (legacy: passphrase in password)', async () => {
    await runConnectorTemplate({ connector: 'sftp', template: 'file_stat', config: SFTP_CONFIG, credentials: { auth_method: 'private_key', username: 'app', private_key: '-----BEGIN OPENSSH PRIVATE KEY-----FAKE', private_key_passphrase: 'fake-phrase' }, inputs: { path: 'in' } })
    expect(server.connectOptions).toMatchObject({ privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----FAKE', passphrase: 'fake-phrase', password: undefined })
    await runConnectorTemplate({ connector: 'sftp', template: 'file_stat', config: SFTP_CONFIG, credentials: { auth_method: 'private_key', username: 'app', private_key: '-----BEGIN OPENSSH PRIVATE KEY-----FAKE', private_key_passphrase: '', password: 'legacy-phrase' }, inputs: { path: 'in' } })
    expect(server.connectOptions).toMatchObject({ passphrase: 'legacy-phrase' })
  })

  it('host key fingerprints match ssh-keygen format', async () => {
    const { hostKeyFingerprint, normalizeFingerprint } = await import('@/lib/sftp-executor')
    expect(hostKeyFingerprint(Buffer.from('fake-key-blob'))).toMatch(/^SHA256:[A-Za-z0-9+/]{43}$/)
    expect(normalizeFingerprint(' SHA256:abc= ')).toBe('SHA256:abc')
    expect(normalizeFingerprint('abc')).toBe('SHA256:abc')
  })
})
