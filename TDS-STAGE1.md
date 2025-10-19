# Technical Design Specification — Courier Stage 1: Pipe‑Native Control + Gateways

Status: Draft
Owner: Courier Architect (AI)
Date: 2025‑10‑18

## 1. Objective

Decouple Courier core from HTTP/WS edge by introducing a small, pipe‑native control protocol and a PipeClient/PipeServer pair. Gateways (HTTP/WS) speak the control protocol over Duplex pipes; core remains pure (queue + triggers + views), and HTTP/WS become optional, reusable components.

## 2. Scope (Stage 1)

- Control Protocol v1 (see docs/rfcs/CONTROL-PROTOCOL-v1.md)
- In‑process PipeServer that bridges control frames → core ops
- In‑process PipeClient with request/response correlation and subscribe flow
- Refactor HTTP/WS gateways to use PipeClient (no direct core calls)
- Optional startup of HTTP/WS via config (default: enabled)
- Hello/version handshake + capability list
- Optional control frame recorder (JSONL) — off by default

Non‑Goals (Stage 1)
- Remote transports (QUIC/serial) — later via Conduit
- Mapper DSL — code mappings only
- Persistence — still in‑memory

## 3. Architecture

Components:
- Core: InMemoryQueue, TriggerEngine, Views (unchanged semantics)
- PipeServer: accepts a Duplex, reads JSON line frames, calls core ops, streams deliver frames
- PipeClient: connects to PipeServer Duplex, exposes enqueue/subscribe/stats/snapshot APIs, correlates reqId/ok/error
- HTTP/WS: thin adapters mapping HTTP/WS requests ⇄ PipeClient calls

Data flow (in‑process):
HTTP/WS ⇄ PipeClient ⇄ (Duplex) ⇄ PipeServer ⇄ Core

## 4. Interfaces (TypeScript)

Control frames (summary):
- Requests: hello, enqueue, subscribe, grant, ack, nack, stats{reqId}, snapshot{reqId}
- Responses: ok{reqId,result}, error{reqId,code,detail}, deliver{env}

PipeClient API:
```ts
interface DeliverHandler { (env: Envelope): void }

class PipeClient {
  constructor(stream: Duplex, opts?: { recorder?: (frame: any, dir: 'in'|'out') => void }) {}
  hello(features?: string[]): Promise<{ version: string; features: string[] }>;
  enqueue(to: string, env: Envelope): Promise<{ id: string }>;
  subscribe(stream: string, onDeliver: DeliverHandler): Promise<{ subId: string }>;
  grant(n: number): void;
  ack(id: string): void;
  nack(id: string, delayMs?: number): void;
  stats(stream: string): Promise<StreamStats>;
  snapshot(view: string): Promise<{ rows: any[] }>;
}
```

PipeServer API:
```ts
class PipeServer {
  constructor(core: QueueCore, view: LatestPerAgentView) {}
  attach(stream: Duplex): void; // begins processing control frames on this stream
}
```

HTTP/WS Gateways (refactor):
- HTTP uses PipeClient.enqueue/stats/snapshot
- WS uses PipeClient.subscribe/grant/ack/nack; may call stats/snapshot via request frames over WS side channel

## 5. Core Mappings

- enqueue → core.enqueue(to, env) then view.update + trigger.onInsert
- subscribe → create subscriber token inside server; deliver frames on credit; lease + timeout logic stays in core
- grant → increments delivery budget
- ack/nack → core.ack/nack
- stats/snapshot → core.stats; view.snapshot
- hello → returns {version:"v1", features:["credit","views","triggers"]}

## 6. Configuration

- COURIER_HTTP_PORT (default 8787); COURIER_WS_PORT (8788)
- COURIER_DISABLE_HTTP, COURIER_DISABLE_WS (false by default)
- COURIER_BIND (default 127.0.0.1)
- COURIER_RECORD_CONTROL (path to JSONL file; unset disables)

## 7. Observability

- Recorder: if enabled, write one JSON per line: {ts, dir, frame}
- Metrics unchanged; stats endpoint remains

## 8. Error Handling

- Validation errors: error{reqId, code:"InvalidEnvelope", detail}
- Unknown stream: error code "UnknownStream"
- Rate/credit issues: no deliver when credit=0 (not an error frame)
- WS/HTTP map ok/error to 200/4xx with JSON body {ok:false,error:{...}}

## 9. Security (Stage 1)

- Token optional; if provided via HTTP Bearer/WS param, include in hello; server may accept/ignore
- Enforce localhost‑only bindings by default (bind 127.0.0.1 unless COURIER_BIND set)

## 10. Testing Plan

- Unit: PipeServer request→core mapping; PipeClient correlation; subscribe delivery on credit; ack/nack paths
- Integration: HTTP enqueue→ok; WS subscribe/grant/ack; stats/snapshot via HTTP and via control frames
- Demo: scripts/cli/demo‑notify.ts works unchanged through PipeClient

## 11. Work Breakdown

1) Control types: add src/control/types.ts (frame unions, helpers)
2) PipeServer: src/control/server.ts (attach, dispatch, write ok/error/deliver)
3) PipeClient: src/control/client.ts (reqId, pending map, line codec, recorder hook)
4) Refactor gateways to use PipeClient; config flags for enable/disable; bind address
5) Hello handshake in client and server
6) Optional recorder: src/control/record.ts; wire via env
7) Update README + docs/mkctl‑courier.md

## 12. Risks & Mitigations

- Backpressure loops: ensure deliver only on grant; never buffer unbounded frames → use bounded queues
- JSON overhead: acceptable for control; large payloads discouraged
- Hidden coupling: keep control surface minimal; do not expose core internals via control frames

## 13. Deliverables

- src/control/{client.ts,server.ts,types.ts,record.ts}
- Refactored src/gateway/{http.ts,ws.ts}, src/index.ts
- Config/env docs and updated README

## 14. Rollout

- Land behind flags (default enabled for HTTP/WS)
- Keep CLI and demo scripts working
- Next stage: extract Conduit gateway to reusable module/repo, keep the same control protocol

