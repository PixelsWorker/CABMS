/**
 * Cloudflare D1 Database Types and Local Node.js SQLite Adapter
 * Provides 100% API compatibility with Cloudflare Workers D1 Database interface.
 */

import { DatabaseSync } from 'node:sqlite';

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  dump(): Promise<ArrayBuffer>;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
  exec(query: string): Promise<D1ExecResult>;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(colName?: string): Promise<T | null>;
  run<T = unknown>(): Promise<D1Result<T>>;
  all<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
  readonly query: string;
  readonly params: unknown[];
}

export interface D1Result<T = unknown> {
  results: T[];
  success: boolean;
  meta: {
    duration: number;
    size_after: number;
    rows_read: number;
    rows_written: number;
    last_row_id: number;
    changed_db: boolean;
    changes: number;
  };
  error?: string;
}

export interface D1ExecResult {
  count: number;
  duration: number;
}

class LocalD1PreparedStatement implements D1PreparedStatement {
  public readonly params: any[] = [];

  constructor(
    private readonly db: DatabaseSync,
    public readonly query: string,
    params: any[] = []
  ) {
    this.params = params;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new LocalD1PreparedStatement(this.db, this.query, values);
  }

  async first<T = unknown>(colName?: string): Promise<T | null> {
    const stmt = this.db.prepare(this.query);
    const row = stmt.get(...(this.params as any)) as Record<string, unknown> | undefined;
    if (!row) return null;
    if (colName) {
      return (row[colName] as T) ?? null;
    }
    return row as T;
  }

  async run<T = unknown>(): Promise<D1Result<T>> {
    const start = performance.now();
    const stmt = this.db.prepare(this.query);
    const res = stmt.run(...(this.params as any));
    const duration = performance.now() - start;

    return {
      results: [] as T[],
      success: true,
      meta: {
        duration,
        size_after: 0,
        rows_read: 0,
        rows_written: Number(res.changes),
        last_row_id: Number(res.lastInsertRowid),
        changed_db: Number(res.changes) > 0,
        changes: Number(res.changes),
      },
    };
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const start = performance.now();
    const stmt = this.db.prepare(this.query);
    const rows = stmt.all(...(this.params as any)) as T[];
    const duration = performance.now() - start;

    return {
      results: rows,
      success: true,
      meta: {
        duration,
        size_after: 0,
        rows_read: rows.length,
        rows_written: 0,
        last_row_id: 0,
        changed_db: false,
        changes: 0,
      },
    };
  }

  async raw<T = unknown>(): Promise<T[]> {
    const res = await this.all<T>();
    return res.results;
  }
}

export class LocalD1Database implements D1Database {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(query: string): D1PreparedStatement {
    return new LocalD1PreparedStatement(this.sqlite, query);
  }

  async dump(): Promise<ArrayBuffer> {
    throw new Error('dump() not supported in local D1 mock');
  }

  /**
   * Cloudflare D1 batch semantics:
   * Executes statements inside a single SQLite transaction.
   * If any statement throws, the entire transaction is rolled back and re-thrown.
   */
  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.sqlite.exec('BEGIN TRANSACTION;');
    try {
      const results: D1Result<T>[] = [];
      for (const stmt of statements) {
        const localStmt = stmt as LocalD1PreparedStatement;
        const prepared = this.sqlite.prepare(localStmt.query);
        const isSelect = /^\s*SELECT\b/i.test(localStmt.query);

        if (isSelect) {
          const rows = prepared.all(...(localStmt.params as any)) as T[];
          results.push({
            results: rows,
            success: true,
            meta: {
              duration: 0,
              size_after: 0,
              rows_read: rows.length,
              rows_written: 0,
              last_row_id: 0,
              changed_db: false,
              changes: 0,
            },
          });
        } else {
          const runRes = prepared.run(...(localStmt.params as any));
          results.push({
            results: [] as T[],
            success: true,
            meta: {
              duration: 0,
              size_after: 0,
              rows_read: 0,
              rows_written: Number(runRes.changes),
              last_row_id: Number(runRes.lastInsertRowid),
              changed_db: Number(runRes.changes) > 0,
              changes: Number(runRes.changes),
            },
          });
        }
      }
      this.sqlite.exec('COMMIT;');
      return results;
    } catch (err) {
      try {
        this.sqlite.exec('ROLLBACK;');
      } catch {
        // Rollback can fail if transaction was already terminated
      }
      throw err;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    const start = performance.now();
    this.sqlite.exec(query);
    const duration = performance.now() - start;
    return {
      count: 1,
      duration,
    };
  }

  getSqliteHandle(): DatabaseSync {
    return this.sqlite;
  }
}

/**
 * Creates an in-memory or file-backed local D1Database instance.
 */
export function createLocalD1Database(location: string = ':memory:'): D1Database {
  const sqlite = new DatabaseSync(location);
  // Enable foreign keys
  sqlite.exec('PRAGMA foreign_keys = ON;');
  return new LocalD1Database(sqlite);
}
