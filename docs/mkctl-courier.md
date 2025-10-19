# mkctl + Courier (Helpers)

Courier exposes HTTP/WS endpoints. Until mkctl subcommands land, use the built-in CLI tools or curl/websocat.

## CLI Tools (v1.0.0-stage1)

**Health check:**
```bash
curl http://127.0.0.1:8787/health
```

**Stream statistics:**
```bash
npm run cli:stats -- --stream agents/Jen/inbox
# Returns: depth, inflight, rateIn, rateOut, latP50, latP95
```

**View snapshot:**
```bash
npm run cli:snapshot -- --view latestPerAgent
# Returns: { rows: [...] }
```

**Global metrics:**
```bash
curl http://127.0.0.1:8787/v1/metrics
# Returns all stream stats in one call
```

**End-to-end demo:**
```bash
npm run demo:e2e
# Runs: health check, enqueue, stats, snapshot, metrics
```

## Enqueue (HTTP)

Basic enqueue:
```bash
curl -X POST http://127.0.0.1:8787/v1/enqueue \
  -H 'content-type: application/json' \
  -d '{
    "to":"agents/Jen/inbox",
    "envelope":{
      "id":"e-1","ts":"2025-10-18T22:50:00Z","type":"notify","payload":{"msg":"hello"}
    }
  }'
```

With Bearer token (auth plumbing):
```bash
curl -X POST http://127.0.0.1:8787/v1/enqueue \
  -H 'content-type: application/json' \
  -H 'Authorization: Bearer dev-local' \
  -d '{"to":"agents/Jen/inbox","envelope":{...}}'
```

## Subscribe (WS)

Basic subscription:
```bash
# requires websocat or wscat
websocat ws://127.0.0.1:8788/v1/subscribe?stream=agents/Jen/inbox \
  -E -t -n --ping-interval=30 \
  <<< '{"credit": 1}'
```

With Bearer token:
```bash
websocat ws://127.0.0.1:8788/v1/subscribe?stream=agents/Jen/inbox \
  -H 'Authorization: Bearer dev-local' \
  -E -t -n <<< '{"credit": 1}'
```

Send ack:
```bash
echo '{"ack": "e-1"}' | websocat ws://127.0.0.1:8788/v1/subscribe?stream=...
```

Send nack:
```bash
echo '{"nack": "e-1"}' | websocat ws://127.0.0.1:8788/v1/subscribe?stream=...
```

## Rate Limiting (disabled by default)

Enable rate limiting:
```bash
export COURIER_RATE_LIMIT=true
export COURIER_RATE_LIMIT_PER_IP=100
export COURIER_RATE_LIMIT_WINDOW_MS=60000
npm run dev
```

Exempt endpoints: /health, /v1/metrics (always allowed)

Rate limit response:
```json
{"error": "rate limit exceeded"}
```
HTTP 429 status

## Error Responses

Courier maps control errors to HTTP status codes:

- **400 Bad Request**: InvalidEnvelope, missing parameters
- **404 Not Found**: UnknownStream, UnknownView
- **429 Too Many Requests**: Rate limit exceeded
- **500 Internal Server Error**: Internal errors

Example error response:
```json
{"error": "UnknownView", "detail": "myview"}
```

## Planned mkctl commands

- `mkctl courier enqueue --to agents/Jen/inbox --file env.json`
- `mkctl courier subscribe --stream agents/Jen/inbox --credit 10`
- `mkctl courier snapshot latestPerAgent`
- `mkctl courier stats agents/Jen/inbox`
- `mkctl courier metrics`
