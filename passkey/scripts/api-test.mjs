// 패스키 API 통합 검사(로컬, 메모리 DB, 시험용 가짜 기기): node scripts/api-test.mjs
import fs from 'node:fs';
import crypto from 'node:crypto';
import worker from '../src/worker.js';
import { createD1 } from './d1-shim.mjs';
import { createAuthenticator, b64u } from './soft-authenticator.mjs';

const HOST = 'pds-passkey.pds-diary.workers.dev';
const ORIGIN = `https://${HOST}`;
const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const env = { DB: createD1(':memory:', read('../schema.sql')) };
const raw = env.DB.raw;
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

const logs = [];
for (const k of ['error', 'warn', 'info', 'debug']) { const o = console[k].bind(console); console[k] = (...a) => { logs.push(a.map(String).join(' ')); o(...a); }; }
const sent = [];      // 서버로 나간 모든 요청 본문
const responses = []; // 서버가 돌려준 모든 응답 본문

async function call(jar, method, path, body, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const cookie = opts.cookie !== undefined ? opts.cookie : jar && jar.c;
  if (cookie) headers.cookie = `sid=${cookie}`;
  const text = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  if (text) sent.push(text);
  const r = await worker.fetch(new Request(ORIGIN + path, { method, headers, body: text }), env);
  const t = await r.text();
  responses.push(t);
  let data; try { data = JSON.parse(t); } catch { data = t; }
  const sc = r.headers.get('set-cookie');
  if (jar && !opts.keep && sc) { const m = /^sid=([^;]*)/.exec(sc); if (m) jar.c = m[1] || null; }
  return { status: r.status, data, sc };
}
const jar = () => ({ c: null });
const newDevice = () => createAuthenticator({ origin: ORIGIN, rpId: HOST });
const q = (sql, ...p) => raw.prepare(sql).get(...p);
const n = (sql, ...p) => q(sql, ...p).n;

async function register(j, handle, dev, name, o = {}) {
  const opt = await call(null, 'POST', '/api/register/options', { handle, passkey_name: name });
  if (opt.status !== 200) return { opt, v: opt };
  const resp = await dev.register(opt.data, o);
  const v = await call(j, 'POST', '/api/register/verify', { response: resp });
  return { opt, resp, v };
}
async function login(j, dev, o = {}) {
  const opt = await call(null, 'POST', '/api/login/options', {});
  const resp = await dev.assert(opt.data, o);
  const v = await call(j, 'POST', '/api/login/verify', { response: resp });
  return { opt, resp, v };
}

let r;
// =====================================================================================
// 카드 1 — 공개/비공개 가르기 (T08-C15~C18)
// =====================================================================================
const PRIVATE_ENDPOINTS = [['GET', '/api/private/items'], ['POST', '/api/private/items', {}], ['DELETE', '/api/private/items/1'], ['GET', '/api/passkeys'],
  ['POST', '/api/passkeys/options', {}], ['POST', '/api/passkeys/verify', {}], ['DELETE', '/api/passkeys/1']];
for (const [m, p, b] of PRIVATE_ENDPOINTS) {
  r = await call(null, m, p, b);
  ok(r.status === 401 && !JSON.stringify(r.data).match(/rows|title|body/), `C16·C17 패스키 없이 ${m} ${p} → 401 (내용 없음)`, JSON.stringify(r));
}
r = await call(null, 'GET', '/api/session');
ok(r.status === 200 && r.data.account === null, 'C15 로그인 전 내 상태는 account=null');

