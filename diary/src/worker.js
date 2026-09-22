// 플랜두씨 다이어리 1 — API (Cloudflare Workers + D1). 비밀값 없음: D1 은 바인딩(env.DB)으로만 연결된다.
const TZ = 'Asia/Seoul';
const SCHEMA_VERSION = 2;
const LIMITS = { plans: 200, todos: 2000, runs: 5000 };
const MAX_BODY = 20000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SORTS = {
  due: { label: '마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 ID 순', sql: '(v.due_date IS NULL), v.due_date, v.priority, v.id' },
  priority: { label: '우선순위 높은 순 → 같으면 마감일 빠른 순 → 같으면 ID 순', sql: 'v.priority, (v.due_date IS NULL), v.due_date, v.id' },
  created: { label: '등록 순(ID 순)', sql: 'v.id' },
  est: { label: '예상 시간 긴 순 → 같으면 ID 순', sql: 'v.est_minutes DESC, v.id' },
  title: { label: '제목 가나다 순 → 같으면 ID 순', sql: 'v.title, v.id' }
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }
  });

const todayKST = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const nowISO = () => new Date().toISOString();

function reqStr(v, name, min, max) {
  if (typeof v !== 'string') throw bad(`${name}은(는) 글자로 입력해야 합니다.`);
  const s = v.trim();
  if (s.length < min || s.length > max) throw bad(`${name}은(는) ${min}~${max}자여야 합니다.`);
  return s;
}
function optStr(v, name, max) {
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
  return reqStr(v, name, 1, max);
}
function reqInt(v, name, min, max) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (!Number.isInteger(n) || n < min || n > max) throw bad(`${name}은(는) ${min}~${max} 사이의 정수여야 합니다.`);
  return n;
}
function isRealDate(s) {
  return typeof s === 'string' && DATE_RE.test(s) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
}
function reqDate(v, name) {
  if (!isRealDate(v)) throw bad(`${name}은(는) 실제 있는 날짜(YYYY-MM-DD)여야 합니다.`);
  return v;
}
function optDate(v, name) {
  if (v === undefined || v === null || v === '') return null;
  return reqDate(v, name);
}
function reqTime(v, name) {
  const d = typeof v === 'string' ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) throw bad(`${name}은(는) 올바른 시각이어야 합니다.`);
  return d.toISOString();
}
function parseTags(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw bad('태그는 목록이어야 합니다.');
  const out = [];
  for (const raw of v) {
    const t = reqStr(raw, '태그', 1, 30);
    if (t.includes(',')) throw bad('태그에는 쉼표를 넣을 수 없습니다.');
    if (!out.includes(t)) out.push(t);
  }
  if (out.length > 8) throw bad('태그는 8개까지 넣을 수 있습니다.');
  return out;
}
function likeEscape(s) {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}
function idParam(s) {
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) throw bad('ID가 올바르지 않습니다.');
  return n;
}
async function readBody(req) {
  const len = Number(req.headers.get('content-length') || 0);
  if (len > MAX_BODY) throw new HttpError(413, '요청이 너무 큽니다.');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new HttpError(413, '요청이 너무 큽니다.');
  try {
    const data = JSON.parse(text || '{}');
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw bad('JSON 형식이 올바르지 않습니다.');
  }
}
async function count(db, table) {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first();
  return r.n;
}
function todoRow(r) {
  return { ...r, tags: r.tags ? r.tags.split(',') : [] };
}

function planFields(b) {
  const f = {
    title: reqStr(b.title, '계획 제목', 1, 200),
    period_start: reqDate(b.period_start, '시작일'),
    period_end: reqDate(b.period_end, '종료일'),
    priority: reqInt(b.priority, '우선순위', 1, 3),
    success_criteria: reqStr(b.success_criteria, '성공 기준', 1, 1000),
    est_minutes: reqInt(b.est_minutes, '예상 시간(분)', 0, 100000)
  };
  if (f.period_end < f.period_start) throw bad('종료일은 시작일보다 빠를 수 없습니다.');
  return f;
}

