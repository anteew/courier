# RFC: Courier Control Protocol v1

Status: Draft
Owner: Courier Architect (AI)
Date: 2025-10-18

## Executive Summary

Courier Control v1 is a small, pipe-native protocol that exposes queue, trigger, and view operations over Duplex streams. It is transport-agnostic (local PassThrough, TCP/WS/Unix via Terminals/Router) and intended for reuse by generic gateways (HTTP/WS/gRPC/Serial) and other services.

## Goals
- Minimal, JSON-framed control surface for enqueue/subscribe/ack/nack with credits.
- Request/response for admin ops (stats, snapshot) with correlation.
- Capability negotiation (`hello`) for forwards/backwards compatibility.
- Idempotent, at-least-once delivery with client acks and server leases.

Non-goals v1: persistence semantics, exactly-once, bulk blob transport (use refs).

## Framing
- Line-delimited JSON (one object per frame). UTF-8. ObjectMode allowed when local.
- Fields: `type` (string), plus type-specific fields. Request frames include `reqId`.

## Types
- `hello`: { type:"hello", version:"v1", features:["credit","views","triggers"] }
- `ok`: { type:"ok", reqId, result?:any }
- `error`: { type:"error", reqId, code, detail? }

Stream ops
- `enqueue`: { type:"enqueue", to, env }
- `subscribe`: { type:"subscribe", stream }
- `grant`: { type:"grant", n }
- `ack`: { type:"ack", id }
- `nack`: { type:"nack", id, delayMs? }
- `deliver`: { type:"deliver", env }

Admin ops
- `stats`: { type:"stats", reqId, stream }
- `snapshot`: { type:"snapshot", reqId, view }

## Semantics
- Ordering: per stream (single partition v1). Credit-based backpressure (`grant` increases delivery budget).
- Leases: server redelivers on timeout; client must `ack` or `nack`.
- Idempotency: `env.id` used by clients to de-dup; server keeps a recent-id window per stream.

## Errors (codes)
- InvalidEnvelope, Unauthorized, UnknownStream, RateLimited, Internal

## Capability Negotiation
- Peer sends `hello`; receiver may reply with `ok` result {version, features}. Unknown frames → `error`.

## Extensibility
- New ops gated by `features`. Non-JSON encodings (CBOR) can be negotiated in future.

## Security
- Tokens carried out-of-band (pipe provisioning) or in `hello` (bearer). Apply per-address quotas.

## Examples
```
{ "type":"hello", "version":"v1", "features":["credit","views"] }
{ "type":"enqueue", "to":"agents/Jen/inbox", "env":{ "id":"e-1", "ts":"...", "type":"notify", "payload":{}} }
{ "type":"subscribe", "stream":"agents/Jen/inbox" }
{ "type":"grant", "n":10 }
{ "type":"deliver", "env":{ ... } }
{ "type":"ack", "id":"e-1" }
{ "type":"stats", "reqId":"r1", "stream":"agents/Jen/inbox" }
{ "type":"ok", "reqId":"r1", "result":{"depth":0} }
```

## Roadmap
- v1.1: `admin` ops (trigger CRUD), `schema.validate`, `connectors.add/remove/status`.
- v2: optional CBOR frames, multi-part blobs via side-channel refs.

