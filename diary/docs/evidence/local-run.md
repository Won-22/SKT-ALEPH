# T07 인증 증거 기록 (로컬 서버 · 같은 Worker 코드)

실행 시각: 2026-09-29T01:23:08.937Z · 계정: `evid-a-c778b8`, `evid-b-4c6bc4` (이 기록을 위해 만든 검사용 계정) · 비밀번호·로그인 값은 앞 4글자만 보이고 가렸습니다.

## 카드 1·4 준비: 계정 두 개를 만들고 각각 자료를 넣음
**1. 계정 A 가입**
```
POST /api/auth/signup
본문: {"login_id":"evid-a-c778b8","password":"●●●●●●●●(가림)"}
→ 201
Set-Cookie: sid=GmsS…(가림); Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure
응답: {"user":{"login_id":"evid-a-c778b8"},"session_expires_at":"2026-10-06T01:23:08.974Z"}
```
**2. 계정 B 가입 (A 와 같은 비밀번호)**
```
POST /api/auth/signup
본문: {"login_id":"evid-b-4c6bc4","password":"●●●●●●●●(가림)"}
→ 201
Set-Cookie: sid=UsxC…(가림); Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure
응답: {"user":{"login_id":"evid-b-4c6bc4"},"session_expires_at":"2026-10-06T01:23:08.990Z"}
```
**3. A 가 계획 넣기**
```
POST /api/plans
Cookie: sid=GmsS…(가림)
본문: {"period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"title":"A의 계획"}
→ 200
응답: {"plan":{"id":1,"title":"A의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"carried_from_plan_id":null,"carried_note":null,"created_at":"2026-09-29T01:23:08.991Z","updated_at":"2026-09-29T01:23:08.991Z"},"revisions":[{"id":1,"plan_id":1,"revision_no":1,"title":"A의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criter …(줄임)
```
**4. A 가 할 일 넣기**
```
POST /api/todos
Cookie: sid=GmsS…(가림)
본문: {"plan_id":1,"title":"A의 할 일"}
→ 200
응답: {"id":1,"plan_id":1,"title":"A의 할 일","due_date":null,"priority":2,"est_minutes":0,"created_at":"2026-09-29T01:23:08.993Z","updated_at":"2026-09-29T01:23:08.993Z","status":"todo","completed_at":null,"actual_minutes":0,"run_count":0,"tags":[]}
```
**5. B 가 계획 넣기**
```
POST /api/plans
Cookie: sid=UsxC…(가림)
본문: {"period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"title":"B의 계획"}
→ 200
응답: {"plan":{"id":2,"title":"B의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"carried_from_plan_id":null,"carried_note":null,"created_at":"2026-09-29T01:23:08.993Z","updated_at":"2026-09-29T01:23:08.993Z"},"revisions":[{"id":2,"plan_id":2,"revision_no":1,"title":"B의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criter …(줄임)
```
**6. B 가 할 일 넣기**
```
POST /api/todos
Cookie: sid=UsxC…(가림)
본문: {"plan_id":2,"title":"B의 할 일"}
→ 200
응답: {"id":2,"plan_id":2,"title":"B의 할 일","due_date":null,"priority":2,"est_minutes":0,"created_at":"2026-09-29T01:23:08.994Z","updated_at":"2026-09-29T01:23:08.994Z","status":"todo","completed_at":null,"actual_minutes":0,"run_count":0,"tags":[]}
```