// ---------- 계획 ----------
async function listPlans(db) {
  const { results } = await db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM plan_revisions r WHERE r.plan_id = p.id) AS revision_count,
        (SELECT COUNT(*) FROM todos t WHERE t.plan_id = p.id) AS todo_count
       FROM plans p ORDER BY p.id DESC`
    )
    .all();
  return { rows: results };
}
async function getPlan(db, id) {
  const plan = await db.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
  if (!plan) throw new HttpError(404, '계획을 찾을 수 없습니다.');
  const revisions = (await db.prepare('SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_no').bind(id).all()).results;
  const carriedTo = (await db.prepare('SELECT id, title FROM plans WHERE carried_from_plan_id = ? ORDER BY id').bind(id).all()).results;
  const carriedFrom = plan.carried_from_plan_id
    ? await db.prepare('SELECT id, title FROM plans WHERE id = ?').bind(plan.carried_from_plan_id).first()
    : null;
  return { plan, revisions, carried_to: carriedTo, carried_from: carriedFrom };
}
async function createPlan(db, b) {
  const f = planFields(b);
  let fromId = null;
  let note = null;
  if (b.carried_from_plan_id !== undefined && b.carried_from_plan_id !== null && b.carried_from_plan_id !== '') {
    fromId = reqInt(b.carried_from_plan_id, '이전 계획 ID', 1, 1e9);
    note = reqStr(b.carried_note, '넘길 고칠 점', 1, 300);
    if (!(await db.prepare('SELECT 1 AS x FROM plans WHERE id = ?').bind(fromId).first())) throw bad('이전 계획을 찾을 수 없습니다.');
  }
  if ((await count(db, 'plans')) >= LIMITS.plans) throw bad(`계획은 ${LIMITS.plans}개까지 만들 수 있습니다.`);
  const now = nowISO();
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO plans (title, period_start, period_end, priority, success_criteria, est_minutes, carried_from_plan_id, carried_note, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.est_minutes, fromId, note, now, now),
    db
      .prepare(
        `INSERT INTO plan_revisions (plan_id, revision_no, title, period_start, period_end, priority, success_criteria, est_minutes, recorded_at)
         VALUES (last_insert_rowid(), 1, ?,?,?,?,?,?,?)`
      )
      .bind(f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.est_minutes, now)
  ]);
  return getPlan(db, res[0].meta.last_row_id);
}
async function updatePlan(db, id, b) {
  const cur = await db.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first();
  if (!cur) throw new HttpError(404, '계획을 찾을 수 없습니다.');
  const f = planFields(b);
  const same = Object.keys(f).every((k) => cur[k] === f[k]);
  if (!same) {
    const now = nowISO();
    await db.batch([
      db
        .prepare('UPDATE plans SET title=?, period_start=?, period_end=?, priority=?, success_criteria=?, est_minutes=?, updated_at=? WHERE id=?')
        .bind(f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.est_minutes, now, id),
      db
        .prepare(
          `INSERT INTO plan_revisions (plan_id, revision_no, title, period_start, period_end, priority, success_criteria, est_minutes, recorded_at)
           SELECT ?, COALESCE(MAX(revision_no), 0) + 1, ?,?,?,?,?,?,? FROM plan_revisions WHERE plan_id = ?`
        )
        .bind(id, f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.est_minutes, now, id)
    ]);
  }
  return getPlan(db, id);
}

// ---------- 할 일 ----------
async function listTodos(db, url) {
  const q = url.searchParams;
  const where = [];
  const params = [];
  if (q.get('plan_id')) { where.push('v.plan_id = ?'); params.push(idParam(q.get('plan_id'))); }
  if (q.get('status')) {
    const s = q.get('status');
    if (!['todo', 'doing', 'done'].includes(s)) throw bad('상태 값이 올바르지 않습니다.');
    where.push('v.status = ?'); params.push(s);
  }
  if (q.get('priority')) { where.push('v.priority = ?'); params.push(reqInt(q.get('priority'), '우선순위', 1, 3)); }
  if (q.get('tag')) {
    where.push('EXISTS (SELECT 1 FROM todo_tags g WHERE g.todo_id = v.id AND g.tag = ?)');
    params.push(reqStr(q.get('tag'), '태그', 1, 30));
  }
  if (q.get('q')) {
    const like = '%' + likeEscape(reqStr(q.get('q'), '검색어', 1, 100)) + '%';
    where.push("(v.title LIKE ? ESCAPE '\\' OR EXISTS (SELECT 1 FROM todo_tags g WHERE g.todo_id = v.id AND g.tag LIKE ? ESCAPE '\\'))");
    params.push(like, like);
  }
  const sortKey = q.get('sort') || 'due';
  if (!SORTS[sortKey]) throw bad('정렬 기준이 올바르지 않습니다.');
  const sql = `SELECT v.* FROM todo_view v ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${SORTS[sortKey].sql}`;
  const { results } = await db.prepare(sql).bind(...params).all();
  return { rows: results.map(todoRow), sort: { key: sortKey, label: SORTS[sortKey].label }, processed_on: 'server' };
}
async function getTodo(db, id) {
  const r = await db.prepare('SELECT * FROM todo_view WHERE id = ?').bind(id).first();
  if (!r) throw new HttpError(404, '할 일을 찾을 수 없습니다.');
  return todoRow(r);
}
function todoFields(b) {
  return {
    title: reqStr(b.title, '할 일 제목', 1, 200),
    due_date: optDate(b.due_date, '마감일'),
    priority: b.priority === undefined ? 2 : reqInt(b.priority, '우선순위', 1, 3),
    est_minutes: b.est_minutes === undefined || b.est_minutes === '' ? 0 : reqInt(b.est_minutes, '예상 시간(분)', 0, 100000),
    tags: parseTags(b.tags)
  };
}
async function createTodo(db, b) {
  const f = todoFields(b);
  const planId = reqInt(b.plan_id, '계획 ID', 1, 1e9);
  if (!(await db.prepare('SELECT 1 AS x FROM plans WHERE id = ?').bind(planId).first())) throw bad('계획을 찾을 수 없습니다.');
  if ((await count(db, 'todos')) >= LIMITS.todos) throw bad(`할 일은 ${LIMITS.todos}개까지 만들 수 있습니다.`);
  const now = nowISO();
  const res = await db
    .prepare('INSERT INTO todos (plan_id, title, status, due_date, priority, est_minutes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)')
    .bind(planId, f.title, 'todo', f.due_date, f.priority, f.est_minutes, now, now)
    .run();
  const id = res.meta.last_row_id;
  if (f.tags.length) {
    try {
      await db.batch(f.tags.map((t) => db.prepare('INSERT INTO todo_tags (todo_id, tag) VALUES (?,?)').bind(id, t)));
    } catch (e) {
      await db.prepare('DELETE FROM todos WHERE id = ?').bind(id).run();
      throw e;
    }
  }
  return getTodo(db, id);
}
async function updateTodo(db, id, b) {
  await getTodo(db, id);
  const f = todoFields(b);
  const status = b.status === undefined ? null : b.status;
  if (status !== null && !['todo', 'doing'].includes(status)) throw bad('완료는 완료 버튼으로만 바꿀 수 있습니다.');
  const stmts = [
    db
      .prepare('UPDATE todos SET title=?, due_date=?, priority=?, est_minutes=?, status=COALESCE(?, status), updated_at=? WHERE id=?')
      .bind(f.title, f.due_date, f.priority, f.est_minutes, status, nowISO(), id),
    db.prepare('DELETE FROM todo_tags WHERE todo_id = ?').bind(id),
    ...f.tags.map((t) => db.prepare('INSERT INTO todo_tags (todo_id, tag) VALUES (?,?)').bind(id, t))
  ];
  await db.batch(stmts);
  return getTodo(db, id);
}
async function deleteTodo(db, id) {
  await getTodo(db, id);
  await db.prepare('DELETE FROM todos WHERE id = ?').bind(id).run();
  return { deleted: id };
}
async function completeTodo(db, id) {
  await getTodo(db, id);
  const res = await db.prepare('INSERT OR IGNORE INTO completions (todo_id, completed_at) VALUES (?, ?)').bind(id, nowISO()).run();
  return { todo: await getTodo(db, id), newly_completed: res.meta.changes === 1 };
}
async function reopenTodo(db, id) {
  await getTodo(db, id);
  await db.batch([
    db.prepare('DELETE FROM completions WHERE todo_id = ?').bind(id),
    db.prepare("UPDATE todos SET status = 'doing', updated_at = ? WHERE id = ?").bind(nowISO(), id)
  ]);
  return { todo: await getTodo(db, id) };
}

// ---------- 실행 기록 ----------
async function listRuns(db, url) {
  const todoId = url.searchParams.get('todo_id');
  const sql = `SELECT r.*, t.title AS todo_title, t.plan_id AS plan_id FROM runs r JOIN todos t ON t.id = r.todo_id
    ${todoId ? 'WHERE r.todo_id = ?' : ''} ORDER BY r.started_at DESC, r.id DESC`;
  const stmt = db.prepare(sql);
  const { results } = await (todoId ? stmt.bind(idParam(todoId)) : stmt).all();
  return { rows: results };
}
async function createRun(db, b) {
  const todoId = reqInt(b.todo_id, '할 일 ID', 1, 1e9);
  await getTodo(db, todoId);
  const started = reqTime(b.started_at, '시작 시각');
  const ended = reqTime(b.ended_at, '끝난 시각');
  if (ended < started) throw bad('끝난 시각은 시작 시각보다 빠를 수 없습니다.');
  const minutes = Math.round((new Date(ended) - new Date(started)) / 60000);
  const blocked = optStr(b.blocked_reason, '막힌 이유', 500);
  if ((await count(db, 'runs')) >= LIMITS.runs) throw bad(`실행 기록은 ${LIMITS.runs}건까지 남길 수 있습니다.`);
  const res = await db
    .prepare('INSERT INTO runs (todo_id, started_at, ended_at, actual_minutes, blocked_reason, created_at) VALUES (?,?,?,?,?,?)')
    .bind(todoId, started, ended, minutes, blocked, nowISO())
    .run();
  const row = await db
    .prepare('SELECT r.*, t.title AS todo_title, t.plan_id AS plan_id FROM runs r JOIN todos t ON t.id = r.todo_id WHERE r.id = ?')
    .bind(res.meta.last_row_id)
    .first();
  return row;
}
async function deleteRun(db, id) {
  const r = await db.prepare('DELETE FROM runs WHERE id = ?').bind(id).run();
  if (r.meta.changes === 0) throw new HttpError(404, '실행 기록을 찾을 수 없습니다.');
  return { deleted: id };
}

// ---------- 돌아보기 ----------
const REVIEW_DEFS = {
  planned: '계획된 할 일 수 = 선택한 계획에 딸린, 지우지 않은 할 일의 개수',
  done: '완료 수 = 그중 지금 완료 상태인 할 일의 개수',
  delayed: '지연 수 = 완료되지 않았고 마감일이 서울 시간 기준 오늘보다 앞선 할 일의 개수 (완료한 할 일은 지연으로 세지 않음)',
  blocked: '막힘 수 = 막힌 이유가 하나라도 적힌 실행 기록이 있는 할 일의 개수',
  est: '예상 시간 = 대상 할 일의 예상 시간(분) 합계',
  actual: '실제 시간 = 대상 할 일에 붙은 실행 기록의 걸린 시간(분) 합계',
  diff: '차이 = 실제 시간 − 예상 시간 (둘 다 없으면 0)'
};
function planScope(planId) {
  return planId ? { sql: 'v.plan_id = ?', params: [planId] } : { sql: '1=1', params: [] };
}
async function review(db, url) {
  const planId = url.searchParams.get('plan_id') ? idParam(url.searchParams.get('plan_id')) : null;
  const today = todayKST();
  const sc = planScope(planId);
  const main = await db
    .prepare(
      `SELECT COUNT(*) AS planned,
        COALESCE(SUM(v.status = 'done'), 0) AS done,
        COALESCE(SUM(v.status != 'done' AND v.due_date IS NOT NULL AND v.due_date < ?), 0) AS delayed,
        COALESCE(SUM(v.est_minutes), 0) AS est_minutes,
        COALESCE(SUM(v.actual_minutes), 0) AS actual_minutes
       FROM todo_view v WHERE ${sc.sql}`
    )
    .bind(today, ...sc.params)
    .first();
  const blocked = await db
    .prepare(
      `SELECT COUNT(DISTINCT r.todo_id) AS n FROM runs r JOIN todo_view v ON v.id = r.todo_id
       WHERE r.blocked_reason IS NOT NULL AND ${sc.sql}`
    )
    .bind(...sc.params)
    .first();
  const plans = planId
    ? 1
    : (await db.prepare('SELECT COUNT(*) AS n FROM plans').first()).n;
  let planInfo = null;
  let carried = [];
  if (planId) {
    planInfo = await db.prepare('SELECT id, title, period_start, period_end FROM plans WHERE id = ?').bind(planId).first();
    if (!planInfo) throw new HttpError(404, '계획을 찾을 수 없습니다.');
    carried = (await db.prepare('SELECT id, title, carried_note FROM plans WHERE carried_from_plan_id = ? ORDER BY id').bind(planId).all()).results;
  }
  return {
    scope: planId ? 'plan' : 'all',
    plan: planInfo,
    today_kst: today,
    plan_count: plans,
    planned: main.planned,
    done: main.done,
    delayed: main.delayed,
    blocked: blocked.n,
    est_minutes: main.est_minutes,
    actual_minutes: main.actual_minutes,
    diff_minutes: main.actual_minutes - main.est_minutes,
    carried_to: carried,
    definitions: REVIEW_DEFS
  };
}
async function reviewRecords(db, url) {
  const planId = url.searchParams.get('plan_id') ? idParam(url.searchParams.get('plan_id')) : null;
  const metric = url.searchParams.get('metric');
  const sc = planScope(planId);
  const today = todayKST();
  const todoKinds = {
    planned: { where: sc.sql, params: sc.params },
    est: { where: sc.sql, params: sc.params },
    done: { where: `${sc.sql} AND v.status = 'done'`, params: sc.params },
    delayed: { where: `${sc.sql} AND v.status != 'done' AND v.due_date IS NOT NULL AND v.due_date < ?`, params: [...sc.params, today] }
  };
  if (todoKinds[metric]) {
    const k = todoKinds[metric];
    const { results } = await db.prepare(`SELECT v.* FROM todo_view v WHERE ${k.where} ORDER BY v.id`).bind(...k.params).all();
    return { metric, kind: 'todos', definition: REVIEW_DEFS[metric], rows: results.map(todoRow) };
  }
  if (metric === 'actual' || metric === 'blocked') {
    const extra = metric === 'blocked' ? 'AND r.blocked_reason IS NOT NULL' : '';
    const { results } = await db
      .prepare(
        `SELECT r.*, v.title AS todo_title, v.plan_id AS plan_id FROM runs r JOIN todo_view v ON v.id = r.todo_id
         WHERE ${sc.sql} ${extra} ORDER BY r.started_at, r.id`
      )
      .bind(...sc.params)
      .all();
    return { metric, kind: 'runs', definition: REVIEW_DEFS[metric], rows: results };
  }
  throw bad('집계 항목이 올바르지 않습니다.');
}

async function exportAll(db) {
  const t = async (name) => (await db.prepare(`SELECT * FROM ${name} ORDER BY 1, 2`).all()).results;
  return {
    schema_version: SCHEMA_VERSION,
    exported_at: nowISO(),
    plans: (await db.prepare('SELECT * FROM plans ORDER BY id').all()).results,
    plan_revisions: (await db.prepare('SELECT * FROM plan_revisions ORDER BY plan_id, revision_no').all()).results,
    todos: (await db.prepare('SELECT * FROM todos ORDER BY id').all()).results,
    todo_tags: await t('todo_tags'),
    runs: (await db.prepare('SELECT * FROM runs ORDER BY id').all()).results,
    completions: (await db.prepare('SELECT * FROM completions ORDER BY id').all()).results
  };
}

// ---------- 라우터 ----------
async function route(req, env) {
  const db = env.DB;
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  let x;

  if (path === '/api/meta' && m === 'GET') {
    return { today_kst: todayKST(), timezone: TZ, schema_version: SCHEMA_VERSION, sorts: Object.fromEntries(Object.entries(SORTS).map(([k, v]) => [k, v.label])),
      counts: { plans: await count(db, 'plans'), todos: await count(db, 'todos'), runs: await count(db, 'runs'), completions: await count(db, 'completions') } };
  }
  if (path === '/api/plans') {
    if (m === 'GET') return listPlans(db);
    if (m === 'POST') return createPlan(db, await readBody(req));
  }
  if ((x = path.match(/^\/api\/plans\/(\d+)$/))) {
    if (m === 'GET') return getPlan(db, idParam(x[1]));
    if (m === 'PUT') return updatePlan(db, idParam(x[1]), await readBody(req));
  }
  if (path === '/api/todos') {
    if (m === 'GET') return listTodos(db, url);
    if (m === 'POST') return createTodo(db, await readBody(req));
  }
  if ((x = path.match(/^\/api\/todos\/(\d+)$/))) {
    if (m === 'PUT') return updateTodo(db, idParam(x[1]), await readBody(req));
    if (m === 'DELETE') return deleteTodo(db, idParam(x[1]));
  }
  if ((x = path.match(/^\/api\/todos\/(\d+)\/(complete|reopen)$/)) && m === 'POST') {
    return x[2] === 'complete' ? completeTodo(db, idParam(x[1])) : reopenTodo(db, idParam(x[1]));
  }
  if (path === '/api/tags' && m === 'GET') {
    return { rows: (await db.prepare('SELECT tag, COUNT(*) AS n FROM todo_tags GROUP BY tag ORDER BY tag').all()).results };
  }
  if (path === '/api/runs') {
    if (m === 'GET') return listRuns(db, url);
    if (m === 'POST') return createRun(db, await readBody(req));
  }
  if ((x = path.match(/^\/api\/runs\/(\d+)$/)) && m === 'DELETE') return deleteRun(db, idParam(x[1]));
  if (path === '/api/review' && m === 'GET') return review(db, url);
  if (path === '/api/review/records' && m === 'GET') return reviewRecords(db, url);
  if (path === '/api/export' && m === 'GET') return { __download: 'pds-diary-export.json', body: await exportAll(db) };

  throw new HttpError(404, '찾을 수 없는 주소입니다.');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    try {
      const out = await route(req, env);
      if (out && out.__download) {
        return new Response(JSON.stringify(out.body, null, 2), {
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="${out.__download}"`,
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff'
          }
        });
      }
      return json(out);
    } catch (e) {
      if (e instanceof HttpError) return json({ error: e.message }, e.status);
      console.error('unhandled', e && e.message);
      return json({ error: '서버 오류가 발생했습니다.' }, 500);
    }
  }
};
