# RFC: Courier — In‑Memory Envelope Queue + Trigger Server (for mkolbol Stream Kernel)

Status: Draft
Owner: Architect (AI)
Date: 2025‑10‑18

## Executive Summary

Courier is a reusable, in‑memory server that provides:
- Addressable streams for envelopes (messages) with backpressure and ordered delivery per stream/partition
- Queryable, consistent snapshots and live subscriptions (deltas) over recent in‑RAM state
- A tiny trigger engine where schema‑specific “envelope agents” act on insert/ack/timeout/query
- A simple HTTP/WebSocket gateway so external tools/agents can enqueue and subscribe concurrently

Courier plugs into the mkolbol Stream Kernel as a normal transform service. On single machine it terminates many concurrent reads/writes; in a mesh it remains oblivious to network hops (routing handled by Router/StateManager/Hostess per RFCs).

## Goals
- High‑fan‑in/out concurrency with predictable backpressure (no disk dependency)
- Queryable memory: consistent snapshots + live deltas; low‑latency notifications
- Schema‑aware triggers: per type/stream hooks (on_insert/on_ack/on_timeout/on_query)
- Idempotent, at‑least‑once delivery with per‑agent ordering
- Seamless Kernel integration (Duplex pipes); transparent scale‑out via routing

## Non‑Goals (Phase 1)
- Durable storage or cross‑restart replay (future: optional disk/DB mirror)
- Exactly‑once semantics end‑to‑end (we provide idempotency keys + at‑least‑once)
- Cross‑datacenter topology decisions (Router/StateManager own that)

## Core Concepts

- Envelope: typed, schema’d message
- Stream: named ordered sequence (e.g., `agents/Jen/inbox`)
- Subscription: credit‑based consumer binding to a stream/partition
- Trigger: predicate + actions executed on hook points
- Action: tiny function (e.g., notify, route, enrich, git.diff)
- View: materialized in‑memory table (e.g., latest per agent)

### Envelope (JSON)
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
  "tags": ["sprint","wave:B"],
  "headers": {"priority": "normal"},
  "payload": {"wave": "B", "title": "Plan xenoctl CLI"}
}
```

## API (In‑Process / Over Pipes)

- enqueue(stream, envelope, opts?) → { id }
- subscribe(stream, { partition?, credit, fromId? }) → emits envelopes; supports `ack(id)`, `nack(id, {requeueDelayMs?})`
- snapshot(viewName, filter?) → rows, watermark
- live(viewName, predicate, credit) → deltas (add/remove/update)
- stats(stream) → rates, depth, inflight, p50/p95 latencies

Semantics:
- Ordering: per stream partition (default: single partition per stream). Optional `partitionKey` for parallelism with order within key.
- Backpressure: credit‑based; server only pushes when subscriber grants credits.
- Delivery: at‑least‑once; lease timeout → redelivery. Idempotency via envelope `id`.

## Trigger Engine

Hooks: `on_insert`, `on_ack`, `on_timeout`, `on_query` (view access)

Rule:
```json
{
  "id": "trig.sprintlog.notify.architect",
  "when": { "type": "sprint.log", "from": "agents/Jen/outbox" },
  "do": [
    { "action": "notify", "to": "agents/architect/inbox",
      "payload": { "title": "Jen posted sprint log", "ref": "${env.id}" } }
  ],
  "limits": { "cooldownMs": 5000 }
}
```

Actions (Phase 1): `notify`, `route`, `enrich`, `emit`. Extensible registry for schema skills, e.g., `git.diff`, `patch.parse`.

Safety:
- Capability tokens scope actions (address prefixes, verbs) and quotas (ops/sec, bytes)
- Idempotency keys; loop prevention via system tag and hop count
- Timeouts per action; circuit breakers and error counters

## Gateway (HTTP/WS)

- POST `/v1/enqueue` → body: `{to, envelope}` → `{id}`
- GET `/v1/subscribe?stream=...` (WebSocket): client sends `credit:N` frames; server pushes envelopes; client acks via `ack:{id}`
- GET `/v1/snapshot?view=latestPerAgent` → JSON rows
- WS `/v1/live?view=...` → deltas; client credits apply

Auth: capability tokens (bearer) with scopes like `streams:agents/Jen/inbox:enqueue` or `views:*:read`.

## Integration with Stream Kernel

- Register as a transform service:
```ts
kernel.register(
  'courier',
  { type: 'transform', accepts: ['envelope'], produces: ['envelope','view'] },
  courierPipe,
);
```
- Local vs remote: Router resolves routes; Courier reads/writes only pipes.
- Hostess/StateManager: expose capabilities; views as addressable resources (e.g., `views/latestPerAgent`).

## Concurrency & Backpressure

- Per‑stream rings (bounded), owner‑only workers; global injection queue for external enqueues
- Credit‑based delivery; per‑producer quotas; burst shaping
- Partitioning by key optional to scale consumers; preserve key order

## Views & Queryability

- Built‑ins: `latestPerAgent`, `inflight`, `metrics:streams`
- Snapshot: RCU‑style handles for consistent reads
- Live: incremental diffs with compact row patches

## Observability

- Metrics: ingress rate, queue depth, p50/p95/99 latencies, acks/timeouts, trigger runs/faults
- Tracing: correlation via `corr`; spans for trigger chains; JSONL export optional
- Introspection: list streams/consumers; explain(trigger) showing predicates and recent emissions

## MVP Scope (2–3 days)

1. Envelope type + basic validation
2. Streams: enqueue, subscribe (credit), ack/nack; per‑stream ring buffers
3. Triggers: on_insert + `notify` action; rule registry; cooldown
4. Views: `latestPerAgent`
5. Gateway: POST enqueue, WS subscribe/ack/credit
6. Kernel registration + Hostess listing stub

## Examples

- Notify Architect when Jen posts sprint log
- Notify Jen when Architect posts sprint assignment
- Git diff (stub): `git.diff.request` → emit `git.diff.result` (can call local git in dev)

## Open Questions
- Schema registry: versioning strategy and negotiation
- Cross‑host delivery credits: export bounded credits across Router hops
- Optional persistence: JSONL mirror and/or SQLite FTS indexing for search
- Security defaults: sensible limits for streams and actions out of the box

