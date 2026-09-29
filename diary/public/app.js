'use strict';
/* 플랜두씨 다이어리 2 — 화면. 모든 값은 서버(/api)에서 읽고 쓴다. 사용자가 넣은 글자는 textContent 로만 표시한다(HTML 해석 없음). */

const $ = (s, r = document) => r.querySelector(s);
const view = $('#view');
const PRI = { 1: '높음', 2: '보통', 3: '낮음' };
const STATUS = { todo: '할 일', doing: '진행 중', done: '완료' };
const TABS = { plans: renderPlans, todos: renderTodos, runs: renderRuns, review: renderReview, observe: renderObserve, mydata: renderMyData, account: renderAccount };
const pid = (n) => 'P-' + n;
const tid = (n) => 'T-' + n;
const rid = (n) => 'R-' + n;
let uid = 0;
let me = null; // 로그인한 사람({login_id}) 또는 null. 화면 표시용일 뿐, 자료를 여는 것은 서버가 쿠키로 확인한다.

function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (['checked', 'selected', 'disabled', 'hidden', 'required'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid === undefined || kid === null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k !== null && k !== undefined && k !== false));

async function api(method, path, body) {
  const res = await fetch('/api' + path, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  let data;
  try { data = await res.json(); } catch { data = { error: '서버 응답을 읽을 수 없습니다.' }; }
  if (res.status === 401 && me && !path.startsWith('/auth/')) { me = null; showLogin('로그인이 끝났습니다. 다시 로그인해 주세요.'); }
  if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
  return data;
}

let toastTimer;
function toast(msg, bad) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = bad ? 'bad' : '';
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 4500);
}

const fmtKST = (iso) =>
  iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + ' KST' : '—';
const kstInputNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date()).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
};
const kstToISO = (v) => new Date(v + ':00+09:00').toISOString();
const addDays = (ymd, n) => { const d = new Date(ymd + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function field(label, input, wide) {
  const id = 'f' + ++uid;
  input.id = id;
  return h('div', { class: 'field' + (wide ? ' wide' : '') }, h('label', { for: id, text: label }), input);
}
function select(map, current, extra) {
  const s = h('select', {});
  if (extra) for (const [k, v] of extra) s.append(h('option', { value: k, text: v }));
  for (const [k, v] of Object.entries(map)) s.append(h('option', { value: k, text: v }));
  s.value = String(current ?? '');
  return s;
}
const card = (title, ...kids) => h('section', { class: 'card' }, title ? h('h2', { text: title }) : null, ...kids);
const empty = (msg) => h('div', { class: 'empty', text: msg });
const errorBox = () => h('p', { class: 'error', role: 'alert', hidden: true });

function submitForm(form, errEl, work) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errEl.hidden = true;
    try { await work(); } catch (err) { errEl.textContent = err.message; errEl.hidden = false; }
  });
}

/* ---------------- 계획 ---------------- */
function planForm(init, label, onSave, top) {
  const f = {
    title: h('input', { type: 'text', maxlength: 200, required: true, value: init.title || '' }),
    start: h('input', { type: 'date', required: true, value: init.period_start || '' }),
    end: h('input', { type: 'date', required: true, value: init.period_end || '' }),
    pri: select(PRI, init.priority || 2),
    est: h('input', { type: 'number', min: 0, max: 100000, step: 1, required: true, value: init.est_minutes ?? 60 }),
    crit: h('textarea', { maxlength: 1000, required: true, value: init.success_criteria || '' })
  };
  const err = errorBox();
  const form = h('form', { novalidate: false },
    top,
    h('div', { class: 'grid two' },
      field('계획 제목', f.title, true),
      field('시작일', f.start), field('종료일', f.end),
      field('우선순위', f.pri), field('예상 시간 (분)', f.est),
      field('성공 기준 (이게 되면 성공)', f.crit, true)),
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary', text: label })),
    err);
  submitForm(form, err, () => onSave({
    title: f.title.value, period_start: f.start.value, period_end: f.end.value,
    priority: Number(f.pri.value), success_criteria: f.crit.value, est_minutes: Number(f.est.value)
  }, form));
  return form;
}

const PLAN_KEYS = [['title', '제목'], ['period_start', '시작일'], ['period_end', '종료일'], ['priority', '우선순위'], ['success_criteria', '성공 기준'], ['est_minutes', '예상 시간']];
const planValue = (k, v) => (k === 'priority' ? PRI[v] : k === 'est_minutes' ? v + '분' : v);

