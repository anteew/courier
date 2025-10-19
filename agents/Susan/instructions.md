```json
{
  "ampcode": "v1",
  "sprint": {
    "id": "C1-Stage1-Edge",
    "briefing": "Polish Courier Stage 1 edge: health/metrics, error mapping, token plumb, rate limits, CLI + demo, docs.",
    "owner": "Susan",
    "notes": "Use local node deps only; bind 127.0.0.1 by default; keep runs short and log to JSONL when recorder is enabled."
  },
  "waves": [
    { "id": "Wave-S1", "parallel": true, "tasks": ["T-S1-HEALTH", "T-S1-METRICS", "T-S1-ERRORS", "T-S1-AUTH", "T-S1-RATE", "T-S1-CLI", "T-S1-DOCS"] }
  ],
  "tasks": [
    {
      "id": "T-S1-HEALTH",
      "agent": "gemini",
      "title": "Add /health endpoint (version, features)",
      "why": "Allow readiness checks and quick diagnostics",
      "allowedFiles": [
        "src/gateway/http.ts",
        "src/index.ts"
      ],
      "verify": [
        "node --loader ts-node/esm src/index.ts & echo $! > /tmp/courier.pid; sleep 1; curl -sS http://127.0.0.1:8787/health; kill $(cat /tmp/courier.pid) || true"
      ],
      "deliverables": ["/health endpoint returning {ok, version, features}"]
    },
    {
      "id": "T-S1-METRICS",
      "agent": "gemini",
      "title": "Add /v1/metrics endpoint (per-stream)",
      "why": "Basic operational visibility without external tools",
      "allowedFiles": [
        "src/gateway/http.ts",
        "src/control/client.ts",
        "src/control/server.ts"
      ],
      "verify": [
        "node --loader ts-node/esm src/index.ts & echo $! > /tmp/courier.pid; sleep 1; curl -sS 'http://127.0.0.1:8787/v1/stats?stream=agents/Jen/inbox'; curl -sS http://127.0.0.1:8787/v1/metrics || true; kill $(cat /tmp/courier.pid) || true"
      ],
      "deliverables": ["/v1/metrics returns JSON summary {streams:[{id,depth,inflight,rateIn,rateOut,latP50,latP95}]}"
      ]
    },
    {
      "id": "T-S1-ERRORS",
      "agent": "gemini",
      "title": "Map control errors to HTTP status codes",
      "why": "Predictable HTTP semantics for clients",
      "allowedFiles": ["src/gateway/http.ts"],
      "verify": [
        "node --loader ts-node/esm src/index.ts & echo $! > /tmp/courier.pid; sleep 1; curl -s -o /dev/null -w '%{http_code}' 'http://127.0.0.1:8787/v1/snapshot?view=__unknown__' | grep -E '400|404' ; kill $(cat /tmp/courier.pid) || true"
      ],
      "deliverables": ["Consistent mapping: InvalidEnvelope→400, UnknownStream/View→404, Internal→500"]
    },
    {
      "id": "T-S1-AUTH",
      "agent": "gemini",
      "title": "Plumb Bearer token into hello negotiation",
      "why": "Prepare for edge auth without enforcing policy",
      "allowedFiles": ["src/gateway/http.ts", "src/gateway/ws.ts", "src/control/{client.ts,server.ts}"] ,
      "verify": [
        "COURIER_RECORD_CONTROL=/tmp/cour.ctrl.jsonl node --loader ts-node/esm src/index.ts & echo $! > /tmp/courier.pid; sleep 1; curl -H 'Authorization: Bearer dev-local' -sS -X POST http://127.0.0.1:8787/v1/enqueue -d '{"to":"agents/Jen/inbox","envelope":{"id":"e-1","ts":"2025-10-18T00:00:00Z","type":"notify","payload":{}}}' -H 'content-type: application/json'; grep -q 'hello' /tmp/cour.ctrl.jsonl; kill $(cat /tmp/courier.pid) || true"
      ],
      "deliverables": ["Gateways pass token to PipeClient.hello; server records token presence (no auth yet)"]
    },
    {
      "id": "T-S1-RATE",
      "agent": "gemini",
      "title": "Add simple per-IP token bucket rate limit hooks",
      "why": "Protect edge from bursts during demos",
      "allowedFiles": ["src/gateway/http.ts"],
      "verify": ["# Manual: configure low limit and verify 429 on bursts"],
      "deliverables": ["Configurable limits; 429 responses when exceeded"]
    },
    {
      "id": "T-S1-CLI",
      "agent": "gemini",
      "title": "CLI helpers + one-shot demo:e2e",
      "why": "Non-technical users can demo quickly",
      "allowedFiles": [
        "scripts/cli/stats.ts",
        "scripts/cli/snapshot.ts",
        "scripts/cli/demo-e2e.ts",
        "package.json"
      ],
      "verify": [
        "npm run cli:stats -- --stream agents/Jen/inbox",
        "npm run cli:snapshot -- --view latestPerAgent",
        "npm run demo:e2e"
      ],
      "deliverables": ["New npm scripts: cli:stats, cli:snapshot, demo:e2e"]
    },
    {
      "id": "T-S1-DOCS",
      "agent": "gemini",
      "title": "Docs polish (README, mkctl helpers, .env.dev)",
      "why": "Clear setup for future contributors and agents",
      "allowedFiles": ["README.md", "docs/mkctl-courier.md", "config/.env.dev"],
      "verify": ["# Manual: lint/read; ensure commands work copy-paste"],
      "deliverables": ["Updated README, helper docs, example env file"]
    }
  ]
}
```

