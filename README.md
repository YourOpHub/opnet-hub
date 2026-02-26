# ⚡ OPNet Hub — Mission Control for Programmable Bitcoin

> The first dashboard for Bitcoin's consensus layer. Built for the [OP_NET Vibecoding Challenge](https://vibecode.finance).

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
| 🚀 **Token Launcher** | Deploy OP-20 fungible tokens on Bitcoin L1. Upload custom logo or auto-generate SVG |
| 💼 **Portfolio** | Track consensus-verified OP-20 holdings with live BTC prices |
| 🛠️ **Tools** | BTC/Sats/USD converter, OP-20 explorer, wallet inspector, gas estimator |
| ⛏️ **Epoch Miner** | Idle clicker game teaching OP_NET concepts (WASM Compiler, ML-DSA Signer, Merkle Trees, epochs) |
| 🎯 **Quests** | Guided onboarding — 8 tasks to learn OP_NET, XP system, levels |
| 📰 **News** | Curated OP_NET and Bitcoin news feed with filtering |
| 🔗 **Ecosystem** | Directory of 26+ apps built on OP_NET's consensus layer |

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
- **OP_NET SDK**: `opnet` npm package
- **APIs**: CoinGecko (prices), Blockchain.info (blocks)
- **Wallet**: OPWallet browser extension integration
- **AI**: Bob MCP server (ai.opnet.org)

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

## Project Structure

```
src/
├── App.tsx            # Main app with 9 tabs + wallet connect
├── index.css          # v7 "Mission Control" design system
├── main.tsx           # Entry point
└── components/
    ├── Landing.tsx     # Hero + 3 pillars + ticker + features
    ├── BobChat.tsx     # AI copilot (21 knowledge entries)
    ├── TokenLauncher.tsx  # OP-20 deployment + image upload
    ├── Portfolio.tsx   # Consensus-verified holdings
    ├── TokenTools.tsx  # Converter + explorer + inspector + gas
    ├── SatoshiMiner.tsx  # Epoch miner game (12 OP_NET upgrades)
    ├── Quests.tsx      # Onboarding quests + XP system
    ├── NewsFeed.tsx    # OP_NET/Bitcoin news
    └── EcosystemDir.tsx  # 26+ ecosystem apps
```

## Built With

- [OP_NET](https://docs.opnet.org) – First consensus layer on Bitcoin
- [Bob AI](https://ai.opnet.org) – AI dev agent for OP_NET
- [vibecode.finance](https://vibecode.finance) – OP_NET build challenge

## License

MIT

---

⚡ Built for the [OP_NET Vibecoding Challenge](https://vibecode.finance/challenge) | #opnetvibecode