// =====================================================================================
// 카드 2 — 패스키 등록 (T08-C19~C26)
// =====================================================================================
const devA1 = newDevice(), devA2 = newDevice(), devB = newDevice();
const jarA = jar(), jarB = jar();
r = await call(null, 'POST', '/api/register/options', { handle: 'Bad Id!', passkey_name: 'x' });
ok(r.status === 400, 'C19 허용되지 않는 자리 이름 거부');
const o1 = await call(null, 'POST', '/api/register/options', { handle: 'spot-a', passkey_name: '이 PC (Windows Hello)' });
const o2 = await call(null, 'POST', '/api/register/options', { handle: 'spot-a', passkey_name: '이 PC (Windows Hello)' });
ok(o1.status === 200 && typeof o1.data.challenge === 'string' && o1.data.challenge.length >= 32, 'C19 서버가 등록 질문(challenge)을 만들어 보냄', JSON.stringify(o1));
ok(o1.data.challenge !== o2.data.challenge, 'C20 등록 요청마다 질문 값이 서로 다름');
ok(n("SELECT COUNT(*) AS n FROM challenges WHERE challenge IN (?, ?)", o1.data.challenge, o2.data.challenge) === 2, 'C19 질문을 서버가 확인할 때까지 보관함(DB 에 있음)');
const ch = q('SELECT created_at, expires_at FROM challenges WHERE challenge = ?', o1.data.challenge);
ok(new Date(ch.expires_at) - new Date(ch.created_at) === 120000, 'C19 질문 보관 시간은 2분(길게 두지 않음)');
ok(o1.data.rp.id === HOST && o1.data.authenticatorSelection.userVerification === 'required' && o1.data.authenticatorSelection.residentKey === 'required' && o1.data.attestation === 'none', '등록 옵션: 이 사이트 주소에 묶임 · 본인 확인(UV) 필수 · 기기에 저장되는 패스키(resident key)');
ok(n('SELECT COUNT(*) AS n FROM accounts') === 0 && n('SELECT COUNT(*) AS n FROM passkeys') === 0, 'C25 질문만 받고 등록을 마치지 않으면(취소) 계정·패스키가 하나도 저장되지 않음');

// 실패하는 등록들 (아무것도 저장되지 않아야 한다)
let resp = await newDevice().register(o1.data, { wrongOrigin: true });
r = await call(null, 'POST', '/api/register/verify', { response: resp });
ok(r.status === 400 && n('SELECT COUNT(*) AS n FROM accounts') === 0, '다른 사이트 주소로 서명된 등록은 거절, 저장 없음');
resp = await newDevice().register(o2.data, { uv: false });
r = await call(null, 'POST', '/api/register/verify', { response: resp });
ok(r.status === 400 && n('SELECT COUNT(*) AS n FROM accounts') === 0, '본인 확인(UV) 없는 등록은 거절, 저장 없음');
r = await register(null, 'spot-a', devA1, '이 PC (Windows Hello)'); // 새 질문으로 진짜 등록
const regA = r;
const sessA = r.v;
jarA.c = /^sid=([^;]*)/.exec(sessA.sc)[1];
ok(sessA.status === 201 && sessA.data.account.handle === 'spot-a', 'C21 등록이 끝나면 계정이 만들어지고 로그인됨', JSON.stringify(sessA));
const stored = q('SELECT * FROM passkeys WHERE account_id = (SELECT id FROM accounts WHERE handle = ?)', 'spot-a');
ok(stored && stored.credential_id === regA.resp.id && stored.public_key.length > 40 && stored.name === '이 PC (Windows Hello)', 'C21·C24 서버에 공개키가 저장되고 사람이 알아볼 수 있는 이름이 붙음', JSON.stringify(stored));
const privJwk = await crypto.subtle.exportKey('jwk', devA1.store.get(regA.resp.id).privateKey);
ok(!JSON.stringify(sent).includes(privJwk.d) && !JSON.stringify(responses).includes(privJwk.d) && !JSON.stringify(raw.prepare('SELECT * FROM passkeys').all()).includes(privJwk.d), 'C23 개인키(d 값)는 서버로 보낸 어떤 요청에도, 서버가 돌려준 어떤 응답에도, DB 에도 없음');
r = await call(null, 'POST', '/api/register/verify', { response: regA.resp });
ok(r.status === 400, '이미 쓴 등록 응답을 다시 보내면 거절(질문은 한 번만)');
r = await call(null, 'POST', '/api/register/options', { handle: 'spot-a' });
ok(r.status === 409, '이미 있는 자리 이름은 다시 만들 수 없음(409)');
r = await call(null, 'POST', '/api/register/options', { handle: 'spot-x' });
const expiredCh = r.data.challenge;
raw.prepare("UPDATE challenges SET expires_at = '2000-01-01T00:00:00.000Z' WHERE challenge = ?").run(expiredCh);
resp = await devB.register(r.data);
r = await call(null, 'POST', '/api/register/verify', { response: resp });
ok(r.status === 400 && n("SELECT COUNT(*) AS n FROM accounts WHERE handle = 'spot-x'") === 0, '2분이 지난 질문으로는 등록 불가');
let lr = await call(jarA, 'GET', '/api/passkeys');
ok(lr.status === 200 && lr.data.rows.length === 1 && lr.data.rows[0].name === '이 PC (Windows Hello)' && lr.data.rows[0].created_at && lr.data.rows[0].public_key === stored.public_key && lr.data.rows[0].is_current === true, 'C43 등록한 패스키 목록에 이름·등록 날짜·서버에 저장된 공개키가 보임');
ok(!JSON.stringify(lr.data).match(/password|private|"d"/i), 'C22 목록에는 공개키만 있고 비밀번호·개인키 값은 없음(비밀번호 칸 자체가 없음)');

