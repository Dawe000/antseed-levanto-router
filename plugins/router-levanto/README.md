# @antseed/router-levanto

The `routing-client` half of Levanto's model-routing subscription (public side —
the routing-server's actual ranking/pricing logic lives in the separate, private
`levanto-routing-server` repo, not here).

Implements `Router.selectRoute` — declines immediately for any concretely-chosen
model, and for the `levanto-auto` sentinel, calls out to the configured routing
peer's `/_antseed/route` endpoint and returns its ranked candidates.

## Config

- `LEVANTO_ROUTING_PEER_URL` — base URL of the routing peer, e.g.
  `http://127.0.0.1:8787`. Optional; the plugin discovers its real mainnet
  routing peer's address itself via P2P/DHT lookup once the node has started.
- `ANTSEED_ROUTER_DATA_DIR` — persistent directory for the routing_decisions
  ledger. Omit to keep the ledger in-memory only.
- `LEVANTO_SELLER_PEER_ID` — the routing peer's P2P peer id.
- `ANTSEED_BUYER_PEER_ID` — this buyer's own P2P peer id.
- `ANTSEED_CHAIN_ID` — this buyer's configured chain, to pick devnet-vs-mainnet
  routing-peer defaults.

## Status

Implements routing call + candidate mapping, day-pass payment signing
(`signDayPassOnDemand`, reactive to a 402/`renewalDue` from the routing peer),
the new-user-message gate, and a SQLite-backed local ledger of routing
decisions.
