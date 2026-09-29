// 플랜두씨 다이어리 2 — API (Cloudflare Workers + D1) + 로그인.
// 코드에 비밀값이 없다: D1 은 바인딩(env.DB)으로만 연결되고, 로그인 상태 값은 요청마다 무작위로 만들어 DB 에 SHA-256 만 남긴다(서명용 비밀키가 아예 없다).
import { METRICS, MAX_RUN_MINUTES, POLICY, kstDate, buildObservation } from './observe.js';

const TZ = 'Asia/Seoul';
const SCHEMA_VERSION = 3;
const LIMITS = { users: 200, plans: 200, todos: 2000, runs: 5000 };
const MAX_BODY = 20000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 인증 설정 — 설명서 ①②③ 과 같은 값이다.
const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 86400e3;
const COOKIE = 'sid';
// Workers 의 WebCrypto 는 PBKDF2 반복 횟수를 10만 회까지만 허용한다(권장치보다 낮다: 설명서 ⑥ 에 적음).
const PW = { algo: 'PBKDF2-HMAC-SHA256', iter: 100000, saltBytes: 16, bits: 256, min: 8, max: 128 };
const LOGIN_RE = /^[a-z0-9_.-]{3,30}$/;
const NOT_LOGGED_IN = '로그인이 필요합니다.';
const LOGIN_FAILED = '아이디 또는 비밀번호가 올바르지 않습니다.'; // 아이디가 없을 때와 비밀번호가 틀릴 때 똑같은 문구

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

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra }
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
  if (text && !/^application\/json\b/i.test(req.headers.get('content-type') || '')) throw new HttpError(415, '요청은 JSON(application/json)이어야 합니다.');
  try {
    const data = JSON.parse(text || '{}');
    if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new Error();
    return data;
  } catch {
    throw bad('JSON 형식이 올바르지 않습니다.');
  }
}
function todoRow(r) {
  const { user_id, ...rest } = r;
  return { ...rest, tags: r.tags ? r.tags.split(',') : [] };
}

// ---------- 암호 도구 (Workers/Node 공통 WebCrypto) ----------
const enc = new TextEncoder();
const toB64 = (u8) => btoa(String.fromCharCode(...u8));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const toB64u = (u8) => toB64(u8).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256hex = async (s) => toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s))));

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, PW.bits));
}
function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(PW.saltBytes));
  return { pw_algo: PW.algo, pw_iter: PW.iter, pw_salt: toB64(salt), pw_hash: toB64(await derive(password, salt, PW.iter)) };
}
async function verifyPassword(user, password) {
  if (typeof password !== 'string' || password.length > PW.max) return false;
  return sameBytes(await derive(password, fromB64(user.pw_salt), user.pw_iter), fromB64(user.pw_hash));
}
const DUMMY_SALT = new Uint8Array(PW.saltBytes);

function reqPassword(v, name) {
  if (typeof v !== 'string' || v.length < PW.min || v.length > PW.max) throw bad(`${name}는 ${PW.min}~${PW.max}자여야 합니다.`);
  return v;
}

