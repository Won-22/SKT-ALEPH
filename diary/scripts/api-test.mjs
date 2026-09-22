// API 통합 검사(로컬, 메모리 DB): node scripts/api-test.mjs
import fs from 'node:fs';
import worker from '../src/worker.js';
import { createD1 } from './d1-shim.mjs';

const schema = fs.readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
const env = { DB: createD1(':memory:', schema) };
let pass = 0, fail = 0;
const ok = (cond, name, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + extra}`); };

async function api(method, path, body) {
  const r = await worker.fetch(new Request('http://x' + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: r.status, data };
}

const plan = { title: '주간 계획 A', period_start: '2026-09-21', period_end: '2026-09-27', priority: 1, success_criteria: '과제6 완성', est_minutes: 480 };

// 계획
let r = await api('POST', '/api/plans', plan);
ok(r.status === 200 && r.data.plan.id === 1 && r.data.revisions.length === 1, 'C04-C07 계획 생성: 기간·우선순위·성공기준·예상시간 저장 + 처음 계획(v1) 보존', JSON.stringify(r));
ok(r.data.plan.period_start === '2026-09-21' && r.data.plan.priority === 1 && r.data.plan.success_criteria === '과제6 완성' && r.data.plan.est_minutes === 480, 'C04~C07 값 그대로 저장');
r = await api('PUT', '/api/plans/1', { ...plan, title: '주간 계획 A (수정)', est_minutes: 600 });
ok(r.data.plan.id === 1 && r.data.plan.title === '주간 계획 A (수정)' && r.data.revisions.length === 2, 'C08 수정해도 계획 ID 그대로, 이력 v2 추가');
ok(r.data.revisions[0].title === '주간 계획 A' && r.data.revisions[0].est_minutes === 480, 'C08 처음 계획(v1) 값이 그대로 남음');
r = await api('PUT', '/api/plans/1', { ...plan, title: '주간 계획 A (수정)', est_minutes: 600 });
ok(r.data.revisions.length === 2, '같은 값으로 저장하면 이력이 늘지 않음');
r = await api('POST', '/api/plans', { ...plan, period_end: '2026-09-01' });
ok(r.status === 400, '종료일<시작일 거부');
r = await api('POST', '/api/plans', { ...plan, period_start: '2026-02-30' });
ok(r.status === 400, '없는 날짜 거부');

// 할 일 5개
const mk = (title, due, pri, est, tags) => api('POST', '/api/todos', { plan_id: 1, title, due_date: due, priority: pri, est_minutes: est, tags });
const t = [];
t.push((await mk('기획서 정리', '2026-09-20', 1, 60, ['문서'])).data);
t.push((await mk('DB 스키마 작성', '2026-09-24', 1, 90, ['개발', '문서'])).data);
t.push((await mk('화면 만들기', '2026-09-25', 2, 120, ['개발'])).data);
t.push((await mk('테스트', '2026-09-30', 3, 45, ['검증'])).data);
t.push((await mk('일정 없는 메모', null, 2, 0, [])).data);
ok(t.every((x) => x && x.id) && t.length === 5, 'C09 할 일 5개 생성', JSON.stringify(t));
ok(t[1].tags.join() === '개발,문서' && t[1].due_date === '2026-09-24' && t[1].priority === 1 && t[1].est_minutes === 90, 'C14~C17 마감일·우선순위·태그·예상시간 저장');
r = await api('PUT', `/api/todos/${t[0].id}`, { title: '기획서 다듬기', due_date: '2026-09-20', priority: 1, est_minutes: 60, tags: ['문서', '기획'] });
ok(r.data.title === '기획서 다듬기' && r.data.tags.join() === '기획,문서', 'C10 할 일 수정(제목·태그)', JSON.stringify(r.data));

// 검색·거르기·정렬
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

// 완료 / 중복 방지 / 되돌리기
const [c1, c2] = await Promise.all([api('POST', `/api/todos/${t[1].id}/complete`), api('POST', `/api/todos/${t[1].id}/complete`)]);
r = await api('GET', '/api/todos?status=done');
ok(r.data.rows.length === 1 && r.data.rows[0].id === t[1].id, 'C11 완료로 바꾸기');
const cnt = (await env.DB.prepare('SELECT COUNT(*) n FROM completions').first()).n;
ok(cnt === 1, 'C21 동시에 두 번 눌러도 완료 기록 1건', String(cnt));
ok([c1, c2].filter((x) => x.data.newly_completed).length === 1, 'C21 둘 중 하나만 새 완료로 응답');
await api('POST', `/api/todos/${t[1].id}/complete`);
ok((await env.DB.prepare('SELECT COUNT(*) n FROM completions').first()).n === 1, 'C21 순차로 또 눌러도 1건');
r = await api('GET', '/api/review?plan_id=1');
ok(r.data.done === 1, 'C22 돌아보기 완료 수가 정확히 1');
r = await api('POST', `/api/todos/${t[1].id}/reopen`);
ok(r.data.todo.status === 'doing' && (await env.DB.prepare('SELECT COUNT(*) n FROM completions').first()).n === 0, 'C12 완료한 할 일을 진행 중으로 되돌림');
await api('POST', `/api/todos/${t[1].id}/complete`);
ok((await env.DB.prepare('SELECT COUNT(*) n FROM completions').first()).n === 1, '되돌린 뒤 다시 완료 가능(1건)');

// 실행 기록
const run = (todo, s, e, blocked) => api('POST', '/api/runs', { todo_id: todo, started_at: s, ended_at: e, blocked_reason: blocked });
r = await run(t[1].id, '2026-09-22T01:00:00.000Z', '2026-09-22T02:30:00.000Z', null);
ok(r.status === 200 && r.data.actual_minutes === 90 && r.data.started_at === '2026-09-22T01:00:00.000Z', 'C23~C25 시작·끝·걸린 시간 저장');
r = await run(t[2].id, '2026-09-22T03:00:00.000Z', '2026-09-22T03:50:00.000Z', '디자인 결정이 안 남');
ok(r.data.blocked_reason === '디자인 결정이 안 남', 'C26 막힌 이유 저장');
await run(t[2].id, '2026-09-23T03:00:00+09:00', '2026-09-23T04:00:00+09:00', null);
const planAfter = await api('GET', '/api/plans/1');
ok(planAfter.data.plan.est_minutes === 600 && planAfter.data.revisions.length === 2, 'C27 실행 기록을 저장해도 계획 값은 그대로');
const todoAfter = (await api('GET', `/api/todos?plan_id=1`)).data.rows.find((x) => x.id === t[1].id);
ok(todoAfter.est_minutes === 90, 'C27 할 일의 예상 시간도 그대로');
r = await run(t[2].id, '2026-09-23T05:00:00Z', '2026-09-23T04:00:00Z', null);
ok(r.status === 400, '끝<시작 거부');

// 돌아보기
const today = (await api('GET', '/api/meta')).data.today_kst;
r = await api('GET', '/api/review?plan_id=1');
const v = r.data;
const todosNow = (await api('GET', '/api/todos?plan_id=1')).data.rows;
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
  const rec = await api('GET', `/api/review/records?plan_id=1&metric=${m}`);
  const n = rec.data.rows.length;
  const want = { planned: v.planned, done: v.done, delayed: v.delayed, blocked: 1, est: v.planned, actual: 3 }[m];
  ok(rec.status === 200 && n === want, `C83 '${m}' 숫자를 누르면 근거 기록 ${want}건으로 이동`, `${n}`);
}
r = await api('POST', '/api/plans', { ...plan, title: '다음 계획', period_start: '2026-09-28', period_end: '2026-10-04', carried_from_plan_id: 1, carried_note: '예상 시간을 20% 더 잡기' });
ok(r.data.plan.carried_from_plan_id === 1 && r.data.plan.carried_note === '예상 시간을 20% 더 잡기' && r.data.carried_from.id === 1, 'C33 고칠 점 한 줄이 다음 계획으로 넘어감');
r = await api('GET', '/api/review?plan_id=1');
ok(r.data.carried_to.length === 1, 'C33 돌아보기에 넘긴 기록이 보임');

// 스크립트 글자 · 삭제 · 내보내기
const evil = '<script>alert(1)</script>';
r = await api('POST', '/api/todos', { plan_id: 1, title: evil, tags: ['<b>x</b>'] });
ok(r.data.title === evil && r.data.tags[0] === '<b>x</b>', 'C57 스크립트 모양 글자가 변형 없이 저장');
const back = await api('GET', '/api/todos?q=script');
ok(back.data.rows[0].title === evil, 'C57 다시 읽어도 글자 그대로');
r = await api('DELETE', `/api/todos/${t[2].id}`);
ok(r.status === 200 && (await env.DB.prepare('SELECT COUNT(*) n FROM runs WHERE todo_id=?').bind(t[2].id).first()).n === 0, 'C13 할 일 삭제(딸린 기록도 함께 삭제)');
ok((await api('GET', '/api/todos')).data.rows.every((x) => x.id !== t[2].id), '삭제한 할 일은 목록에서 사라짐');
r = await api('GET', '/api/export');
ok(r.status === 200 && r.data.plans.length === 3 && r.data.todos.length >= 5 && r.data.runs.length >= 1 && r.data.plan_revisions.length >= 4 && r.data.schema_version === 2, 'C36 전체 내보내기(계획·이력·할 일·태그·실행기록·완료)');
const late = (await api('POST', '/api/todos', { plan_id: 1, title: '마감 지난 일', due_date: '2026-09-01' })).data;
const d1 = (await api('GET', '/api/review?plan_id=1')).data.delayed;
await api('POST', `/api/todos/${late.id}/complete`);
const d2 = (await api('GET', '/api/review?plan_id=1')).data.delayed;
ok(d2 === d1 - 1, 'C30 마감이 지난 할 일을 완료하면 지연 수에서 빠짐(이중 집계 없음)', `${d1} -> ${d2}`);
r = await api('POST', '/api/todos', { plan_id: 999, title: 'x' });
ok(r.status === 400, '없는 계획에는 할 일을 못 만듦');
r = await api('POST', '/api/plans', 'not json');
ok(r.status === 400, '잘못된 JSON 거부');
r = await api('GET', '/api/nope');
ok(r.status === 404, '없는 주소는 404');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
