// API 통합 검사(로컬, 메모리 DB): node scripts/api-test.mjs
// BASE_URL 을 주면 배포된 서버에 HTTP 로 같은 검사를 돌린다(일부 DB 직접 확인은 빼고). 검사용 계정을 만들었다가 끝에서 지운다.
import fs from 'node:fs';
import crypto from 'node:crypto';
import worker from '../src/worker.js';
import { buildObservation, summarize, weekStartMon, kstDate } from '../src/observe.js';
import { createD1 } from './d1-shim.mjs';

const BASE = process.env.BASE_URL;
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const env = BASE ? null : { DB: createD1(':memory:', read('../schema.sql')) };
const raw = env && env.DB.raw;
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };
const local = (fn) => { if (!BASE) fn(); };

// 로그·응답에 비밀번호 원문이 남는지 보려고 서버가 남기는 로그와 모든 응답 본문을 모아 둔다.
const logs = [];
for (const k of ['error', 'warn', 'info', 'debug']) { const o = console[k].bind(console); console[k] = (...a) => { logs.push(a.map(String).join(' ')); o(...a); }; }
const responses = [];

const rnd = () => crypto.randomBytes(9).toString('hex');
const PW_A = `Aa1-${rnd()}`, PW_B = `Bb2-${rnd()}`, PW_A2 = `Cc3-${rnd()}`, PW_SAME = `Dd4-${rnd()}`;
const ID_A = `tester-a-${rnd().slice(0, 6)}`, ID_B = `tester-b-${rnd().slice(0, 6)}`;
const newJar = () => ({ cookie: null });

async function call(jar, method, path, body, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const cookie = opts.cookie !== undefined ? opts.cookie : jar && jar.cookie;
  if (cookie) headers.cookie = `sid=${cookie}`;
  const init = { method, headers, body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body) };
  const r = BASE ? await fetch(BASE + path, init) : await worker.fetch(new Request((opts.https ? 'https://x' : 'http://x') + path, init), env);
  const text = await r.text();
  responses.push(text);
  let data; try { data = JSON.parse(text); } catch { data = text; }
  const setCookie = r.headers.get('set-cookie');
  if (jar && !opts.keepJar && setCookie) { const m = /^sid=([^;]*)/.exec(setCookie); if (m) jar.cookie = m[1] || null; }
  return { status: r.status, data, setCookie };
}
const A = newJar(), B = newJar();
const api = (m, p, b) => call(A, m, p, b);
const apiB = (m, p, b) => call(B, m, p, b);

let r;
// =====================================================================================
// 1. 가입·로그인·로그아웃 (T07-C94~C99)
// =====================================================================================
const DATA_ENDPOINTS = [
  ['GET', '/api/meta'], ['GET', '/api/plans'], ['GET', '/api/plans/1'], ['POST', '/api/plans', {}], ['PUT', '/api/plans/1', {}],
  ['GET', '/api/todos'], ['POST', '/api/todos', {}], ['PUT', '/api/todos/1', {}], ['DELETE', '/api/todos/1'],
  ['POST', '/api/todos/1/complete'], ['POST', '/api/todos/1/reopen'], ['GET', '/api/tags'], ['GET', '/api/runs'], ['POST', '/api/runs', {}], ['DELETE', '/api/runs/1'],
  ['GET', '/api/review'], ['GET', '/api/review/records?metric=done'], ['GET', '/api/observation'], ['POST', '/api/observation', {}],
  ['POST', '/api/observation/rule-change', {}], ['GET', '/api/export'], ['POST', '/api/auth/password', {}], ['DELETE', '/api/auth/account', {}]
];
for (const [m, p, b] of DATA_ENDPOINTS) {
  r = await call(null, m, p, b);
  ok(r.status === 401 && !JSON.stringify(r.data).includes('rows'), `C97 로그인 없이 ${m} ${p} → 401 (자료 없음)`, JSON.stringify(r));
}
r = await call(null, 'GET', '/api/auth/me');
ok(r.status === 200 && r.data.user === null, 'C97 로그인 전 내 상태 확인은 user=null');
r = await call(null, 'GET', '/api/nope');
ok(r.status === 401, '없는 주소도 로그인 전에는 401 (존재 여부를 알려주지 않음)');

r = await call(A, 'POST', '/api/auth/signup', { login_id: 'ab', password: PW_A });
ok(r.status === 400, 'C94 너무 짧은 아이디 거부');
r = await call(A, 'POST', '/api/auth/signup', { login_id: ID_A, password: 'short' });
ok(r.status === 400, 'C94 8자 미만 비밀번호 거부');
r = await call(A, 'POST', '/api/auth/signup', { login_id: 'Bad Id!', password: PW_A });
ok(r.status === 400, 'C94 허용되지 않는 글자가 든 아이디 거부');
r = await call(A, 'POST', '/api/auth/signup', { login_id: ID_A, password: ID_A });
ok(r.status === 400, 'C94 비밀번호가 아이디와 같으면 거부');