// =====================================================================================
// 카드 3 — 패스키로 들어간다 (T08-C27~C35)
// =====================================================================================
const lo1 = await call(null, 'POST', '/api/login/options', {});
const lo2 = await call(null, 'POST', '/api/login/options', {});
ok(lo1.status === 200 && lo1.data.challenge && lo1.data.challenge !== lo2.data.challenge, 'C27·C28 로그인할 때도 서버가 매번 새 질문을 만들어 보냄(두 번 달랐음)');
ok(lo1.data.userVerification === 'required' && lo1.data.rpId === HOST, '로그인 옵션: 본인 확인 필수 · 이 사이트 주소');
const jarL = jar();
let a = await login(jarL, devA1);
ok(a.v.status === 200 && jarL.c && a.v.data.account.handle === 'spot-a', 'C29 서버가 저장해 둔 공개키로 서명을 확인한 뒤에만 통과 → 로그인 성공', JSON.stringify(a.v));
ok(/HttpOnly/.test(a.v.sc) && /SameSite=Strict/.test(a.v.sc) && /Max-Age=604800/.test(a.v.sc) && /Secure/.test(a.v.sc) && !JSON.stringify(a.v.data).includes(jarL.c), 'C32 로그인 뒤 사람을 알아보는 것은 세션 쿠키(HttpOnly·SameSite=Strict·Secure, 7일), 응답 본문·주소에 값이 실리지 않음', a.v.sc);
ok((await call(jarL, 'GET', '/api/private/items')).status === 200, '로그인 뒤 비공개 자리 요청이 통과');
ok(q('SELECT counter, last_used_at FROM passkeys WHERE credential_id = ?', regA.resp.id).counter === 1, '서명 횟수(counter)가 서버에 갱신됨');
// 실패한 서명들
a = await login(jar(), devA1, { tamper: true });
ok(a.v.status === 401 && !a.v.sc && a.v.data.error === '패스키 확인에 실패했습니다.', 'C30 일부러 틀린 서명은 거절(401, 쿠키 없음)', JSON.stringify(a.v));
const failMsg = a.v.data.error;
const first = await login(jar(), devA1);
ok(first.v.status === 200, '(준비) 정상 로그인');
r = await call(jar(), 'POST', '/api/login/verify', { response: first.resp });
ok(r.status === 401 && r.data.error === failMsg, 'C31 이미 한 번 쓴 질문(같은 서명 응답)으로 다시 로그인하려는 요청은 거절(401)', JSON.stringify(r));
const reuse = await call(null, 'POST', '/api/login/options', {});
await call(jar(), 'POST', '/api/login/verify', { response: await devA1.assert(reuse.data) });
r = await call(jar(), 'POST', '/api/login/verify', { response: await devA1.assert(reuse.data) });
ok(r.status === 401, 'C31 같은 질문에 새로 서명해서 다시 보내도 거절(질문은 첫 확인 때 이미 지워짐)');
ok(n('SELECT COUNT(*) AS n FROM challenges WHERE challenge = ?', reuse.data.challenge) === 0, 'C31 쓴 질문은 서버에서 지워짐');
const lo3 = await call(null, 'POST', '/api/login/options', {});
raw.prepare("UPDATE challenges SET expires_at = '2000-01-01T00:00:00.000Z' WHERE challenge = ?").run(lo3.data.challenge);
r = await call(jar(), 'POST', '/api/login/verify', { response: await devA1.assert(lo3.data) });
ok(r.status === 401 && r.data.error === failMsg, '2분이 지난 질문은 거절(같은 안내 문구)');
a = await login(jar(), devA1, { uv: false });
ok(a.v.status === 401, '본인 확인(UV) 없는 서명은 거절');
a = await login(jar(), devA1, { origin: 'https://evil.example' });
ok(a.v.status === 401, '다른 사이트 주소로 서명된 로그인은 거절(피싱 방지)');
const stranger = newDevice(); await stranger.register({ challenge: 'x'.repeat(43) });
a = await login(jar(), stranger);
ok(a.v.status === 401 && a.v.data.error === failMsg && !a.v.sc, '서버가 모르는 패스키로는 거절, 안내 문구는 다른 실패와 똑같음');
const ctr = q('SELECT counter FROM passkeys WHERE credential_id = ?', regA.resp.id).counter;
a = await login(jar(), devA1, { counter: ctr });
ok(a.v.status === 401, '서명 횟수가 늘지 않은 서명(복제된 기기 의심)은 거절', JSON.stringify(a.v));
r = await call(jar(), 'POST', '/api/login/verify', { response: 'nope' });
ok(r.status === 401, '엉터리 요청은 같은 401');

