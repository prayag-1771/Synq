# Synq — Vulnerabilities, Problems & Architecture Audit

> **Audit Date:** June 5, 2026  
> **Scope:** Full codebase review against the Master Implementation Plan  
> **Auditor:** Automated deep-scan of `synq-server` and `synq-web`

---

## Summary

| Category | Critical | High | Medium | Low | Info |
| :--- | :---: | :---: | :---: | :---: | :---: |
| Security | 3 | 4 | 3 | 2 | — |
| Architecture | 1 | 2 | 3 | 1 | — |
| Data Integrity | — | 2 | 1 | — | — |
| Plan Gaps (Phases 2–10) | — | — | — | — | 8 |
| **Total** | **4** | **8** | **7** | **3** | **8** |

---

## 🔴 Critical Issues

### CRIT-1: `.env` File Committed to Git — Secrets Exposed (SOLVED)
**File:** [.gitignore](file:///g:/VSC_NEW/Synq/.gitignore)  
**Problem:** The `.gitignore` does NOT include `.env`. This means your `.env` file — containing `DATABASE_URL`, `JWT_SECRET`, `GEMINI_API_KEY`, `GROQ_API_KEY`, and `REDIS_URL` — is tracked and pushed to GitHub in plaintext.  
**Impact:** Anyone with repository access can extract your Neon database credentials, AI API keys, and JWT signing secrets. This is the single most dangerous vulnerability in the project.  
**Fix:**
```diff
+ # Environment files
+ .env
+ .env.*
+ !.env.example
```
Then run `git rm --cached synq-server/.env` to remove it from tracking.

---

### CRIT-2: Hardcoded JWT Secrets as Fallback Defaults (SOLVED)
**Files:**
- [auth.controller.ts:7-8](file:///g:/VSC_NEW/Synq/synq-server/src/controllers/auth.controller.ts#L7-L8)
- [auth.middleware.ts:26](file:///g:/VSC_NEW/Synq/synq-server/src/middleware/auth.middleware.ts#L26)
- [socket.ts:11](file:///g:/VSC_NEW/Synq/synq-server/src/sockets/socket.ts#L11)

**Problem:** All three files contain the same fallback:
```typescript
const JWT_SECRET = process.env.JWT_SECRET || 'synq_jwt_access_secret_token_2026_modern';
```
If the environment variable is ever missing (e.g., a Render/Vercel misconfiguration), the server silently falls back to a publicly-known static string. Any attacker can forge valid JWTs.  
**Fix:** Crash at startup if `JWT_SECRET` is not set:
```typescript
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) throw new Error('FATAL: JWT_SECRET environment variable is required');
```

---

### CRIT-3: Redis `subClient` Shared Between Socket.IO Adapter and EventBus (SOLVED)
**Files:**
- [server.ts:31](file:///g:/VSC_NEW/Synq/synq-server/src/server.ts#L31): `io.adapter(createAdapter(pubClient, subClient))`
- [eventBus.ts:16](file:///g:/VSC_NEW/Synq/synq-server/src/events/eventBus.ts#L16): `subClient.subscribe(this.redisChannel, ...)`

**Problem:** In `ioredis`, once a Redis client enters subscriber mode (which the Socket.IO adapter forces), it **cannot** be used for other Pub/Sub subscriptions by a different module. The `subClient` from `redis.ts` is imported and used by BOTH the Socket.IO adapter (`createAdapter`) and the EventBus (`subClient.subscribe`). This creates unpredictable behavior and may cause one or both systems to miss events.  
**Fix:** Create a **dedicated** Redis client pair for the EventBus:
```typescript
// In redis.ts — add separate clients for EventBus
export const eventPubClient = new Redis(redisUrl, { maxRetriesPerRequest: null });
export const eventSubClient = new Redis(redisUrl, { maxRetriesPerRequest: null });
```
Then update `eventBus.ts` to import `eventPubClient` / `eventSubClient` instead.

---

### CRIT-4: CORS Set to Wildcard `*` on Both Express and Socket.IO (SOLVED)
**File:** [server.ts:23-24](file:///g:/VSC_NEW/Synq/synq-server/src/server.ts#L23-L24) and [server.ts:39](file:///g:/VSC_NEW/Synq/synq-server/src/server.ts#L39)  
**Problem:** `origin: '*'` on Socket.IO and `app.use(cors())` with no config on Express allows any website on the internet to make authenticated requests to your API and establish WebSocket connections.  
**Impact:** Enables Cross-Site WebSocket Hijacking (CSWSH) and CSRF attacks.  
**Fix:** Restrict origins to your known frontend domains:
```typescript
const allowedOrigins = [process.env.FRONTEND_URL || 'http://localhost:3000'];
app.use(cors({ origin: allowedOrigins, credentials: true }));
// Same for Socket.IO
```

---

## 🟠 High Severity Issues

### HIGH-1: No Rate Limiting on Any Endpoint (SOLVED)
**Problem:** There is no rate limiting middleware anywhere. The `/api/auth/login`, `/api/auth/register`, `/api/ai/summarize`, and `/api/ai/replies` endpoints are wide open.  
**Impact:**
- Brute-force attacks on login.
- AI API cost abuse (Groq API calls are billed).
- DDoS amplification.
**Recommended Tool:** `express-rate-limit` + `rate-limit-redis` (use your existing Redis for distributed rate limiting).

---

### HIGH-2: No Input Validation or Sanitization (SOLVED)
**Files:** All controllers  
**Problem:** No schema validation library (Zod, Joi, class-validator) is used anywhere. User inputs from `req.body` are passed directly to Prisma queries and AI prompts.  
**Impact:**
- Prompt injection attacks on the AI endpoints (user can manipulate the LLM system prompt).
- NoSQL-style injection via crafted Prisma `where` clauses.
- XSS if message content is rendered unescaped on the frontend.
**Recommended Tool:** `zod` for schema validation on all route handlers.

---

### HIGH-3: No Security Headers (Helmet) (SOLVED)
**Problem:** The Express server does not use `helmet` or any equivalent to set security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security`, `Content-Security-Policy`).  
**Fix:** `npm install helmet` and add `app.use(helmet())`.

---

### HIGH-4: Refresh Tokens Not Stored or Revocable (SOLVED)
**File:** [auth.controller.ts:136-163](file:///g:/VSC_NEW/Synq/synq-server/src/controllers/auth.controller.ts#L136-L163)  
**Problem:** Refresh tokens are signed JWTs verified only by signature. They are never stored in a database or Redis. There is no way to revoke a refresh token if a user's account is compromised or they log out.  
**Fix:** Store refresh token hashes in a `RefreshToken` Prisma model with `userId`, `tokenHash`, `expiresAt`, and `revoked` fields. Check on every refresh. Delete on logout.

---

### HIGH-5: Race Condition in `deregisterUserPresence` (SOLVED)
**File:** [redis.ts:45-62](file:///g:/VSC_NEW/Synq/synq-server/src/db/redis.ts#L45-L62)  
**Problem:** The function performs a `HGET` then a separate `HDEL` or `HSET`. Between these two Redis commands, another server instance could concurrently modify the same field, causing incorrect presence counts (phantom online/offline states).  
**Fix:** Use `HINCRBY` (atomic) with a check, or use a Lua script for atomicity:
```typescript
const luaScript = `
  local count = redis.call('hincrby', KEYS[1], ARGV[1], -1)
  if count <= 0 then
    redis.call('hdel', KEYS[1], ARGV[1])
    return 1
  end
  return 0
`;
```

---

### HIGH-6: Auth Store Persists Tokens in LocalStorage (Unencrypted)
**File:** [authStore.ts:32-34](file:///g:/VSC_NEW/Synq/synq-web/src/stores/authStore.ts#L32-L34)  
**Problem:** Zustand's `persist` middleware defaults to `localStorage`, which stores `accessToken`, `refreshToken`, and user data in plaintext. Any XSS attack can steal these tokens.  
**Mitigation:** Consider using `sessionStorage` instead, or encrypting the persisted data. For highest security, use `HttpOnly` cookies for tokens instead of client-side storage.

---

## 🟡 Medium Severity Issues

### MED-1: No Database Indexes on Hot Query Paths (SOLVED)
**File:** [schema.prisma](file:///g:/VSC_NEW/Synq/synq-server/prisma/schema.prisma)  
**Problem:** The `Message` model has no explicit index on `chatId` + `createdAt`. Cursor-based pagination queries (`WHERE chatId = ? AND createdAt < ? ORDER BY createdAt DESC LIMIT 50`) will perform full table scans as the message count grows.  
**Fix:** Add composite index:
```prisma
model Message {
  ...
  @@index([chatId, createdAt])
}
```

---

### MED-2: WebRTC Uses Only Public STUN Servers (No TURN)
**File:** [webrtcService.ts:9-14](file:///g:/VSC_NEW/Synq/synq-web/src/services/webrtcService.ts#L9-L14)  
**Problem:** Only STUN servers (`stun.l.google.com`, `global.stun.twilio.com`) are configured. If both users are behind symmetric NATs or restrictive firewalls, peer-to-peer connections will fail silently.  
**Fix:** Add a TURN server (e.g., Twilio, Metered.ca, or self-hosted coturn) as a fallback relay.

---

### MED-3: E2EE Cannot Decrypt Own Sent Messages from Server History
**File:** [socketService.ts:43-52](file:///g:/VSC_NEW/Synq/synq-web/src/services/socketService.ts#L43-L52)  
**Problem:** As documented in the code comments, when a user sends an encrypted message, it's encrypted with the **recipient's** public key. If the local IndexedDB is cleared and the user fetches historical messages from the server, their own sent messages are unreadable ciphertext.  
**Fix (Architecture):** Implement the Signal Protocol's approach: encrypt the message once for the recipient AND once for the sender's own device key (dual ratchet or "message keys for self"). Store the self-encrypted copy alongside the recipient-encrypted copy.

---

### MED-4: `getAllUsers` Endpoint Returns All Users Without Pagination
**File:** [auth.controller.ts:166-189](file:///g:/VSC_NEW/Synq/synq-server/src/controllers/auth.controller.ts#L166-L189)  
**Problem:** Returns every user in the database. At scale (10k+ users), this will be extremely slow and leaks the entire user directory.  
**Fix:** Add pagination and search filtering (e.g., `?search=john&limit=20&cursor=...`).

---

### MED-5: Sync Endpoint Has No Pagination or Limit
**File:** [chat.controller.ts](file:///g:/VSC_NEW/Synq/synq-server/src/controllers/chat.controller.ts) (the `syncMessages` function)  
**Problem:** The `/chats/sync` endpoint fetches ALL messages since `lastSync` with no limit. If a user was offline for weeks, this could return thousands of messages in a single response.  
**Fix:** Add `take: 500` to the Prisma query and return a `hasMore` flag so the client can paginate.

---

## 🟢 Low Severity Issues

### LOW-1: No Graceful Shutdown for Redis Connections
**Problem:** When the server stops, Redis clients are never explicitly disconnected. This can leave orphan connections in Redis.  
**Fix:** Add a `SIGTERM` handler that calls `redisClient.quit()`, `pubClient.quit()`, etc.

---

### LOW-2: Console Logging Instead of Structured Logger
**Problem:** All logging uses `console.log` / `console.error`. No structured logging library (Winston, Pino) is used. This makes production debugging, log aggregation, and error tracking difficult.  
**Recommended Tool:** `pino` (fastest Node.js logger, JSON output, integrates with DataDog/Grafana).

---

### LOW-3: `npm audit` Reports 2 High Severity Vulnerabilities
**Problem:** During `npm install`, the output reported `2 high severity vulnerabilities` in server dependencies. These should be investigated and resolved.  
**Fix:** Run `npm audit` and `npm audit fix` in `synq-server/`.

---

## 📋 Plan Gaps — Phases Not Yet Implemented

| Phase | Feature | Status | Notes |
| :---: | :--- | :---: | :--- |
| 2 | **pgvector Semantic Search** | ❌ Not Started | No `pgvector` extension, no embedding table in schema, no vector search endpoint |
| 3 | **AI Command System** (`/summarize`, `/search`, `/todo`) | ❌ Not Started | Basic AI summary exists via Groq but no slash command parser |
| 4 | **AI Context Extraction** (auto-detect tasks/deadlines) | ❌ Not Started | No event subscriber for `message.created` → AI extraction pipeline |
| 5 | **Automation Layer** (n8n/webhooks) | ❌ Not Started | No webhook dispatcher, no `automation/` module |
| 6 | **AI Agent Layer** (OpenClaw/LangChain) | ❌ Not Started | No agent runtime, no tool registry |
| 7 | **Desktop Companion App** (Tauri) | ❌ Not Started | No Tauri project scaffolded |
| 8 | **Contextual File Retrieval** | ❌ Not Started | Depends on Phase 7 |
| 9 | **Security Hardening** (libsodium hardening, device sessions) | 🟡 Partial | E2EE exists but missing device sessions, key rotation, session revocation |
| 10 | **CRDTs / Local-First Sync** | ❌ Not Started | Long-term phase |

---

## 🔧 Better Tools & Architecture Suggestions

### Immediate Upgrades (Low Effort, High Impact)

| Current | Recommended | Why |
| :--- | :--- | :--- |
| No rate limiter | **`express-rate-limit`** + **`rate-limit-redis`** | Prevents brute force and AI API abuse using your existing Redis |
| No input validation | **`zod`** | Type-safe schema validation, integrates perfectly with TypeScript |
| No security headers | **`helmet`** | One-line middleware, sets 15+ HTTP security headers |
| `console.log` | **`pino`** | 5x faster than Winston, JSON structured logs, production-ready |
| No error tracking | **Sentry** (free tier) | Automatic error capture, stack traces, performance monitoring |

### Architecture Improvements

| Area | Current | Recommended | Why |
| :--- | :--- | :--- | :--- |
| **Event Bus Redis Clients** | Shared `subClient` | Separate `eventSubClient` / `eventPubClient` | Fixes CRIT-3: ioredis subscriber mode conflict |
| **Presence Decrement** | Two-step `HGET` → `HDEL` | **Lua script** (`HINCRBY` + conditional `HDEL`) | Atomic operation prevents race conditions |
| **Token Storage** | JWT in localStorage | **HttpOnly Cookies** or encrypted `sessionStorage` | Prevents XSS token theft |
| **Message Encryption** | Single-recipient encryption | **Dual-key encryption** (recipient + self) | Fixes MED-3: own sent messages become readable from server |
| **AI Embeddings** | None | **pgvector** + **Ollama** (`nomic-embed-text`) | Enables Phase 2 semantic search |
| **Deployment** | Separate Vercel + Render | **Docker Compose** with Nginx reverse proxy | Unified deployment, easier local dev parity |

### Phase 2 Specific Stack Recommendation

For the upcoming semantic search implementation:

| Component | Tool | Why |
| :--- | :--- | :--- |
| Vector DB | **pgvector** extension on existing PostgreSQL | No new infrastructure, native SQL integration with Prisma |
| Embedding Model | **Ollama** running `nomic-embed-text` | Free, local, fast 768-dim embeddings, no API costs |
| Alternative (Cloud) | **OpenAI `text-embedding-3-small`** | Higher quality but costs money and adds external dependency |
| Search Algorithm | **Cosine similarity** (`<=>` operator) | Industry standard for semantic similarity |

---

## Priority Fix Order

1. **CRIT-1**: Add `.env` to `.gitignore` and remove from git history immediately
2. **CRIT-3**: Create dedicated Redis clients for EventBus
3. **CRIT-2**: Remove hardcoded JWT fallbacks, crash on missing secrets
4. **CRIT-4**: Restrict CORS origins
5. **HIGH-1**: Add rate limiting
6. **HIGH-2**: Add Zod validation
7. **HIGH-3**: Add Helmet
8. **HIGH-5**: Fix presence race condition with Lua script
9. **MED-1**: Add database indexes
10. **Then proceed to Phase 2** (pgvector + semantic search)