## 카드 4: 남의 자료가 안 열리는 것
### 성공한 요청 (자기 자료)
**7. A 가 자기 계획 읽기 → 성공**
```
GET /api/plans/1
Cookie: sid=GmsS…(가림)
→ 200
응답: {"plan":{"id":1,"title":"A의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"carried_from_plan_id":null,"carried_note":null,"created_at":"2026-09-29T01:23:08.991Z","updated_at":"2026-09-29T01:23:08.991Z"},"revisions":[{"id":1,"plan_id":1,"revision_no":1,"title":"A의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criter …(줄임)
```
### 건수 기록 (거절 시도 전)
**8. (건수 확인) 내 계획·할 일 수**
```
GET /api/meta
Cookie: sid=GmsS…(가림)
→ 200
응답: {"today_kst":"2026-09-29","timezone":"Asia/Seoul","schema_version":3,"sorts":{"due":"마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 ID 순","priority":"우선순위 높은 순 → 같으면 마감일 빠른 순 → 같으면 ID 순","created":"등록 순(ID 순)","est":"예상 시간 긴 순 → 같으면 ID 순","title":"제목 가나다 순 → 같으면 ID 순"},"counts":{"plans":1,"todos":1,"runs":0,"completions":0}}
```
**9. (건수 확인) 내 계획·할 일 수**
```
GET /api/meta
Cookie: sid=UsxC…(가림)
→ 200
응답: {"today_kst":"2026-09-29","timezone":"Asia/Seoul","schema_version":3,"sorts":{"due":"마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 ID 순","priority":"우선순위 높은 순 → 같으면 마감일 빠른 순 → 같으면 ID 순","created":"등록 순(ID 순)","est":"예상 시간 긴 순 → 같으면 ID 순","title":"제목 가나다 순 → 같으면 ID 순"},"counts":{"plans":1,"todos":1,"runs":0,"completions":0}}
```
시도 전: A = {"plans":1,"todos":1,"runs":0,"completions":0}, B = {"plans":1,"todos":1,"runs":0,"completions":0}

