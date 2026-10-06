# T08 패스키 증거 기록 (로컬 서버 · 같은 Worker 코드 · 시험용 가짜 기기)

실행 시각: 2026-10-06T05:44:10.350Z · 계정: `evid-a-fd989a`, `evid-b-48ba15` (이 기록을 위해 만든 검사용 계정) · 세션 값은 앞 4글자만 보이게 가렸고, 길이가 긴 값(attestationObject·signature·공개키)은 앞부분만 보입니다. 비밀번호는 이 시스템에 존재하지 않습니다.

## 카드 2 — 패스키 등록
**1. 등록 질문(challenge) 요청 ①**
```
POST /api/register/options
본문: {"handle":"evid-a-fd989a","passkey_name":"이 PC (Windows Hello)"}
→ 200
응답: {"challenge":"8hlw0OXdQCQpRXpLDzBndoPEhW2Z7Ac9OWKtJJYoGJk","rp":{"name":"전원 — 나만의 자리","id":"pds-passkey.pds-diary.workers.dev"},"user":{"id":"IoeIW8A-TXaTnuCpV580hw","name":"evid-a-fd989a","displayName":"evid-a-fd989a"},"pubKeyCredParams":[{"alg":-7,"type":"public-key"},{"alg":-257,"type":"public-key"}],"timeout":60000,"attestation":"none","excludeCredential …(줄임)
```
**2. 등록 질문 요청 ② (같은 자리 이름으로 다시 요청 — 질문 값이 달라야 함)**
```
POST /api/register/options
본문: {"handle":"evid-a-fd989a","passkey_name":"이 PC (Windows Hello)"}
→ 200
응답: {"challenge":"kdrkAQD1b9LgJz2D6RneHwmjThU3wbDECwPlRS7KsgM","rp":{"name":"전원 — 나만의 자리","id":"pds-passkey.pds-diary.workers.dev"},"user":{"id":"ZSsz9x1p0sxKKWZ6uWETKQ","name":"evid-a-fd989a","displayName":"evid-a-fd989a"},"pubKeyCredParams":[{"alg":-7,"type":"public-key"},{"alg":-257,"type":"public-key"}],"timeout":60000,"attestation":"none","excludeCredential …(줄임)
```
→ 두 질문 값이 서로 다른가: **다르다** · 서버는 질문을 DB 에 보관하고(확인할 때까지, 최대 2분) 확인이 끝나면 지웁니다.
### 취소했을 때 (질문만 받고 등록을 마치지 않음)
**3. 질문만 받고 기기 창에서 취소 → 등록 확인 요청을 보내지 않음**
```
POST /api/register/options
본문: {"handle":"evid-c-74e262","passkey_name":"취소할 패스키"}
→ 200
응답: {"challenge":"5lJ3yBSKVVcxM-LGGkCXEGuQYZxeBWSTGTqME230U8A","rp":{"name":"전원 — 나만의 자리","id":"pds-passkey.pds-diary.workers.dev"},"user":{"id":"SjiP5mOHIl5dr9IgUTQ_-A","name":"evid-c-74e262","displayName":"evid-c-74e262"},"pubKeyCredParams":[{"alg":-7,"type":"public-key"},{"alg":-257,"type":"public-key"}],"timeout":60000,"attestation":"none","excludeCredential …(줄임)
```
→ 서버에 `evid-c-74e262` 계정이 저장됐는가: **저장되지 않았다** · 패스키 수: 0건. 화면에는 "취소되었거나 시간이 지나서 아무것도 저장되지 않았습니다" 안내가 나옵니다.
### 등록 완료
**4. 등록 확인 요청 (기기가 서명한 공개키와 서명 — 개인키는 없음)**
```
POST /api/register/verify
본문: {"response":{"id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-SwY5o","rawId":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoia2Rya0FRRDFiOUxnSnoyRDZSbmVId21qVGhVM3diREVDd1BsUlM3S3NnTSIsIm9yaWdpbiI6Imh0dHBzOi8vcGRzLXBhc3NrZXkucGRzLWRpYXJ5LndvcmtlcnMuZGV2IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ","attestationObject":"o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVik…(줄임, 전체 259자)","transports":["internal"]}}}
→ 201
Set-Cookie: sid=55cl…(가림); Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure
응답: {"account":{"handle":"evid-a-fd989a"},"passkey":{"name":"이 PC (Windows Hello)"},"session_expires_at":"2026-10-13T05:44:10.385Z"}
```
→ 요청 본문의 clientDataJSON 을 풀어 보면: `{"type":"webauthn.create","challenge":"kdrkAQD1b9LgJz2D6RneHwmjThU3wbDECwPlRS7KsgM","origin":"https://pds-passkey.pds-diary.workers.dev","crossOrigin":false}` — 서버가 보낸 질문 값(kdrk…(가림))과 이 사이트 주소(origin)가 들어 있고, 개인키는 없다.
- 이 기기의 개인키 값이 서버로 보낸 요청 전체에 들어 있는가: **들어 있지 않다**
**5. 서버에 저장된 패스키 목록 (이름·등록 날짜·공개키)**
```
GET /api/passkeys
Cookie: sid=55cl…(가림)
→ 200
응답: {"rows":[{"id":1,"credential_id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","public_key":"pQECAyYgASFYIGfN7cX0KM1aNGrbv4hNlDu1b_pc…(줄임, 전체 103자)","counter":0,"transports":["internal"],"device_type":"singleDevice","backed_up":false,"name":"이 PC (Windows Hello)","created_at":"2026-10-06T05:44:10.385Z","last_used_at":null,"is_current":true}]}
```
DB 의 passkeys 표에 저장된 값 (공개키이며 비밀번호가 아니다 — 이것만으로는 로그인할 수 없고, 서명을 확인하는 데만 쓰인다):
```
credential_id = HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-SwY5o
public_key = pQECAyYgASFYIGfN7cX0KM1aNGrbv4hNlDu1b_pcA-FPKHMJStxCH7GqIlggj06GTHgUo2I2LbnDg-4Js8VfWjmqeo…(줄임, 전체 103자)
counter = 0
transports = ["internal"]
device_type = singleDevice
backed_up = 0
name = 이 PC (Windows Hello)
created_at = 2026-10-06T05:44:10.385Z
```
- 패스키 이름: **이 PC (Windows Hello)** (사람이 알아볼 수 있는 이름) · 저장 위치: 개인키는 기기(Windows Hello 등)나 Google 비밀번호 관리자 같은 보관 장소에만 있고 서버에는 없다.
**6. 이미 쓴 등록 응답을 다시 보냄 → 거절**
```
POST /api/register/verify
본문: {"response":{"id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-SwY5o","rawId":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoia2Rya0FRRDFiOUxnSnoyRDZSbmVId21qVGhVM3diREVDd1BsUlM3S3NnTSIsIm9yaWdpbiI6Imh0dHBzOi8vcGRzLXBhc3NrZXkucGRzLWRpYXJ5LndvcmtlcnMuZGV2IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ","attestationObject":"o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVik…(줄임, 전체 259자)","transports":["internal"]}}}
→ 400
응답: {"error":"패스키 등록을 확인하지 못했습니다. 처음부터 다시 시도해 주세요."}
```

