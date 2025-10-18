# Technical Design Specification — Courier v1.0 (Minimal)

Status: Draft
Owner: Architect (AI)
Date: 2025-10-18

## 1. Purpose

Courier v1.0 provides an in-memory, queryable envelope queue with backpressure and a tiny trigger engine, designed to plug into the mkolbol Stream Kernel. It terminates many concurrent producers/consumers on a single machine, and later scales transparently via the Router/StateManager without code changes.

## 2. Non-Goals (v1.0)
- Durable storage or replay across restarts (no disk/DB persistence)
- Exactly-once delivery (provide idempotency keys + at-least-once)
- Cross-host topology logic (handled by Hostess/StateManager/Router)
- Complex trigger chaining or untrusted user code execution

## 3. Scope (MVP)
- Streams: Named, ordered in-memory queues with bounded rings per stream
- Subscribe API: Credit-based backpressure; ack/nack; lease timeouts with redelivery
- Enqueue API: Append envelope to stream with basic validation
- Views: `latestPerAgent` materialized map (address → last envelope)
- Triggers: `on_insert` only + built-in `notify` action
- Gateway: HTTP POST enqueue + WebSocket subscribe/ack/credit
- Kernel integration: Register as transform service; expose capabilities; single-process

## 4. Concepts & Data Model

### 4.1 Envelope (public JSON)
```json
{
  "id": "e-91a",
  "ts": "2025-10-18T19:55:00Z",
  "from": "architect",
  "to": "agents/Jen/inbox",
  "type": "sprint.assign",
  "schema": "xeno/sprint-assign@v1",
  "version": 1,
  "corr": "c-42",
  "refs": ["T1102"],
  "tags": ["sprint"],
  "headers": {"priority": "normal"},
  "payload": {"wave": "B", "title": "Plan xenoctl CLI"}
}
```

Validation (v1): require `id`, `ts`, `to`, `type`, `payload`.

### 4.2 Internal Types
```ts
// Stream key e.g., "agents/Jen/inbox"
type StreamId = string;

type Envelope = { /* as above */ };

type Lease = { id: string; subscriberId: string; expiresAt: number };

type Ring<T> = { buf: T[]; head: number; tail: number; size: number };

type Subscriber = {
  id: string;
  stream: StreamId;
  credit: number;
  inFlight: Map<string, Lease>; // id → lease
};
```

## 5. Architecture

Components (single process):
- QueueCore: stream registry, rings, subscriptions, ack/nack, timeouts, triggers, views
- TriggerEngine: evaluates `on_insert` rules; executes built-in actions
- Views: maintains `latestPerAgent` map; emits deltas to live subscribers (phase 2)
- Gateway: HTTP/WS front end; validates and calls QueueCore
- KernelAdapter: registers with Stream Kernel; exposes a duplex Pipe if embedded in-process

Threading model (Node): event-loop only; timers for lease expiry; no worker threads in v1.

## 6. Semantics

### 6.1 Ordering
- Per stream FIFO for delivery
- Optional partitioning by `partitionKey` (not in v1); v1 uses single partition

### 6.2 Backpressure (Credits)
- Subscribers start with `credit=0`; they must grant credits via WS control messages
- Server decrements credit on delivery; stops pushing at 0; resumes when credit > 0

### 6.3 Delivery / Leases
- At-least-once: delivery creates a lease with TTL (default 30s)
- Ack: removes lease
- Nack: removes lease and re-enqueues (tail) with optional delay (not in v1)
- Timeout: lease expiry triggers redelivery (re-enqueue tail)

### 6.4 Idempotency
- Envelope `id` is the idempotency key; subscribers should de-dup
- Server maintains a small per-stream recent-id cache window (v1: simple LRU set)

## 7. APIs

### 7.1 In-Process Interface (used by Gateway/Kernel)
```ts
interface QueueCore {
  enqueue(stream: StreamId, env: Envelope): { id: string };
  subscribe(stream: StreamId): Subscriber; // returns token/id
  grantCredit(subId: string, n: number): void;
  ack(subId: string, id: string): void;
  nack(subId: string, id: string): void;
  stats(stream: StreamId): StreamStats;
}

interface StreamStats {
  depth: number; inflight: number; rateIn: number; rateOut: number;
  latP50: number; latP95: number; lastTs: string;
}
```

### 7.2 HTTP/WS Gateway (v1)
- POST `/v1/enqueue`
  - Body: `{ to: string, envelope: Envelope }`
  - Resp: `{ id: string }`
- WS `/v1/subscribe?stream=<id>`
  - Client → Server control frames (JSON): `{"credit":N}`, `{"ack":"<id>"}`, `{"nack":"<id>"}`
  - Server → Client deliveries: `{"deliver": Envelope}`
  - Errors: `{"error": {code, message}}`