const jarOut = jar(); await login(jarOut, devA1);
const oldC = jarOut.c;
ok((await call(null, 'GET', '/api/private/items', undefined, { cookie: oldC })).status === 200, 'C33 로그인한 상태의 성공 응답');
r = await call(jarOut, 'POST', '/api/logout');
ok(r.status === 200 && /Max-Age=0/.test(r.sc), '로그아웃(쿠키 삭제 지시)');
ok((await call(null, 'GET', '/api/private/items', undefined, { cookie: oldC })).status === 401, 'C33 로그아웃한 뒤 같은 주소·같은 방식·같은 값으로 다시 요청하면 거절(401)');
ok(n('SELECT COUNT(*) AS n FROM sessions WHERE token_hash = ?', crypto.createHash('sha256').update(oldC).digest('hex')) === 0, '로그아웃하면 서버에서도 세션이 지워짐');
const jarE = jar(); await login(jarE, devA1);
raw.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE token_hash = ?").run(crypto.createHash('sha256').update(jarE.c).digest('hex'));
ok((await call(jarE, 'GET', '/api/private/items')).status === 401, '만료 시각이 지난 세션은 거절');
ok((await call(null, 'GET', '/api/private/items', undefined, { cookie: 'AAAA' })).status === 401, '엉터리 세션 값은 거절');

