'use strict';
/* 나만의 자리 · 화면. 비밀번호 입력칸은 없다. 기기(패스키)가 개인키로 서명하고, 서버에는 공개키만 저장된다.
   모든 값은 서버(/api)에서 읽고, 사용자가 넣은 글자는 textContent 로만 표시한다(HTML 해석 없음). */
(function () {
  const view = document.getElementById('private-view');
  if (!view) return;

  const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  const fmtKST = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }) + ' KST' : '아직 없음');

  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
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
    if (!res.ok) { const e = new Error(data.error || '요청에 실패했습니다.'); e.status = res.status; throw e; }
    return data;
  }

  // ---- 패스키(WebAuthn) 호출 ----
  const supported = () => window.isSecureContext && 'PublicKeyCredential' in window && navigator.credentials;
  function friendly(e) {
    if (e && e.name === 'NotAllowedError') return '취소되었거나 시간이 지나서 아무것도 저장되지 않았습니다. 다시 시도해 주세요.';
    if (e && e.name === 'InvalidStateError') return '이 기기·보관 장소에는 이미 이 자리의 패스키가 등록되어 있습니다. 다른 기기나 보관 장소(휴대폰, Google 비밀번호 관리자, 보안 키 등)로 등록해 주세요.';
    if (e && e.name === 'SecurityError') return '이 주소(https 또는 localhost)에서만 패스키를 쓸 수 있습니다.';
    return (e && e.message) || '패스키를 처리하지 못했습니다.';
  }
  const creationOptions = (o) => ({
    ...o,
    challenge: unb64u(o.challenge),
    user: { ...o.user, id: unb64u(o.user.id) },
    excludeCredentials: (o.excludeCredentials || []).map((c) => ({ ...c, id: unb64u(c.id) }))
  });
  async function createPasskey(options) {
    const cred = await navigator.credentials.create({ publicKey: creationOptions(options) });
    return {
      id: cred.id, rawId: b64u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || undefined,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: {
        clientDataJSON: b64u(cred.response.clientDataJSON), attestationObject: b64u(cred.response.attestationObject),
        transports: cred.response.getTransports ? cred.response.getTransports() : []
      }
    };
  }
  async function getAssertion(options) {
    const cred = await navigator.credentials.get({
      publicKey: { ...options, challenge: unb64u(options.challenge), allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: unb64u(c.id) })) }
    });
    return {
      id: cred.id, rawId: b64u(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment || undefined,
      clientExtensionResults: cred.getClientExtensionResults(),
      response: {
        clientDataJSON: b64u(cred.response.clientDataJSON), authenticatorData: b64u(cred.response.authenticatorData),
        signature: b64u(cred.response.signature), userHandle: cred.response.userHandle ? b64u(cred.response.userHandle) : undefined
      }
    };
  }

  const msg = (kind, text) => h('p', { class: 'pv-msg ' + kind, role: kind === 'err' ? 'alert' : 'status', text });
  function field(label, input) { return h('label', {}, label, input); }

  // ---- 로그인 전 화면 ----
  function showLoggedOut(note) {
    const out = h('div', {});
    const say = (kind, text) => fill(out, text ? msg(kind, text) : null);
    const handle = h('input', { type: 'text', maxlength: 30, autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', placeholder: '예: my-spot' });
    const name = h('input', { type: 'text', maxlength: 30, placeholder: '예: 이 PC (Windows Hello)', value: '' });
    const unsupported = !supported() ? msg('err', '이 브라우저·주소에서는 패스키를 쓸 수 없습니다. https 주소(또는 localhost)에서 최신 브라우저로 열어 주세요.') : null;

    async function doLogin() {
      say('info', '기기의 확인 창(PIN·지문·얼굴·보안 키)을 기다리는 중…');
      try {
        const options = await api('POST', '/login/options', {});
        const response = await getAssertion(options);
        await api('POST', '/login/verify', { response });
        await load();
      } catch (e) { say('err', e.status ? e.message : friendly(e)); }
    }
    async function doRegister() {
      say('info', '기기의 확인 창을 기다리는 중… 취소하면 아무것도 저장되지 않습니다.');
      try {
        const options = await api('POST', '/register/options', { handle: handle.value, passkey_name: name.value });
        const response = await createPasskey(options);
        await api('POST', '/register/verify', { response });
        await load();
      } catch (e) { say('err', e.status ? e.message : friendly(e)); }
    }

    fill(view,
      note ? msg('info', note) : null,
      unsupported,
      h('div', { class: 'pv-card' },
        h('h3', { text: '패스키로 들어가기' }),
        h('p', { class: 'pv-muted', text: '비밀번호는 없습니다. 서버가 매번 새 질문을 보내고, 이 기기가 개인키로 서명해 답합니다.' }),
        h('div', { class: 'pv-row' }, h('button', { class: 'pv-btn', type: 'button', text: '패스키로 들어가기', onclick: doLogin }))),
      h('div', { class: 'pv-card' },
        h('h3', { text: '새 자리 만들기 (패스키 등록)' }),
        h('p', { class: 'pv-muted', text: '자리 이름을 정하고 패스키를 만들면 이 기기가 키 한 쌍을 만듭니다. 서버에는 공개키만 저장되고, 개인키는 기기 밖으로 나오지 않습니다.' }),
        h('div', { class: 'pv-row' }, field('자리 이름 (영문 소문자·숫자·._-, 3~30자)', handle), field('이 패스키의 이름 (알아볼 수 있게)', name)),
        h('div', { class: 'pv-row' }, h('button', { class: 'pv-btn line', type: 'button', text: '패스키 만들고 시작', onclick: doRegister }))),
      out);
  }

  // ---- 로그인 뒤 화면 ----
  async function showLoggedIn(me) {
    const [items, keys] = await Promise.all([api('GET', '/private/items'), api('GET', '/passkeys')]);
    const out = h('div', {});
    const say = (kind, text) => fill(out, text ? msg(kind, text) : null);
    const reload = () => load();

    async function logout() { try { await api('POST', '/logout'); } finally { await load('로그아웃했습니다. 서버에서도 로그인 상태를 지웠습니다.'); } }
    async function remove(path, ask) {
      if (!confirm(ask)) return;
      try { await api('DELETE', path); await reload(); } catch (e) { say('err', e.message); }
    }

    const title = h('input', { type: 'text', maxlength: 100 });
    const body = h('textarea', { rows: 3, maxlength: 1000 });
    const itemForm = h('form', { onsubmit: async (e) => {
      e.preventDefault();
      try { await api('POST', '/private/items', { title: title.value, body: body.value }); await reload(); } catch (err) { say('err', err.message); }
    } }, h('div', { class: 'pv-row' }, field('제목', title), field('내용', body)), h('div', { class: 'pv-row' }, h('button', { class: 'pv-btn line small', type: 'submit', text: '항목 추가' })));

    const pname = h('input', { type: 'text', maxlength: 30, placeholder: '예: 휴대폰 (Google 비밀번호 관리자)' });
    async function addPasskey() {
      say('info', '기기의 확인 창을 기다리는 중… 취소하면 아무것도 저장되지 않습니다.');
      try {
        const options = await api('POST', '/passkeys/options', { passkey_name: pname.value });
        const response = await createPasskey(options);
        await api('POST', '/passkeys/verify', { response });
        await reload();
      } catch (e) { say('err', e.status ? e.message : friendly(e)); }
    }

    fill(view,
      h('div', { class: 'pv-card' },
        h('div', { class: 'pv-top' },
          h('p', {}, h('strong', { text: me.account.handle }), ' 님의 자리 · 이 로그인은 ' + fmtKST(me.session.expires_at) + ' 에 끊깁니다(' + me.session.ttl_days + '일).'),
          h('button', { class: 'pv-btn line small', type: 'button', text: '로그아웃', onclick: logout }))),
      h('div', { class: 'pv-card' },
        h('h3', { text: `내 비공개 항목 (${items.rows.length}개)` }),
        items.rows.length ? items.rows.map((it) => h('div', { class: 'pv-item' },
          h('h4', { text: it.title }), h('p', { text: it.body }),
          h('p', { class: 'pv-muted', text: fmtKST(it.created_at) }),
          h('div', { class: 'pv-row' }, h('button', { class: 'pv-btn danger small', type: 'button', text: '지우기', onclick: () => remove('/private/items/' + it.id, `"${it.title}" 항목을 지울까요?`) })))) : h('p', { class: 'pv-muted', text: '아직 항목이 없습니다.' }),
        itemForm),
      h('div', { class: 'pv-card' },
        h('h3', { text: `내 패스키 (${keys.rows.length}개)` }),
        h('p', { class: 'pv-muted', text: '서버에는 아래 공개키만 저장되어 있습니다(비밀번호가 아니며, 이것만으로는 로그인할 수 없습니다). 개인키는 각 기기·보관 장소에만 있습니다. 하나만 남으면 지울 수 없습니다: 하나도 없으면 이 자리에 다시 들어올 방법이 없기 때문입니다.' }),
        keys.rows.map((k) => h('div', { class: 'pv-item' },
          h('h4', { text: k.name + (k.is_current ? ' (지금 로그인한 패스키)' : '') }),
          h('p', { class: 'pv-muted', text: `등록 ${fmtKST(k.created_at)} · 마지막 사용 ${fmtKST(k.last_used_at)} · ${k.device_type === 'multiDevice' ? '여러 기기에 동기화됨' : '이 기기에만 있음'}` }),
          h('p', { class: 'pv-key', text: '공개키(서버 저장값): ' + k.public_key.slice(0, 48) + '…' }),
          h('div', { class: 'pv-row' }, h('button', { class: 'pv-btn danger small', type: 'button', text: '이 패스키 지우기', onclick: () => remove('/passkeys/' + k.id, `"${k.name}" 패스키를 지울까요? 이 패스키로는 더 이상 들어올 수 없습니다.`) })))),
        h('div', { class: 'pv-row' }, field('새 패스키의 이름', pname), h('button', { class: 'pv-btn line', type: 'button', text: '패스키 추가 (다른 기기·보관 장소)', onclick: addPasskey }))),
      out);
  }

  async function load(note) {
    try {
      const me = await api('GET', '/session');
      if (me.account) await showLoggedIn(me); else showLoggedOut(note);
    } catch (e) { fill(view, msg('err', e.message)); }
  }
  load();
})();