### A 가 B 의 자료를 건드리는 요청 (모두 거절돼야 함)
**10. A → B 의 계획 읽기**
```
GET /api/plans/2
Cookie: sid=GmsS…(가림)
→ 404
응답: {"error":"계획을 찾을 수 없습니다."}
```
**11. A → B 의 계획 고치기**
```
PUT /api/plans/2
Cookie: sid=GmsS…(가림)
본문: {"period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"title":"탈취"}
→ 404
응답: {"error":"계획을 찾을 수 없습니다."}
```
**12. A → B 의 할 일 고치기**
```
PUT /api/todos/2
Cookie: sid=GmsS…(가림)
본문: {"title":"탈취"}
→ 404
응답: {"error":"할 일을 찾을 수 없습니다."}
```
**13. A → B 의 할 일 지우기**
```
DELETE /api/todos/2
Cookie: sid=GmsS…(가림)
→ 404
응답: {"error":"할 일을 찾을 수 없습니다."}
```
### 반대 방향: B 가 A 의 자료를 건드리는 요청
**14. B → A 의 계획 읽기**
```
GET /api/plans/1
Cookie: sid=UsxC…(가림)
→ 404
응답: {"error":"계획을 찾을 수 없습니다."}
```
**15. B → A 의 계획 고치기**
```
PUT /api/plans/1
Cookie: sid=UsxC…(가림)
본문: {"period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"title":"탈취"}
→ 404
응답: {"error":"계획을 찾을 수 없습니다."}
```
**16. B → A 의 할 일 고치기**
```
PUT /api/todos/1
Cookie: sid=UsxC…(가림)
본문: {"title":"탈취"}
→ 404
응답: {"error":"할 일을 찾을 수 없습니다."}
```
**17. B → A 의 할 일 지우기**
```
DELETE /api/todos/1
Cookie: sid=UsxC…(가림)
→ 404
응답: {"error":"할 일을 찾을 수 없습니다."}
```
### 주소·헤더·본문에 다른 계정을 적어 보냄 (그래도 내 자료만 돌아와야 함)
**18. 주소에 B 적기 (?user_id, ?owner)**
```
GET /api/plans?user_id=2&owner=evid-b-4c6bc4
Cookie: sid=GmsS…(가림)
→ 200
응답: {"rows":[{"id":1,"title":"A의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"carried_from_plan_id":null,"carried_note":null,"created_at":"2026-09-29T01:23:08.991Z","updated_at":"2026-09-29T01:23:08.991Z","revision_count":1,"todo_count":1}]}
```
**19. 헤더에 B 적기 (X-User-Id, X-Login-Id)**
```
GET /api/plans
Cookie: sid=GmsS…(가림)
x-user-id: 2
x-login-id: evid-b-4c6bc4
→ 200
응답: {"rows":[{"id":1,"title":"A의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"carried_from_plan_id":null,"carried_note":null,"created_at":"2026-09-29T01:23:08.991Z","updated_at":"2026-09-29T01:23:08.991Z","revision_count":1,"todo_count":1}]}
```
**20. 본문에 B 적기 (user_id, owner)**
```
POST /api/plans
Cookie: sid=GmsS…(가림)
본문: {"period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"title":"A가 만든 계획(본문에 B 적음)","user_id":2,"owner":"evid-b-4c6bc4"}
→ 200
응답: {"plan":{"id":3,"title":"A가 만든 계획(본문에 B 적음)","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"carried_from_plan_id":null,"carried_note":null,"created_at":"2026-09-29T01:23:09.010Z","updated_at":"2026-09-29T01:23:09.010Z"},"revisions":[{"id":3,"plan_id":3,"revision_no":1,"title":"A가 만든 계획(본문에 B 적음)","period_start":"2026-09-29","period_end":"2026-10-05","p …(줄임)
```
**21. 그 계획이 B 목록에 생겼는지**
```
GET /api/plans
Cookie: sid=UsxC…(가림)
→ 200
응답: {"rows":[{"id":2,"title":"B의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"carried_from_plan_id":null,"carried_note":null,"created_at":"2026-09-29T01:23:08.993Z","updated_at":"2026-09-29T01:23:08.993Z","revision_count":1,"todo_count":1}]}
```
→ B 목록에 "A가 만든 계획(본문에 B 적음)" 이 있는가: **없다(정상)**
### 로그인하지 않은 채로 직접 요청
**22. 로그인 없이 계획 목록**
```
GET /api/plans
→ 401
응답: {"error":"로그인이 필요합니다."}
```
**23. 로그인 없이 남의 계획 ID 직접**
```
GET /api/plans/2
→ 401
응답: {"error":"로그인이 필요합니다."}
```
### 목록 응답에 남의 자료가 섞이는지
**24. A 의 할 일 목록**
```
GET /api/todos
Cookie: sid=GmsS…(가림)
→ 200
응답: {"rows":[{"id":1,"plan_id":1,"title":"A의 할 일","due_date":null,"priority":2,"est_minutes":0,"created_at":"2026-09-29T01:23:08.993Z","updated_at":"2026-09-29T01:23:08.993Z","status":"todo","completed_at":null,"actual_minutes":0,"run_count":0,"tags":[]}],"sort":{"key":"due","label":"마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 ID 순"},"processed_on":"server"}
```
**25. B 의 할 일 목록**
```
GET /api/todos
Cookie: sid=UsxC…(가림)
→ 200
응답: {"rows":[{"id":2,"plan_id":2,"title":"B의 할 일","due_date":null,"priority":2,"est_minutes":0,"created_at":"2026-09-29T01:23:08.994Z","updated_at":"2026-09-29T01:23:08.994Z","status":"todo","completed_at":null,"actual_minutes":0,"run_count":0,"tags":[]}],"sort":{"key":"due","label":"마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 ID 순"},"processed_on":"server"}
```
→ A 목록의 제목: ["A의 할 일"] / B 목록의 제목: ["B의 할 일"] — 서로의 것이 하나도 없음: **맞다**
### 거절 전후 건수 비교 (거절하기 전에 저장부터 하고 있지 않은지)
**26. (건수 확인) 내 계획·할 일 수**
```
GET /api/meta
Cookie: sid=GmsS…(가림)
→ 200
응답: {"today_kst":"2026-09-29","timezone":"Asia/Seoul","schema_version":3,"sorts":{"due":"마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 ID 순","priority":"우선순위 높은 순 → 같으면 마감일 빠른 순 → 같으면 ID 순","created":"등록 순(ID 순)","est":"예상 시간 긴 순 → 같으면 ID 순","title":"제목 가나다 순 → 같으면 ID 순"},"counts":{"plans":2,"todos":1,"runs":0,"completions":0}}
```
**27. (건수 확인) 내 계획·할 일 수**
```
GET /api/meta
Cookie: sid=UsxC…(가림)
→ 200
응답: {"today_kst":"2026-09-29","timezone":"Asia/Seoul","schema_version":3,"sorts":{"due":"마감일 빠른 순 → 같으면 우선순위 높은 순 → 같으면 ID 순","priority":"우선순위 높은 순 → 같으면 마감일 빠른 순 → 같으면 ID 순","created":"등록 순(ID 순)","est":"예상 시간 긴 순 → 같으면 ID 순","title":"제목 가나다 순 → 같으면 ID 순"},"counts":{"plans":1,"todos":1,"runs":0,"completions":0}}
```
시도 후: A = {"plans":2,"todos":1,"runs":0,"completions":0}, B = {"plans":1,"todos":1,"runs":0,"completions":0}
→ B 의 건수는 시도 전과 **같다**, A 는 본문 변조 요청으로 내 계획 1건이 늘어난 것만 다르다(계획 1 → 2).