// ---------- 로그인 상태(세션) ----------
function cookieHeader(value, url, maxAge) {
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === 'https:' ? '; Secure' : ''}`;
}
function tokenFrom(req) {
  for (const part of (req.headers.get('cookie') || '').split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i) === COOKIE) return part.slice(i + 1);
  }
  return null;
}
async function startSession(db, userId, url) {
  const token = toB64u(crypto.getRandomValues(new Uint8Array(32)));
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(new Date(now).toISOString()),
    db
      .prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?,?,?,?)')
      .bind(await sha256hex(token), userId, new Date(now).toISOString(), new Date(now + SESSION_MS).toISOString())
  ]);
  return { cookie: cookieHeader(token, url, SESSION_MS / 1000), expires_at: new Date(now + SESSION_MS).toISOString() };
}
async function currentUser(db, req) {
  const token = tokenFrom(req);
  if (!token) return null;
  const row = await db
    .prepare('SELECT s.id AS session_id, s.expires_at, u.id, u.login_id, u.created_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
    .bind(await sha256hex(token))
    .first();
  if (!row) return null;
  if (row.expires_at <= nowISO()) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(row.session_id).run();
    return null;
  }
  return row;
}
const respond = (body, cookie, status = 200) => ({ __respond: true, status, body, headers: cookie ? { 'set-cookie': cookie } : {} });

function normLogin(v) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return LOGIN_RE.test(s) ? s : null;
}
async function signup(db, req, url) {
  const b = await readBody(req);
  const loginId = normLogin(b.login_id);
  if (!loginId) throw bad('아이디는 영문 소문자·숫자·._- 로 3~30자여야 합니다.');
  const password = reqPassword(b.password, '비밀번호');
  if (password.toLowerCase() === loginId) throw bad('비밀번호는 아이디와 달라야 합니다.');
  if ((await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n >= LIMITS.users) throw bad('지금은 더 가입할 수 없습니다.');
  if (await db.prepare('SELECT 1 AS x FROM users WHERE login_id = ?').bind(loginId).first()) throw new HttpError(409, '이미 사용 중인 아이디입니다.');
  const h = await hashPassword(password);
  let res;
  try {
    res = await db
      .prepare('INSERT INTO users (login_id, pw_algo, pw_iter, pw_salt, pw_hash, created_at) VALUES (?,?,?,?,?,?)')
      .bind(loginId, h.pw_algo, h.pw_iter, h.pw_salt, h.pw_hash, nowISO())
      .run();
  } catch (e) {
    if (/UNIQUE/i.test(String(e && e.message))) throw new HttpError(409, '이미 사용 중인 아이디입니다.');
    throw e;
  }
  const s = await startSession(db, res.meta.last_row_id, url);
  return respond({ user: { login_id: loginId }, session_expires_at: s.expires_at }, s.cookie, 201);
}
async function login(db, req, url) {
  const b = await readBody(req);
  const loginId = normLogin(b.login_id);
  const user = loginId ? await db.prepare('SELECT * FROM users WHERE login_id = ?').bind(loginId).first() : null;
  // 아이디가 없어도 같은 계산을 한 번 해서, 걸린 시간으로 아이디 유무를 알아내지 못하게 한다.
  const ok = user ? await verifyPassword(user, b.password) : (await derive(typeof b.password === 'string' ? b.password.slice(0, PW.max) : '', DUMMY_SALT, PW.iter), false);
  if (!ok) throw new HttpError(401, LOGIN_FAILED);
  const s = await startSession(db, user.id, url);
  return respond({ user: { login_id: user.login_id }, session_expires_at: s.expires_at }, s.cookie);
}
async function logout(db, req, url) {
  const token = tokenFrom(req);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256hex(token)).run();
  return respond({ ok: true }, cookieHeader('', url, 0));
}
async function me(db, req) {
  const u = await currentUser(db, req);
  if (!u) return { user: null };
  return { user: { login_id: u.login_id, created_at: u.created_at }, session: { expires_at: u.expires_at, ttl_days: SESSION_DAYS } };
}
async function changePassword(db, user, req, url) {
  const b = await readBody(req);
  const full = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  if (!(await verifyPassword(full, b.current_password))) throw new HttpError(401, '현재 비밀번호가 올바르지 않습니다.');
  const next = reqPassword(b.new_password, '새 비밀번호');
  if (next.toLowerCase() === full.login_id) throw bad('비밀번호는 아이디와 달라야 합니다.');
  const h = await hashPassword(next);
  await db.batch([
    db.prepare('UPDATE users SET pw_algo=?, pw_iter=?, pw_salt=?, pw_hash=? WHERE id=?').bind(h.pw_algo, h.pw_iter, h.pw_salt, h.pw_hash, user.id),
    db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(user.id) // 이전에 발급한 값은 전부 끊는다
  ]);
  const s = await startSession(db, user.id, url);
  return respond({ ok: true, session_expires_at: s.expires_at }, s.cookie);
}
async function deleteAccount(db, user, req, url) {
  const b = await readBody(req);
  const full = await db.prepare('SELECT * FROM users WHERE id = ?').bind(user.id).first();
  if (!(await verifyPassword(full, b.password))) throw new HttpError(401, '비밀번호가 올바르지 않습니다.');
  await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run(); // 계획·할 일·실행 기록·세션이 함께 지워진다(ON DELETE CASCADE)
  return respond({ deleted: true }, cookieHeader('', url, 0));
}

// ---------- 주인 확인: 남의 자료와 없는 자료를 구분하지 않고 같은 404 로 거절한다. 모든 자료 접근이 여기를 지난다. ----------
async function ownedPlan(db, uid, id) {
  const p = await db.prepare('SELECT * FROM plans WHERE id = ? AND user_id = ?').bind(id, uid).first();
  if (!p) throw new HttpError(404, '계획을 찾을 수 없습니다.');
  return p;
}
async function ownedTodo(db, uid, id) {
  const r = await db.prepare('SELECT * FROM todo_view WHERE id = ? AND user_id = ?').bind(id, uid).first();
  if (!r) throw new HttpError(404, '할 일을 찾을 수 없습니다.');
  return todoRow(r);
}
async function ownedRun(db, uid, id) {
  const r = await db
    .prepare('SELECT r.id FROM runs r JOIN todos t ON t.id = r.todo_id JOIN plans p ON p.id = t.plan_id WHERE r.id = ? AND p.user_id = ?')
    .bind(id, uid)
    .first();
  if (!r) throw new HttpError(404, '실행 기록을 찾을 수 없습니다.');
  return r;
}
async function countOwn(db, uid, what) {
  const sql = {
    plans: 'SELECT COUNT(*) AS n FROM plans WHERE user_id = ?',
    todos: 'SELECT COUNT(*) AS n FROM todos t JOIN plans p ON p.id = t.plan_id WHERE p.user_id = ?',
    runs: 'SELECT COUNT(*) AS n FROM runs r JOIN todos t ON t.id = r.todo_id JOIN plans p ON p.id = t.plan_id WHERE p.user_id = ?',
    completions: 'SELECT COUNT(*) AS n FROM completions c JOIN todos t ON t.id = c.todo_id JOIN plans p ON p.id = t.plan_id WHERE p.user_id = ?'
  }[what];
  return (await db.prepare(sql).bind(uid).first()).n;
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
async function listPlans(db, uid) {
  const { results } = await db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM plan_revisions r WHERE r.plan_id = p.id) AS revision_count,
        (SELECT COUNT(*) FROM todos t WHERE t.plan_id = p.id) AS todo_count
       FROM plans p WHERE p.user_id = ? ORDER BY p.id DESC`
    )
    .bind(uid)
    .all();
  return { rows: results.map(({ user_id, ...p }) => p) };
}
async function getPlan(db, uid, id) {
  const { user_id, ...plan } = await ownedPlan(db, uid, id);
  const revisions = (await db.prepare('SELECT * FROM plan_revisions WHERE plan_id = ? ORDER BY revision_no').bind(id).all()).results;
  const carriedTo = (await db.prepare('SELECT id, title FROM plans WHERE carried_from_plan_id = ? AND user_id = ? ORDER BY id').bind(id, uid).all()).results;
  const carriedFrom = plan.carried_from_plan_id
    ? await db.prepare('SELECT id, title FROM plans WHERE id = ? AND user_id = ?').bind(plan.carried_from_plan_id, uid).first()
    : null;
  return { plan, revisions, carried_to: carriedTo, carried_from: carriedFrom };
}
async function createPlan(db, uid, b) {
  const f = planFields(b);
  let fromId = null;
  let note = null;
  if (b.carried_from_plan_id !== undefined && b.carried_from_plan_id !== null && b.carried_from_plan_id !== '') {
    fromId = reqInt(b.carried_from_plan_id, '이전 계획 ID', 1, 1e9);
    note = reqStr(b.carried_note, '넘길 고칠 점', 1, 300);
    await ownedPlan(db, uid, fromId);
  }
  if ((await countOwn(db, uid, 'plans')) >= LIMITS.plans) throw bad(`계획은 ${LIMITS.plans}개까지 만들 수 있습니다.`);
  const now = nowISO();
  const res = await db.batch([
    db
      .prepare(
        `INSERT INTO plans (title, period_start, period_end, priority, success_criteria, est_minutes, carried_from_plan_id, carried_note, created_at, updated_at, user_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`
      )
      .bind(f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.est_minutes, fromId, note, now, now, uid),
    db
      .prepare(
        `INSERT INTO plan_revisions (plan_id, revision_no, title, period_start, period_end, priority, success_criteria, est_minutes, recorded_at)
         VALUES (last_insert_rowid(), 1, ?,?,?,?,?,?,?)`
      )
      .bind(f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.est_minutes, now)
  ]);
  return getPlan(db, uid, res[0].meta.last_row_id);
}
async function updatePlan(db, uid, id, b) {
  const cur = await ownedPlan(db, uid, id);
  const f = planFields(b);
  const same = Object.keys(f).every((k) => cur[k] === f[k]);
  if (!same) {
    const now = nowISO();
    await db.batch([
      db
        .prepare('UPDATE plans SET title=?, period_start=?, period_end=?, priority=?, success_criteria=?, est_minutes=?, updated_at=? WHERE id=? AND user_id=?')
        .bind(f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.est_minutes, now, id, uid),
      db
        .prepare(
          `INSERT INTO plan_revisions (plan_id, revision_no, title, period_start, period_end, priority, success_criteria, est_minutes, recorded_at)
           SELECT ?, COALESCE(MAX(revision_no), 0) + 1, ?,?,?,?,?,?,? FROM plan_revisions WHERE plan_id = ?`
        )
        .bind(id, f.title, f.period_start, f.period_end, f.priority, f.success_criteria, f.est_minutes, now, id)
    ]);
  }
  return getPlan(db, uid, id);
}