## 카드 3 — 패스키로 들어간다
**7. 로그인 질문 요청 ①**
```
POST /api/login/options
본문: {}
→ 200
응답: {"rpId":"pds-passkey.pds-diary.workers.dev","challenge":"faYqICbRkzHBCGF26p_P01TMHTrtwYDrROcajr0NsqY","timeout":60000,"userVerification":"required"}
```
**8. 로그인 질문 요청 ② (달라야 함)**
```
POST /api/login/options
본문: {}
→ 200
응답: {"rpId":"pds-passkey.pds-diary.workers.dev","challenge":"1Awz-D6pnUXOOl8XjDvIje43F4ehE56lNYZVShQMtk4","timeout":60000,"userVerification":"required"}
```
→ 두 질문 값이 서로 다른가: **다르다**
**9. 서명 확인에 성공한 로그인 (서버가 저장해 둔 공개키로 서명을 확인)**
```
POST /api/login/verify
본문: {"response":{"id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-SwY5o","rawId":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiZmFZcUlDYlJrekhCQ0dGMjZwX1AwMVRNSFRydHdZRHJST2NhanIwTnNxWSIsIm9yaWdpbiI6Imh0dHBzOi8vcGRzLXBhc3NrZXkucGRzLWRpYXJ5LndvcmtlcnMuZGV2IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ","authenticatorData":"EWWh1JM6WTIlJCZZj-6gTjM_UJgwRIOl7aMyj1Hd…(줄임, 전체 50자)","signature":"MEYCIQCjQQJl0ND-BaMBFQ8Sifl4j05LMYrT8Y7x…(줄임, 전체 96자)","userHandle":null}}}
→ 200
Set-Cookie: sid=XU8y…(가림); Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure
응답: {"account":{"handle":"evid-a-fd989a"},"session_expires_at":"2026-10-13T05:44:10.391Z"}
```
**10. 로그인한 상태로 비공개 자리 요청 → 성공**
```
GET /api/private/items
Cookie: sid=XU8y…(가림)
→ 200
응답: {"rows":[]}
```
**11. 일부러 틀린 서명으로 로그인 → 거절**
```
POST /api/login/verify
본문: {"response":{"id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-SwY5o","rawId":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoidjNWbFVsM1d2czhMamswMVFzTXBVdGlZZnpsUFp0ZlRJcFlMc0EtRER4NCIsIm9yaWdpbiI6Imh0dHBzOi8vcGRzLXBhc3NrZXkucGRzLWRpYXJ5LndvcmtlcnMuZGV2IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ","authenticatorData":"EWWh1JM6WTIlJCZZj-6gTjM_UJgwRIOl7aMyj1Hd…(줄임, 전체 50자)","signature":"MEUCIQCytYd8ZgbdmcUSSSlA8ZTi9bm2J3fEpyiK…(줄임, 전체 95자)","userHandle":null}}}
→ 401
응답: {"error":"패스키 확인에 실패했습니다."}
```
**12. 이미 쓴 질문(위 성공 로그인의 서명 응답)으로 다시 로그인 → 거절**
```
POST /api/login/verify
본문: {"response":{"id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-SwY5o","rawId":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiZmFZcUlDYlJrekhCQ0dGMjZwX1AwMVRNSFRydHdZRHJST2NhanIwTnNxWSIsIm9yaWdpbiI6Imh0dHBzOi8vcGRzLXBhc3NrZXkucGRzLWRpYXJ5LndvcmtlcnMuZGV2IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ","authenticatorData":"EWWh1JM6WTIlJCZZj-6gTjM_UJgwRIOl7aMyj1Hd…(줄임, 전체 50자)","signature":"MEYCIQCjQQJl0ND-BaMBFQ8Sifl4j05LMYrT8Y7x…(줄임, 전체 96자)","userHandle":null}}}
→ 401
응답: {"error":"패스키 확인에 실패했습니다."}
```
**13. 같은 질문에 새로 서명해서 다시 보냄 → 거절 (질문은 처음 확인할 때 이미 지워짐)**
```
POST /api/login/verify
본문: {"response":{"id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-SwY5o","rawId":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiOGVLdUFGdDFpNTlfWXQ4aVhvbTdMTnF3NUZ5QWlWd2tnQ2lBZXViQnBpOCIsIm9yaWdpbiI6Imh0dHBzOi8vcGRzLXBhc3NrZXkucGRzLWRpYXJ5LndvcmtlcnMuZGV2IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ","authenticatorData":"EWWh1JM6WTIlJCZZj-6gTjM_UJgwRIOl7aMyj1Hd…(줄임, 전체 50자)","signature":"MEQCIAwnqEH4gVZwyoVadcm42HmPrBvp-Xo9JEUV…(줄임, 전체 94자)","userHandle":null}}}
→ 401
응답: {"error":"패스키 확인에 실패했습니다."}
```
→ 거절 응답의 안내 문구가 모두 같은가(이유를 알려 주지 않음): **같다**
### 로그아웃하면 같은 값이 더 통하지 않는다
**14. 로그아웃**
```
POST /api/logout
Cookie: sid=XU8y…(가림)
→ 200
Set-Cookie: sid=(비어 있음 = 삭제); Path=/; HttpOnly; SameSite=Strict; Max-Age=0; Secure
응답: {"ok":true}
```
**15. 로그아웃한 뒤 같은 값으로 같은 요청 → 거절**
```
GET /api/private/items
Cookie: sid=XU8y…(가림)
→ 401
응답: {"error":"로그인이 필요합니다."}
```
→ 두 요청은 주소(`GET /api/private/items`)와 쿠키 값(`sid=XU8y…(가림)`)이 같고 다른 것은 로그아웃 여부뿐이다: 성공 200 / 거절 401
- 로그인 뒤 사람을 알아보는 것: 서버가 발급한 무작위 **세션 값**(쿠키 `sid`, HttpOnly·SameSite=Strict·Secure, 7일). 서버 DB 에는 그 값의 SHA-256 만 있다. 주소창·응답 본문에는 실리지 않는다.

