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
| 🤖 **Bob AI** | AI copilot with 21 knowledge topics about OP_NET consensus layer, epochs, ML-DSA, gas, tokens |
| 🚀 **Token Launcher** | Configure your OP-20 (name, symbol, supply), then follow real deploy steps: build from [OP_20](https://github.com/btc-vision/OP_20) template and deploy via OP_WALLET |
| 💼 **Portfolio** | **Live BTC balance** from OP_NET RPC when wallet is connected; sample OP-20 rows |
| 🛠️ **Tools** | **Live RPC**: BTC/Sats/USD converter, OP-20 token explorer (name/symbol/supply from chain), wallet inspector (balance), gas & mempool from OP_NET |
| ⛏️ **Epoch Miner** | Idle clicker game teaching OP_NET concepts (WASM Compiler, ML-DSA Signer, Merkle Trees, epochs) |
| 🎯 **Quests** | Tiered onboarding (Beginner → Explorer → Builder) — 8 tasks, XP, level progression, accessible via the ⚡ FAB button |
| 📰 **News** | Curated OP_NET and Bitcoin news feed with filtering |
| 🔗 **Ecosystem** | Directory of 26+ apps built on OP_NET's consensus layer |
| 📊 **Dashboard** | Live BTC price, epoch progress bar, gas fee, OPScan link, auto-refresh every 30s |

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
- **AI**: Bob MCP server ([ai.opnet.org](https://ai.opnet.org)) — 28+ tools, zero config

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

## Deploy (VPS + Cloudflare)

Build: `npm run build` → output in `dist/`. See **[DEPLOY.md](./DEPLOY.md)** for Nginx config, uploading to a VPS, and putting Cloudflare in front (optional). You can use an IP first; add a domain later and point it to the same server.

## Project Structure

```
src/
├── App.tsx              # Main app, 9 tabs + OP_WALLET connect + Quest FAB
├── index.css            # Premium design system (glassmorphism, animations)
├── main.tsx             # Entry point
├── opnet.ts             # OP_NET JSON-RPC wrapper (mainnet/testnet/regtest)
└── components/
    ├── Landing.tsx       # Hero + pillars + ticker + Vibecode CTA
    ├── Dashboard.tsx     # Live metrics: price, epoch progress, gas, OPScan
    ├── BobChat.tsx       # AI copilot linked to ai.opnet.org MCP server
    ├── TokenLauncher.tsx # OP-20 config + deploy steps from template
    ├── Portfolio.tsx     # Live wallet balance + OP-20 holdings
    ├── TokenTools.tsx    # Converter + token explorer + gas & mempool
    ├── SatoshiMiner.tsx  # Epoch miner game — 12 upgrades, 6 stages
    ├── Quests.tsx        # Tiered onboarding: Beginner / Explorer / Builder
    ├── NewsFeed.tsx      # OP_NET/Bitcoin curated news
    └── EcosystemDir.tsx  # 26+ dApps on OP_NET consensus layer
```

## Built With

- [OP_NET](https://docs.opnet.org) – First consensus layer on Bitcoin
- [Bob AI](https://ai.opnet.org) – AI dev agent for OP_NET
- [vibecode.finance](https://vibecode.finance) – OP_NET build challenge

## License

MIT

---

⚡ Built for the [OP_NET Vibecoding Challenge](https://vibecode.finance/challenge) | #opnetvibecode