// =====================================================================================
// 카드 4 — 기기를 잃어버렸을 때 (T08-C42~C46)
// =====================================================================================
const jarS = jar(); await login(jarS, devA1);
let ao = await call(jarS, 'POST', '/api/passkeys/options', { passkey_name: '휴대폰 (Google 비밀번호 관리자)' });
ok(ao.status === 200 && ao.data.excludeCredentials.length === 1 && ao.data.excludeCredentials[0].id === regA.resp.id, 'C46(막히는 지점) 두 번째 패스키 등록 때 이미 등록된 기기는 제외하도록 서버가 알려 줌(excludeCredentials)', JSON.stringify(ao.data.excludeCredentials));
r = await call(jarS, 'POST', '/api/passkeys/verify', { response: await devA2.register(ao.data) });
ok(r.status === 200 && r.data.rows.length === 2, 'C42 한 계정에 패스키가 두 개 등록됨', JSON.stringify(r));
const list2 = r.data.rows;
ok(list2.map((p) => p.name).join('|') === '이 PC (Windows Hello)|휴대폰 (Google 비밀번호 관리자)' && list2.every((p) => p.created_at), 'C43 목록에서 두 패스키의 이름과 등록한 날짜가 보임');
r = await call(jar(), 'POST', '/api/passkeys/verify', { response: 'x' });
ok(r.status === 401, '로그인하지 않은 채 패스키를 추가할 수 없음');
const jar1 = jar(), jar2 = jar();
await login(jar1, devA1); await login(jar2, devA2);
ok(jar2.c && (await call(jar2, 'GET', '/api/private/items')).status === 200, '두 번째 패스키로도 로그인됨');
r = await call(jar2, 'DELETE', `/api/passkeys/${list2[0].id}`);
ok(r.status === 200 && r.data.remaining === 1, 'C44 패스키 하나(이 PC)를 지움, 하나가 남음', JSON.stringify(r));
ok((await call(jar2, 'GET', '/api/private/items')).status === 200 && (await call(jar2, 'GET', '/api/passkeys')).data.rows.length === 1, 'C44 지운 뒤 남은 하나(휴대폰)로 로그인한 상태에서 자료가 열림');
const afterDel = jar();
const viaOld = await login(afterDel, devA1);
ok(viaOld.v.status === 401 && !afterDel.c, 'C45 지운 패스키로는 더 이상 들어갈 수 없음(401, 기기에는 키가 남아 있어도 서버가 모름)', JSON.stringify(viaOld.v));
ok((await call(jar1, 'GET', '/api/private/items')).status === 401, 'C45 지운 패스키로 이미 열어 둔 세션도 함께 끊김(잃어버린 기기가 로그인 상태로 남지 않음)');
const viaNew = jar(); a = await login(viaNew, devA2);
ok(a.v.status === 200, 'C44 남은 패스키로 다시 로그인 성공');
r = await call(viaNew, 'DELETE', `/api/passkeys/${list2[1].id}`);
ok(r.status === 409 && n('SELECT COUNT(*) AS n FROM passkeys WHERE account_id = (SELECT id FROM accounts WHERE handle = ?)', 'spot-a') === 1, 'C46 마지막 하나는 서버가 지우지 못하게 막음(409) — 하나도 안 남는 일이 없음', JSON.stringify(r));
jarA.c = viaNew.c;
ok((await call(jarA, 'GET', '/api/passkeys')).data.rows.length === 1, '(상태) 지금 A 의 패스키는 휴대폰 하나');

// =====================================================================================
// 카드 5 — 계정 두 개, 서로의 자료 (T08-C36~C41)
// =====================================================================================
r = await register(null, 'spot-b', devB, '다른 계정의 패스키');
jarB.c = /^sid=([^;]*)/.exec(r.v.sc)[1];
ok(r.v.status === 201, 'C36 두 번째 계정(B) 만들기');
const mkItem = (j, title, body) => call(j, 'POST', '/api/private/items', { title, body });
const A_ITEMS = ['A-메모: 포트폴리오 개편 계획', 'A-지원 목록: 가상회사 알파', 'A-회고: 이번 주는 러닝 4회'];
const B_ITEMS = ['B-메모: 스터디 자료 정리', 'B-지원 목록: 가상회사 베타', 'B-회고: 이번 주는 독서 3권'];
for (const t of A_ITEMS) await mkItem(jarA, t, t + ' (만들어 넣은 내용)');
for (const t of B_ITEMS) await mkItem(jarB, t, t + ' (만들어 넣은 내용)');
const listOf = async (j) => (await call(j, 'GET', '/api/private/items')).data.rows;
const la = await listOf(jarA), lb = await listOf(jarB);
ok(la.length === 3 && lb.length === 3 && la.every((x) => x.title.startsWith('A-')) && lb.every((x) => x.title.startsWith('B-')), 'C36 계정 두 개에 각각 서로 다른 비공개 내용 3개씩 — 목록에 남의 것이 섞이지 않음');
const exportOf = async (j) => JSON.stringify([await listOf(j), (await call(j, 'GET', '/api/passkeys')).data.rows.map((p) => p.id)]);
const beforeA = await exportOf(jarA), beforeB = await exportOf(jarB);
const idA = la[0].id, idB = lb[0].id;
const pkA = (await call(jarA, 'GET', '/api/passkeys')).data.rows[0].id, pkB = (await call(jarB, 'GET', '/api/passkeys')).data.rows[0].id;
async function attack(name, j, other, otherPk) {
  let x = await call(j, 'DELETE', `/api/private/items/${other}`);
  ok(x.status === 404, `C37·C38 ${name}: 남의 비공개 항목 지우기 → 404`);
  x = await call(j, 'DELETE', `/api/passkeys/${otherPk}`);
  ok(x.status === 404, `${name}: 남의 패스키 지우기 → 404`);
  x = await call(j, 'GET', `/api/private/items/${other}`);
  ok(x.status === 404 || x.status === 405 || x.status === 401, `${name}: 남의 항목 id 로 직접 읽기 → 열리지 않음 (${x.status})`);
}
await attack('A→B', jarA, idB, pkB);
await attack('B→A', jarB, idA, pkA);
ok((await exportOf(jarA)) === beforeA && (await exportOf(jarB)) === beforeB, 'C39 거절 앞뒤로 반대편(그리고 내) 자료 건수·내용이 똑같음');
r = await call(jarA, 'GET', `/api/private/items?account_id=${'2'}&handle=spot-b`, undefined, { headers: { 'x-account-id': '2', 'x-handle': 'spot-b' } });
ok(r.status === 200 && r.data.rows.every((x) => x.title.startsWith('A-')), 'C40 주소(?account_id=)·헤더에 B 를 적어도 A 의 자료만 돌아옴');
r = await call(jarA, 'POST', '/api/private/items', { title: 'A가 B로 위장', body: 'x', account_id: 2, handle: 'spot-b' });
ok(r.status === 200 && (await listOf(jarB)).every((x) => x.title !== 'A가 B로 위장') && (await listOf(jarA)).some((x) => x.title === 'A가 B로 위장'), 'C40 본문에 account_id/자리 이름을 B 로 적어도 A 의 항목으로만 저장됨');
await call(jarA, 'DELETE', `/api/private/items/${r.data.id}`);
r = await call(null, 'GET', '/api/private/items', undefined, { headers: { 'x-handle': 'spot-b' } });
ok(r.status === 401, '패스키 없이 B 를 적어 요청해도 401');
const dump = JSON.stringify(raw.prepare('SELECT * FROM passkeys').all());
ok(!/"d":/.test(dump), 'DB 에 개인키가 없음');