## 카드 4 — 기기를 잃어버렸을 때
**16. 두 번째 패스키 등록 질문 (이미 등록한 기기는 제외하라고 알려 줌)**
```
POST /api/passkeys/options
Cookie: sid=VBvB…(가림)
본문: {"passkey_name":"휴대폰 (Google 비밀번호 관리자)"}
→ 200
응답: {"challenge":"5me80Kqfds4Bg7U76CxOXI8FXRWIXorugSKSRTPJJm0","rp":{"name":"전원 — 나만의 자리","id":"pds-passkey.pds-diary.workers.dev"},"user":{"id":"ZSsz9x1p0sxKKWZ6uWETKQ","name":"evid-a-fd989a","displayName":"evid-a-fd989a"},"pubKeyCredParams":[{"alg":-7,"type":"public-key"},{"alg":-257,"type":"public-key"}],"timeout":60000,"attestation":"none","excludeCredential …(줄임)
```
→ excludeCredentials 에 첫 패스키가 들어 있다: **예** — 같은 기기에 같은 패스키가 두 번 등록되지 않게 합니다.
**17. 두 번째 패스키 등록 확인**
```
POST /api/passkeys/verify
Cookie: sid=VBvB…(가림)
본문: {"response":{"id":"5_cYhXFioDHnmsvcrJg5L0v-HGTCrvO-O8HJ3dTMv4g","rawId":"5_cYhXFioDHnmsvcrJg5L0v-HGTCrvO-O8HJ3dTM…(줄임, 전체 43자)","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiNW1lODBLcWZkczRCZzdVNzZDeE9YSThGWFJXSVhvcnVnU0tTUlRQSkptMCIsIm9yaWdpbiI6Imh0dHBzOi8vcGRzLXBhc3NrZXkucGRzLWRpYXJ5LndvcmtlcnMuZGV2IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ","attestationObject":"o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVik…(줄임, 전체 259자)","transports":["internal"]}}}
→ 200
응답: {"rows":[{"id":1,"credential_id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","public_key":"pQECAyYgASFYIGfN7cX0KM1aNGrbv4hNlDu1b_pc…(줄임, 전체 103자)","counter":5,"transports":["internal"],"device_type":"singleDevice","backed_up":false,"name":"이 PC (Windows Hello)","created_at":"2026-10-06T05:44:10.385Z","last_used_at":"2026-10-06T05:44:10.397Z","is_ …(줄임)
```
**18. 패스키 두 개가 보이는 목록**
```
GET /api/passkeys
Cookie: sid=VBvB…(가림)
→ 200
응답: {"rows":[{"id":1,"credential_id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","public_key":"pQECAyYgASFYIGfN7cX0KM1aNGrbv4hNlDu1b_pc…(줄임, 전체 103자)","counter":5,"transports":["internal"],"device_type":"singleDevice","backed_up":false,"name":"이 PC (Windows Hello)","created_at":"2026-10-06T05:44:10.385Z","last_used_at":"2026-10-06T05:44:10.397Z","is_ …(줄임)
```
**19. 휴대폰 패스키로 로그인한 상태에서 첫 패스키(이 PC)를 지움**
```
DELETE /api/passkeys/1
Cookie: sid=5zeg…(가림)
→ 200
응답: {"deleted":1,"remaining":1}
```
**20. 남은 하나(휴대폰)로 자료 열기 → 성공**
```
GET /api/private/items
Cookie: sid=5zeg…(가림)
→ 200
응답: {"rows":[]}
```
**21. 지운 패스키로 로그인 → 거절 (기기에 키가 남아 있어도 서버가 모름)**
```
POST /api/login/verify
본문: {"response":{"id":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-SwY5o","rawId":"HywcI_uIUMOSqj4aR9pSvPy1-cjNVAnZEF42p-Sw…(줄임, 전체 43자)","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uZ2V0IiwiY2hhbGxlbmdlIjoiTjRadFlVOWlBRWd2NGIzTjdocmU3QndHWEZXaWtuQXN3ZFlzVXBtQ2M5ZyIsIm9yaWdpbiI6Imh0dHBzOi8vcGRzLXBhc3NrZXkucGRzLWRpYXJ5LndvcmtlcnMuZGV2IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ","authenticatorData":"EWWh1JM6WTIlJCZZj-6gTjM_UJgwRIOl7aMyj1Hd…(줄임, 전체 50자)","signature":"MEUCIQCnoA7xwHdOVRiUJXFvdMOw7wLvRqa-PP_s…(줄임, 전체 95자)","userHandle":null}}}
→ 401
응답: {"error":"패스키 확인에 실패했습니다."}
```
**22. 지운 패스키로 이미 열어 둔 세션도 끊김 → 거절**
```
GET /api/private/items
Cookie: sid=P2Iu…(가림)
→ 401
응답: {"error":"로그인이 필요합니다."}
```
**23. 마지막 하나를 지우려 함 → 거절 (하나도 안 남는 일이 없게 서버가 막음)**
```
DELETE /api/passkeys/2
Cookie: sid=5zeg…(가림)
→ 409
응답: {"error":"마지막 패스키는 지울 수 없습니다. 하나도 없으면 이 자리에 다시 들어올 방법이 없습니다. 먼저 다른 패스키를 하나 더 등록하세요."}
```
- **패스키가 하나도 남지 않으면:** 서버가 마지막 하나는 지우지 못하게 막으므로(409) 하나도 안 남는 상태가 생기지 않는다. 다만 남은 하나가 있는 기기·보관 장소를 모두 잃으면 이 자리에 다시 들어올 복구 방법은 없다(⑥에 적음).