function planCard(p) {
  const box = h('article', { class: 'item' });
  const historyBox = h('div', { hidden: true });
  let historyLoaded = false;

  function viewMode() {
    fill(box, 
      h('h3', {}, h('span', { class: 'id', text: pid(p.id) }), p.title, h('span', { class: 'badge p' + p.priority, text: '우선순위 ' + PRI[p.priority] })),
      h('p', { class: 'meta', text: `기간 ${p.period_start} ~ ${p.period_end} · 예상 ${p.est_minutes}분 · 할 일 ${p.todo_count}개 · 수정 ${p.revision_count - 1}회` }),
      h('p', {}, h('strong', { text: '성공 기준: ' }), p.success_criteria),
      p.carried_note ? h('p', { class: 'note' }, h('strong', { text: `${pid(p.carried_from_plan_id)}에서 넘어온 고칠 점: ` }), p.carried_note) : null,
      h('div', { class: 'actions' },
        h('button', { class: 'small', text: '수정', onclick: editMode }),
        h('button', { class: 'small', text: '수정 이력 보기', onclick: toggleHistory }),
        h('a', { class: 'btn small', href: '#/todos?plan=' + p.id, text: '할 일 보기' }),
        h('a', { class: 'btn small', href: '#/review?plan=' + p.id, text: '돌아보기' })),
      historyBox);
  }
  function editMode() {
    fill(box, h('h3', {}, h('span', { class: 'id', text: pid(p.id) }), '계획 수정'),
      planForm(p, '수정 저장', async (vals) => { await api('PUT', '/plans/' + p.id, vals); toast('계획을 고쳤습니다. 처음 계획은 이력에 그대로 남아 있습니다.'); route(); }),
      h('div', { class: 'actions' }, h('button', { class: 'small', text: '취소', onclick: viewMode })));
  }
  async function toggleHistory() {
    historyBox.hidden = !historyBox.hidden;
    if (historyBox.hidden || historyLoaded) return;
    const d = await api('GET', '/plans/' + p.id);
    historyLoaded = true;
    historyBox.replaceChildren(h('h3', { text: '수정 이력 (처음 계획은 v1로 그대로 보존됩니다)' }),
      ...d.revisions.map((r, i) => {
        const prev = d.revisions[i - 1];
        const changed = prev ? PLAN_KEYS.filter(([k]) => prev[k] !== r[k]).map(([, l]) => l) : [];
        return h('div', { class: 'rev' + (i === 0 ? ' first' : '') },
          h('div', {}, h('strong', { text: `v${r.revision_no}${i === 0 ? ' · 처음 세운 계획' : ''}` }), ` · ${fmtKST(r.recorded_at)}`,
            changed.length ? h('span', { class: 'changed', text: ` · 바뀐 항목: ${changed.join(', ')}` }) : null),
          h('div', { class: 'small muted', text: PLAN_KEYS.map(([k, l]) => `${l}: ${planValue(k, r[k])}`).join(' / ') }));
      }));
  }
  viewMode();
  return box;
}

async function renderPlans() {
  const data = await api('GET', '/plans');
  const root = h('div', {});
  root.append(card('새 계획 세우기',
    h('p', { class: 'muted small', text: '지금 실제로 하고 있는 일 하나를 골라 계획으로 옮기세요. 남의 예시가 아니라 내 계획을 넣습니다.' }),
    planForm({}, '계획 저장', async (vals) => { await api('POST', '/plans', vals); toast('계획을 저장했습니다.'); route(); })));
  root.append(h('h2', { text: `내 계획 (${data.rows.length}개)` }));
  if (!data.rows.length) root.append(empty('아직 계획이 없습니다. 위에서 첫 계획을 세워 보세요.'));
  data.rows.forEach((p) => root.append(planCard(p)));
  view.replaceChildren(root);
}

/* ---------------- 할 일 ---------------- */
const tf = { plan_id: '', status: '', priority: '', tag: '', q: '', sort: 'due' };
let runTodoPreset = '';