r = await call(A, 'POST', '/api/auth/signup', { login_id: ID_A, password: PW_A });
const signupCookie = A.cookie;
ok(r.status === 201 && r.data.user.login_id === ID_A && signupCookie && signupCookie.length >= 40, 'C94 가입 성공 + 로그인 상태(쿠키 발급)', JSON.stringify(r));
ok(/HttpOnly/.test(r.setCookie) && /SameSite=Strict/.test(r.setCookie) && /Max-Age=604800/.test(r.setCookie) && /Path=\//.test(r.setCookie), 'C111 쿠키: HttpOnly·SameSite=Strict·Max-Age=604800(7일)', r.setCookie);
local(() => ok(!/Secure/.test(r.setCookie), '쿠키: http(로컬)에서는 Secure 를 붙이지 않음'));
ok(!JSON.stringify(r.data).match(/password|pw_|token|sid/i) && !JSON.stringify(r.data).includes(signupCookie), 'C112 응답 본문에 비밀번호·해시·세션 값이 없음 (주소창·본문에 값이 실리지 않음)');
r = await call(A, 'GET', '/api/auth/me');
ok(r.data.user.login_id === ID_A && r.data.session.ttl_days === 7 && r.data.session.expires_at > new Date().toISOString(), 'C111 내 상태 확인: 만료 시각이 있고 7일');

r = await call(newJar(), 'POST', '/api/auth/signup', { login_id: ID_A, password: PW_A2 });
ok(r.status === 409 && r.data.error.includes('이미 사용 중'), 'C98 같은 아이디로 두 번 가입 불가(409)', JSON.stringify(r));
r = await call(newJar(), 'POST', '/api/auth/signup', { login_id: ID_A.toUpperCase(), password: PW_A2 });
ok(r.status === 409, 'C98 대소문자만 다른 아이디도 같은 아이디로 취급(409)');

const rWrong = await call(newJar(), 'POST', '/api/auth/login', { login_id: ID_A, password: 'wrong-' + PW_A });
const rNoUser = await call(newJar(), 'POST', '/api/auth/login', { login_id: 'nobody-' + rnd(), password: 'wrong-' + PW_A });
ok(rWrong.status === 401 && rNoUser.status === 401 && rWrong.data.error === rNoUser.data.error && !rWrong.setCookie && !rNoUser.setCookie, 'C99 아이디는 맞고 비밀번호만 틀릴 때와 아이디가 없을 때 응답(상태·문구)이 똑같고 쿠키도 없음', JSON.stringify([rWrong.data, rNoUser.data]));
r = await call(newJar(), 'POST', '/api/auth/login', { login_id: ID_A });
ok(r.status === 401 && r.data.error === rWrong.data.error, 'C99 비밀번호를 안 보내도 같은 응답');
const loginJar = newJar();
r = await call(loginJar, 'POST', '/api/auth/login', { login_id: ID_A.toUpperCase(), password: PW_A }, { https: true });
ok(r.status === 200 && loginJar.cookie && loginJar.cookie !== signupCookie, 'C95 만든 계정으로 로그인(아이디 대소문자 무관), 로그인마다 새 값 발급', JSON.stringify(r));
ok(/Secure/.test(r.setCookie), 'C111 https 에서는 쿠키에 Secure 가 붙음', r.setCookie);
A.cookie = loginJar.cookie;

// ---- 저장된 비밀번호 (카드 2) ----
r = await call(newJar(), 'POST', '/api/auth/signup', { login_id: ID_B, password: PW_SAME });
B.cookie = null; await call(B, 'POST', '/api/auth/login', { login_id: ID_B, password: PW_SAME });
const ID_C = `tester-c-${rnd().slice(0, 6)}`;
const jarC = newJar();
r = await call(jarC, 'POST', '/api/auth/signup', { login_id: ID_C, password: PW_SAME });
ok(r.status === 201, 'C104 같은 비밀번호로 계정 두 개 만들기');
local(() => {
  const rows = raw.prepare('SELECT * FROM users ORDER BY id').all();
  const ub = rows.find((x) => x.login_id === ID_B), uc = rows.find((x) => x.login_id === ID_C), ua = rows.find((x) => x.login_id === ID_A);
  ok(ua.pw_algo === 'PBKDF2-HMAC-SHA256' && ua.pw_iter === 100000, 'C101 방법: PBKDF2-HMAC-SHA256 · 100000회', JSON.stringify([ua.pw_algo, ua.pw_iter]));
  ok(!ua.pw_hash.includes(PW_A) && !ua.pw_salt.includes(PW_A) && ua.pw_hash !== PW_A && Buffer.from(ua.pw_hash, 'base64').length === 32 && Buffer.from(ua.pw_salt, 'base64').length === 16, 'C103 저장된 값에 입력한 글자가 보이지 않음 (해시 32바이트·소금 16바이트)');
  ok(ub.pw_hash !== uc.pw_hash && ub.pw_salt !== uc.pw_salt, 'C104 같은 비밀번호로 만든 두 계정의 저장된 값이 서로 다름(소금이 계정마다 다름)');
  const dump = raw.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((t) => JSON.stringify(raw.prepare(`SELECT * FROM ${t.name}`).all())).join('\n');
  ok(![PW_A, PW_B, PW_A2, PW_SAME].some((p) => dump.includes(p)), 'C103 DB 모든 표를 통틀어 비밀번호 원문이 없음');
  const sess = raw.prepare('SELECT token_hash FROM sessions').all().map((s) => s.token_hash);
  ok(sess.every((h) => /^[0-9a-f]{64}$/.test(h)) && !sess.includes(A.cookie) && !dump.includes(A.cookie) && !dump.includes(signupCookie), 'C113 DB 에는 세션 값의 SHA-256 만 있고 원문은 없음');
});

// ---- 로그아웃 (C96, C110 계열) ----
const beforeLogout = A.cookie;
r = await call(A, 'GET', '/api/plans');
ok(r.status === 200, '로그인한 상태에서는 자료 요청이 통과');
const same1 = await call(null, 'GET', '/api/plans', undefined, { cookie: beforeLogout });
ok(same1.status === 200, 'C109 로그인 상태의 성공 응답(같은 주소·같은 방식)');
r = await call(A, 'POST', '/api/auth/logout');
ok(r.status === 200 && /Max-Age=0/.test(r.setCookie) && A.cookie === null, 'C96 로그아웃(쿠키 삭제 지시)');
const same2 = await call(null, 'GET', '/api/plans', undefined, { cookie: beforeLogout });
ok(same2.status === 401, 'C109·C110 로그아웃한 뒤 같은 주소·같은 방식·같은 값으로 요청하면 거절(401) — 다른 점은 로그아웃 여부뿐', JSON.stringify(same2));
local(() => ok(raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(crypto.createHash('sha256').update(beforeLogout).digest('hex')).n === 0, 'C114 서버에서도 세션이 지워짐(브라우저에서만 지운 게 아님)'));
r = await call(A, 'POST', '/api/auth/login', { login_id: ID_A, password: PW_A });
ok(r.status === 200 && A.cookie, '다시 로그인');

// ---- 비밀번호 변경 → 이전 값 무효 (C114) ----
const second = newJar();
await call(second, 'POST', '/api/auth/login', { login_id: ID_A, password: PW_A });
const oldCookie1 = A.cookie, oldCookie2 = second.cookie;
r = await call(A, 'POST', '/api/auth/password', { current_password: 'x' + PW_A, new_password: PW_A2 });
ok(r.status === 401 && (await call(null, 'GET', '/api/plans', undefined, { cookie: oldCookie1 })).status === 200, '비밀번호 변경: 현재 비밀번호가 틀리면 거절, 기존 로그인은 그대로');
r = await call(A, 'POST', '/api/auth/password', { current_password: PW_A, new_password: 'short' });
ok(r.status === 400, '비밀번호 변경: 새 비밀번호 규칙 위반 거절');
r = await call(A, 'POST', '/api/auth/password', { current_password: PW_A, new_password: PW_A2 });
ok(r.status === 200 && A.cookie && A.cookie !== oldCookie1, '비밀번호 변경 성공 + 지금 기기에는 새 로그인 값 발급');
ok((await call(null, 'GET', '/api/plans', undefined, { cookie: oldCookie1 })).status === 401 && (await call(null, 'GET', '/api/plans', undefined, { cookie: oldCookie2 })).status === 401, 'C114 비밀번호를 바꾸면 이전에 발급한 값(다른 기기 포함)이 더 통하지 않음');
ok((await call(A, 'GET', '/api/plans')).status === 200, '비밀번호 변경 뒤 새 값은 통함');
ok((await call(newJar(), 'POST', '/api/auth/login', { login_id: ID_A, password: PW_A })).status === 401 && (await call(newJar(), 'POST', '/api/auth/login', { login_id: ID_A, password: PW_A2 })).status === 200, '옛 비밀번호로는 로그인 안 되고 새 비밀번호로는 됨');

// ---- 만료 (C111) ----
if (!BASE) {
  const exp = newJar();
  await call(exp, 'POST', '/api/auth/login', { login_id: ID_A, password: PW_A2 });
  const cookieExp = exp.cookie;
  raw.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?").run(crypto.createHash('sha256').update(cookieExp).digest('hex'));
  ok((await call(null, 'GET', '/api/plans', undefined, { cookie: cookieExp })).status === 401, 'C111 만료 시각이 지난 값은 서버가 거절');
  ok(raw.prepare('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?').get(crypto.createHash('sha256').update(cookieExp).digest('hex')).n === 0, 'C111 만료된 세션은 DB 에서도 지워짐');
}
ok((await call(null, 'GET', '/api/plans', undefined, { cookie: 'AAAA' })).status === 401 && (await call(null, 'GET', '/api/plans', undefined, { cookie: '' })).status === 401, '엉터리 로그인 값은 거절');

// ---- 다른 사이트에서 온 쓰기 요청 · 형식 ----
r = await call(A, 'POST', '/api/plans', { title: 'x' }, { headers: { origin: 'https://evil.example' } });
ok(r.status === 403, '다른 사이트(Origin)에서 온 쓰기 요청은 쿠키가 있어도 403');
r = await call(A, 'POST', '/api/plans', '{"title":"x"}', { headers: { 'content-type': 'text/plain' } });
ok(r.status === 415, 'JSON 이 아닌 본문은 415');

// =====================================================================================
// 2. 6번 기능이 계정 안에서 그대로 동작 (계정 A)
// =====================================================================================
const plan = { title: '주간 계획 A', period_start: '2026-09-21', period_end: '2026-09-27', priority: 1, success_criteria: '과제6 완성', est_minutes: 480 };
r = await api('POST', '/api/plans', plan);
ok(r.status === 200 && r.data.plan.id >= 1 && r.data.revisions.length === 1 && r.data.plan.user_id === undefined, 'C04-C07 계획 생성: 기간·우선순위·성공기준·예상시간 저장 + 처음 계획(v1) 보존', JSON.stringify(r));
const P1 = r.data.plan.id;
ok(r.data.plan.period_start === '2026-09-21' && r.data.plan.priority === 1 && r.data.plan.success_criteria === '과제6 완성' && r.data.plan.est_minutes === 480, 'C04~C07 값 그대로 저장');
r = await api('PUT', `/api/plans/${P1}`, { ...plan, title: '주간 계획 A (수정)', est_minutes: 600 });
ok(r.data.plan.id === P1 && r.data.plan.title === '주간 계획 A (수정)' && r.data.revisions.length === 2, 'C08 수정해도 계획 ID 그대로, 이력 v2 추가');
ok(r.data.revisions[0].title === '주간 계획 A' && r.data.revisions[0].est_minutes === 480, 'C08 처음 계획(v1) 값이 그대로 남음');
r = await api('PUT', `/api/plans/${P1}`, { ...plan, title: '주간 계획 A (수정)', est_minutes: 600 });
ok(r.data.revisions.length === 2, '같은 값으로 저장하면 이력이 늘지 않음');
r = await api('POST', '/api/plans', { ...plan, period_end: '2026-09-01' });
ok(r.status === 400, '종료일<시작일 거부');
r = await api('POST', '/api/plans', { ...plan, period_start: '2026-02-30' });
ok(r.status === 400, '없는 날짜 거부');

const mk = (title, due, pri, est, tags) => api('POST', '/api/todos', { plan_id: P1, title, due_date: due, priority: pri, est_minutes: est, tags });
const t = [];
t.push((await mk('기획서 정리', '2026-09-20', 1, 60, ['문서'])).data);
t.push((await mk('DB 스키마 작성', '2026-09-24', 1, 90, ['개발', '문서'])).data);
t.push((await mk('화면 만들기', '2026-09-25', 2, 120, ['개발'])).data);
t.push((await mk('테스트', '2026-09-30', 3, 45, ['검증'])).data);
t.push((await mk('일정 없는 메모', null, 2, 0, [])).data);
ok(t.every((x) => x && x.id) && t.length === 5, 'C09 할 일 5개 생성', JSON.stringify(t));
ok(t[1].tags.join() === '개발,문서' && t[1].due_date === '2026-09-24' && t[1].priority === 1 && t[1].est_minutes === 90 && t[1].user_id === undefined, 'C14~C17 마감일·우선순위·태그·예상시간 저장');
r = await api('PUT', `/api/todos/${t[0].id}`, { title: '기획서 다듬기', due_date: '2026-09-20', priority: 1, est_minutes: 60, tags: ['문서', '기획'] });
ok(r.data.title === '기획서 다듬기' && r.data.tags.join() === '기획,문서', 'C10 할 일 수정(제목·태그)', JSON.stringify(r.data));

r = await api('GET', '/api/todos?q=' + encodeURIComponent('기획'));
ok(r.data.rows.length === 1 && r.data.rows[0].id === t[0].id, 'C18 제목 검색');
r = await api('GET', '/api/todos?q=' + encodeURIComponent('검증'));
ok(r.data.rows.length === 1 && r.data.rows[0].title === '테스트', 'C18 태그로도 검색');
r = await api('GET', '/api/todos?tag=' + encodeURIComponent('개발'));
ok(r.data.rows.length === 2, 'C19 태그 거르기');
r = await api('GET', '/api/todos?priority=1');
ok(r.data.rows.length === 2, 'C19 우선순위 거르기');
r = await api('GET', '/api/todos?sort=due');
ok(r.data.rows.map((x) => x.title).join('|') === '기획서 다듬기|DB 스키마 작성|화면 만들기|테스트|일정 없는 메모' && r.data.sort.label.includes('마감일'), 'C20 마감일 정렬(빈 마감은 마지막) + 기준 문구', r.data.rows.map((x) => x.title).join('|'));
r = await api('GET', '/api/todos?sort=priority');
ok(r.data.rows.map((x) => x.priority).join() === '1,1,2,2,3', 'C20 우선순위 정렬 + 같을 때 마감일');
r = await api('GET', '/api/todos?sort=bogus');
ok(r.status === 400, '알 수 없는 정렬 기준 거부');
r = await api('GET', '/api/todos?q=' + encodeURIComponent("%'; DROP TABLE todos;--"));
ok(r.status === 200 && r.data.rows.length === 0, 'SQL 주입성 검색어는 글자로 처리');

const completionsN = async () => (await api('GET', '/api/export')).data.completions.length;
const [c1, c2] = await Promise.all([api('POST', `/api/todos/${t[1].id}/complete`), api('POST', `/api/todos/${t[1].id}/complete`)]);
r = await api('GET', '/api/todos?status=done');
ok(r.data.rows.length === 1 && r.data.rows[0].id === t[1].id, 'C11 완료로 바꾸기');
ok((await completionsN()) === 1, 'C21 동시에 두 번 눌러도 완료 기록 1건');
ok([c1, c2].filter((x) => x.data.newly_completed).length === 1, 'C21 둘 중 하나만 새 완료로 응답');
await api('POST', `/api/todos/${t[1].id}/complete`);
ok((await completionsN()) === 1, 'C21 순차로 또 눌러도 1건');
r = await api('GET', `/api/review?plan_id=${P1}`);
ok(r.data.done === 1, 'C22 돌아보기 완료 수가 정확히 1');
r = await api('POST', `/api/todos/${t[1].id}/reopen`);
ok(r.data.todo.status === 'doing' && (await completionsN()) === 0, 'C12 완료한 할 일을 진행 중으로 되돌림');
await api('POST', `/api/todos/${t[1].id}/complete`);
ok((await completionsN()) === 1, '되돌린 뒤 다시 완료 가능(1건)');

const run = (todo, s, e, blocked) => api('POST', '/api/runs', { todo_id: todo, started_at: s, ended_at: e, blocked_reason: blocked });
r = await run(t[1].id, '2026-09-22T01:00:00.000Z', '2026-09-22T02:30:00.000Z', null);
ok(r.status === 200 && r.data.actual_minutes === 90 && r.data.started_at === '2026-09-22T01:00:00.000Z', 'C23~C25 시작·끝·걸린 시간 저장');
r = await run(t[2].id, '2026-09-22T03:00:00.000Z', '2026-09-22T03:50:00.000Z', '디자인 결정이 안 남');
ok(r.data.blocked_reason === '디자인 결정이 안 남', 'C26 막힌 이유 저장');
await run(t[2].id, '2026-09-23T03:00:00+09:00', '2026-09-23T04:00:00+09:00', null);
const planAfter = await api('GET', `/api/plans/${P1}`);
ok(planAfter.data.plan.est_minutes === 600 && planAfter.data.revisions.length === 2, 'C27 실행 기록을 저장해도 계획 값은 그대로');
const todoAfter = (await api('GET', `/api/todos?plan_id=${P1}`)).data.rows.find((x) => x.id === t[1].id);
ok(todoAfter.est_minutes === 90, 'C27 할 일의 예상 시간도 그대로');
r = await run(t[2].id, '2026-09-23T05:00:00Z', '2026-09-23T04:00:00Z', null);
ok(r.status === 400, '끝<시작 거부');
r = await run(t[2].id, '2026-09-22T03:00:00.000Z', '2026-09-22T03:10:00.000Z', null);
ok(r.status === 409, 'C24(관찰) 같은 할 일·같은 시작 시각 기록은 중복으로 저장하지 않음(409)', JSON.stringify(r));
r = await run(t[2].id, '2026-09-24T00:00:00.000Z', '2026-09-24T12:01:00.000Z', null);
ok(r.status === 400, 'C25(관찰) 720분을 넘는 기록은 입력 착오로 저장하지 않음(400)');
r = await run(t[2].id, '2026-09-24T00:00:00.000Z', '2026-09-24T12:00:00.000Z', null);
ok(r.status === 200 && r.data.actual_minutes === 720, 'C25(관찰) 딱 720분은 그대로 저장');
await api('DELETE', `/api/runs/${r.data.id}`);

const today = (await api('GET', '/api/meta')).data.today_kst;
r = await api('GET', `/api/review?plan_id=${P1}`);
const v = r.data;
const todosNow = (await api('GET', `/api/todos?plan_id=${P1}`)).data.rows;
ok(v.planned === todosNow.length && v.planned === 5, 'C28 계획된 할 일 수 = 딸린 할 일 수');
ok(v.done === todosNow.filter((x) => x.status === 'done').length, 'C29 완료 수');
const expectDelayed = todosNow.filter((x) => x.status !== 'done' && x.due_date && x.due_date < today).length;
ok(v.delayed === expectDelayed && v.delayed >= 1, `C30 지연 수 (오늘 ${today} 기준)`, `${v.delayed} vs ${expectDelayed}`);
ok(todosNow.find((x) => x.id === t[1].id).status === 'done' && todosNow.find((x) => x.id === t[0].id).due_date < today, 'C30 완료한 일(T2)은 지연 집계에서 빠지고 미완료·마감 지난 일(T1)만 셈');
ok(v.blocked === 1, 'C31 막힘 수 = 막힌 이유가 적힌 할 일 수');
ok(v.est_minutes === 60 + 90 + 120 + 45 + 0 && v.actual_minutes === 90 + 50 + 60 && v.diff_minutes === v.actual_minutes - v.est_minutes, 'C32 예상/실제/차이');
const empty = await api('POST', '/api/plans', { ...plan, title: '빈 계획' });
r = await api('GET', `/api/review?plan_id=${empty.data.plan.id}`);
ok(r.data.planned === 0 && r.data.diff_minutes === 0 && r.data.est_minutes === 0, 'C32 아무것도 없으면 0');
for (const m of ['planned', 'done', 'delayed', 'blocked', 'est', 'actual']) {
  const rec = await api('GET', `/api/review/records?plan_id=${P1}&metric=${m}`);
  const n = rec.data.rows.length;
  const want = { planned: v.planned, done: v.done, delayed: v.delayed, blocked: 1, est: v.planned, actual: 3 }[m];
  ok(rec.status === 200 && n === want, `C83 '${m}' 숫자를 누르면 근거 기록 ${want}건으로 이동`, `${n}`);
}
r = await api('POST', '/api/plans', { ...plan, title: '다음 계획', period_start: '2026-09-28', period_end: '2026-10-04', carried_from_plan_id: P1, carried_note: '예상 시간을 20% 더 잡기' });
ok(r.data.plan.carried_from_plan_id === P1 && r.data.plan.carried_note === '예상 시간을 20% 더 잡기' && r.data.carried_from.id === P1, 'C33 고칠 점 한 줄이 다음 계획으로 넘어감');
r = await api('GET', `/api/review?plan_id=${P1}`);
ok(r.data.carried_to.length === 1, 'C33 돌아보기에 넘긴 기록이 보임');

const evil = '<script>alert(1)</script>';
r = await api('POST', '/api/todos', { plan_id: P1, title: evil, tags: ['<b>x</b>'] });
ok(r.data.title === evil && r.data.tags[0] === '<b>x</b>', 'C57 스크립트 모양 글자가 변형 없이 저장');
const back = await api('GET', '/api/todos?q=script');
ok(back.data.rows[0].title === evil, 'C57 다시 읽어도 글자 그대로');
r = await api('DELETE', `/api/todos/${t[2].id}`);
ok(r.status === 200 && (await api('GET', '/api/runs?todo_id=' + t[2].id)).data.rows.length === 0, 'C13 할 일 삭제(딸린 기록도 함께 삭제)');
ok((await api('GET', '/api/todos')).data.rows.every((x) => x.id !== t[2].id), '삭제한 할 일은 목록에서 사라짐');
r = await api('GET', '/api/export');
ok(r.status === 200 && r.data.plans.length === 3 && r.data.todos.length >= 5 && r.data.runs.length >= 1 && r.data.plan_revisions.length >= 4 && r.data.schema_version === 3, 'C36·C133 전체 내보내기(계획·이력·할 일·태그·실행기록·완료)');
ok(!JSON.stringify(r.data).match(/pw_hash|pw_salt|token_hash|password/i) && r.data.account.login_id === ID_A, 'C133 내보낸 파일에 비밀번호 값·세션 값이 없음(계정 아이디만)');
const late = (await api('POST', '/api/todos', { plan_id: P1, title: '마감 지난 일', due_date: '2026-09-01' })).data;
const d1 = (await api('GET', `/api/review?plan_id=${P1}`)).data.delayed;
await api('POST', `/api/todos/${late.id}/complete`);
const d2 = (await api('GET', `/api/review?plan_id=${P1}`)).data.delayed;
ok(d2 === d1 - 1, 'C30 마감이 지난 할 일을 완료하면 지연 수에서 빠짐(이중 집계 없음)', `${d1} -> ${d2}`);
r = await api('POST', '/api/todos', { plan_id: 999999, title: 'x' });
ok(r.status === 404, '없는 계획에는 할 일을 못 만듦(404)');
r = await api('POST', '/api/plans', 'not json');
ok(r.status === 400, '잘못된 JSON 거부');
r = await api('GET', '/api/nope');
ok(r.status === 404, '로그인한 뒤 없는 주소는 404');

// =====================================================================================
// 3. 남의 자료 차단 (카드 4: T07-C116~C126) — 계정 두 개, 양방향
// =====================================================================================
B.cookie = null;
r = await call(B, 'POST', '/api/auth/login', { login_id: ID_B, password: PW_SAME });
ok(r.status === 200 && B.cookie, 'C116 계정 B 로그인');
const bPlan = (await apiB('POST', '/api/plans', { ...plan, title: 'B의 비밀 계획' })).data.plan;
const bTodo = (await apiB('POST', '/api/todos', { plan_id: bPlan.id, title: 'B의 비밀 할 일', tags: ['b-only'] })).data;
const bRun = (await apiB('POST', '/api/runs', { todo_id: bTodo.id, started_at: '2026-09-22T01:00:00.000Z', ended_at: '2026-09-22T01:40:00.000Z', blocked_reason: 'B만의 막힘' })).data;
await apiB('POST', `/api/todos/${bTodo.id}/complete`);
const aPlan = (await api('POST', '/api/plans', { ...plan, title: 'A의 비밀 계획' })).data.plan;
const aTodo = (await api('POST', '/api/todos', { plan_id: aPlan.id, title: 'A의 비밀 할 일', tags: ['a-only'] })).data;
const aRun = (await api('POST', '/api/runs', { todo_id: aTodo.id, started_at: '2026-09-22T05:00:00.000Z', ended_at: '2026-09-22T05:20:00.000Z', blocked_reason: 'A만의 막힘' })).data;
ok(bPlan.id && bTodo.id && bRun.id && aPlan.id && aTodo.id && aRun.id, 'C116 계정 두 개가 각각 계획·할 일·실행 기록을 넣음');
const snap = async (fn) => { const e = (await fn('GET', '/api/export')).data; delete e.exported_at; return JSON.stringify(e); };
const snapA0 = await snap(api), snapB0 = await snap(apiB);

async function attack(name, jar, other) {
  const c = (m, p, b, o) => call(jar, m, p, b, o);
  let x = await c('GET', `/api/plans/${other.plan}`);
  ok(x.status === 404 && !JSON.stringify(x.data).includes('비밀'), `C117 ${name}: 남의 계획 읽기 → 404, 내용 없음`, JSON.stringify(x));
  x = await c('PUT', `/api/plans/${other.plan}`, { ...plan, title: '탈취' });
  ok(x.status === 404, `C118 ${name}: 남의 계획 고치기 → 404`);
  x = await c('PUT', `/api/todos/${other.todo}`, { title: '탈취', priority: 1 });
  ok(x.status === 404, `C118 ${name}: 남의 할 일 고치기 → 404`);
  x = await c('DELETE', `/api/todos/${other.todo}`);
  ok(x.status === 404, `C119 ${name}: 남의 할 일 지우기 → 404`);
  x = await c('DELETE', `/api/runs/${other.run}`);
  ok(x.status === 404, `C119 ${name}: 남의 실행 기록 지우기 → 404`);
  x = await c('POST', `/api/todos/${other.todo}/complete`);
  ok(x.status === 404, `C118 ${name}: 남의 할 일 완료 처리 → 404`);
  x = await c('POST', `/api/todos/${other.todo}/reopen`);
  ok(x.status === 404, `C118 ${name}: 남의 할 일 되돌리기 → 404`);
  x = await c('POST', '/api/runs', { todo_id: other.todo, started_at: '2026-09-25T01:00:00.000Z', ended_at: '2026-09-25T02:00:00.000Z' });
  ok(x.status === 404, `${name}: 남의 할 일에 실행 기록 붙이기 → 404`);
  x = await c('POST', '/api/todos', { plan_id: other.plan, title: '끼워넣기' });
  ok(x.status === 404, `${name}: 남의 계획에 할 일 끼워넣기 → 404`);
  x = await c('POST', '/api/plans', { ...plan, title: '가져오기', carried_from_plan_id: other.plan, carried_note: 'x' });
  ok(x.status === 404, `${name}: 남의 계획을 이전 계획으로 잇기 → 404`);
  x = await c('GET', `/api/review?plan_id=${other.plan}`);
  ok(x.status === 404, `${name}: 남의 계획의 돌아보기 → 404`);
  x = await c('GET', `/api/review/records?plan_id=${other.plan}&metric=planned`);
  ok(x.status === 404, `${name}: 남의 계획의 근거 기록 → 404`);
  x = await c('GET', `/api/runs?todo_id=${other.todo}`);
  ok(x.status === 200 && x.data.rows.length === 0, `C122 ${name}: 남의 할 일의 실행 기록을 물어도 빈 목록`);
}
await attack('A→B', A, { plan: bPlan.id, todo: bTodo.id, run: bRun.id });
await attack('B→A', B, { plan: aPlan.id, todo: aTodo.id, run: aRun.id });
ok((await snap(apiB)) === snapB0 && (await snap(api)) === snapA0, 'C120·C122 양방향 거절 시도가 끝난 뒤 A·B 각자의 자료(내보내기 전체)가 시도 전과 똑같음 — 건수·내용 모두');

// 주소·헤더·본문에 다른 계정을 적어도 내 자료만 (C123)
r = await call(A, 'GET', `/api/plans?user_id=${'2'}&owner=${ID_B}`, undefined, { headers: { 'x-user-id': '2', 'x-login-id': ID_B, authorization: `Bearer ${B.cookie}` } });
ok(r.status === 200 && r.data.rows.every((p) => p.title !== 'B의 비밀 계획'), 'C123 주소(?user_id=)·헤더(X-User-Id, Authorization)에 B 를 적어도 A 의 자료만 돌아옴');
r = await call(A, 'POST', '/api/plans', { ...plan, title: '본문에 B 적기', user_id: 2, owner: ID_B, login_id: ID_B });
const asB = (await apiB('GET', '/api/plans')).data.rows.map((p) => p.title);
ok(r.status === 200 && !asB.includes('본문에 B 적기') && (await api('GET', '/api/plans')).data.rows.some((p) => p.title === '본문에 B 적기'), 'C123 본문에 user_id/아이디를 B 로 적어도 A 의 계획으로만 만들어짐');
r = await call(A, 'GET', `/api/todos?plan_id=${bPlan.id}`);
ok(r.status === 200 && r.data.rows.length === 0, 'C123 A 가 B 의 plan_id 로 할 일 목록을 물어도 빈 목록');

// 목록 안 섞임 (C125)
const listA = (await api('GET', '/api/todos')).data.rows, listB = (await apiB('GET', '/api/todos')).data.rows;
ok(listA.every((x) => x.title !== 'B의 비밀 할 일' && !x.tags.includes('b-only')) && listB.length === 1 && listB[0].title === 'B의 비밀 할 일', 'C125 할 일 목록에 남의 자료가 하나도 없음(A 목록에 B 없음, B 목록은 B 것 1건)');
const exA = JSON.stringify((await api('GET', '/api/export')).data), exB = JSON.stringify((await apiB('GET', '/api/export')).data);
ok(!exA.includes('B의 비밀') && !exA.includes('B만의 막힘') && !exB.includes('A의 비밀') && !exB.includes('A만의 막힘'), 'C125 내보내기·집계에도 남의 자료가 섞이지 않음');
ok((await api('GET', '/api/tags')).data.rows.every((g) => g.tag !== 'b-only') && (await apiB('GET', '/api/tags')).data.rows.map((g) => g.tag).join() === 'b-only', 'C125 태그 목록도 각자 것만');
ok((await apiB('GET', '/api/review')).data.planned === 1 && (await apiB('GET', '/api/meta')).data.counts.plans === 1, 'C125 돌아보기 집계·현황 숫자도 각자 것만(B 는 계획 1·할 일 1)');
ok((await apiB('GET', '/api/runs')).data.rows.length === 1 && (await apiB('GET', '/api/runs')).data.rows[0].id === bRun.id, 'C125 실행 기록 목록도 각자 것만');

// =====================================================================================
// 4. 5일 관찰 (카드 5: T07-C04~C15, C23~C27, C132)
// =====================================================================================
// 순수 계산: 손으로 더한 값과 대조
const dm = { '2026-09-28': { value: 30, records: 1 }, '2026-09-29': { value: 45, records: 2 }, '2026-10-01': { value: 60, records: 1 }, '2026-10-02': { value: 20, records: 1 }, '2026-10-03': { value: 25, records: 1 } };
const o = buildObservation({
  setup: { locked_on: '2026-09-28' },
  rules: [{ version: 1, changed_on: '2026-09-28' }, { version: 2, changed_on: '2026-09-30' }],
  dayMap: dm, today: '2026-10-03'
});
ok(o.data_days === 5 && o.days.length === 6 && o.days.find((d) => d.date === '2026-09-30').value === null, 'C23 기록이 없는 날(9/30)은 0이 아니라 "기록 없음"(null)이고 일수에서 빠짐');
ok(o.groups.before.days === 2 && o.groups.before.total === 75 && o.groups.before.avg === 37.5, 'C132 변경 전 = (30+45) ÷ 2일 = 37.5 (손 계산과 같음)', JSON.stringify(o.groups.before));
ok(o.groups.after.days === 3 && o.groups.after.total === 105 && o.groups.after.avg === 35, 'C132 변경 후 = (60+20+25) ÷ 3일 = 35.0 (손 계산과 같음)', JSON.stringify(o.groups.after));
ok(o.overall.days === 5 && o.overall.total === 180 && o.overall.avg === 36, 'C132 5일 전체 = 180 ÷ 5일 = 36.0');
ok(o.days.filter((d) => d.group === 'before').map((d) => d.date).join() === '2026-09-28,2026-09-29' && o.days.filter((d) => d.group === 'after').map((d) => d.date).join() === '2026-10-01,2026-10-02,2026-10-03', 'C12 변경 기록이 1·2일차와 3~5일차를 정확히 가름');
ok(o.days[0].week_start === '2026-09-28' && o.days[5].week_start === '2026-09-28' && weekStartMon('2026-10-04') === '2026-09-28' && weekStartMon('2026-10-05') === '2026-10-05', 'C27 주 시작 요일은 월요일(일요일 10/4 도 9/28 주, 10/5 는 새 주)');
ok(summarize([1, 2]).avg === 1.5 && summarize([1, 1, 2]).avg === 1.3 && summarize([2, 2, 3]).avg === 2.3 && summarize([1, 1, 1, 2]).avg === 1.3 && summarize([]).avg === null && summarize([7]).avg === 7, 'C26 반올림: 1.333→1.3, 2.333→2.3, 1.25→1.3(0.05 이상 올림), 한 날만 있으면 그 값');
ok(kstDate('2026-09-29T15:30:00.000Z') === '2026-09-30' && kstDate('2026-09-29T14:59:00.000Z') === '2026-09-29', 'C07 하루의 경계는 서울 자정(UTC 15:00)');

// HTTP: 관찰 전용 계정 O 로(다른 검사의 실행 기록이 섞이지 않게)
const O = newJar(), PW_O = `Oo6-${rnd()}`, ID_O = `tester-o-${rnd().slice(0, 6)}`;
await call(O, 'POST', '/api/auth/signup', { login_id: ID_O, password: PW_O });
const apiO = (m, p, b) => call(O, m, p, b);
const oPlan = (await apiO('POST', '/api/plans', plan)).data.plan;
r = await apiO('GET', '/api/observation');
ok(r.status === 200 && r.data.setup === null && r.data.can_change.ok === false && r.data.policy.missing && r.data.policy.duplicate && r.data.policy.outlier && r.data.policy.rounding && r.data.policy.week_start, 'C23~C27 처리 규칙이 서버 응답(화면)에 글로 있음');
r = await apiO('POST', '/api/observation', { question: '질문\n두 줄', metric: 'run_minutes', plan_rule: '규칙' });
ok(r.status === 400, 'C04 질문은 한 문장(줄바꿈 거부)');
r = await apiO('POST', '/api/observation', { question: '질문', metric: 'weight', plan_rule: '규칙' });
ok(r.status === 400, 'C05 정해진 지표 중에서만 고를 수 있음');
r = await apiO('POST', '/api/observation/rule-change', { rule_text: 'x', reason: 'y' });
ok(r.status === 409, 'C09 정하기 전에는 규칙 변경 불가(409)');
r = await apiO('POST', '/api/observation', { question: '하루에 실제로 몇 분 했나?', metric: 'run_minutes', plan_rule: '하루에 할 일 3개까지만 잡는다' });
ok(r.status === 200 && r.data.setup.question === '하루에 실제로 몇 분 했나?' && r.data.setup.unit === '분' && r.data.rules.length === 1 && r.data.rules[0].version === 1 && r.data.setup.locked_on === today, 'C04~C06 1일차에 질문·지표·단위·계획 규칙이 정해지고 기록됨', JSON.stringify(r.data.setup));
r = await apiO('POST', '/api/observation', { question: '다른 질문', metric: 'done_count', plan_rule: '다른 규칙' });
ok(r.status === 409 && (await apiO('GET', '/api/observation')).data.setup.question === '하루에 실제로 몇 분 했나?', 'C04~C06 정한 질문·지표·단위는 고칠 수 없음(409, 값 그대로)');
r = await apiO('POST', '/api/observation/rule-change', { rule_text: '새 규칙', reason: '이유' });
ok(r.status === 409, 'C09 관찰 시작일 이후 기록이 없으면 규칙 변경 불가(409)');
local(() => raw.prepare('UPDATE observation SET locked_on = ? WHERE user_id = (SELECT id FROM users WHERE login_id = ?)').run('2026-09-20', ID_O));
if (!BASE) {
  const kstIso = (d, hm) => new Date(`${d}T${hm}:00+09:00`).toISOString();
  const nt = (await apiO('POST', '/api/todos', { plan_id: oPlan.id, title: '관찰용 할 일' })).data;
  const seedRun = (d, hm, mins) => apiO('POST', '/api/runs', { todo_id: nt.id, started_at: kstIso(d, hm), ended_at: new Date(new Date(kstIso(d, hm)).getTime() + mins * 60000).toISOString() });
  await seedRun('2026-09-19', '10:00', 500 / 10); // 관찰 시작일 이전 → 세지 않음
  await seedRun('2026-09-21', '23:30', 45);       // 자정을 넘기는 기록도 시작한 날(9/21)에
  await seedRun('2026-09-21', '08:00', 30);
  await seedRun('2026-09-22', '09:00', 20);
  r = await apiO('GET', '/api/observation');
  const d21 = r.data.days.find((d) => d.date === '2026-09-21'), d22 = r.data.days.find((d) => d.date === '2026-09-22'), d20 = r.data.days.find((d) => d.date === '2026-09-20');
  ok(d21.value === 75 && d21.records === 2 && d22.value === 20 && d20.value === null, 'C07·C08 서울 날짜별 합계(9/21 = 30+45 = 75, 자정 넘긴 기록은 시작한 날) · 기록 없는 날 null', JSON.stringify([d20, d21, d22]));
  ok(r.data.days.every((d) => d.date >= '2026-09-20') && r.data.data_days === 2, 'C07 관찰 시작일 이전(9/19)의 기록은 세지 않음 — 기록 있는 날 2일');
  ok(r.data.can_change.ok === true, 'C09 오늘 기록이 아직 없고 지난 기록이 있으면 규칙 변경 가능');
  const todayRunRow = (await seedRun(today, '00:05', 5)).data;
  ok((await apiO('GET', '/api/observation')).data.can_change.ok === false && (await apiO('POST', '/api/observation/rule-change', { rule_text: '새 규칙', reason: '이유' })).status === 409, 'C09 오늘 이미 기록이 있으면 규칙 변경 불가(변경은 3일차 기록 전에)');
  await apiO('DELETE', `/api/runs/${todayRunRow.id}`);
  r = await apiO('POST', '/api/observation/rule-change', { rule_text: '하루에 할 일 3개까지만 잡는다', reason: '같은 규칙' });
  ok(r.status === 400, 'C09 기존 규칙과 같은 문장으로는 변경 불가');
  r = await apiO('POST', '/api/observation/rule-change', { rule_text: '하루에 할 일 2개까지만 잡는다', reason: '' });
  ok(r.status === 400, 'C11 바꾼 이유는 필수');
  r = await apiO('POST', '/api/observation/rule-change', { rule_text: '하루에 할 일 2개까지만 잡는다', reason: '3개는 너무 많아서 끝내지 못한 날이 많았다' });
  const ch = r.data.rules.find((x) => x.version === 2);
  ok(r.status === 200 && ch && ch.changed_at && ch.changed_on === today && ch.reason.includes('너무 많아서') && ch.before_dates.join() === '2026-09-21,2026-09-22', 'C09~C12 규칙 변경 기록: 바꾼 시각·이유·"이 날짜들의 기록 뒤"(9/21, 9/22)가 함께 남음', JSON.stringify(ch));
  ok(r.data.rules.find((x) => x.version === 1).rule_text === '하루에 할 일 3개까지만 잡는다', 'C09 처음 규칙(v1)도 그대로 남음');
  r = await apiO('POST', '/api/observation/rule-change', { rule_text: '또 다른 규칙', reason: '한 번만 바꿀 수 있음' });
  ok(r.status === 409, 'C09 규칙은 한 번만 바꿀 수 있음(409)');
  await seedRun(today, '10:00', 60);
  r = await apiO('GET', '/api/observation');
  ok(r.data.groups.before.days === 2 && r.data.groups.before.total === 95 && r.data.groups.before.avg === 47.5 && r.data.groups.after.days === 1 && r.data.groups.after.total === 60 && r.data.groups.after.avg === 60, 'C13~C15 변경 전(9/21·9/22 = 75+20 ÷ 2 = 47.5)과 변경 후(오늘 60분)를 같은 지표·같은 단위·같은 계산으로 비교', JSON.stringify(r.data.groups));
  ok(r.data.groups.before.formula.includes('75 + 20 = 95') && r.data.setup.unit === '분', 'C132 화면의 계산식이 손으로 더한 값과 같음');
}
const exObs = (await apiO('GET', '/api/export')).data;
ok(exObs.observation.length === 1 && exObs.plan_rules.length >= 1 && !JSON.stringify(exObs).includes('user_id'), 'C133 내보내기에 관찰 설정·규칙 기록이 들어감');

// =====================================================================================
// 5. 계정 삭제 (C134)
// =====================================================================================
r = await call(B, 'DELETE', '/api/auth/account', { password: 'x' + PW_SAME });
ok(r.status === 401 && (await apiB('GET', '/api/plans')).data.rows.length === 1, 'C134 비밀번호가 틀리면 계정 삭제 거절, 자료 그대로');
const countA = async () => (await api('GET', '/api/meta')).data.counts;
const cA0 = JSON.stringify(await countA());
const bCookieOld = B.cookie;
r = await call(B, 'DELETE', '/api/auth/account', { password: PW_SAME });
ok(r.status === 200 && r.data.deleted === true && B.cookie === null, 'C134 계정 삭제 성공');
ok((await call(null, 'GET', '/api/plans', undefined, { cookie: bCookieOld })).status === 401, 'C134 삭제한 계정의 로그인 값은 더 통하지 않음');
ok((await call(newJar(), 'POST', '/api/auth/login', { login_id: ID_B, password: PW_SAME })).status === 401, 'C134 삭제한 계정으로는 로그인 안 됨');
local(() => {
  const n = (sql, ...p) => raw.prepare(sql).get(...p).n;
  ok(n('SELECT COUNT(*) AS n FROM plans WHERE title = ?', 'B의 비밀 계획') === 0 && n('SELECT COUNT(*) AS n FROM todos WHERE title = ?', 'B의 비밀 할 일') === 0 && n('SELECT COUNT(*) AS n FROM runs WHERE blocked_reason = ?', 'B만의 막힘') === 0 && n('SELECT COUNT(*) AS n FROM todo_tags WHERE tag = ?', 'b-only') === 0, 'C134 계정을 지우면 딸린 계획·할 일·실행 기록·태그도 함께 지워짐');
  ok(n('SELECT COUNT(*) AS n FROM users WHERE login_id = ?', ID_B) === 0 && n('SELECT COUNT(*) AS n FROM sessions WHERE user_id NOT IN (SELECT id FROM users)') === 0, 'C134 계정·세션 행도 없음');
});
ok(JSON.stringify(await countA()) === cA0 && (await api('GET', '/api/plans')).status === 200, 'C134 다른 계정(A)의 자료는 그대로');

// =====================================================================================
// 6. 6번 자료가 든 DB 에 0002 를 적용해도 자료가 남고, 내 계정으로 옮길 수 있다 (C100)
// =====================================================================================
if (!BASE) {
  const legacy = createD1(':memory:', read('../migrations/0001_init.sql'));
  legacy.raw.exec(`INSERT INTO plans (title, period_start, period_end, priority, success_criteria, est_minutes, created_at, updated_at) VALUES ('6번에 넣어 둔 계획','2026-09-22','2026-09-22',1,'10km 달리기',60,'2026-09-22T00:52:38.957Z','2026-09-22T00:52:38.957Z');
    INSERT INTO plan_revisions (plan_id, revision_no, title, period_start, period_end, priority, success_criteria, est_minutes, recorded_at) VALUES (1,1,'6번에 넣어 둔 계획','2026-09-22','2026-09-22',1,'10km 달리기',60,'2026-09-22T00:52:38.957Z');
    INSERT INTO todos (plan_id, title, status, due_date, priority, est_minutes, created_at, updated_at) VALUES (1,'러닝','todo','2026-09-22',1,60,'2026-09-22T00:53:13.950Z','2026-09-22T00:53:13.950Z');
    INSERT INTO todo_tags (todo_id, tag) VALUES (1,'운동');
    INSERT INTO runs (todo_id, started_at, ended_at, actual_minutes, blocked_reason, created_at) VALUES (1,'2026-09-22T03:48:00.000Z','2026-09-22T04:33:00.000Z',45,NULL,'2026-09-22T03:50:50.933Z');
    INSERT INTO completions (todo_id, completed_at) VALUES (1,'2026-09-22T00:53:49.851Z');`);
  legacy.raw.exec(read('../migrations/0002_auth.sql'));
  const lenv = { DB: legacy };
  const L = newJar();
  const lcall = async (m, p, b) => { const rr = await worker.fetch(new Request('http://x' + p, { method: m, headers: { 'content-type': 'application/json', ...(L.cookie ? { cookie: 'sid=' + L.cookie } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) }), lenv); const sc = rr.headers.get('set-cookie'); if (sc) L.cookie = /^sid=([^;]*)/.exec(sc)[1] || null; return { status: rr.status, data: await rr.json() }; };
  ok(legacy.raw.prepare('SELECT COUNT(*) AS n FROM plans WHERE user_id IS NULL').get().n === 1 && legacy.raw.prepare('SELECT COUNT(*) AS n FROM todo_view').get().n === 1, 'C100 0002 를 적용해도 6번 자료(계획·할 일·기록)가 그대로 남고 주인만 비어 있음');
  await lcall('POST', '/api/auth/signup', { login_id: 'claim-me', password: `Ee5-${rnd()}` });
  ok((await lcall('GET', '/api/plans')).data.rows.length === 0 && (await lcall('GET', '/api/todos')).data.rows.length === 0, 'C100 주인 없는 6번 자료는 새로 가입한 계정에도 보이지 않음');
  legacy.raw.exec("UPDATE plans SET user_id = (SELECT id FROM users WHERE login_id = 'claim-me') WHERE user_id IS NULL");
  const moved = await lcall('GET', '/api/plans');
  const movedTodos = (await lcall('GET', '/api/todos')).data.rows, movedRuns = (await lcall('GET', '/api/runs')).data.rows, movedRev = (await lcall('GET', '/api/plans/1')).data.revisions;
  ok(moved.data.rows.length === 1 && moved.data.rows[0].title === '6번에 넣어 둔 계획' && movedTodos.length === 1 && movedTodos[0].status === 'done' && movedTodos[0].tags.join() === '운동' && movedRuns.length === 1 && movedRuns[0].actual_minutes === 45 && movedRev.length === 1, 'C100 한 줄 UPDATE 로 6번 자료(계획·이력·할 일·태그·완료·실행 기록)가 내 계정으로 옮겨져 그대로 보임');
}

// =====================================================================================
// 7. 로그·응답에 비밀번호 원문이 없다 (C105·C106·C131)
// =====================================================================================
const secrets = [PW_A, PW_B, PW_A2, PW_SAME, PW_O];
ok(!responses.some((t) => secrets.some((p) => t.includes(p))), 'C105·C106 지금까지의 모든 응답 본문에 비밀번호 원문이 없음', `${responses.length}개 응답 검사`);
ok(!logs.some((t) => secrets.some((p) => t.includes(p))), 'C105·C106 서버가 남긴 로그(오류·경고 등)에 비밀번호 원문이 없음', `${logs.length}줄 검사`);

if (BASE) { // 검사용 계정 정리
  await call(A, 'DELETE', '/api/auth/account', { password: PW_A2 });
  await call(jarC, 'DELETE', '/api/auth/account', { password: PW_SAME });
  await call(O, 'DELETE', '/api/auth/account', { password: PW_O });
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