## 카드 5 — 계정 두 개, 서로의 비공개 자료 (양방향)
**24. 계정 B 만들기 (패스키 등록)**
```
POST /api/register/verify
본문: {"response":{"id":"p2pyvG7fWAFDksFZrbWh4uoxGlmPn1Lca2n7lruN9lc","rawId":"p2pyvG7fWAFDksFZrbWh4uoxGlmPn1Lca2n7lruN…(줄임, 전체 43자)","type":"public-key","authenticatorAttachment":"platform","clientExtensionResults":{},"response":{"clientDataJSON":"eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIiwiY2hhbGxlbmdlIjoiUnJoLTRyRzVtRXNIVTM3eTFwVzhJLV9qSHFnZGV0c2ptMEktUmRjTi13byIsIm9yaWdpbiI6Imh0dHBzOi8vcGRzLXBhc3NrZXkucGRzLWRpYXJ5LndvcmtlcnMuZGV2IiwiY3Jvc3NPcmlnaW4iOmZhbHNlfQ","attestationObject":"o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YVik…(줄임, 전체 259자)","transports":["internal"]}}}
→ 201
Set-Cookie: sid=Qs-B…(가림); Path=/; HttpOnly; SameSite=Strict; Max-Age=604800; Secure
응답: {"account":{"handle":"evid-b-48ba15"},"passkey":{"name":"B 의 패스키"},"session_expires_at":"2026-10-13T05:44:10.404Z"}
```
거절 시도 전 건수: A = {"items":2,"passkeys":1}, B = {"items":2,"passkeys":1}
### 성공한 요청 (자기 자료)
**25. A 가 자기 비공개 목록 읽기 → 성공**
```
GET /api/private/items
Cookie: sid=5zeg…(가림)
→ 200
응답: {"rows":[{"id":1,"title":"A-메모: 포트폴리오 개편 계획","body":"A 만의 내용(만들어 넣은 내용)","created_at":"2026-10-06T05:44:10.405Z"},{"id":2,"title":"A-지원 목록: 가상회사 알파","body":"A 만의 내용(만들어 넣은 내용)","created_at":"2026-10-06T05:44:10.405Z"}]}
```
### A 가 B 의 자료를 건드리는 요청
**26. A → B 의 비공개 항목 지우기**
```
DELETE /api/private/items/3
Cookie: sid=5zeg…(가림)
→ 404
응답: {"error":"항목을 찾을 수 없습니다."}
```
**27. A → B 의 패스키 지우기**
```
DELETE /api/passkeys/3
Cookie: sid=5zeg…(가림)
→ 404
응답: {"error":"패스키를 찾을 수 없습니다."}
```
### 반대 방향: B 가 A 의 자료를 건드리는 요청
**28. B → A 의 비공개 항목 지우기**
```
DELETE /api/private/items/1
Cookie: sid=Qs-B…(가림)
→ 404
응답: {"error":"항목을 찾을 수 없습니다."}
```
**29. B → A 의 패스키 지우기**
```
DELETE /api/passkeys/2
Cookie: sid=Qs-B…(가림)
→ 404
응답: {"error":"패스키를 찾을 수 없습니다."}
```
### 주소·헤더·본문에 다른 계정을 적어 보냄
**30. 주소(?account_id=, ?handle=)와 헤더(X-Account-Id, X-Handle)에 B 를 적은 A 의 요청**
```
GET /api/private/items?account_id=2&handle=evid-b-48ba15
Cookie: sid=5zeg…(가림)
x-account-id: 2
x-handle: evid-b-48ba15
→ 200
응답: {"rows":[{"id":1,"title":"A-메모: 포트폴리오 개편 계획","body":"A 만의 내용(만들어 넣은 내용)","created_at":"2026-10-06T05:44:10.405Z"},{"id":2,"title":"A-지원 목록: 가상회사 알파","body":"A 만의 내용(만들어 넣은 내용)","created_at":"2026-10-06T05:44:10.405Z"}]}
```
**31. 본문에 account_id/handle 을 B 로 적어 항목 만들기**
```
POST /api/private/items
Cookie: sid=5zeg…(가림)
본문: {"title":"A가 만든 항목(본문에 B 적음)","body":"x","account_id":2,"handle":"evid-b-48ba15"}
→ 200
응답: {"id":5,"title":"A가 만든 항목(본문에 B 적음)","body":"x","created_at":"2026-10-06T05:44:10.409Z"}
```
→ 그 항목이 B 목록에 생겼는가: **없다(정상)** (A 의 항목으로만 저장됨)
### 패스키 없이 직접 요청
**32. 패스키 없이 비공개 자료 직접 요청**
```
GET /api/private/items
→ 401
응답: {"error":"로그인이 필요합니다."}
```
### 거절 전후 건수 비교
시도 후: A = {"items":2,"passkeys":1}, B = {"items":2,"passkeys":1} → 시도 전과 **같다**
### 목록 응답에 남의 자료가 섞이는지
A 목록 제목: ["A-메모: 포트폴리오 개편 계획","A-지원 목록: 가상회사 알파"] / B 목록 제목: ["B-메모: 스터디 자료 정리","B-지원 목록: 가상회사 베타"] — 서로의 것이 하나도 없음: **맞다**
### 거절을 만드는 소스 위치
- `src/worker.js:226` ownedPasskey · `:231` ownedItem — 남의 것과 없는 것을 구분하지 않고 같은 404 를 던진다
- `src/worker.js:311` 패스키로 들어오지 않은 요청은 여기서 401 (패스키 로그인·등록·로그아웃·내 상태 확인만 그 앞에서 처리)
- 목록은 `WHERE account_id = ?` 로 걸러진다(listItems·listPasskeys)
- 서명 확인과 질문 한 번만 쓰기: `:84` takeChallenge(질문 삭제), `:191` loginVerify(공개키로 서명 확인)

## 이 문서 전체에 세션 값 원문이 있는가
**없다** — 이 문서 전체를 검사한 결과(앞 4글자만 보이게 가렸음).
