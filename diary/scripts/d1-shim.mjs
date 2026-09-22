// 로컬 개발·검증 전용: Node 내장 SQLite 를 Cloudflare D1 API 모양(prepare/bind/first/all/run/batch)으로 감싼다.
// 실제 배포에서는 쓰이지 않는다(Worker 는 env.DB 바인딩만 사용).
import { DatabaseSync } from 'node:sqlite';

const isRead = (sql) => /^\s*(select|with|pragma)/i.test(sql);

class Stmt {
  constructor(db, sql) { this.db = db; this.sql = sql; this.params = []; }
  bind(...p) { this.params = p; return this; }
  _st() { return this.db.prepare(this.sql); }
  async first() { const r = this._st().get(...this.params); return r ? { ...r } : null; }
  async all() { return { results: this._st().all(...this.params).map((r) => ({ ...r })), success: true, meta: {} }; }
  async run() {
    const r = this._st().run(...this.params);
    return { results: [], success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
  }
  async _exec() { return isRead(this.sql) ? this.all() : this.run(); }
}

export function createD1(file = ':memory:', schemaSql = '') {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (schemaSql) db.exec(schemaSql);
  return {
    raw: db,
    prepare: (sql) => new Stmt(db, sql),
    async batch(stmts) {
      db.exec('BEGIN');
      try {
        const out = [];
        for (const s of stmts) out.push(await s._exec());
        db.exec('COMMIT');
        return out;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    }
  };
}
