# 플랜두씨 다이어리 2 — 인증 구현 설명서

- 결과물(첫 화면은 로그인 화면): https://pds-diary-2.pds-diary.workers.dev
- 이어 붙인 6번 결과(그대로 공개 유지): https://pds-diary.pds-diary.workers.dev — 소스는 commit `c5e59701285ae58f83a3761816610e2fa0a5e7a4` (7번 소스 이력에 조상으로 들어 있음)
- 이 설명서가 가리키는 소스: commit `1946c2f060fb7913903b6061b5a9fe8ca98dfba5` (아래 링크는 모두 이 commit 의 고정 주소)
- 비밀번호·로그인 값·비밀키는 이 문서 어디에도 원문이 없습니다. 증거 기록의 값은 앞 4글자만 보이게 가렸습니다.

> 설명서 여섯 항목: ① 무엇으로 붙였나 · ② 왜 그걸 골랐나 · ③ 어디를 어떻게 고쳤나 · ④ 안 열리는 것을 확인한 기록 · ⑤ AI와 나 · ⑥ 아직 못 막은 것

---

## ① 무엇으로 붙였나

**직접 구현했습니다.** 인증 라이브러리도, 외부 인증 서비스도 쓰지 않았습니다.

| 부분 | 쓴 것 |
|---|---|
| 비밀번호 저장 | 웹 표준 WebCrypto 의 **PBKDF2-HMAC-SHA256**, 100000회, 계정마다 새 16바이트 소금, 32바이트 결과 |
| 로그인 상태 | 서버가 만든 무작위 32바이트 세션 값을 쿠키 `sid`(HttpOnly · SameSite=Strict · https 에서 Secure)로 주고, DB 에는 그 값의 SHA-256 만 저장. 만료 7일 |
| 저장소 | Cloudflare D1 (`users`, `sessions` 표) |
| 자료 접근 통제 | 세션이 알려 주는 `user_id` 로만 자료를 찾음 (요청의 주소·헤더·본문에 적힌 사용자 값은 쓰지 않음) |

- 인증에 쓴 **라이브러리·서비스: 없음** (이름·버전을 적을 것이 없음). 런타임이 제공하는 WebCrypto 만 사용.
- 실행 환경: Cloudflare Workers(compatibility_date `2025-09-01`) + D1. 배포 도구 wrangler 4.136.1. 로컬 검사는 Node 24.
- 7번용으로 **새 Worker(`pds-diary-2`)와 새 D1 데이터베이스**를 만들었습니다. 6번 Worker 와 DB 는 그대로라서 6번 제출 링크는 계속 로그인 없이 열립니다.

## ② 왜 그걸 골랐나

**한 문장:** 이 과제는 "붙였다"가 아니라 "저장된 비밀번호 값을 보이고, 거절을 만드는 소스 위치를 적어라"를 요구하므로, 그 두 가지를 내 코드와 내 DB 에서 그대로 보여 줄 수 있는 직접 구현을 골랐습니다.

함께 검토했지만 고르지 않은 방법:

| 검토한 방법 | 고르지 않은 이유 |
|---|---|
| 인증 라이브러리(예: Better Auth 등) | 코드는 줄지만, 라이브러리가 하는 일과 내가 확인한 일을 나눠 설명하는 부담이 늘고, 카드 2·4 의 증거(저장값·거절 위치)가 라이브러리 안쪽으로 들어감 |
| 외부 인증 서비스(예: Clerk, Supabase Auth 등) | 가장 빠르지만 비밀번호 저장값을 우리 DB 에서 보여 줄 수 없어 카드 2 와 맞지 않고, 남의 자료 차단(카드 4)도 서비스 연동을 따로 증명해야 함 |

직접 구현이 가능했던 이유: Workers 가 PBKDF2 를 내장 지원하고(추가 의존성 0), 세션 값을 서버가 무작위로 만들어 DB 에만 해시로 두므로 **서명용 비밀키가 아예 없습니다**(그래서 키가 코드·배포 파일·Git 어디에도 있을 수 없음).