// ---------- 할 일 ----------
async function listTodos(db, uid, url) {
  const q = url.searchParams;
  const where = ['v.user_id = ?'];
  const params = [uid];
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
  const sql = `SELECT v.* FROM todo_view v WHERE ${where.join(' AND ')} ORDER BY ${SORTS[sortKey].sql}`;
  const { results } = await db.prepare(sql).bind(...params).all();
  return { rows: results.map(todoRow), sort: { key: sortKey, label: SORTS[sortKey].label }, processed_on: 'server' };
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
async function createTodo(db, uid, b) {
  const f = todoFields(b);
  const planId = reqInt(b.plan_id, '계획 ID', 1, 1e9);
  await ownedPlan(db, uid, planId);
  if ((await countOwn(db, uid, 'todos')) >= LIMITS.todos) throw bad(`할 일은 ${LIMITS.todos}개까지 만들 수 있습니다.`);
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
  return ownedTodo(db, uid, id);
}
async function updateTodo(db, uid, id, b) {
  await ownedTodo(db, uid, id);
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
  return ownedTodo(db, uid, id);
}
async function deleteTodo(db, uid, id) {
  await ownedTodo(db, uid, id);
  await db.prepare('DELETE FROM todos WHERE id = ?').bind(id).run();
  return { deleted: id };
}
async function completeTodo(db, uid, id) {
  await ownedTodo(db, uid, id);
  const res = await db.prepare('INSERT OR IGNORE INTO completions (todo_id, completed_at) VALUES (?, ?)').bind(id, nowISO()).run();
  return { todo: await ownedTodo(db, uid, id), newly_completed: res.meta.changes === 1 };
}
async function reopenTodo(db, uid, id) {
  await ownedTodo(db, uid, id);
  await db.batch([
    db.prepare('DELETE FROM completions WHERE todo_id = ?').bind(id),
    db.prepare("UPDATE todos SET status = 'doing', updated_at = ? WHERE id = ?").bind(nowISO(), id)
  ]);
  return { todo: await ownedTodo(db, uid, id) };
}

// ---------- 실행 기록 ----------
const RUN_SELECT = `SELECT r.*, t.title AS todo_title, t.plan_id AS plan_id FROM runs r JOIN todos t ON t.id = r.todo_id JOIN plans p ON p.id = t.plan_id`;
async function listRuns(db, uid, url) {
  const todoId = url.searchParams.get('todo_id');
  const sql = `${RUN_SELECT} WHERE p.user_id = ? ${todoId ? 'AND r.todo_id = ?' : ''} ORDER BY r.started_at DESC, r.id DESC`;
  const stmt = db.prepare(sql);
  const { results } = await (todoId ? stmt.bind(uid, idParam(todoId)) : stmt.bind(uid)).all();
  return { rows: results };
}
async function createRun(db, uid, b) {
  const todoId = reqInt(b.todo_id, '할 일 ID', 1, 1e9);
  await ownedTodo(db, uid, todoId);
  const started = reqTime(b.started_at, '시작 시각');
  const ended = reqTime(b.ended_at, '끝난 시각');
  if (ended < started) throw bad('끝난 시각은 시작 시각보다 빠를 수 없습니다.');
  const minutes = Math.round((new Date(ended) - new Date(started)) / 60000);
  if (minutes > MAX_RUN_MINUTES) throw bad(`한 번에 ${MAX_RUN_MINUTES}분(12시간)을 넘는 기록은 입력 착오로 보고 저장하지 않습니다.`);
  const blocked = optStr(b.blocked_reason, '막힌 이유', 500);
  if ((await countOwn(db, uid, 'runs')) >= LIMITS.runs) throw bad(`실행 기록은 ${LIMITS.runs}건까지 남길 수 있습니다.`);
  if (await db.prepare('SELECT 1 AS x FROM runs WHERE todo_id = ? AND started_at = ?').bind(todoId, started).first()) {
    throw new HttpError(409, '같은 할 일의 같은 시작 시각 기록이 이미 있습니다.');
  }
  const res = await db
    .prepare('INSERT INTO runs (todo_id, started_at, ended_at, actual_minutes, blocked_reason, created_at) VALUES (?,?,?,?,?,?)')
    .bind(todoId, started, ended, minutes, blocked, nowISO())
    .run();
  return db.prepare(`${RUN_SELECT} WHERE r.id = ? AND p.user_id = ?`).bind(res.meta.last_row_id, uid).first();
}
async function deleteRun(db, uid, id) {
  await ownedRun(db, uid, id);
  await db.prepare('DELETE FROM runs WHERE id = ?').bind(id).run();
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
async function planScope(db, uid, planId) {
  if (planId) await ownedPlan(db, uid, planId);
  return planId ? { sql: 'v.user_id = ? AND v.plan_id = ?', params: [uid, planId] } : { sql: 'v.user_id = ?', params: [uid] };
}
async function review(db, uid, url) {
  const planId = url.searchParams.get('plan_id') ? idParam(url.searchParams.get('plan_id')) : null;
  const today = todayKST();
  const sc = await planScope(db, uid, planId);
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
  const plans = planId ? 1 : await countOwn(db, uid, 'plans');
  let planInfo = null;
  let carried = [];
  if (planId) {
    planInfo = await db.prepare('SELECT id, title, period_start, period_end FROM plans WHERE id = ? AND user_id = ?').bind(planId, uid).first();
    carried = (await db.prepare('SELECT id, title, carried_note FROM plans WHERE carried_from_plan_id = ? AND user_id = ? ORDER BY id').bind(planId, uid).all()).results;
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
async function reviewRecords(db, uid, url) {
  const planId = url.searchParams.get('plan_id') ? idParam(url.searchParams.get('plan_id')) : null;
  const metric = url.searchParams.get('metric');
  const sc = await planScope(db, uid, planId);
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

// ---------- 5일 관찰 ----------
async function dayValues(db, uid, metric, fromDate) {
  const map = {};
  const add = (iso, v) => {
    const d = kstDate(iso);
    if (d < fromDate) return;
    (map[d] ||= { value: 0, records: 0 });
    map[d].value += v;
    map[d].records += 1;
  };
  if (metric === 'run_minutes') {
    const { results } = await db.prepare(`SELECT r.started_at, r.actual_minutes FROM runs r JOIN todos t ON t.id = r.todo_id JOIN plans p ON p.id = t.plan_id WHERE p.user_id = ?`).bind(uid).all();
    results.forEach((r) => add(r.started_at, r.actual_minutes));
  } else {
    const { results } = await db.prepare(`SELECT c.completed_at FROM completions c JOIN todos t ON t.id = c.todo_id JOIN plans p ON p.id = t.plan_id WHERE p.user_id = ?`).bind(uid).all();
    results.forEach((r) => add(r.completed_at, 1));
  }
  return map;
}
async function observationState(db, uid) {
  const today = todayKST();
  const setup = await db.prepare('SELECT * FROM observation WHERE user_id = ?').bind(uid).first();
  const rules = setup
    ? (await db.prepare('SELECT version, rule_text, reason, changed_at, changed_on, before_dates FROM plan_rules WHERE user_id = ? ORDER BY version').bind(uid).all()).results
        .map((r) => ({ ...r, before_dates: r.before_dates ? JSON.parse(r.before_dates) : null }))
    : [];
  const dayMap = setup ? await dayValues(db, uid, setup.metric, setup.locked_on) : {};
  return { today, setup, rules, dayMap };
}
async function getObservation(db, uid) {
  const { today, setup, rules, dayMap } = await observationState(db, uid);
  const obs = buildObservation({ setup, rules, dayMap, today });
  let canChange = { ok: false, why: '먼저 1일차에 질문·지표·계획 규칙을 정하세요.' };
  if (setup) {
    if (rules.length >= 2) canChange = { ok: false, why: '계획 규칙은 한 번만 바꿀 수 있고, 이미 바꿨습니다.' };
    else if (!obs.data_days) canChange = { ok: false, why: '아직 기록이 없어서 바꿀 수 없습니다. 기록이 쌓인 뒤 바꾸세요.' };
    else if (dayMap[today]) canChange = { ok: false, why: `오늘(${today}) 이미 기록이 있어 바꿀 수 없습니다. 오늘 기록이 없는 날(예: 3일차 기록 전)에 바꾸세요.` };
    else canChange = { ok: true, why: `지금까지 ${obs.data_days}일치 기록이 "변경 전"으로 묶입니다. 이 뒤의 기록은 "변경 후"가 됩니다.` };
  }
  return {
    today_kst: today,
    metrics: METRICS,
    policy: POLICY,
    setup: setup ? { question: setup.question, metric: setup.metric, metric_label: METRICS[setup.metric].label, unit: setup.unit, locked_on: setup.locked_on, locked_at: setup.locked_at } : null,
    rules,
    can_change: canChange,
    ...obs
  };
}
async function createObservation(db, uid, b) {
  if (await db.prepare('SELECT 1 AS x FROM observation WHERE user_id = ?').bind(uid).first()) {
    throw new HttpError(409, '이미 정했습니다. 질문·지표·단위는 고칠 수 없습니다.');
  }
  const question = reqStr(b.question, '답하려는 질문', 1, 200);
  if (/[\r\n]/.test(question)) throw bad('질문은 한 문장으로, 줄을 바꾸지 않고 적어 주세요.');
  if (!METRICS[b.metric]) throw bad('지표를 골라 주세요.');
  const rule = reqStr(b.plan_rule, '계획 규칙', 1, 300);
  const now = nowISO();
  await db.batch([
    db.prepare('INSERT INTO observation (user_id, question, metric, unit, locked_on, locked_at) VALUES (?,?,?,?,?,?)').bind(uid, question, b.metric, METRICS[b.metric].unit, todayKST(), now),
    db.prepare('INSERT INTO plan_rules (user_id, version, rule_text, reason, changed_at, changed_on, before_dates) VALUES (?,?,?,?,?,?,?)').bind(uid, 1, rule, null, now, todayKST(), null)
  ]);
  return getObservation(db, uid);
}
async function changeRule(db, uid, b) {
  const { today, setup, rules, dayMap } = await observationState(db, uid);
  if (!setup) throw new HttpError(409, '먼저 1일차에 질문·지표·계획 규칙을 정하세요.');
  if (rules.length >= 2) throw new HttpError(409, '계획 규칙은 한 번만 바꿀 수 있고, 이미 바꿨습니다.');
  const dates = Object.keys(dayMap).sort();
  if (!dates.length) throw new HttpError(409, '아직 기록이 없어서 바꿀 수 없습니다. 기록이 쌓인 뒤 바꾸세요.');
  if (dayMap[today]) throw new HttpError(409, `오늘(${today}) 이미 기록이 있어 바꿀 수 없습니다. 오늘 기록이 없는 날에 바꾸세요.`);
  const text = reqStr(b.rule_text, '새 계획 규칙', 1, 300);
  if (text === rules[0].rule_text) throw bad('새 규칙이 기존 규칙과 같습니다.');
  const reason = reqStr(b.reason, '바꾼 이유', 1, 300);
  await db
    .prepare('INSERT INTO plan_rules (user_id, version, rule_text, reason, changed_at, changed_on, before_dates) VALUES (?,?,?,?,?,?,?)')
    .bind(uid, 2, text, reason, nowISO(), today, JSON.stringify(dates))
    .run();
  return getObservation(db, uid);
}

async function exportAll(db, uid, user) {
  const own = 'SELECT id FROM plans WHERE user_id = ?';
  const ownTodos = `SELECT t.id FROM todos t WHERE t.plan_id IN (${own})`;
  const rows = async (sql, ...p) => (await db.prepare(sql).bind(...p).all()).results;
  return {
    schema_version: SCHEMA_VERSION,
    exported_at: nowISO(),
    account: { login_id: user.login_id, created_at: user.created_at },
    plans: (await rows('SELECT id, title, period_start, period_end, priority, success_criteria, est_minutes, carried_from_plan_id, carried_note, created_at, updated_at FROM plans WHERE user_id = ? ORDER BY id', uid)),
    plan_revisions: await rows(`SELECT * FROM plan_revisions WHERE plan_id IN (${own}) ORDER BY plan_id, revision_no`, uid),
    todos: await rows(`SELECT * FROM todos WHERE plan_id IN (${own}) ORDER BY id`, uid),
    todo_tags: await rows(`SELECT * FROM todo_tags WHERE todo_id IN (${ownTodos}) ORDER BY 1, 2`, uid),
    runs: await rows(`SELECT * FROM runs WHERE todo_id IN (${ownTodos}) ORDER BY id`, uid),
    completions: await rows(`SELECT * FROM completions WHERE todo_id IN (${ownTodos}) ORDER BY id`, uid),
    observation: await rows('SELECT question, metric, unit, locked_on, locked_at FROM observation WHERE user_id = ?', uid),
    plan_rules: await rows('SELECT version, rule_text, reason, changed_at, changed_on, before_dates FROM plan_rules WHERE user_id = ? ORDER BY version', uid)
  };
}

// ---------- 라우터 ----------
async function route(req, env, url) {
  const db = env.DB;
  const path = url.pathname.replace(/\/+$/, '');
  const m = req.method;
  let x;

  // 로그인 없이 쓸 수 있는 것: 가입·로그인·로그아웃·내 상태 확인
  if (path === '/api/auth/signup' && m === 'POST') return signup(db, req, url);
  if (path === '/api/auth/login' && m === 'POST') return login(db, req, url);
  if (path === '/api/auth/logout' && m === 'POST') return logout(db, req, url);
  if (path === '/api/auth/me' && m === 'GET') return me(db, req);

  // 그 밖의 모든 /api 는 로그인한 사람만. 여기서 uid 를 정하고, 아래 모든 자료 접근이 uid 로 걸러진다.
  const user = await currentUser(db, req);
  if (!user) throw new HttpError(401, NOT_LOGGED_IN);
  const uid = user.id;

  if (path === '/api/auth/password' && m === 'POST') return changePassword(db, user, req, url);
  if (path === '/api/auth/account' && m === 'DELETE') return deleteAccount(db, user, req, url);

  if (path === '/api/meta' && m === 'GET') {
    return { today_kst: todayKST(), timezone: TZ, schema_version: SCHEMA_VERSION, sorts: Object.fromEntries(Object.entries(SORTS).map(([k, v]) => [k, v.label])),
      counts: { plans: await countOwn(db, uid, 'plans'), todos: await countOwn(db, uid, 'todos'), runs: await countOwn(db, uid, 'runs'), completions: await countOwn(db, uid, 'completions') } };
  }
  if (path === '/api/plans') {
    if (m === 'GET') return listPlans(db, uid);
    if (m === 'POST') return createPlan(db, uid, await readBody(req));
  }
  if ((x = path.match(/^\/api\/plans\/(\d+)$/))) {
    if (m === 'GET') return getPlan(db, uid, idParam(x[1]));
    if (m === 'PUT') return updatePlan(db, uid, idParam(x[1]), await readBody(req));
  }
  if (path === '/api/todos') {
    if (m === 'GET') return listTodos(db, uid, url);
    if (m === 'POST') return createTodo(db, uid, await readBody(req));
  }
  if ((x = path.match(/^\/api\/todos\/(\d+)$/))) {
    if (m === 'PUT') return updateTodo(db, uid, idParam(x[1]), await readBody(req));
    if (m === 'DELETE') return deleteTodo(db, uid, idParam(x[1]));
  }
  if ((x = path.match(/^\/api\/todos\/(\d+)\/(complete|reopen)$/)) && m === 'POST') {
    return x[2] === 'complete' ? completeTodo(db, uid, idParam(x[1])) : reopenTodo(db, uid, idParam(x[1]));
  }
  if (path === '/api/tags' && m === 'GET') {
    return { rows: (await db.prepare('SELECT g.tag AS tag, COUNT(*) AS n FROM todo_tags g JOIN todos t ON t.id = g.todo_id JOIN plans p ON p.id = t.plan_id WHERE p.user_id = ? GROUP BY g.tag ORDER BY g.tag').bind(uid).all()).results };
  }
  if (path === '/api/runs') {
    if (m === 'GET') return listRuns(db, uid, url);
    if (m === 'POST') return createRun(db, uid, await readBody(req));
  }
  if ((x = path.match(/^\/api\/runs\/(\d+)$/)) && m === 'DELETE') return deleteRun(db, uid, idParam(x[1]));
  if (path === '/api/review' && m === 'GET') return review(db, uid, url);
  if (path === '/api/review/records' && m === 'GET') return reviewRecords(db, uid, url);
  if (path === '/api/observation') {
    if (m === 'GET') return getObservation(db, uid);
    if (m === 'POST') return createObservation(db, uid, await readBody(req));
  }
  if (path === '/api/observation/rule-change' && m === 'POST') return changeRule(db, uid, await readBody(req));
  if (path === '/api/export' && m === 'GET') return { __download: 'pds-diary-export.json', body: await exportAll(db, uid, user) };

  throw new HttpError(404, '찾을 수 없는 주소입니다.');
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith('/api/')) return new Response('Not found', { status: 404 });
    try {
      // 다른 사이트에서 온 쓰기 요청은 쿠키가 있어도 거절한다(SameSite=Strict 와 함께 쓰는 이중 방어).
      if (!['GET', 'HEAD'].includes(req.method)) {
        const origin = req.headers.get('origin');
        let host = null;
        try { host = origin ? new URL(origin).host : url.host; } catch { /* 잘못된 Origin */ }
        if (host !== url.host) throw new HttpError(403, '허용되지 않은 출처의 요청입니다.');
      }
      const out = await route(req, env, url);
      if (out && out.__respond) return json(out.body, out.status, out.headers);
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