// 출처·형식
r = await call(jarA, 'POST', '/api/private/items', { title: 'x', body: 'y' }, { headers: { origin: 'https://evil.example' } });
ok(r.status === 403, '다른 사이트(Origin)에서 온 쓰기 요청은 403');
r = await call(jarA, 'POST', '/api/private/items', '{"title":"x","body":"y"}', { headers: { 'content-type': 'text/plain' } });
ok(r.status === 415, 'JSON 이 아닌 본문은 415');
r = await call(jarA, 'POST', '/api/private/items', { title: '<script>alert(1)</script>', body: '<b>그대로</b>' });
ok(r.status === 200 && r.data.title === '<script>alert(1)</script>', '스크립트 모양 글자는 그대로 저장(화면은 textContent 로만 표시)');
await call(jarA, 'DELETE', `/api/private/items/${r.data.id}`);

// =====================================================================================
// 공개 페이지에 비공개 내용이 없다 (T08-C18) · 비밀값 (T08-C35)
// =====================================================================================
const html = ['../public/index.html', '../public/passkey.js', '../public/passkey.css'].map(read).join('\n');
ok([...A_ITEMS, ...B_ITEMS].every((t) => !html.includes(t.replace(/^[AB]-/, '').split(':')[1] || t) && !html.includes(t)), 'C18 공개 페이지의 소스(HTML·JS·CSS)에 비공개 항목의 내용이 없음');
ok(!/type=["']password["']/i.test(html) && !/<input[^>]*password/i.test(html), 'C35 어디에도 비밀번호를 입력하는 칸이 없음');
ok(!responses.some((t) => /pw_hash|password|private_key/i.test(t)) && !logs.some((t) => /"d":|private/i.test(t)), '모든 응답·서버 로그에 비밀번호·개인키 값이 없음', `${responses.length}개 응답, ${logs.length}줄 로그`);
const tokenLeak = [jarA.c, jarB.c, jarL.c].filter(Boolean).some((tk) => responses.some((t) => t.includes(tk)) || logs.some((t) => t.includes(tk)));
ok(!tokenLeak, 'C34 세션 값이 응답 본문·서버 로그 어디에도 실리지 않음');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
