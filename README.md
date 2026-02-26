# ⚡ OPNet Hub — Mission Control for Programmable Bitcoin

> The first mission control dashboard for Bitcoin's consensus layer. Built for the [OP_NET Vibecoding Challenge](https://vibecode.finance).

🌐 **Live Demo**: https://yourophub.github.io/opnet-hub/

![Bitcoin L1](https://img.shields.io/badge/Bitcoin-L1-F7931A?style=flat&logo=bitcoin&logoColor=white)
![OP_NET](https://img.shields.io/badge/OP__NET-Consensus_Layer-0ea5e9?style=flat)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat&logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?style=flat&logo=vite&logoColor=white)

## What is this?

**OPNet Hub** is a mission control dashboard for the OP_NET ecosystem — the first consensus layer on Bitcoin. Unlike metaprotocols (BRC-20, Runes) that rely on indexers, OP_NET provides cryptographic proof of correct execution directly on Bitcoin L1.

This app gives users a single interface to explore, interact with, and learn about programmable Bitcoin:

### Features

| Feature | Description |
|---------|-------------|
| 🏠 **Landing** | Hero page explaining OP_NET's 3 pillars: Consensus, WASM Contracts, Post-Quantum Security |
| 🤖 **Bob AI** | AI copilot connected to **live Bob MCP server** (ai.opnet.org) — 30+ knowledge topics, falls back to local KB |
| 🚀 **Token Launcher** | Configure your OP-20 (name, symbol, supply), then follow real deploy steps: build from [OP_20](https://github.com/btc-vision/OP_20) template and deploy via OP_WALLET |
| 💼 **Portfolio** | **Live BTC balance** from OP_NET RPC + OP-20 token holdings with 24h change |
| 🛠️ **Tools** | **Live RPC**: BTC/Sats/USD converter, OP-20 token explorer (name/symbol/supply from chain), wallet inspector (balance), gas & mempool from OP_NET |
| ⛏️ **Epoch Miner** | Idle clicker game with **$MINE token** economics — halving, pool distribution, real VPS leaderboard, claim flow |
| 🎯 **Quests** | Tiered onboarding (Beginner → Explorer → Builder) — 8 tasks, XP, level progression, accessible via the ⚡ FAB button |
| 🔄 **Swap** | Motoswap-style DEX — swap OP-20 tokens, **Bob MCP live contract addresses**, LP fees, slippage, price impact |
| 📰 **News** | Curated OP_NET and Bitcoin news feed with filtering |
| 🔗 **Ecosystem** | Directory of 26+ apps built on OP_NET's consensus layer |
| 📊 **Dashboard** | Live BTC price, epoch progress bar, gas fee, live block feed, OPScan link, auto-refresh every 30s |

## On-Chain Deployments (Testnet)

| Token | Address | TX Hash | Supply |
|-------|---------|---------|--------|
| ⛏️ **$MINE** | `opt1sqpqqfzj0tvevwpj2fx0pwfevm7ulf7xzlcxw8nys` | `78421616ef1234...` | 21,000,000 |
| ⚡ **$VIBE** | `opt1sqzfw0zskjdlcnsa057695af6rp5dadl2pu58dx9d` | `c1195ea7b1bdcd...` | 100,000,000 |

**Deployer wallet**: `opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my`

Both tokens deployed via `TransactionFactory.signDeployment()` with ML-DSA signing on OP_NET testnet.

### Security & Performance

- **Zero** `any` types, `@ts-ignore`, `eslint-disable` — strict TypeScript
- **React.lazy** for 8 components — initial JS bundle: **27KB** (down from 104KB)
- **bigint** for all satoshi/token amounts
- **AbortSignal.timeout** on all RPC calls (8s) and MCP calls (10s)
- **Multi-source BTC price**: CoinCap → Blockchain.info → CoinGecko with 5min cache
- **No private keys** in frontend code

### Why OP_NET?

OP_NET is fundamentally different from metaprotocols:

- **Cryptographic Consensus**: Given the same Bitcoin blocks, every node derives the exact same state
- **WASM Smart Contracts**: Full Turing-complete execution via WebAssembly (AssemblyScript, Rust, C++)
- **Post-Quantum Security**: ML-DSA (NIST-standardized) signatures for all contract interactions
- **Zero New Trust**: Only ONE honest node needed. Inherits all of Bitcoin's security
- **Epoch System**: 5-block checkpoints with SHA-1 proof-of-work

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite 5
- **Styling**: Custom CSS with grid-line circuit aesthetic
- **OP_NET**: Live JSON-RPC (regtest/testnet/mainnet): block height, epoch, balance, contract code & storage, gas parameters
- **APIs**: CoinGecko (BTC price), optional Blockchain.info fallback
- **Wallet**: OPWallet browser extension; real chain balance in Portfolio
- **AI**: Bob MCP server ([ai.opnet.org](https://ai.opnet.org)) — **19 tools** integrated (knowledge, audit, CLI, contracts, RPC, monitor, skills)
- **Backend**: Node.js Express API on VPS — Bob proxy (CORS bypass), player sync, leaderboard, $MINE claims
- **Token**: $MINE (OP-20) — 21M supply, 10.5M game pool, weekly halving, consensus-verified on Bitcoin L1

## Getting Started

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/opnet-hub.git
cd opnet-hub

# Install
npm install

# Run
npm run dev
```

Open http://localhost:3000

### Connect Bob (AI Dev Agent)

Bob is OP_NET's MCP server. Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "opnet-bob": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://ai.opnet.org/mcp"]
    }
  }
}
```

No API key needed. Restart your editor.

## Backend API (VPS)

The backend runs on a VPS at `188.137.250.160` and provides:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Server status + $MINE pool stats |
| `/api/token` | GET | $MINE token info (supply, emission, pool) |
| `/api/leaderboard` | GET | Top miners ranked by $MINE balance |
| `/api/player/sync` | POST | Sync game state from frontend |
| `/api/claim` | POST | Claim accumulated $MINE tokens |
| `/api/bob` | POST | Bob MCP proxy (CORS bypass for production) |
| `/api/rpc` | POST | OP_NET RPC proxy |

### Deploy Backend

```bash
# SSH into VPS, then:
curl -sL https://raw.githubusercontent.com/YourOpHub/opnet-hub/master/server/setup-vps.sh | bash
```

### Deploy Frontend

```bash
npm run build    # base set to /opnet-hub/ for GitHub Pages
npx gh-pages -d dist
```

## Project Structure

```
src/
├── App.tsx              # Main app, 9 tabs + OP_WALLET connect + Quest FAB
├── index.css            # Premium design system (glassmorphism, animations)
├── main.tsx             # Entry point
├── opnet.ts             # OP_NET JSON-RPC wrapper (mainnet/testnet/regtest)
├── bob-mcp.ts           # Bob MCP client — 19 tools, VPS proxy + direct fallback
├── api.ts               # VPS API client (sync, leaderboard, claims)
└── components/
    ├── Landing.tsx       # Hero + pillars + ticker + Vibecode CTA
    ├── Dashboard.tsx     # Live metrics: price, epoch progress, gas, OPScan
    ├── BobChat.tsx       # AI copilot — smart routing to 10+ Bob tools
    ├── TokenLauncher.tsx # OP-20 config + deploy steps from template
    ├── Portfolio.tsx     # Live wallet balance + OP-20 + $MINE holdings
    ├── TokenTools.tsx    # Converter + token explorer + gas & mempool
    ├── SatoshiMiner.tsx  # Epoch miner + $MINE token + VPS leaderboard
    ├── SwapUI.tsx        # Motoswap DEX + Bob contract addresses
    ├── Quests.tsx        # Tiered onboarding via FAB button
    ├── NewsFeed.tsx      # OP_NET/Bitcoin curated news
    └── EcosystemDir.tsx  # 26+ dApps on OP_NET consensus layer
server/
├── index.js             # Express API: Bob proxy, player sync, claims, leaderboard
├── setup-vps.sh         # One-command VPS deployment script
├── deploy-token.js      # $MINE token deployment + chain verification
├── nginx.conf           # Nginx reverse proxy config
└── .env.example         # Environment variables template
```

## Built With

- [OP_NET](https://docs.opnet.org) – First consensus layer on Bitcoin
- [Bob AI](https://ai.opnet.org) – AI dev agent for OP_NET
- [vibecode.finance](https://vibecode.finance) – OP_NET build challenge

## License

MIT

---

⚡ Built for the [OP_NET Vibecoding Challenge](https://vibecode.finance/challenge) | #opnetvibecode