비밀번호를 되돌릴 수 없게 만드는 방법으로 PBKDF2 를 고른 이유: bcrypt·argon2·scrypt 는 Workers 에서 별도 라이브러리(wasm)가 필요하고, PBKDF2 만 런타임에 내장돼 있습니다. 대신 반복 횟수는 Workers 상한(10만 회)이라 권장치보다 낮습니다(⑥에 적음).

## ③ 어디를 어떻게 고쳤나

소스 링크 기준: `https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/`

**가입·로그인·로그아웃·자료 조회 네 흐름이 소스를 지나는 곳** ([src/worker.js](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js))

| 흐름 | 지나는 곳 |
|---|---|
| 가입 | 화면 `showLogin`(public/app.js) → `POST /api/auth/signup` → [`signup` L189](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L189) → [`hashPassword` L132](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L132)(소금 생성 + PBKDF2) → `users` INSERT(같은 아이디면 409) → [`startSession` L158](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L158) → 쿠키 발급 |
| 로그인 | `POST /api/auth/login` → [`login` L211](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L211) → 아이디 조회 → [`verifyPassword` L136](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L136)(같은 소금·횟수로 계산해 일정 시간 비교) → 실패면 아이디 유무와 상관없이 같은 401 → 성공이면 `startSession` |
| 로그아웃 | `POST /api/auth/logout` → [`logout` L221](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L221) → `sessions` 행 삭제(서버에서 끊김) + 쿠키 삭제 지시 |
| 자료 조회 | `GET /api/...` → [`route` L680](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L680) 의 [`currentUser` 호출 L693](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L693)(쿠키 → SHA-256 → `sessions` 조회 · 만료 확인, 없으면 401) → 각 처리 함수가 `WHERE user_id = ?` 또는 [`ownedPlan` L254](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L254)·[`ownedTodo` L259](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L259)·[`ownedRun` L264](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L264) 로 주인을 확인 |

**그 밖에 고친 곳**