function todoForm(init, plans, label, onSave) {
  const f = {
    plan: init.plan_id !== undefined ? null : select(Object.fromEntries(plans.map((p) => [p.id, `${pid(p.id)} ${p.title}`])), tf.plan_id || (plans[0] && plans[0].id)),
    title: h('input', { type: 'text', maxlength: 200, required: true, value: init.title || '' }),
    due: h('input', { type: 'date', value: init.due_date || '' }),
    pri: select(PRI, init.priority || 2),
    est: h('input', { type: 'number', min: 0, max: 100000, step: 1, value: init.est_minutes ?? 30 }),
    tags: h('input', { type: 'text', value: (init.tags || []).join(', '), placeholder: '쉼표로 구분 (예: 개발, 문서)' })
  };
  const err = errorBox();
  const form = h('form', {},
    h('div', { class: 'grid two' },
      f.plan ? field('계획', f.plan) : null,
      field('할 일 제목', f.title, true),
      field('마감일', f.due), field('우선순위', f.pri), field('예상 시간 (분)', f.est), field('태그', f.tags)),
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary', text: label })), err);
  submitForm(form, err, () => onSave({
    ...(f.plan ? { plan_id: Number(f.plan.value) } : {}),
    title: f.title.value, due_date: f.due.value || null, priority: Number(f.pri.value), est_minutes: f.est.value === '' ? 0 : Number(f.est.value),
    tags: f.tags.value.split(',').map((s) => s.trim()).filter(Boolean)
  }));
  return form;
}

async function saveTodo(t, patch) {
  await api('PUT', '/todos/' + t.id, { title: t.title, due_date: t.due_date, priority: t.priority, est_minutes: t.est_minutes, tags: t.tags, status: t.status === 'done' ? undefined : t.status, ...patch });
}

function todoItem(t, today) {
  const box = h('article', { class: 'item' + (t.status === 'done' ? ' done' : '') });
  const late = t.status !== 'done' && t.due_date && t.due_date < today;
  function viewMode() {
    fill(box, 
      h('h3', {}, h('span', { class: 'id', text: tid(t.id) }), h('span', { class: 'badge ' + t.status, text: STATUS[t.status] }), t.title,
        late ? h('span', { class: 'badge late', text: '지연' }) : null),
      h('p', { class: 'meta', text: `${pid(t.plan_id)} · 마감 ${t.due_date || '없음'} · 우선순위 ${PRI[t.priority]} · 예상 ${t.est_minutes}분 · 실제 ${t.actual_minutes}분 (기록 ${t.run_count}건)` }),
      t.tags.length ? h('p', {}, t.tags.map((g) => h('span', { class: 'tag', text: '#' + g }))) : null,
      t.completed_at ? h('p', { class: 'small muted', text: '완료 시각 ' + fmtKST(t.completed_at) }) : null,
      h('div', { class: 'actions' },
        t.status === 'done'
          ? h('button', { class: 'small', text: '진행 중으로 되돌리기', onclick: () => act(() => api('POST', `/todos/${t.id}/reopen`), '진행 중으로 되돌렸습니다.') })
          : [
              t.status === 'todo'
                ? h('button', { class: 'small', text: '진행 시작', onclick: () => act(() => saveTodo(t, { status: 'doing' }), '진행 중으로 바꿨습니다.') })
                : h('button', { class: 'small', text: '할 일로 되돌리기', onclick: () => act(() => saveTodo(t, { status: 'todo' }), '할 일로 되돌렸습니다.') }),
              h('button', { class: 'small ok', text: '완료', onclick: async () => {
                try {
                  const r = await api('POST', `/todos/${t.id}/complete`);
                  toast(r.newly_completed ? '완료 처리했습니다.' : '이미 완료된 할 일입니다. 완료 기록은 1건만 유지됩니다.');
                  route();
                } catch (e) { toast(e.message, true); }
              } })
            ],
        h('button', { class: 'small', text: '실행 기록 남기기', onclick: () => { runTodoPreset = String(t.id); location.hash = '#/runs'; } }),
        h('button', { class: 'small', text: '수정', onclick: editMode }),
        h('button', { class: 'small danger', text: '삭제', onclick: async () => {
          if (!confirm(`${tid(t.id)} "${t.title}"을(를) 삭제할까요? 딸린 실행 기록도 함께 지워집니다.`)) return;
          await act(() => api('DELETE', '/todos/' + t.id), '할 일을 삭제했습니다.');
        } })));
  }
  function editMode() {
    fill(box, h('h3', {}, h('span', { class: 'id', text: tid(t.id) }), '할 일 수정'),
      todoForm({ ...t }, [], '수정 저장', async (vals) => { await saveTodo(t, vals); toast('할 일을 고쳤습니다.'); route(); }),
      h('div', { class: 'actions' }, h('button', { class: 'small', text: '취소', onclick: viewMode })));
  }
  viewMode();
  return box;
}

async function act(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); route(); } catch (e) { toast(e.message, true); }
}

