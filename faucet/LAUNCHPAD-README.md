# OPNet Launchpad Server

Instant-trade server for the OPNet Launchpad (pump.fun style).
All trades execute server-side for instant UX. On-chain settlement can happen in background.

## Quick Start (local)

```bash
cd faucet
npm install express cors
node launchpad-server.mjs
# → http://localhost:3457/lp/health
```

## Deploy to VPS

```bash
# 1. Copy files to VPS
scp -r faucet/ root@188.137.250.160:/root/opnet-hub/faucet/

# 2. Install deps on VPS
ssh root@188.137.250.160 "cd /root/opnet-hub/faucet && npm install express cors"

# 3. Install systemd service
ssh root@188.137.250.160 "cp /root/opnet-hub/faucet/opnet-launchpad.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable opnet-launchpad && systemctl start opnet-launchpad"

# 4. Check status
ssh root@188.137.250.160 "systemctl status opnet-launchpad"
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/lp/health` | Health check |
| GET | `/lp/tokens` | List all tokens (sorted by mcap) |
| GET | `/lp/token/:address` | Token detail |
| POST | `/lp/create` | Register new token launch |
| POST | `/lp/buy` | **Instant buy** `{address, wallet, amount}` |
| POST | `/lp/sell` | **Instant sell** `{address, wallet, amount}` |
| POST | `/lp/reply` | Post comment `{address, wallet, text}` |
| POST | `/lp/like` | Like token `{address}` |
| GET | `/lp/account/:wallet` | User balances |

## Architecture

- **Data**: JSON files in `./data/` (auto-saved every 30s)
- **Bonding curve**: Virtual constant-product (same as frontend)
- **Graduation**: At 80% publicMintSupply minted → status becomes "graduated"
- **CORS**: Enabled for all origins
- **Port**: 3457 (configurable via `LP_PORT` env)

## Frontend Config

Set `VITE_LP_API` in `.env.development` or `.env.production`:
```
VITE_LP_API=http://localhost:3457        # local dev
VITE_LP_API=http://188.137.250.160:3457  # production VPS
```

The frontend auto-detects server availability and falls back to localStorage if unreachable.