### 거절을 만드는 소스 위치
- `src/worker.js:254` ownedPlan · `:259` ownedTodo · `:264` ownedRun — 남의 자료와 없는 자료를 구분하지 않고 같은 404 를 던진다
- `src/worker.js:693` 로그인하지 않은 요청은 여기서 401 (가입·로그인·로그아웃·내 상태 확인만 그 앞에서 처리)
- 목록·집계는 `WHERE ... user_id = ?` 로 걸러진다(listPlans·listTodos·listRuns·review·exportAll)

## 카드 3: 들어온 사람을 기억하는 방식 (세션 쿠키)
로그인 상태의 성공 응답과, 로그아웃한 뒤 **같은 주소·같은 방식·같은 값**으로 다시 요청한 거절 응답을 나란히 둡니다.
**28. 로그인**
```
POST /api/auth/login
본문: {"login_id":"evid-a-c778b8","password":"●●●●●●●●(가림)"}
→ 200
Set-Cookie: sid=lwSo…(가림); Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure
응답: {"user":{"login_id":"evid-a-c778b8"},"session_expires_at":"2026-10-06T01:23:09.028Z"}
```
**29. 로그인한 상태: 내 계획 목록 → 성공**
```
GET /api/plans
Cookie: sid=lwSo…(가림)
→ 200
응답: {"rows":[{"id":3,"title":"A가 만든 계획(본문에 B 적음)","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"carried_from_plan_id":null,"carried_note":null,"created_at":"2026-09-29T01:23:09.010Z","updated_at":"2026-09-29T01:23:09.010Z","revision_count":1,"todo_count":0},{"id":1,"title":"A의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success …(줄임)
```
**30. 내 상태 확인 (만료 시각)**
```
GET /api/auth/me
Cookie: sid=lwSo…(가림)
→ 200
응답: {"user":{"login_id":"evid-a-c778b8","created_at":"2026-09-29T01:23:08.974Z"},"session":{"expires_at":"2026-10-06T01:23:09.028Z","ttl_days":7}}
```
**31. 로그아웃**
```
POST /api/auth/logout
Cookie: sid=lwSo…(가림)
→ 200
Set-Cookie: sid=(비어 있음 = 삭제); Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure
응답: {"ok":true}
```
**32. 로그아웃한 뒤 같은 값으로 같은 요청 → 거절**
```
GET /api/plans
Cookie: sid=lwSo…(가림)
→ 401
응답: {"error":"로그인이 필요합니다."}
```
→ 두 요청은 주소(`GET /api/plans`)와 쿠키 값(`sid=lwSo…(가림)`)이 같고 다른 것은 로그아웃 여부뿐이다: 성공 200 / 거절 401
- 사람을 알아보는 것: 서버가 발급한 무작위 세션 값(쿠키 `sid`, HttpOnly). 만료: 7일(위 응답의 expires_at). 주소창(URL)에는 실리지 않는다.
### 비밀번호를 바꾸면 이전 값이 끊기는지
**33. 두 기기에서 로그인 (기기 1)**
```
POST /api/auth/login
본문: {"login_id":"evid-a-c778b8","password":"●●●●●●●●(가림)"}
→ 200
Set-Cookie: sid=j3yO…(가림); Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure
응답: {"user":{"login_id":"evid-a-c778b8"},"session_expires_at":"2026-10-06T01:23:09.045Z"}
```
**34. 두 기기에서 로그인 (기기 2)**
```
POST /api/auth/login
본문: {"login_id":"evid-a-c778b8","password":"●●●●●●●●(가림)"}
→ 200
Set-Cookie: sid=3Hc4…(가림); Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure
응답: {"user":{"login_id":"evid-a-c778b8"},"session_expires_at":"2026-10-06T01:23:09.060Z"}
```
**35. 기기 1 에서 비밀번호 변경**
```
POST /api/auth/password
Cookie: sid=j3yO…(가림)
본문: {"current_password":"●●●●●●●●(가림)","new_password":"●●●●●●●●(가림)"}
→ 200
Set-Cookie: sid=ukA9…(가림); Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure
응답: {"ok":true,"session_expires_at":"2026-10-06T01:23:09.089Z"}
```
**36. 기기 2 의 이전 값으로 요청 → 거절**
```
GET /api/plans
Cookie: sid=3Hc4…(가림)
→ 401
응답: {"error":"로그인이 필요합니다."}
```
**37. 기기 1 의 이전 값으로 요청 → 거절**
```
GET /api/plans
Cookie: sid=j3yO…(가림)
→ 401
응답: {"error":"로그인이 필요합니다."}
```
**38. 기기 1 의 새 값으로 요청 → 성공**
```
GET /api/plans
Cookie: sid=ukA9…(가림)
→ 200
응답: {"rows":[{"id":3,"title":"A가 만든 계획(본문에 B 적음)","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success_criteria":"증거 기록용","est_minutes":60,"carried_from_plan_id":null,"carried_note":null,"created_at":"2026-09-29T01:23:09.010Z","updated_at":"2026-09-29T01:23:09.010Z","revision_count":1,"todo_count":0},{"id":1,"title":"A의 계획","period_start":"2026-09-29","period_end":"2026-10-05","priority":2,"success …(줄임)
```

