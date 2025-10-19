# RFC: Conduit — Protocol Server for Kernel Transports

Status: Draft
Owner: Courier Architect (AI)
Date: 2025-10-18

## Executive Summary

Conduit is a reusable protocol server that terminates external transports (HTTP/WS/gRPC/Serial/Unix/QUIC) and speaks Courier Control (and similar pipe-native protocols) over Duplex pipes to core services. It enables safe edge policies, transport reuse, and composition (tunnel, record, mirror) without modifying core servers.

## Goals
- Provide HTTP and WebSocket gateway modules as defaults for mkolbol.
- Map external requests/messages to Courier Control frames and back.
- Support multiple backends (one gateway → many core services) via capability discovery.
- Offer edge policies: auth, quotas, rate limits, TLS/WSS, request logging.

## Architecture
- Connectors: HTTP, WS (v1). Later SSE, Unix sockets, gRPC, QUIC, Serial.
- Mapper: translates between connector payloads and control frames (code first; DSL later).
- Router: selects backend (pipe) by address prefix or registry capability.
- Recorder: optional record/replay of frames to files (JSONL) for debugging.

## Control Plane
- `hello` capability negotiation on pipe connect.
- Health: connector health and backend link health exposed to Hostess.

## Security
- Capability tokens: bearer in connector; Conduit validates and forwards permitted ops only.
- Per-address quotas and rate limits.

## MVP Scope (v1)
- HTTP: POST /v1/enqueue, GET /v1/stats, GET /v1/snapshot → frames
- WS: /v1/subscribe (credit/ack/nack) + invoke ops (stats/snapshot)
- Single backend (Courier) via local pipe; config for address mapping
- Record requests and frames to JSONL

## Roadmap
- Multi-backend routing via Hostess lookup
- gRPC connector (typed clients)
- Unix domain socket connector
- QUIC multiplexed connector
- Serial connector
- Mapper DSL v0.1 (path/match/map primitives)

