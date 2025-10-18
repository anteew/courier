# mkctl + Courier (Helpers)

Courier exposes HTTP/WS endpoints. Until mkctl subcommands land, use curl/websocat.

## Enqueue (HTTP)

```bash
curl -sS -X POST http://localhost:8787/v1/enqueue \
  -H 'content-type: application/json' \
  -d '{
    "to":"agents/Jen/inbox",
    "envelope":{
      "id":"e-1","ts":"2025-10-18T22:50:00Z","type":"notify","payload":{"msg":"hello"}
    }
  }'
```

## Subscribe (WS)

```bash
# requires websocat or wscat
websocat ws://localhost:8788/v1/subscribe?stream=agents/Jen/inbox \
  -E -t -n --ping-interval=30 \
  <<< '{"credit": 1}'
```

## Planned mkctl commands

- `mkctl courier enqueue --to agents/Jen/inbox --file env.json`
- `mkctl courier subscribe --stream agents/Jen/inbox --credit 10`
- `mkctl courier snapshot latestPerAgent`
