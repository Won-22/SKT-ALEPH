// 제출용 증거 기록을 만든다: 성공한 요청과 거절된 요청을 나란히, 비밀값(비밀번호·로그인 값)은 가려서 마크다운으로 출력한다.
//   로컬(메모리 DB, 저장된 비밀번호 값도 함께 보여 줌):  node scripts/evidence.mjs > docs/evidence/local-run.md
//   배포 서버(검사용 계정 2개를 만들고 KEEP=1 이면 남겨 둠):  BASE_URL=https://... [KEEP=1] node scripts/evidence.mjs
// 계정 아이디는 evid-로 시작하고 비밀번호는 실행마다 무작위로 만들어 메모리에서만 쓴다(출력에는 가려서 나온다).
import fs from 'node:fs';
import crypto from 'node:crypto';
import worker from '../src/worker.js';
import { createD1 } from './d1-shim.mjs';

const BASE = process.env.BASE_URL;
const KEEP = process.env.KEEP === '1';
const env = BASE ? null : { DB: createD1(':memory:', fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')) };
const out = [];
const w = (s = '') => out.push(s);
const rnd = (n) => crypto.randomBytes(n).toString('hex');

const idA = `evid-a-${rnd(3)}`, idB = `evid-b-${rnd(3)}`, PW = `Ev1-${rnd(9)}`; // 두 계정이 같은 비밀번호를 쓴다(카드 2)
const mask = (v) => (v && v.length > 6 ? v.slice(0, 4) + '…(가림)' : v);
const maskBody = (o) => JSON.parse(JSON.stringify(o, (k, v) => (/password/i.test(k) ? '●●●●●●●●(가림)' : v)));
const showSetCookie = (sc) => (sc ? sc.replace(/^(sid=)([^;]*)/, (_, a, b) => a + (b ? mask(b) : '(비어 있음 = 삭제)')) : null);

const jarA = { c: null }, jarB = { c: null };
let n = 0;
async function call(label, jar, method, path, body, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const cookie = opts.cookie !== undefined ? opts.cookie : jar && jar.c;
  if (cookie) headers.cookie = `sid=${cookie}`;
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  const r = BASE ? await fetch(BASE + path, init) : await worker.fetch(new Request('https://evidence.local' + path, init), env);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  const sc = r.headers.get('set-cookie');
  if (jar && !opts.keep && sc) { const m = /^sid=([^;]*)/.exec(sc); if (m) jar.c = m[1] || null; }
  const shownHeaders = Object.entries(opts.headers || {}).map(([k, v]) => `${k}: ${/authorization|cookie/i.test(k) ? mask(String(v)) : v}`);
  w(`**${++n}. ${label}**`);
  w('```');
  w(`${method} ${path}`);
  if (cookie) w(`Cookie: sid=${mask(cookie)}`);
  shownHeaders.forEach((h) => w(h));
  if (body !== undefined) w(`본문: ${JSON.stringify(maskBody(body))}`);
  w(`→ ${r.status}`);
  if (sc) w(`Set-Cookie: ${showSetCookie(sc)}`);
  const shown = typeof data === 'string' ? data : JSON.stringify(maskBody(data));
  w(`응답: ${shown.length > 420 ? shown.slice(0, 420) + ' …(줄임)' : shown}`);
  w('```');
  return { status: r.status, data, sc };
}

w(`# T07 인증 증거 기록 (${BASE ? '배포 서버 ' + BASE : '로컬 서버 · 같은 Worker 코드'})`);
w();
w(`실행 시각: ${new Date().toISOString()} · 계정: \`${idA}\`, \`${idB}\` (이 기록을 위해 만든 검사용 계정) · 비밀번호·로그인 값은 앞 4글자만 보이고 가렸습니다.`);
w();

w('## 카드 1·4 준비: 계정 두 개를 만들고 각각 자료를 넣음');
await call('계정 A 가입', jarA, 'POST', '/api/auth/signup', { login_id: idA, password: PW });
await call('계정 B 가입 (A 와 같은 비밀번호)', jarB, 'POST', '/api/auth/signup', { login_id: idB, password: PW });
const plan = { period_start: '2026-09-29', period_end: '2026-10-05', priority: 2, success_criteria: '증거 기록용', est_minutes: 60 };
const pa = (await call('A 가 계획 넣기', jarA, 'POST', '/api/plans', { ...plan, title: 'A의 계획' })).data.plan;
const ta = (await call('A 가 할 일 넣기', jarA, 'POST', '/api/todos', { plan_id: pa.id, title: 'A의 할 일' })).data;
const pb = (await call('B 가 계획 넣기', jarB, 'POST', '/api/plans', { ...plan, title: 'B의 계획' })).data.plan;
const tb = (await call('B 가 할 일 넣기', jarB, 'POST', '/api/todos', { plan_id: pb.id, title: 'B의 할 일' })).data;
const count = async (jar) => { const r = await call('(건수 확인) 내 계획·할 일 수', jar, 'GET', '/api/meta'); return r.data.counts; };

w();
w('## 카드 4: 남의 자료가 안 열리는 것');
w(`### 성공한 요청 (자기 자료)`);
await call('A 가 자기 계획 읽기 → 성공', jarA, 'GET', `/api/plans/${pa.id}`);
w('### 건수 기록 (거절 시도 전)');
const beforeA = await count(jarA), beforeB = await count(jarB);
w(`시도 전: A = ${JSON.stringify(beforeA)}, B = ${JSON.stringify(beforeB)}`);
w();
w('### A 가 B 의 자료를 건드리는 요청 (모두 거절돼야 함)');
await call('A → B 의 계획 읽기', jarA, 'GET', `/api/plans/${pb.id}`);
await call('A → B 의 계획 고치기', jarA, 'PUT', `/api/plans/${pb.id}`, { ...plan, title: '탈취' });
await call('A → B 의 할 일 고치기', jarA, 'PUT', `/api/todos/${tb.id}`, { title: '탈취' });
await call('A → B 의 할 일 지우기', jarA, 'DELETE', `/api/todos/${tb.id}`);
w('### 반대 방향: B 가 A 의 자료를 건드리는 요청');
await call('B → A 의 계획 읽기', jarB, 'GET', `/api/plans/${pa.id}`);
await call('B → A 의 계획 고치기', jarB, 'PUT', `/api/plans/${pa.id}`, { ...plan, title: '탈취' });
await call('B → A 의 할 일 고치기', jarB, 'PUT', `/api/todos/${ta.id}`, { title: '탈취' });
await call('B → A 의 할 일 지우기', jarB, 'DELETE', `/api/todos/${ta.id}`);
w('### 주소·헤더·본문에 다른 계정을 적어 보냄 (그래도 내 자료만 돌아와야 함)');
await call('주소에 B 적기 (?user_id, ?owner)', jarA, 'GET', `/api/plans?user_id=2&owner=${idB}`);
await call('헤더에 B 적기 (X-User-Id, X-Login-Id)', jarA, 'GET', '/api/plans', undefined, { headers: { 'x-user-id': '2', 'x-login-id': idB } });
const bodyTamper = await call('본문에 B 적기 (user_id, owner)', jarA, 'POST', '/api/plans', { ...plan, title: 'A가 만든 계획(본문에 B 적음)', user_id: 2, owner: idB });
const bSees = await call('그 계획이 B 목록에 생겼는지', jarB, 'GET', '/api/plans');
w(`→ B 목록에 "A가 만든 계획(본문에 B 적음)" 이 있는가: **${bSees.data.rows.some((p) => p.title.startsWith('A가 만든')) ? '있다(문제)' : '없다(정상)'}**`);
w('### 로그인하지 않은 채로 직접 요청');
await call('로그인 없이 계획 목록', null, 'GET', '/api/plans');
await call('로그인 없이 남의 계획 ID 직접', null, 'GET', `/api/plans/${pb.id}`);
w('### 목록 응답에 남의 자료가 섞이는지');
const la = await call('A 의 할 일 목록', jarA, 'GET', '/api/todos');
const lb = await call('B 의 할 일 목록', jarB, 'GET', '/api/todos');
w(`→ A 목록의 제목: ${JSON.stringify(la.data.rows.map((x) => x.title))} / B 목록의 제목: ${JSON.stringify(lb.data.rows.map((x) => x.title))} — 서로의 것이 하나도 없음: **${!la.data.rows.some((x) => x.title.startsWith('B')) && !lb.data.rows.some((x) => x.title.startsWith('A')) ? '맞다' : '아니다(문제)'}**`);
w('### 거절 전후 건수 비교 (거절하기 전에 저장부터 하고 있지 않은지)');
const afterA = await count(jarA), afterB = await count(jarB);
w(`시도 후: A = ${JSON.stringify(afterA)}, B = ${JSON.stringify(afterB)}`);
w(`→ B 의 건수는 시도 전과 **${JSON.stringify(beforeB) === JSON.stringify(afterB) ? '같다' : '다르다(문제)'}**, A 는 본문 변조 요청으로 내 계획 1건이 늘어난 것만 다르다(계획 ${beforeA.plans} → ${afterA.plans}).`);
w();
w('### 거절을 만드는 소스 위치');
const src = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8').split('\n');
const at = (needle) => src.findIndex((l) => l.includes(needle)) + 1;
w(`- \`src/worker.js:${at('async function ownedPlan')}\` ownedPlan · \`:${at('async function ownedTodo')}\` ownedTodo · \`:${at('async function ownedRun')}\` ownedRun — 남의 자료와 없는 자료를 구분하지 않고 같은 404 를 던진다`);
w(`- \`src/worker.js:${at("const user = await currentUser(db, req);")}\` 로그인하지 않은 요청은 여기서 401 (가입·로그인·로그아웃·내 상태 확인만 그 앞에서 처리)`);
w(`- 목록·집계는 \`WHERE ... user_id = ?\` 로 걸러진다(listPlans·listTodos·listRuns·review·exportAll)`);

w();
w('## 카드 3: 들어온 사람을 기억하는 방식 (세션 쿠키)');
w('로그인 상태의 성공 응답과, 로그아웃한 뒤 **같은 주소·같은 방식·같은 값**으로 다시 요청한 거절 응답을 나란히 둡니다.');
const jarC = { c: null };
await call('로그인', jarC, 'POST', '/api/auth/login', { login_id: idA, password: PW });
const saved = jarC.c;
const okR = await call('로그인한 상태: 내 계획 목록 → 성공', jarC, 'GET', '/api/plans');
const me = await call('내 상태 확인 (만료 시각)', jarC, 'GET', '/api/auth/me');
await call('로그아웃', jarC, 'POST', '/api/auth/logout');
const noR = await call('로그아웃한 뒤 같은 값으로 같은 요청 → 거절', null, 'GET', '/api/plans', undefined, { cookie: saved });
w(`→ 두 요청은 주소(\`GET /api/plans\`)와 쿠키 값(\`sid=${mask(saved)}\`)이 같고 다른 것은 로그아웃 여부뿐이다: 성공 ${okR.status} / 거절 ${noR.status}`);
w(`- 사람을 알아보는 것: 서버가 발급한 무작위 세션 값(쿠키 \`sid\`, HttpOnly). 만료: ${me.data.session.ttl_days}일(위 응답의 expires_at). 주소창(URL)에는 실리지 않는다.`);
w('### 비밀번호를 바꾸면 이전 값이 끊기는지');
const jarD = { c: null }, jarE = { c: null };
await call('두 기기에서 로그인 (기기 1)', jarD, 'POST', '/api/auth/login', { login_id: idA, password: PW });
await call('두 기기에서 로그인 (기기 2)', jarE, 'POST', '/api/auth/login', { login_id: idA, password: PW });
const d0 = jarD.c, e0 = jarE.c;
const NEWPW = `Ev2-${rnd(9)}`;
await call('기기 1 에서 비밀번호 변경', jarD, 'POST', '/api/auth/password', { current_password: PW, new_password: NEWPW });
await call('기기 2 의 이전 값으로 요청 → 거절', null, 'GET', '/api/plans', undefined, { cookie: e0 });
await call('기기 1 의 이전 값으로 요청 → 거절', null, 'GET', '/api/plans', undefined, { cookie: d0 });
await call('기기 1 의 새 값으로 요청 → 성공', jarD, 'GET', '/api/plans');

w();
w('## 카드 2: 비밀번호를 어떻게 맡아 두는지');
if (env) {
  const rows = env.DB.raw.prepare('SELECT login_id, pw_algo, pw_iter, pw_salt, pw_hash FROM users ORDER BY id').all();
  w('DB 의 users 표에 실제로 저장된 값 (계정 A·B 는 **같은 비밀번호**로 만들었다):');
  w('```');
  rows.forEach((r) => w(`${r.login_id}\n  pw_algo = ${r.pw_algo}\n  pw_iter = ${r.pw_iter}\n  pw_salt = ${r.pw_salt}\n  pw_hash = ${r.pw_hash}`));
  w('```');
  const [a, b] = rows;
  w(`- 입력한 비밀번호 글자가 저장된 값에 보이는가: **${rows.some((r) => Object.values(r).some((v) => String(v).includes(PW))) ? '보인다(문제)' : '보이지 않는다'}**`);
  w(`- 같은 비밀번호인데 두 계정의 소금이 다른가: **${a.pw_salt !== b.pw_salt ? '다르다' : '같다(문제)'}**, 저장된 해시가 다른가: **${a.pw_hash !== b.pw_hash ? '다르다' : '같다(문제)'}**`);
} else {
  w('배포 서버의 DB 는 이 스크립트가 직접 읽지 않는다. 저장된 값은 `wrangler d1 execute pds-diary-2 --remote --command "SELECT login_id, pw_algo, pw_iter, pw_salt, pw_hash FROM users WHERE login_id LIKE \'evid-%\'"` 로 따로 확인한다.');
}
w('### 위 모든 요청·응답에 비밀번호 원문이 있는가');
const all = out.join('\n');
w(`**${[PW, NEWPW].some((p) => all.includes(p)) ? '있다(문제)' : '없다'}** — 이 문서 전체(가린 요청 본문·응답·Set-Cookie 포함)를 검사한 결과.`);

if (!KEEP) {
  await call('(정리) 계정 A 삭제', jarD, 'DELETE', '/api/auth/account', { password: NEWPW });
  await call('(정리) 계정 B 삭제', jarB, 'DELETE', '/api/auth/account', { password: PW });
}
console.log(out.join('\n'));