async function renderTodos(q) {
  if (q && q.get('plan')) { tf.plan_id = q.get('plan'); history.replaceState(null, '', '#/todos'); }
  const [plans, tags, meta] = await Promise.all([api('GET', '/plans'), api('GET', '/tags'), api('GET', '/meta')]);
  const list = await api('GET', '/todos?' + new URLSearchParams(Object.entries(tf).filter(([, v]) => v)));
  const root = h('div', {});

  if (!plans.rows.length) {
    root.append(card('할 일', empty('먼저 계획을 세워야 할 일을 넣을 수 있습니다.'), h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/plans', text: '계획 세우러 가기' }))));
    view.replaceChildren(root);
    return;
  }
  root.append(card('할 일 추가', todoForm({}, plans.rows, '할 일 추가', async (vals) => { await api('POST', '/todos', vals); toast('할 일을 추가했습니다.'); route(); })));

  const fq = h('input', { type: 'search', value: tf.q, placeholder: '제목·태그 검색', maxlength: 100 });
  const fplan = select(Object.fromEntries(plans.rows.map((p) => [p.id, `${pid(p.id)} ${p.title}`])), tf.plan_id, [['', '모든 계획']]);
  const fstatus = select(STATUS, tf.status, [['', '모든 상태']]);
  const fpri = select(PRI, tf.priority, [['', '모든 우선순위']]);
  const ftag = select(Object.fromEntries(tags.rows.map((g) => [g.tag, `#${g.tag} (${g.n})`])), tf.tag, [['', '모든 태그']]);
  const fsort = select(meta.sorts, tf.sort);
  const apply = () => { Object.assign(tf, { q: fq.value.trim(), plan_id: fplan.value, status: fstatus.value, priority: fpri.value, tag: ftag.value, sort: fsort.value }); route(); };
  const filterForm = h('form', { onsubmit: (e) => { e.preventDefault(); apply(); } },
    h('div', { class: 'filters' }, field('검색', fq), field('계획', fplan), field('상태', fstatus), field('우선순위', fpri), field('태그', ftag), field('정렬', fsort)),
    h('div', { class: 'actions' },
      h('button', { type: 'submit', class: 'primary small', text: '적용' }),
      h('button', { type: 'button', class: 'small', text: '필터 지우기', onclick: () => { Object.assign(tf, { plan_id: '', status: '', priority: '', tag: '', q: '', sort: 'due' }); route(); } })));
  [fplan, fstatus, fpri, ftag, fsort].forEach((s) => s.addEventListener('change', apply));

  root.append(card(`내 할 일 (${list.rows.length}개)`, filterForm,
    h('p', { class: 'sortnote' }, h('strong', { text: '정렬 기준: ' }), list.sort.label, h('span', { class: 'muted', text: ' · 검색·거르기·정렬은 서버에서 처리됩니다.' })),
    list.rows.length ? list.rows.map((t) => todoItem(t, meta.today_kst)) : empty('조건에 맞는 할 일이 없습니다.')));
  view.replaceChildren(root);
}

/* ---------------- 실행 기록 ---------------- */
async function renderRuns() {
  const [todos, runs] = await Promise.all([api('GET', '/todos?sort=created'), api('GET', '/runs')]);
  const root = h('div', {});
  if (!todos.rows.length) {
    root.append(card('실행 기록', empty('기록을 남길 할 일이 없습니다. 먼저 할 일을 추가하세요.'), h('div', { class: 'actions' }, h('a', { class: 'btn primary', href: '#/todos', text: '할 일 화면으로' }))));
    view.replaceChildren(root);
    return;
  }
  const f = {
    todo: select(Object.fromEntries(todos.rows.map((t) => [t.id, `${tid(t.id)} ${t.title} (${pid(t.plan_id)})`])), runTodoPreset || todos.rows[0].id),
    start: h('input', { type: 'datetime-local', required: true, value: kstInputNow() }),
    end: h('input', { type: 'datetime-local', required: true, value: kstInputNow() }),
    blocked: h('textarea', { maxlength: 500, placeholder: '막힌 곳이 없으면 비워 두세요' })
  };
  runTodoPreset = '';
  const err = errorBox();
  const form = h('form', {},
    h('p', { class: 'muted small', text: '계획과 별개로, 실제로 언제 시작해서 얼마나 걸렸고 어디서 막혔는지 남깁니다. 시각은 서울(KST) 기준입니다. 이 기록은 계획 값을 바꾸지 않습니다.' }),
    h('div', { class: 'grid two' },
      field('어떤 할 일', f.todo, true),
      field('시작 시각 (KST)', f.start), field('끝난 시각 (KST)', f.end),
      field('막혔던 이유', f.blocked, true)),
    h('div', { class: 'actions' },
      h('button', { type: 'button', class: 'small', text: '시작 = 지금', onclick: () => { f.start.value = kstInputNow(); } }),
      h('button', { type: 'button', class: 'small', text: '끝 = 지금', onclick: () => { f.end.value = kstInputNow(); } }),
      h('button', { type: 'submit', class: 'primary', text: '실행 기록 저장' })), err);
  submitForm(form, err, async () => {
    await api('POST', '/runs', { todo_id: Number(f.todo.value), started_at: kstToISO(f.start.value), ended_at: kstToISO(f.end.value), blocked_reason: f.blocked.value });
    toast('실행 기록을 저장했습니다.');
    route();
  });
  root.append(card('실제로 한 일 적기', form));
  root.append(h('h2', { text: `실행 기록 (${runs.rows.length}건)` }));
  if (!runs.rows.length) root.append(empty('아직 실행 기록이 없습니다.'));
  runs.rows.forEach((r) => root.append(runItem(r)));
  view.replaceChildren(root);
}

function runItem(r, noDelete) {
  return h('article', { class: 'item' },
    h('h3', {}, h('span', { class: 'id', text: rid(r.id) }), `${tid(r.todo_id)} ${r.todo_title}`, r.blocked_reason ? h('span', { class: 'badge doing', text: '막힘' }) : null),
    h('p', { class: 'meta', text: `${fmtKST(r.started_at)} → ${fmtKST(r.ended_at)} · 걸린 시간 ${r.actual_minutes}분 · ${pid(r.plan_id)}` }),
    r.blocked_reason ? h('p', {}, h('strong', { text: '막힌 이유: ' }), r.blocked_reason) : null,
    noDelete ? null : h('div', { class: 'actions' }, h('button', { class: 'small danger', text: '삭제', onclick: async () => {
      if (confirm(`${rid(r.id)} 실행 기록을 삭제할까요?`)) await act(() => api('DELETE', '/runs/' + r.id), '실행 기록을 삭제했습니다.');
    } })));
}

/* ---------------- 돌아보기 ---------------- */
async function renderReview(q) {
  const plans = await api('GET', '/plans');
  const planId = q.get('plan') || '';
  const metric = q.get('metric') || '';
  const v = await api('GET', '/review' + (planId ? '?plan_id=' + planId : ''));
  const root = h('div', {});

  const sel = select(Object.fromEntries(plans.rows.map((p) => [p.id, `${pid(p.id)} ${p.title}`])), planId, [['', '전체 계획']]);
  sel.addEventListener('change', () => { location.hash = '#/review' + (sel.value ? '?plan=' + sel.value : ''); });
  const go = (m) => '#/review?' + new URLSearchParams({ ...(planId ? { plan: planId } : {}), metric: m });

  const M = [
    ['planned', '계획된 할 일', v.planned, '개'], ['done', '완료', v.done, '개'], ['delayed', '지연', v.delayed, '개'], ['blocked', '막힘', v.blocked, '개'],
    ['est', '예상 시간', v.est_minutes, '분'], ['actual', '실제 시간', v.actual_minutes, '분']
  ];
  const diffText = (v.diff_minutes > 0 ? '+' : '') + v.diff_minutes;
  root.append(card('돌아보기',
    h('div', { class: 'grid two' }, field('범위', sel)),
    v.plan ? h('p', { class: 'meta', text: `${pid(v.plan.id)} ${v.plan.title} · 기간 ${v.plan.period_start} ~ ${v.plan.period_end}` }) : h('p', { class: 'meta', text: `모든 계획(${v.plan_count}개)의 할 일을 모아 봅니다.` }),
    h('p', { class: 'small muted', text: `기준일: 서울 시간 오늘 ${v.today_kst}. 숫자를 누르면 그 숫자가 나온 기록이 아래에 열립니다.` }),
    h('div', { class: 'metrics' },
      M.map(([k, label, n, unit]) => h('a', { class: 'metric', href: go(k), 'aria-label': `${label} ${n}${unit} — 눌러서 근거 기록 보기`, 'aria-current': metric === k ? 'true' : null },
        h('span', { class: 'l', text: label }), h('span', { class: 'n', text: n }), h('span', { class: 'u', text: unit }), h('span', { class: 'd', text: v.definitions[k] }))),
      h('div', { class: 'metric static' }, h('span', { class: 'l', text: '차이 (실제 − 예상)' }), h('span', { class: 'n', text: diffText }), h('span', { class: 'u', text: '분' }), h('span', { class: 'd', text: v.definitions.diff })))));

  if (metric) {
    const rec = await api('GET', '/review/records?' + new URLSearchParams({ ...(planId ? { plan_id: planId } : {}), metric }));
    root.append(card(`근거 기록 — ${(M.find((x) => x[0] === metric) || [])[1] || metric} (${rec.rows.length}건)`,
      h('p', { class: 'small muted', text: rec.definition }),
      rec.rows.length ? rec.rows.map((r) => (rec.kind === 'runs' ? runItem(r, true) : todoItem(r, v.today_kst))) : empty('이 숫자에 해당하는 기록이 없습니다.')));
  }

  if (v.plan) {
    if (v.carried_to.length) {
      root.append(card('이 계획에서 다음 계획으로 넘긴 고칠 점',
        v.carried_to.map((c) => h('p', {}, h('span', { class: 'id', text: pid(c.id) + ' ' }), h('strong', { text: c.title }), ' — ', c.carried_note))));
    }
    const note = h('input', { type: 'text', maxlength: 300, required: true, placeholder: '예: 예상 시간을 20% 더 넉넉히 잡기' });
    root.append(card('고칠 점 한 가지를 다음 계획으로 넘기기',
      h('p', { class: 'muted small', text: '숫자를 보고 정한 고칠 점 한 줄이 새 계획에 함께 저장됩니다.' }),
      planForm({ title: `다음 계획 (${pid(v.plan.id)} 이어서)`, period_start: addDays(v.plan.period_end, 1), period_end: addDays(v.plan.period_end, 7), priority: 2, est_minutes: Math.max(v.est_minutes, 60), success_criteria: '' },
        '다음 계획 만들고 넘기기',
        async (vals) => { await api('POST', '/plans', { ...vals, carried_from_plan_id: v.plan.id, carried_note: note.value }); toast('다음 계획으로 넘겼습니다.'); route(); },
        h('div', { class: 'grid two' }, field('넘길 고칠 점 (한 줄)', note, true)))));
  }
  view.replaceChildren(root);
}

/* ---------------- 내 자료 ---------------- */
async function renderMyData() {
  const meta = await api('GET', '/meta');
  const dump = h('pre', { class: 'schema', text: '(열면 서버에 저장된 값을 불러옵니다)' });
  const details = h('details', {}, h('summary', { text: '지금 서버에 저장된 자료 그대로 보기' }), dump);
  details.addEventListener('toggle', async () => {
    if (!details.open) return;
    dump.textContent = '불러오는 중…';
    try { dump.textContent = JSON.stringify(await api('GET', '/export'), null, 2); } catch (e) { dump.textContent = e.message; }
  });
  const root = h('div', {});
  root.append(card('내 자료 현황',
    h('dl', { class: 'kv' },
      h('dt', { text: '계획' }), h('dd', { text: meta.counts.plans + '개' }),
      h('dt', { text: '할 일' }), h('dd', { text: meta.counts.todos + '개' }),
      h('dt', { text: '실행 기록' }), h('dd', { text: meta.counts.runs + '건' }),
      h('dt', { text: '완료 기록' }), h('dd', { text: meta.counts.completions + '건' }),
      h('dt', { text: '오늘(서울)' }), h('dd', { text: meta.today_kst }))));
  root.append(card('전체 내보내기',
    h('p', { class: 'muted small', text: '내 계획·이력·할 일·태그·실행 기록·완료 기록·5일 관찰 설정을 파일 하나로 내려받습니다. 비밀번호와 로그인 값은 들어 있지 않습니다.' }),
    h('div', { class: 'actions' }, h('button', { class: 'primary', text: '전체 내보내기 (JSON)', onclick: async () => {
      try {
        const res = await fetch('/api/export');
        if (!res.ok) throw new Error('내보내기에 실패했습니다.');
        const url = URL.createObjectURL(await res.blob());
        const a = h('a', { href: url, download: 'pds-diary-export.json' });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast('내보내기 파일을 만들었습니다.');
      } catch (e) { toast(e.message, true); }
    } })), details));
  root.append(card('저장과 공개 방식',
    h('dl', { class: 'kv' },
      h('dt', { text: '저장 위치' }), h('dd', { text: '서버 데이터베이스(Cloudflare D1). 브라우저 저장소를 쓰지 않으므로 새로고침·다른 기기에서도 같은 값이 보입니다.' }),
      h('dt', { text: '공개 범위' }), h('dd', { text: '로그인한 나만 볼 수 있습니다. 링크를 알아도 로그인 없이는 자료가 열리지 않고, 다른 계정으로는 내 자료를 읽거나 고치거나 지울 수 없습니다(서버가 요청마다 확인).' }),
      h('dt', { text: '비밀번호·로그인' }), h('dd', { text: '비밀번호는 되돌릴 수 없는 값으로만 저장됩니다(원문 없음). 로그인 상태는 7일 뒤 끊기고, 로그아웃하거나 비밀번호를 바꾸면 서버에서 바로 끊깁니다.' }),
      h('dt', { text: '날짜·시간 규칙' }), h('dd', { text: '날짜는 서울(Asia/Seoul) 달력 날짜, 시각은 UTC로 저장하고 화면에는 KST로 보여 줍니다. 시간 단위는 모두 분입니다.' }),
      h('dt', { text: '입력한 글자' }), h('dd', { text: '<script> 같은 글자도 실행되지 않고 입력한 그대로 표시됩니다.' }),
      h('dt', { text: '스키마 문서' }), h('dd', {}, h('a', { href: 'https://github.com/Won-22/SKT-ALEPH/blob/main/diary/contracts/pds-schema-v2.json', text: 'contracts/pds-schema-v2.json', rel: 'noopener' })))));
  view.replaceChildren(root);
}

/* ---------------- 라우터 ---------------- */
function parseHash() {
  const [name, qs] = location.hash.replace(/^#\/?/, '').split('?');
  return { tab: TABS[name] ? name : 'plans', q: new URLSearchParams(qs || '') };
}
async function route() {
  if (!me) { showLogin(); return; }
  const { tab, q } = parseHash();
  document.querySelectorAll('#tabs a').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  try { await TABS[tab](q); } catch (e) { view.replaceChildren(card('오류', h('p', { class: 'error', text: e.message }))); }
}
window.addEventListener('hashchange', route);
boot();


/* ---------------- 로그인 · 계정 ---------------- */
function renderShell() {
  $('#tabs').hidden = !me;
  const box = $('#account');
  box.hidden = !me;
  if (me) fill(box, h('span', { text: me.login_id + ' 님으로 로그인함' }), h('button', { class: 'small', text: '로그아웃', onclick: doLogout }));
  else box.replaceChildren();
}

async function boot() {
  try { const d = await api('GET', '/auth/me'); me = d.user; } catch { me = null; }
  if (me && !location.hash) location.hash = '#/plans';
  renderShell();
  route();
}

async function doLogout() {
  try { await api('POST', '/auth/logout'); } catch { /* 이미 끊겼어도 화면은 로그인으로 */ }
  me = null;
  showLogin('로그아웃했습니다. 서버에서도 로그인 상태를 지웠습니다.');
}

function showLogin(notice) {
  renderShell();
  document.querySelectorAll('#tabs a').forEach((a) => a.removeAttribute('aria-current'));
  let mode = 'login';
  const box = h('div', { class: 'auth' });
  function draw(msg) {
    const signup = mode === 'signup';
    const id = h('input', { type: 'text', autocomplete: 'username', required: true, maxlength: 30, autocapitalize: 'none', spellcheck: 'false' });
    const pw = h('input', { type: 'password', autocomplete: signup ? 'new-password' : 'current-password', required: true, minlength: signup ? 8 : null, maxlength: 128 });
    const pw2 = signup ? h('input', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 128 }) : null;
    const err = errorBox();
    const form = h('form', {},
      h('div', { class: 'grid' }, field('아이디', id), field('비밀번호', pw), pw2 ? field('비밀번호 확인', pw2) : null),
      signup ? h('p', { class: 'fine', text: '아이디는 영문 소문자·숫자·._- 3~30자, 비밀번호는 8자 이상입니다. 이메일은 받지 않습니다.' }) : null,
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary', text: signup ? '가입하고 시작' : '로그인' })), err);
    submitForm(form, err, async () => {
      if (signup && pw.value !== pw2.value) throw new Error('비밀번호 확인이 서로 다릅니다.');
      const d = await api('POST', signup ? '/auth/signup' : '/auth/login', { login_id: id.value, password: pw.value });
      me = d.user;
      pw.value = ''; if (pw2) pw2.value = '';
      location.hash = '#/plans';
      renderShell();
      route();
    });
    fill(box,
      h('section', { class: 'card' },
        h('h2', { text: signup ? '가입하기' : '로그인' }),
        msg ? h('p', { class: 'note', role: 'status', text: msg }) : null,
        h('div', { class: 'switch' },
          h('button', { type: 'button', class: 'small', 'aria-pressed': String(!signup), text: '로그인', onclick: () => { mode = 'login'; draw(); } }),
          h('button', { type: 'button', class: 'small', 'aria-pressed': String(signup), text: '가입', onclick: () => { mode = 'signup'; draw(); } })),
        form,
        h('p', { class: 'fine', text: '이 다이어리는 로그인한 사람만 자기 계획·할 일·실행 기록을 봅니다. 로그인하지 않으면 자료 화면 주소를 열어도 이 화면이 나옵니다.' })));
  }
  draw(notice);
  view.replaceChildren(box);
}

async function renderAccount() {
  const d = await api('GET', '/auth/me');
  const root = h('div', {});
  root.append(card('내 계정',
    h('dl', { class: 'kv' },
      h('dt', { text: '아이디' }), h('dd', { text: d.user.login_id }),
      h('dt', { text: '가입 시각' }), h('dd', { text: fmtKST(d.user.created_at) }),
      h('dt', { text: '이 로그인이 끊기는 시각' }), h('dd', { text: fmtKST(d.session.expires_at) + ' (발급 후 ' + d.session.ttl_days + '일. 그 전에도 로그아웃하면 서버에서 바로 끊깁니다)' }))));

  const cur = h('input', { type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
  const nw = h('input', { type: 'password', autocomplete: 'new-password', required: true, minlength: 8, maxlength: 128 });
  const nw2 = h('input', { type: 'password', autocomplete: 'new-password', required: true, maxlength: 128 });
  const err1 = errorBox();
  const pwForm = h('form', {},
    h('div', { class: 'grid two' }, field('현재 비밀번호', cur), field('새 비밀번호 (8자 이상)', nw), field('새 비밀번호 확인', nw2)),
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary', text: '비밀번호 바꾸기' })), err1);
  submitForm(pwForm, err1, async () => {
    if (nw.value !== nw2.value) throw new Error('새 비밀번호 확인이 서로 다릅니다.');
    await api('POST', '/auth/password', { current_password: cur.value, new_password: nw.value });
    toast('비밀번호를 바꿨습니다. 이전에 발급된 로그인은 모두 끊겼고, 이 기기만 새로 로그인된 상태입니다.');
    route();
  });
  root.append(card('비밀번호 바꾸기', pwForm));

  const delPw = h('input', { type: 'password', autocomplete: 'current-password', required: true, maxlength: 128 });
  const err2 = errorBox();
  const delForm = h('form', {},
    h('p', { class: 'warn', text: '계정을 지우면 내 계획·이력·할 일·태그·실행 기록·완료 기록·5일 관찰 설정이 모두 함께 지워지고 되돌릴 수 없습니다. 필요하면 먼저 "내 자료"에서 전체 내보내기를 하세요.' }),
    h('div', { class: 'grid two' }, field('비밀번호 확인', delPw)),
    h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'danger', text: '계정과 내 자료 모두 지우기' })), err2);
  submitForm(delForm, err2, async () => {
    if (!confirm('정말 계정과 모든 자료를 지울까요? 되돌릴 수 없습니다.')) return;
    await api('DELETE', '/auth/account', { password: delPw.value });
    me = null;
    showLogin('계정과 딸린 자료를 모두 지웠습니다.');
  });
  root.append(card('계정 지우기', delForm));
  view.replaceChildren(root);
}

/* ---------------- 5일 관찰 ---------------- */
const POLICY_LABELS = [
  ['day_boundary', '하루의 경계'], ['missing', '값이 빠졌을 때'], ['duplicate', '값이 중복될 때'], ['outlier', '값이 유난히 클 때'],
  ['rounding', '반올림'], ['week_start', '주 시작 요일'], ['order', '입력 순서']
];
const th = (...t) => h('tr', {}, t.map((x) => h('th', { text: x })));
const round1 = (n) => Math.round(n * 10) / 10;

async function renderObserve() {
  const d = await api('GET', '/observation');
  const root = h('div', {});
  const policyCard = (title) => card(title, h('dl', { class: 'kv' }, POLICY_LABELS.flatMap(([k, l]) => [h('dt', { text: l }), h('dd', { text: d.policy[k] })])));

  if (!d.setup) {
    const q = h('input', { type: 'text', maxlength: 200, required: true, placeholder: '예: 계획을 줄이면 하루에 실제로 한 시간이 늘어날까?' });
    const metric = select(Object.fromEntries(Object.entries(d.metrics).map(([k, m]) => [k, m.label + ' — 단위: ' + m.unit])), 'run_minutes');
    const rule = h('input', { type: 'text', maxlength: 300, required: true, placeholder: '예: 하루에 할 일은 3개까지만 잡는다' });
    const err = errorBox();
    const form = h('form', {},
      h('p', { class: 'muted small', text: '1일차에 딱 한 번 정합니다. 저장하면 질문·지표·단위는 고칠 수 없고, 오늘(' + d.today_kst + ')부터의 기록만 셉니다. 값은 실행 기록·완료 기록에서 서버가 계산하므로 따로 입력하지 않습니다.' }),
      h('div', { class: 'grid' }, field('1일차에 답하려는 질문 (한 문장)', q, true), field('볼 지표 하나 (단위 포함)', metric, true), field('처음 계획 규칙 (사람이 읽는 문장)', rule, true)),
      h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary', text: '이대로 정하기' })), err);
    submitForm(form, err, async () => {
      if (!confirm('정한 뒤에는 질문·지표·단위를 고칠 수 없습니다. 이대로 정할까요?')) return;
      await api('POST', '/observation', { question: q.value, metric: metric.value, plan_rule: rule.value });
      toast('정했습니다. 오늘부터 기록을 셉니다.');
      route();
    });
    root.append(card('1일차에 정하기', form), policyCard('처리 규칙 (미리 알려 드립니다)'));
    view.replaceChildren(root);
    return;
  }

  const s = d.setup;
  root.append(card('고정된 질문·지표·단위',
    h('dl', { class: 'kv' },
      h('dt', { text: '답하려는 질문' }), h('dd', { text: s.question }),
      h('dt', { text: '관찰 지표' }), h('dd', { text: s.metric_label }),
      h('dt', { text: '단위' }), h('dd', { text: s.unit }),
      h('dt', { text: '계산 규칙' }), h('dd', { text: '서울 날짜별 값의 합계. 여러 날의 평균 = 합계 ÷ 기록이 있는 일수' }),
      h('dt', { text: '관찰 시작일' }), h('dd', { text: s.locked_on + ' (정한 시각 ' + fmtKST(s.locked_at) + ') — 이날 이후 기록만 셉니다' })),
    h('p', { class: 'small muted', text: '질문·지표·단위·계산 규칙은 고칠 수 없습니다. 바꿀 수 있는 것은 아래 계획 규칙 한 가지, 한 번뿐입니다.' })));
  root.append(policyCard('값을 처리하는 규칙'));

  const ruleBox = card('계획 규칙 (바꿀 수 있는 것 하나)',
    d.rules.map((r) => h('div', { class: 'rule' },
      h('strong', { text: r.version === 1 ? '처음 규칙' : '바꾼 규칙' }), ' — ' + r.rule_text,
      h('div', { class: 'small muted', text: r.version === 1
        ? '정한 시각 ' + fmtKST(r.changed_at)
        : '바꾼 시각 ' + fmtKST(r.changed_at) + ' (서울 날짜 ' + r.changed_on + ') · 이유: ' + r.reason + ' · 이 변경은 기록이 있던 날(' + (r.before_dates || []).join(', ') + ') 뒤에 놓이고, ' + r.changed_on + ' 이후의 기록이 "변경 후"입니다.' }))));
  if (d.rules.length < 2) {
    const nr = h('input', { type: 'text', maxlength: 300, placeholder: '바꿀 규칙 문장' });
    const why = h('input', { type: 'text', maxlength: 300, placeholder: '왜 바꾸는지 한 줄' });
    const err = errorBox();
    const form = h('form', {},
      h('p', { class: d.can_change.ok ? 'muted small' : 'warn', text: d.can_change.why }),
      d.can_change.ok ? h('div', { class: 'grid' }, field('새 계획 규칙', nr, true), field('바꾸는 이유', why, true)) : null,
      d.can_change.ok ? h('div', { class: 'actions' }, h('button', { type: 'submit', class: 'primary', text: '규칙 바꾸기 (한 번만)' })) : null, err);
    submitForm(form, err, async () => {
      if (!confirm('계획 규칙은 한 번만 바꿀 수 있습니다. 지금 바꿀까요?')) return;
      await api('POST', '/observation/rule-change', { rule_text: nr.value, reason: why.value });
      toast('규칙 변경을 기록했습니다.');
      route();
    });
    ruleBox.append(form);
  }
  root.append(ruleBox);

  const unit = s.unit;
  root.append(card('날짜별 기록 (서울 날짜)',
    h('p', { class: 'small muted', text: '기록 있는 날 ' + d.data_days + '일 (이 과제는 서로 다른 날짜 5일이 필요합니다)' }),
    h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' },
      h('thead', {}, th('날짜', '주 시작(월)', '값(' + unit + ')', '기록 수', '구분')),
      h('tbody', {}, d.days.map((x) => h('tr', { class: x.value === null ? 'gap' : '' },
        h('td', { text: x.date }), h('td', { text: x.week_start }),
        h('td', { class: 'num', text: x.value === null ? '기록 없음 (평균에서 제외)' : x.value }),
        h('td', { class: 'num', text: x.records }),
        h('td', {}, x.group ? h('span', { class: 'grp' + (x.group === 'after' ? ' after' : ''), text: x.group === 'after' ? '변경 후' : d.groups ? '변경 전' : '변경 전(아직 안 바꿈)' }) : ''))))))));

  const rows = [['5일 전체', d.overall]];
  if (d.groups) { rows.unshift(['변경 후', d.groups.after]); rows.unshift(['변경 전', d.groups.before]); }
  const diff = d.groups && d.groups.before.avg !== null && d.groups.after.avg !== null ? round1(d.groups.after.avg - d.groups.before.avg) : null;
  root.append(card('합계와 평균 (같은 지표·같은 단위·같은 계산 규칙)',
    h('div', { class: 'tblwrap' }, h('table', { class: 'tbl' },
      h('thead', {}, th('구분', '일수', '합계(' + unit + ')', '평균(' + unit + '/일)', '계산식')),
      h('tbody', {}, rows.map(([l, g]) => h('tr', {},
        h('td', { text: l }), h('td', { class: 'num', text: g.days }), h('td', { class: 'num', text: g.total }),
        h('td', { class: 'num', text: g.avg === null ? '—' : g.avg.toFixed(1) }), h('td', { class: 'formula', text: g.formula })))))),
    diff !== null
      ? h('p', { text: '변경 후 평균 − 변경 전 평균 = ' + (diff > 0 ? '+' : '') + diff.toFixed(1) + ' ' + unit + '/일 (나빠졌어도 그대로 둡니다)' })
      : h('p', { class: 'small muted', text: d.groups ? '변경 전·후 모두 기록이 쌓이면 비교가 나옵니다.' : '계획 규칙을 바꾸면 변경 전·후 비교가 여기에 나옵니다.' })));
  view.replaceChildren(root);
}