## 카드 2: 비밀번호를 어떻게 맡아 두는지
DB 의 users 표에 실제로 저장된 값 (계정 A·B 는 **같은 비밀번호**로 만들었다):
```
evid-a-c778b8
  pw_algo = PBKDF2-HMAC-SHA256
  pw_iter = 100000
  pw_salt = Bpdu1Ezwk2GIzzWUZ089rg==
  pw_hash = D02ZXNRqy5Kx2gD+6RjJD8MYjwUs+fsa8231fsqWovY=
evid-b-4c6bc4
  pw_algo = PBKDF2-HMAC-SHA256
  pw_iter = 100000
  pw_salt = 2lNjxYqibvJPhYkcFcPHNg==
  pw_hash = b8w20BEnwqDNTOpD12C07lH36lBkA0w8ZOx7yaj/qIc=
```
- 입력한 비밀번호 글자가 저장된 값에 보이는가: **보이지 않는다**
- 같은 비밀번호인데 두 계정의 소금이 다른가: **다르다**, 저장된 해시가 다른가: **다르다**
### 위 모든 요청·응답에 비밀번호 원문이 있는가
**없다** — 이 문서 전체(가린 요청 본문·응답·Set-Cookie 포함)를 검사한 결과.
**39. (정리) 계정 A 삭제**
```
DELETE /api/auth/account
Cookie: sid=ukA9…(가림)
본문: {"password":"●●●●●●●●(가림)"}
→ 200
Set-Cookie: sid=(비어 있음 = 삭제); Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure
응답: {"deleted":true}
```
**40. (정리) 계정 B 삭제**
```
DELETE /api/auth/account
Cookie: sid=UsxC…(가림)
본문: {"password":"●●●●●●●●(가림)"}
→ 200
Set-Cookie: sid=(비어 있음 = 삭제); Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure
응답: {"deleted":true}
```
