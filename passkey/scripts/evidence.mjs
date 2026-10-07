// 제출용 증거 기록: 성공한 요청과 거절된 요청을 나란히, 비밀값(세션 값)은 가려서 마크다운으로 출력한다.
//   로컬(시험용 가짜 기기, DB 저장값도 함께 보여 줌):  node scripts/evidence.mjs > docs/evidence/local-run.md
//   배포 서버(검사용 계정 2개를 만들고 남김):           BASE_URL=https://pds-passkey.pds-diary.workers.dev node scripts/evidence.mjs
// 시험용 가짜 기기(scripts/soft-authenticator.mjs)가 진짜 기기와 같은 형식으로 서명한다. 계정 이름은 evid- 로 시작한다.
import fs from 'node:fs';
import crypto from 'node:crypto';
import worker from '../src/worker.js';
import { createD1 } from './d1-shim.mjs';
import { createAuthenticator, b64u } from './soft-authenticator.mjs';

const BASE = process.env.BASE_URL;
const ORIGIN = BASE || 'https://pds-passkey.pds-diary.workers.dev';
const HOST = new URL(ORIGIN).hostname;
const env = BASE ? null : { DB: createD1(':memory:', fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')) };
const out = [];
const w = (s = '') => out.push(s);
const rnd = (n) => crypto.randomBytes(n).toString('hex');
const mask = (v) => (v && v.length > 6 ? v.slice(0, 4) + '…(가림)' : v);
const cut = (s, n = 70) => (typeof s === 'string' && s.length > n ? s.slice(0, n) + `…(줄임, 전체 ${s.length}자)` : s);

function shownBody(o) {
  return JSON.stringify(o, (k, v) => (typeof v === 'string' && ['clientDataJSON', 'attestationObject', 'authenticatorData', 'signature', 'public_key', 'credential_id', 'rawId'].includes(k) ? cut(v, 40) : v));
}
let n = 0;
async function call(label, jar, method, path, body, opts = {}) {
  const headers = { 'content-type': 'application/json', ...(opts.headers || {}) };
  const cookie = opts.cookie !== undefined ? opts.cookie : jar && jar.c;
  if (cookie) headers.cookie = `sid=${cookie}`;
  const init = { method, headers, body: body === undefined ? undefined : JSON.stringify(body) };
  const r = BASE ? await fetch(BASE + path, init) : await worker.fetch(new Request(ORIGIN + path, init), env);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  const sc = r.headers.get('set-cookie');
  if (jar && !opts.keep && sc) { const m = /^sid=([^;]*)/.exec(sc); if (m) jar.c = m[1] || null; }
  if (label) {
    w(`**${++n}. ${label}**`);
    w('```');
    w(`${method} ${path}`);
    if (cookie) w(`Cookie: sid=${mask(cookie)}`);
    Object.entries(opts.headers || {}).forEach(([k, v]) => w(`${k}: ${v}`));
    if (body !== undefined) w(`본문: ${shownBody(body)}`);
    w(`→ ${r.status}`);
    if (sc) w(`Set-Cookie: ${sc.replace(/^(sid=)([^;]*)/, (_, a, b) => a + (b ? mask(b) : '(비어 있음 = 삭제)'))}`);
    const shown = typeof data === 'string' ? data : shownBody(data);
    w(`응답: ${shown.length > 360 ? shown.slice(0, 360) + ' …(줄임)' : shown}`);
    w('```');
  }
  return { status: r.status, data, sc };
}
const newDev = () => createAuthenticator({ origin: ORIGIN, rpId: HOST });
const idA = `evid-a-${rnd(3)}`, idB = `evid-b-${rnd(3)}`;
const jarA = { c: null }, jarB = { c: null };
const decode = (b) => JSON.parse(Buffer.from(b, 'base64url').toString());

w(`# T08 패스키 증거 기록 (${BASE ? '배포 서버 ' + BASE : '로컬 서버 · 같은 Worker 코드 · 시험용 가짜 기기'})`);
w();
w(`실행 시각: ${new Date().toISOString()} · 계정: \`${idA}\`, \`${idB}\` (이 기록을 위해 만든 검사용 계정) · 세션 값은 앞 4글자만 보이게 가렸고, 길이가 긴 값(attestationObject·signature·공개키)은 앞부분만 보입니다. 비밀번호는 이 시스템에 존재하지 않습니다.`);
w();

// ---------------- 카드 2 ----------------
w('## 카드 2 — 패스키 등록');
const devA1 = newDev(), devA2 = newDev(), devB = newDev();
const opt1 = await call('등록 질문(challenge) 요청 ①', null, 'POST', '/api/register/options', { handle: idA, passkey_name: '이 PC (Windows Hello)' });
const opt2 = await call('등록 질문 요청 ② (같은 자리 이름으로 다시 요청 — 질문 값이 달라야 함)', null, 'POST', '/api/register/options', { handle: idA, passkey_name: '이 PC (Windows Hello)' });
w(`→ 두 질문 값이 서로 다른가: **${opt1.data.challenge !== opt2.data.challenge ? '다르다' : '같다(문제)'}** · 서버는 질문을 DB 에 보관하고(확인할 때까지, 최대 2분) 확인이 끝나면 지웁니다.`);
w('### 취소했을 때 (질문만 받고 등록을 마치지 않음)');
const cancelHandle = `evid-c-${rnd(3)}`;
await call('질문만 받고 기기 창에서 취소 → 등록 확인 요청을 보내지 않음', null, 'POST', '/api/register/options', { handle: cancelHandle, passkey_name: '취소할 패스키' });
if (env) {
  const cnt = (t, c, v) => env.DB.raw.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE ${c} = ?`).get(v).n;
  w(`→ 서버에 \`${cancelHandle}\` 계정이 저장됐는가: **${cnt('accounts', 'handle', cancelHandle) === 0 ? '저장되지 않았다' : '저장됨(문제)'}** · 패스키 수: ${env.DB.raw.prepare('SELECT COUNT(*) AS n FROM passkeys').get().n}건. 화면에는 "취소되었거나 시간이 지나서 아무것도 저장되지 않았습니다" 안내가 나옵니다.`);
}
w('### 등록 완료');
const attA1 = await devA1.register(opt2.data);
const regA = await call('등록 확인 요청 (기기가 서명한 공개키와 서명 — 개인키는 없음)', jarA, 'POST', '/api/register/verify', { response: attA1 });
const cd = decode(attA1.response.clientDataJSON);
w(`→ 요청 본문의 clientDataJSON 을 풀어 보면: \`${JSON.stringify(cd)}\` — 서버가 보낸 질문 값(${mask(opt2.data.challenge)})과 이 사이트 주소(origin)가 들어 있고, 개인키는 없다.`);
let privD = null;
try { privD = (await crypto.subtle.exportKey('jwk', devA1.store.get(attA1.id).privateKey)).d; } catch { /* 키 내보내기 불가 */ }
w(`- 이 기기의 개인키 값이 서버로 보낸 요청 전체에 들어 있는가: **${privD && JSON.stringify([attA1]).includes(privD) ? '들어 있다(문제)' : '들어 있지 않다'}**`);
const listA = await call('서버에 저장된 패스키 목록 (이름·등록 날짜·공개키)', jarA, 'GET', '/api/passkeys');
if (env) {
  const row = env.DB.raw.prepare('SELECT credential_id, public_key, counter, transports, device_type, backed_up, name, created_at FROM passkeys').get();
  w('DB 의 passkeys 표에 저장된 값 (공개키이며 비밀번호가 아니다 — 이것만으로는 로그인할 수 없고, 서명을 확인하는 데만 쓰인다):');
  w('```');
  Object.entries(row).forEach(([k, v]) => w(`${k} = ${typeof v === 'string' ? cut(v, 90) : v}`));
  w('```');
}
w(`- 패스키 이름: **${listA.data.rows[0].name}** (사람이 알아볼 수 있는 이름) · 저장 위치: 개인키는 기기(Windows Hello 등)나 Google 비밀번호 관리자 같은 보관 장소에만 있고 서버에는 없다.`);
await call('이미 쓴 등록 응답을 다시 보냄 → 거절', null, 'POST', '/api/register/verify', { response: attA1 });
w();

// ---------------- 카드 3 ----------------
w('## 카드 3 — 패스키로 들어간다');
const lo1 = await call('로그인 질문 요청 ①', null, 'POST', '/api/login/options', {});
const lo2 = await call('로그인 질문 요청 ② (달라야 함)', null, 'POST', '/api/login/options', {});
w(`→ 두 질문 값이 서로 다른가: **${lo1.data.challenge !== lo2.data.challenge ? '다르다' : '같다(문제)'}**`);
const jarL = { c: null };
const asOk = await devA1.assert(lo1.data);
const okLogin = await call('서명 확인에 성공한 로그인 (서버가 저장해 둔 공개키로 서명을 확인)', jarL, 'POST', '/api/login/verify', { response: asOk });
const ok2 = await call('로그인한 상태로 비공개 자리 요청 → 성공', jarL, 'GET', '/api/private/items');
const lo3 = await call(null, null, 'POST', '/api/login/options', {});
const bad = await call('일부러 틀린 서명으로 로그인 → 거절', null, 'POST', '/api/login/verify', { response: await devA1.assert(lo3.data, { tamper: true }) });
const rep = await call('이미 쓴 질문(위 성공 로그인의 서명 응답)으로 다시 로그인 → 거절', null, 'POST', '/api/login/verify', { response: asOk });
const lo4 = await call(null, null, 'POST', '/api/login/options', {});
await call(null, null, 'POST', '/api/login/verify', { response: await devA1.assert(lo4.data) });
const rep2 = await call('같은 질문에 새로 서명해서 다시 보냄 → 거절 (질문은 처음 확인할 때 이미 지워짐)', null, 'POST', '/api/login/verify', { response: await devA1.assert(lo4.data) });
w(`→ 거절 응답의 안내 문구가 모두 같은가(이유를 알려 주지 않음): **${[bad, rep, rep2].every((x) => x.data.error === bad.data.error) ? '같다' : '다르다(문제)'}**`);
w('### 로그아웃하면 같은 값이 더 통하지 않는다');
const saved = jarL.c;
await call('로그아웃', jarL, 'POST', '/api/logout');
const afterOut = await call('로그아웃한 뒤 같은 값으로 같은 요청 → 거절', null, 'GET', '/api/private/items', undefined, { cookie: saved });
w(`→ 두 요청은 주소(\`GET /api/private/items\`)와 쿠키 값(\`sid=${mask(saved)}\`)이 같고 다른 것은 로그아웃 여부뿐이다: 성공 ${ok2.status} / 거절 ${afterOut.status}`);
w(`- 로그인 뒤 사람을 알아보는 것: 서버가 발급한 무작위 **세션 값**(쿠키 \`sid\`, HttpOnly·SameSite=Strict·Secure, 7일). 서버 DB 에는 그 값의 SHA-256 만 있다. 주소창·응답 본문에는 실리지 않는다.`);
w();

// ---------------- 카드 4 ----------------
w('## 카드 4 — 기기를 잃어버렸을 때');
const jarS = { c: null };
await call(null, jarS, 'POST', '/api/login/verify', { response: await devA1.assert((await call(null, null, 'POST', '/api/login/options', {})).data) });
const ao = await call('두 번째 패스키 등록 질문 (이미 등록한 기기는 제외하라고 알려 줌)', jarS, 'POST', '/api/passkeys/options', { passkey_name: '휴대폰 (Google 비밀번호 관리자)' });
w(`→ excludeCredentials 에 첫 패스키가 들어 있다: **${ao.data.excludeCredentials.length === 1 ? '예' : '아니오(문제)'}** — 같은 기기에 같은 패스키가 두 번 등록되지 않게 합니다.`);
await call('두 번째 패스키 등록 확인', jarS, 'POST', '/api/passkeys/verify', { response: await devA2.register(ao.data) });
const two = await call('패스키 두 개가 보이는 목록', jarS, 'GET', '/api/passkeys');
const j1 = { c: null }, j2 = { c: null };
await call(null, j1, 'POST', '/api/login/verify', { response: await devA1.assert((await call(null, null, 'POST', '/api/login/options', {})).data, { credentialId: attA1.id }) });
await call(null, j2, 'POST', '/api/login/verify', { response: await devA2.assert((await call(null, null, 'POST', '/api/login/options', {})).data) });
const first = two.data.rows[0].id, second = two.data.rows[1].id;
await call('휴대폰 패스키로 로그인한 상태에서 첫 패스키(이 PC)를 지움', j2, 'DELETE', `/api/passkeys/${first}`);
await call('남은 하나(휴대폰)로 자료 열기 → 성공', j2, 'GET', '/api/private/items');
const viaDeleted = await call('지운 패스키로 로그인 → 거절 (기기에 키가 남아 있어도 서버가 모름)', null, 'POST', '/api/login/verify', { response: await devA1.assert((await call(null, null, 'POST', '/api/login/options', {})).data, { credentialId: attA1.id }) });
await call('지운 패스키로 이미 열어 둔 세션도 끊김 → 거절', j1, 'GET', '/api/private/items');
const last = await call('마지막 하나를 지우려 함 → 거절 (하나도 안 남는 일이 없게 서버가 막음)', j2, 'DELETE', `/api/passkeys/${second}`);
w(`- **패스키가 하나도 남지 않으면:** 서버가 마지막 하나는 지우지 못하게 막으므로(409) 하나도 안 남는 상태가 생기지 않는다. 다만 남은 하나가 있는 기기·보관 장소를 모두 잃으면 이 자리에 다시 들어올 복구 방법은 없다(⑥에 적음).`);
w();

// ---------------- 카드 5 ----------------
w('## 카드 5 — 계정 두 개, 서로의 비공개 자료 (양방향)');
const regB = await call('계정 B 만들기 (패스키 등록)', jarB, 'POST', '/api/register/verify', { response: await devB.register((await call(null, null, 'POST', '/api/register/options', { handle: idB, passkey_name: 'B 의 패스키' })).data) });
jarA.c = j2.c;
const a1 = (await call(null, jarA, 'POST', '/api/private/items', { title: 'A-메모: 포트폴리오 개편 계획', body: 'A 만의 내용(만들어 넣은 내용)' })).data;
await call(null, jarA, 'POST', '/api/private/items', { title: 'A-지원 목록: 가상회사 알파', body: 'A 만의 내용(만들어 넣은 내용)' });
const b1 = (await call(null, jarB, 'POST', '/api/private/items', { title: 'B-메모: 스터디 자료 정리', body: 'B 만의 내용(만들어 넣은 내용)' })).data;
await call(null, jarB, 'POST', '/api/private/items', { title: 'B-지원 목록: 가상회사 베타', body: 'B 만의 내용(만들어 넣은 내용)' });
const pkB = (await call(null, jarB, 'GET', '/api/passkeys')).data.rows[0].id;
const pkA = (await call(null, jarA, 'GET', '/api/passkeys')).data.rows[0].id;
const count = async (j) => { const it = (await call(null, j, 'GET', '/api/private/items')).data.rows.length; const pk = (await call(null, j, 'GET', '/api/passkeys')).data.rows.length; return { items: it, passkeys: pk }; };
const beforeA = await count(jarA), beforeB = await count(jarB);
w(`거절 시도 전 건수: A = ${JSON.stringify(beforeA)}, B = ${JSON.stringify(beforeB)}`);
w('### 성공한 요청 (자기 자료)');
await call('A 가 자기 비공개 목록 읽기 → 성공', jarA, 'GET', '/api/private/items');
w('### A 가 B 의 자료를 건드리는 요청');
await call('A → B 의 비공개 항목 지우기', jarA, 'DELETE', `/api/private/items/${b1.id}`);
await call('A → B 의 패스키 지우기', jarA, 'DELETE', `/api/passkeys/${pkB}`);
w('### 반대 방향: B 가 A 의 자료를 건드리는 요청');
await call('B → A 의 비공개 항목 지우기', jarB, 'DELETE', `/api/private/items/${a1.id}`);
await call('B → A 의 패스키 지우기', jarB, 'DELETE', `/api/passkeys/${pkA}`);
w('### 주소·헤더·본문에 다른 계정을 적어 보냄');
await call('주소(?account_id=, ?handle=)와 헤더(X-Account-Id, X-Handle)에 B 를 적은 A 의 요청', jarA, 'GET', `/api/private/items?account_id=2&handle=${idB}`, undefined, { headers: { 'x-account-id': '2', 'x-handle': idB } });
const tamper = await call('본문에 account_id/handle 을 B 로 적어 항목 만들기', jarA, 'POST', '/api/private/items', { title: 'A가 만든 항목(본문에 B 적음)', body: 'x', account_id: 2, handle: idB });
const bList = await call(null, jarB, 'GET', '/api/private/items');
w(`→ 그 항목이 B 목록에 생겼는가: **${bList.data.rows.some((x) => x.title.startsWith('A가 만든')) ? '생겼다(문제)' : '없다(정상)'}** (A 의 항목으로만 저장됨)`);
await call(null, jarA, 'DELETE', `/api/private/items/${tamper.data.id}`);
w('### 패스키 없이 직접 요청');
await call('패스키 없이 비공개 자료 직접 요청', null, 'GET', '/api/private/items');
const afterA = await count(jarA), afterB = await count(jarB);
w('### 거절 전후 건수 비교');
w(`시도 후: A = ${JSON.stringify(afterA)}, B = ${JSON.stringify(afterB)} → 시도 전과 **${JSON.stringify(beforeA) === JSON.stringify(afterA) && JSON.stringify(beforeB) === JSON.stringify(afterB) ? '같다' : '다르다(문제)'}**`);
w('### 목록 응답에 남의 자료가 섞이는지');
const la = await call(null, jarA, 'GET', '/api/private/items'), lb = await call(null, jarB, 'GET', '/api/private/items');
w(`A 목록 제목: ${JSON.stringify(la.data.rows.map((x) => x.title))} / B 목록 제목: ${JSON.stringify(lb.data.rows.map((x) => x.title))} — 서로의 것이 하나도 없음: **${la.data.rows.every((x) => x.title.startsWith('A-')) && lb.data.rows.every((x) => x.title.startsWith('B-')) ? '맞다' : '아니다(문제)'}**`);
w('### 거절을 만드는 소스 위치');
const src = fs.readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8').split('\n');
const at = (s) => src.findIndex((l) => l.includes(s)) + 1;
w(`- \`src/worker.js:${at('async function ownedPasskey')}\` ownedPasskey · \`:${at('async function ownedItem')}\` ownedItem — 남의 것과 없는 것을 구분하지 않고 같은 404 를 던진다`);
w(`- \`src/worker.js:${at('const acc = await currentAccount(db, req);')}\` 패스키로 들어오지 않은 요청은 여기서 401 (패스키 로그인·등록·로그아웃·내 상태 확인만 그 앞에서 처리)`);
w(`- 목록은 \`WHERE account_id = ?\` 로 걸러진다(listItems·listPasskeys)`);
w(`- 서명 확인과 질문 한 번만 쓰기: \`:${at('async function takeChallenge')}\` takeChallenge(질문 삭제), \`:${at('async function loginVerify')}\` loginVerify(공개키로 서명 확인)`);
w();
w('## 이 문서 전체에 세션 값 원문이 있는가');
const all = out.join('\n');
const tokens = [jarA.c, jarB.c, jarL.c, saved, j1.c, j2.c].filter(Boolean);
w(`**${tokens.some((t) => all.includes(t)) ? '있다(문제)' : '없다'}** — 이 문서 전체를 검사한 결과(앞 4글자만 보이게 가렸음).`);
console.log(out.join('\n'));