Auth (v1): optional bearer token with scopes (static allowlist). If absent, allow localhost.

## 8. Triggers

### 8.1 Model
- Rules table evaluated on `on_insert(stream, env)` only (v1)
- Predicate: match on `to`, `from`, `type`, `tags`, and simple header keys
- Action: built-in `notify` → emits new envelope to target stream

### 8.2 Example Rules
```json
{
  "id":"trig.jen.log.notify.architect",
  "when": {"type":"sprint.log", "from":"agents/Jen/outbox"},
  "do": [{"action":"notify","to":"agents/architect/inbox",
          "payload":{"title":"Jen posted sprint log","ref":"${env.id}"}}],
  "limits": {"cooldownMs": 5000}
}
```

Cooldown prevents notification storms from bulk inserts.

## 9. Views

v1 provides `latestPerAgent`:
- Map of `agents/<name>/inbox` → last envelope
- Snapshot API (HTTP): GET `/v1/snapshot?view=latestPerAgent`
- Live updates over WS (phase 2): `/v1/live?view=latestPerAgent`

## 10. Observability

Metrics (per stream):
- q.in (enqueued), q.out (delivered), q.ack, q.nack, q.re (redeliveries)
- q.depth (current), q.if (in-flight)
- q.lat.p50, q.lat.p95 (enqueue→first delivery)

Logs (optional JSONL):
- events: enqueue, deliver, ack, timeout, trigger.run/fail with ids and durations

## 11. Error Handling
- Validation errors → 400 (HTTP) / error frame (WS)
- Unknown stream → 404 / error frame
- Lease errors (double ack) → 409 / error frame
- Over-quota / no credit → 429 / back-off guidance

## 12. Security
- Capability tokens (static v1): scopes like `streams:agents/Jen/inbox:enqueue`, `streams:*:subscribe`
- Rate limits per token and per stream (simple token bucket)

## 13. Integration with Stream Kernel
- Register as transform service:
```ts
kernel.register(
  'courier',
  { type:'transform', accepts:['envelope'], produces:['envelope','view'] },
  courierPipe,
);
```
- If embedded: provide a Pipe adapter that maps deliveries to `deliver` envelopes and accepts `enqueue` commands
- Hostess/StateManager: advertise `courier` service and basic stats (HTTP endpoint link)

## 14. Performance Targets (Dev Box)
- Single stream sustained: 10–50k msg/s in-memory with small envelopes
- p95 enqueue→deliver latency: < 5 ms under moderate load
- N subscribers with credit 1: fair delivery without starvation

## 15. Configuration (v1)
```yaml
streams:
  defaultLeaseMs: 30000
  maxDepth: 100000
  perStreamCaps: { "agents/*": { maxDepth: 50000 } }
triggers:
  - { id: trig.jen.log.notify.architect, when: {type: sprint.log, from: agents/Jen/outbox}, do: [{action: notify, to: agents/architect/inbox}] }
auth:
  tokens:
    - { token: "dev-local", scopes: ["streams:*:enqueue","streams:*:subscribe","views:*:read"] }
```

## 16. Testing Strategy
- Unit: enqueue/subscribe/ack/nack/timeout; trigger predicate/action; view updates
- Property: at-least-once (every enqueued id eventually acked or leased), no delivery when credit=0
- Integration: HTTP/WS flows; trigger notification loop (Jen→Architect, Architect→Jen)
- Load: synthetic producer/consumer to hit targets; validate latency percentiles

## 17. Rollout Plan
- Phase A: QueueCore + HTTP/WS + on_insert notify + latestPerAgent + metrics
- Phase B: Live view subscriptions; delayed requeue; partitionKey; token buckets; basic id cache
- Phase C: Schema skills (git.diff stub), additional actions (route, enrich), Router/Kernel adapter polish

## 18. Open Questions
- Schema registry versioning and evolution (accept older/newer?)
- Exporting credits across multi-hop routes when distributed
- Optional persistence (JSONL mirror and/or SQLite FTS5)
- Multi-tenant isolation and default safe limits

## 19. Appendix — Minimal Interfaces (TS)
```ts
class InMemoryQueue implements QueueCore { /* ... */ }
class HttpWsGateway { constructor(private core: QueueCore) {} /* ... */ }
class TriggerEngine { /* match + execute */ }
class Views { latestPerAgent: Map<string, Envelope>; snapshot() {} }
```

```http
POST /v1/enqueue
{ "to":"agents/Jen/inbox", "envelope": { /* Envelope */ } }
→ { "id": "e-91a" }

WS /v1/subscribe?stream=agents/Jen/inbox
Client: {"credit": 10}
Server: {"deliver": { /* Envelope */ }}
Client: {"ack": "e-91a"}
```