- DB: [schema.sql](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/schema.sql) 에 `users`·`sessions`·`observation`·`plan_rules` 표, `plans.user_id`(주인), `runs` 중복 방지 색인, `todo_view` 에 `user_id` 추가. 이미 쌓인 6번 DB 를 잇는 [migrations/0002_auth.sql](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/migrations/0002_auth.sql) 도 함께 검사합니다(`npm run check:schema`).
- 화면: [public/app.js](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/public/app.js) 에 로그인·가입 화면, 헤더의 로그아웃, 내 계정(비밀번호 변경·계정 삭제), 5일 관찰 탭. 로그인하지 않으면 어떤 주소를 열어도 로그인 화면이 나옵니다.
- 계정 삭제: `users` 행을 지우면 `ON DELETE CASCADE` 로 계획·할 일·태그·실행 기록·완료 기록·이력·5일 관찰·세션이 함께 지워집니다(화면에도 그렇게 적어 둠). 내보내기 파일에는 비밀번호 값·세션 값이 들어가지 않습니다.
- **6번 자료를 내 계정으로 옮긴 방법**: 6번 DB 는 건드리지 않고, 새 DB 에 6번 자료를 복사했습니다(`wrangler d1 export … --no-schema` → 새 DB 에 import). 이때 `plans.user_id` 가 비어 있어 어느 계정에도 보이지 않다가, 내 계정을 만든 뒤 한 줄로 주인을 붙였습니다: `UPDATE plans SET user_id = (SELECT id FROM users WHERE login_id = '<내 아이디>') WHERE user_id IS NULL`. 이 과정(6번 자료가 든 DB → 0002 적용 → 다른 계정에는 안 보임 → 옮기면 계획·이력·할 일·태그·완료·실행 기록이 그대로 보임)은 자동 검사 `scripts/api-test.mjs` 6장에서 확인합니다.
- 다른 사이트에서 온 쓰기 요청은 [Origin 확인 L753](https://github.com/Won-22/SKT-ALEPH/blob/1946c2f060fb7913903b6061b5a9fe8ca98dfba5/diary/src/worker.js#L753) 으로 403, JSON 이 아닌 본문은 415.

## ④ 안 열리는 것을 확인한 기록

전체 요청·응답 원문(비밀값 가림)은 [docs/evidence/local-run.md](https://github.com/Won-22/SKT-ALEPH/blob/b07600cf09c481f0e76f56db7ad0e0238ea4a0ed/diary/docs/evidence/local-run.md) 에 있습니다(로컬 실행 · 같은 Worker 코드). 배포 서버에서 같은 스크립트를 돌린 기록은 [docs/evidence/live-run.md](https://github.com/Won-22/SKT-ALEPH/blob/main/diary/docs/evidence/live-run.md) 에 추가합니다. 다섯 가지 확인마다 성공한 요청과 거절된 요청을 나란히 적습니다.

| # | 확인 | 성공한 요청 | 거절된 요청 |
|---|---|---|---|
| 1 | 로그인 없이 열면 자료 대신 거절/로그인 화면 | 로그인한 상태의 `GET /api/plans` → **200** | 로그인 없는 `GET /api/plans`, `GET /api/plans/<남의 ID>` → **401** |
| 2 | 로그아웃하면 같은 값으로 다시 요청해도 거절 | 로그인한 채 `GET /api/plans` (`Cookie: sid=lwSo…(가림)`) → **200** | 로그아웃 뒤 같은 주소·같은 쿠키 값 → **401** (서버에서 세션 행이 지워짐) |
| 3 | 비밀번호를 바꾸면 이전에 발급한 값이 끊김 | 바꾼 기기의 새 값 `GET /api/plans` → **200** | 바꾸기 전에 발급한 기기 1·기기 2 의 값 → **401** 둘 다 |
| 4 | 남의 자료 읽기·고치기·지우기 (양방향) | A 가 자기 계획 읽기 → **200** | A→B, B→A 로 계획 읽기·고치기, 할 일 고치기·지우기 8건 → 모두 **404**(존재 자체를 감춤), 시도 전후 B 의 건수 동일 |
| 5 | 주소·헤더·본문에 다른 계정을 적어도 내 자료만 | 내 요청 → 내 자료 | `?user_id=`, `X-User-Id`, 본문 `user_id` 를 B 로 적어도 A 의 자료·A 의 계획으로만 처리(B 목록에 안 생김) |

- 거절 응답이 403 이 아니라 **404** 인 이유: 남의 자료와 없는 자료를 구분해 알려 주지 않으려고(존재를 숨김). 거절을 만드는 소스 위치는 위 `ownedPlan`/`ownedTodo`/`ownedRun`(L254·L259·L264) 하나뿐이고, 목록 계열은 `WHERE user_id = ?`(예: `listPlans` L296, `listTodos` L366, `listRuns` L458)로 걸러집니다.
- 목록 응답: A 의 할 일 목록에는 A 것만, B 목록에는 B 것만 들어 있음(증거 기록 24·25번).
- 자동 검사 `npm test` 는 위 다섯 가지를 포함해 **197개 검사**를 돌립니다. 소유권 확인을 일부러 빼 보면 남의 자료 관련 검사가 실제로 실패하는 것도 확인했습니다.
- 카드 2 증거(저장된 비밀번호 값, 같은 비밀번호인데 다른 저장값)는 증거 기록의 마지막 장에 있고, 값 예시는 다음과 같습니다(로컬 검사 계정 두 개, 같은 비밀번호로 만듦):

```
evid-a-c778b8   pw_algo=PBKDF2-HMAC-SHA256  pw_iter=100000  pw_salt=Bpdu1Ezwk2GIzzWUZ089rg==  pw_hash=D02ZXNRqy5Kx2gD+6RjJD8MYjwUs+fsa8231fsqWovY=
evid-b-4c6bc4   pw_algo=PBKDF2-HMAC-SHA256  pw_iter=100000  pw_salt=2lNjxYqibvJPhYkcFcPHNg==  pw_hash=b8w20BEnwqDNTOpD12C07lH36lBkA0w8ZOx7yaj/qIc=
```

## ⑤ AI와 나

- **AI 가 한 일**: 인증 방식 비교와 추천, 서버(가입·로그인·세션·주인 확인)·DB·화면 구현, 자동 검사 197개와 증거 스크립트 작성, Cloudflare 배포, 6번 자료 복사.
- **내가 직접 판단한 일**: (직접 채움)
- **AI 제안을 따르지 않은 일**: (직접 채움 — 없다면 "없음"과 이유)

## ⑥ 아직 못 막은 것

"다 막았다"가 아니라 아직 막지 않은 것을 적습니다. 시간이 없어서 못 한 것도 그대로 적었습니다.

| 아직 못 막은 것 | 왜 위험한가 |
|---|---|
| **무차별 대입**: 로그인 시도 횟수 제한이 없다 | 비밀번호를 자동으로 계속 넣어 보는 공격을 서버가 늦추지도 막지도 않는다(Cloudflare 속도 제한을 붙이면 되지만 안 했다) |
| **비밀번호 재설정**이 없다 | 비밀번호를 잊으면 복구 방법이 없다(이메일을 받지 않아서 만들 수 없었다). 반대로 재설정을 붙이면 그 통로가 새 공격 지점이 된다 |
| **두 번째 인증 수단**이 없다 | 비밀번호가 하나 유출되면 그것만으로 계정이 뚫린다 |
| **로그 남기기**가 없다 | 로그인 실패·이상한 남의 자료 접근 시도를 서버가 기록하지 않아, 공격이 있었는지 나중에 알 수 없다(비밀번호가 로그에 남지 않게 일부러 로그를 거의 안 남긴 결과이기도 하다) |
| PBKDF2 반복 횟수가 **10만 회**(Workers 상한) | 권장(OWASP 약 60만 회)보다 낮아 DB 가 통째로 새면 추측 계산이 더 빨리 끝난다 |
| 가입할 때 "이미 사용 중인 아이디"라고 알려 준다 | 그 화면으로 어떤 아이디가 있는지 확인할 수 있다(로그인 화면은 유무를 알려 주지 않음) |
| 세션이 7일 고정이고 사용 중 연장·기기별 목록·강제 로그아웃 화면이 없다 | 값이 남의 손에 들어가면 만료(7일)나 내가 로그아웃/비밀번호 변경을 할 때까지 쓸 수 있다 |
| CSRF 를 SameSite=Strict + Origin 확인으로만 막고 요청별 토큰은 없다 | 브라우저가 이 두 가지를 지키지 않는 환경에서는 방어가 약해진다 |
| `plans.user_id` 가 NULL 을 허용한다(6번 자료를 옮기려고) | 앱은 항상 채우지만 DB 규칙(NOT NULL)로는 못 막는다. 주인 없는 자료는 어느 계정에도 보이지 않는 것으로만 보호됨 |
| 비밀번호를 유출 목록과 대조하지 않는다 | 흔한 비밀번호(8자 이상이지만 쉬운 것)도 가입이 된다 |
| **5일 관찰에서 3일차 첫 기록(10/1 06:00)이 규칙 변경 시각(10/1 17:12)보다 앞선다** | 카드 5는 "규칙 변경 기록이 2일차 기록 뒤, 3일차 기록 앞"을 요구하는데, 규칙은 3일차 날짜 안(그날 앱에 입력된 기록이 아직 없던 17:12)에 바꿨고 06:00 운동은 그 뒤에 앱에 입력했지만, 운동 자체는 변경보다 먼저 한 일이다. 앱은 날짜로 "변경 전/후"를 가르므로 10/1 전체가 "변경 후"로 계산되지만, 시각 순서만 보면 06:00 기록이 변경보다 앞선다. 시각은 조작하지 않고 그대로 두었다 |

---

## 5일 관찰 (카드 5) — 내가 실제로 5일 쓰며 규칙을 하나 바꾼 기록

앱의 "5일 관찰" 탭이 서울 날짜별 값을 서버에서 계산해 보여 주고, 아래는 화면의 숫자를 손으로 더한 값과 대조한 결과입니다. 값은 모두 내가 실제로 한 일의 기록이며, 날짜·시각은 조작하지 않았습니다.

**1일차(9/29)에 정한 것 (이후 고칠 수 없게 잠김)**

| 항목 | 값 |
|---|---|
| 답하려는 질문 | 계획을 줄이면 실제로 시간적 여유가 생길까? |
| 관찰 지표 | 하루 동안 실제로 한 시간(실행 기록의 걸린 시간 합계) |
| 단위 | 분 |
| 계산 규칙 | 서울 날짜별 합계. 여러 날의 평균 = 합계 ÷ 기록이 있는 일수 (평균은 소수 둘째 자리에서 반올림) |
| 처음 계획 규칙 | 하루에 할 일은 1개만 잡는다 (9/29 정함) |

처리 규칙: 값이 빠진 날은 0이 아니라 "기록 없음"으로 두고 일수에서 뺀다 · 같은 할 일을 같은 시작 시각으로 두 번 넣으면 저장하지 않는다 · 한 번에 720분을 넘는 기록은 저장하지 않는다 · 평균은 소수 둘째 자리에서 반올림 · 한 주는 월요일 시작.

**규칙 변경 (한 번)**: 2026-10-01 17:12 KST, "하루에 할 일은 1개만 잡는다" → "하루에 할 일은 2개만 잡는다.", 이유: "할 일을 늘려보자.". 변경 기록에는 그 전까지 기록이 있던 날(2026-09-29, 2026-09-30)이 함께 저장돼 있고, 10/1 이후가 "변경 후"입니다. (10/1 06:00 기록이 변경 시각보다 앞서는 점은 ⑥에 적었습니다.)

**날짜별 기록 (서울 날짜)**

| 날짜 | 구분 | 기록 | 값(분) | 손 계산 |
|---|---|---|---|---|
| 9/29 (1일차) | 변경 전 | T-1 러닝 06:00~06:40 | 40 | 40 |
| 9/30 (2일차) | 변경 전 | T-6 헬스 06:00~07:30 | 90 | 90 |
| 10/1 (3일차) | 변경 후 | T-1 러닝 06:00~07:00, T-2 LSD 러닝 21:00~22:30 | 150 | 60 + 90 |
| 10/2 (4일차) | 변경 후 | T-3 템포런 06:00~07:30 | 90 | 90 |
| 10/3 (5일차) | 변경 후 | (5일차 입력 뒤 채움) | (TBD) | (TBD) |

**합계·평균 (같은 지표·같은 단위·같은 계산 규칙)**

- 변경 전(9/29, 9/30): 40 + 90 = 130, 130 ÷ 2일 = **65.0분/일**
- 변경 후: (5일차 입력 뒤 채움)
- 5일 전체: (5일차 입력 뒤 채움)
- 변경 후 평균 − 변경 전 평균: (5일차 입력 뒤 채움)

(4일차까지 화면의 숫자와 손 계산이 모두 같았습니다: 변경 전 65.0, 4일 변경 후 120.0, 4일 전체 92.5.)

**결과 한 줄**: (5일차 입력 뒤, 나빠졌든 좋아졌든 그대로 적음)
