# 헬스체크 API 컨벤션 조사

> 작성: 진삼 | 2026-07-16 | 소요: ~15분

---

## 1. `status` 필드 값 컨벤션

### IETF 표준안 (draft-inadarei-api-health-check)
| 값 | 의미 | HTTP 코드 |
|---|---|---|
| `pass` | 정상 | 2xx–3xx |
| `fail` | 비정상 | 4xx–5xx |
| `warn` | 경고 (부분 저하) | 2xx–3xx |

### 프레임워크별 관례
| 값 | 사용처 |
|---|---|
| `ok` | Node.js / @godaddy/terminus |
| `up` | Spring Boot Actuator |
| `healthy` / `unhealthy` | Microsoft Data API Builder 등 |

### **결론 (추천)**
> **`ok` / `error`** — 실무에서 가장 널리 쓰이는 조합. IETF 초안이 만료(expired)되어 사실상 표준이 없으므로, 팀 내 일관성이 가장 중요함.
>
> 단순 이진 상태라면 `ok` / `error`, 세분화가 필요하면 `pass` / `warn` / `fail` 3단계 사용.

---

## 2. `uptime` 표현 형식

- **초(seconds)** 가 업계 표준: `"uptime": 3842` 또는 `"uptimeSeconds": 3842`
- 밀리초(ms)는 **의존성 레이턴시** 측정용으로만 사용 (`"latency_ms": 12`)
- Node.js `process.uptime()` → 초 단위 반환이 기본

### **결론 (추천)**
```json
"uptime": 3842
```
단위 혼동 방지를 위해 필드명에 `Seconds` 접미사를 붙이는 것도 좋음 (`uptimeSeconds`).

---

## 3. 헬스체크 응답 베스트프랙티스

### 최소 응답 예시
```json
{
  "status": "ok",
  "uptime": 3842,
  "timestamp": "2026-07-16T12:00:00Z"
}
```

### 의존성 포함 응답 예시
```json
{
  "status": "ok",
  "version": "1.2.3",
  "uptime": 3842,
  "checks": {
    "database": { "status": "ok", "latency_ms": 8 },
    "redis":    { "status": "ok", "latency_ms": 2 }
  }
}
```

### 핵심 규칙
| 항목 | 권장 |
|---|---|
| HTTP 상태코드 | 정상 → `200`, 비정상 → `503` |
| Content-Type | `application/json` |
| 응답속도 | 50ms 이하 목표 (헬스체크 자체가 부하 유발 금지) |
| 민감정보 | DB 비밀번호·연결문자열 절대 포함 금지 |
| 의존성 체크 | 크리티컬 의존성만 포함 (외부 API 등 선택적) |
| 버전 정보 | `version` 필드 포함 권장 (디버깅 용이) |

---

## 참고 출처

- [IETF draft-inadarei-api-health-check-06](https://datatracker.ietf.org/doc/html/draft-inadarei-api-health-check-06)
- [eloquentcode.com - Health Check Endpoint Design](https://eloquentcode.com/rest-api-design-health-check-endpoint)
- [reliableuptime.com - REST API Health Check](https://reliableuptime.com/blog/rest-api-health-check-endpoint-design)
- [api7.ai - 7 Best Practices](https://api7.ai/blog/tips-for-health-check-best-practices)
