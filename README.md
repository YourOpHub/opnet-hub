# OPNet Hub — Mission Control for Programmable Bitcoin

The most comprehensive DeFi platform on OP_NET consensus layer — Bitcoin L1 smart contracts with real BTC escrow, AMM pools, staking, and cross-chain bridges.

**Live:** [opnethub.xyz](https://opnethub.xyz) | **Network:** OPNet Testnet (Signet)

![Bitcoin L1](https://img.shields.io/badge/Bitcoin-L1-F7931A?style=flat&logo=bitcoin&logoColor=white)
![OP_NET](https://img.shields.io/badge/OP__NET-Consensus_Layer-0ea5e9?style=flat)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?style=flat&logo=react&logoColor=white)
![Contracts](https://img.shields.io/badge/Contracts-7_deployed-green?style=flat)

> Built for [#opnetvibecode](https://vibecode.finance/challenge) Vibecoding Challenge

---

## DeFi Suite — 5 Smart Contracts

| Contract | Version | Description | Key Features |
|----------|---------|-------------|-------------|
| **SimplePool** | v4 | MINE/VIBE AMM | Uniswap V2 LP shares, k-invariant, 0.3% fee, MINIMUM_LIQUIDITY lock |
| **NativeSwap** | v5 | BTC/Token AMM | 2-phase reservation model, effective reserves, dust check, slippage protection |
| **SimpleStaking** | v3 | Stake MINE | Synthetix accumulator, reward end block, pool cap, deployer-only rate control |
| **P2PMarket** | v9 | OTC Orderbook | Sell + buy orders, partial fills, trustless BTC verification, acceptance timeout |
| **FractalSwap** | v7 | BTC/Fractal Bridge | Real BTC escrow both directions, relayer auto-complete, 72-block min expiry |

### Token System — 2 Custom Tokens

| Token | Supply | Contract | Utility |
|-------|--------|----------|---------|
| **MINE** | 21,000,000 | MintableToken | Game rewards, staking, DEX trading, public mint 1M/tx |
| **VIBE** | 100,000,000 | MintableToken | Ecosystem token, LP pair, launchpad, public mint 5M/tx |

---

## Frontend — 14 Interactive Pages

**Stack:** React 19 + TypeScript 5 + Vite 5 + WalletConnect

| Group | Pages |
|-------|-------|
| **DeFi** | Swap (AMM), Stake (MINE rewards), Market (P2P OTC), Cross-Chain (BTC/Fractal bridge) |
| **Tokens** | Launchpad (bonding curve), Token Tools (mint/transfer/airdrop), MultiSender (batch) |
| **Explore** | Analytics (DEX stats), Ecosystem Directory, News Feed (on-chain activity) |
| **Play** | Satoshi Miner (clicker game earning real MINE), Bob AI Chat (OPNet assistant) |

**Key patterns:** Contract instance caching, multi-step TX state machine, localStorage persistence, BTC price feed, error boundaries, mobile responsive navigation.

---

## Backend — 4 Services

**Stack:** Node.js + Express + SQLite (WAL mode) + systemd

| Service | Port | Purpose |
|---------|------|---------|
| **API Server** | 4000 | Bob MCP proxy, RPC relay, game state sync, leaderboard, MINE claims |
| **Token Indexer** | — | Auto-discovers OP-20 tokens by scanning blocks, balance cache (60s TTL) |
| **FractalSwap Relayer** | — | Monitors Fractal BTC payments, calls relayerComplete() on-chain |
| **Launchpad** | 3457 | Token registry, comments, likes, marketplace orders |

---

## Security

All 7 contracts implement:

- **ReentrancyGuard** base class
- **CEI pattern** (Checks-Effects-Interactions)
- **SafeMath** on all u256 arithmetic
- **Output bitmap** — prevents BTC output double-counting
- **k-invariant verification** after every swap
- **Dual BTC verification** — scriptPubKey + decoded address matching
- **Owner access control** on all admin functions
- **`Blockchain.call(token, writer, true)`** — auto-revert on cross-contract failures

### 20+ Documented Audit Fixes

NativeSwap: C-01 bitmap, C-02 effective reserves, C-03 reservation limits, H-03 sell verification, H-04 slippage, L-01 dust, L-02 min fee, M-05 k-invariant | P2PMarket: H-01 bitmap, M-02 acceptance timeout | Staking: M-01 reward pool cap | MintableToken: M-04 airdrop maxSupply pre-check | FractalSwap: output bitmap, expiry validation, fee cap 10%

---

## Testing

**93 deploy/test scripts** with full E2E coverage:

- **BTC_TO_FB full cycle**: create (lock BTC) -> take (pay fee) -> complete (taker claims BTC) = SUCCESS
- **FB_TO_BTC full cycle**: create (intent) -> take (lock BTC + fee) -> complete (maker claims BTC) = SUCCESS
- Both directions verified on-chain (testnet blocks 4093-4098)
- Multi-wallet testing (Wallet A + B from same mnemonic)
- Contract verification scripts for all 7 contracts

---

## Deployed Contracts (OPNet Testnet)

| Contract | Address |
|----------|---------|
| MINE Token | `opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa` |
| VIBE Token | `opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl` |
| SimplePool v4 | `opt1sqplvfq5ytgtwzes6tc4ys77f90279rsz8q4dg7ex` |
| SimpleStaking v3 | `opt1sqzfsz6csap8jpv8ueac5n2u0vx2a85epuyk9ez5c` |
| P2PMarket v9 | `opt1sqq3l4ku6vf4xeyr0603mehwvf9rp2ja39ghx02qt` |
| NativeSwap v5 | `opt1sqp3uxpgy9yjrhpvjukhpqhmsqr4qe7hahgup8cuj` |
| FractalSwap v7 | `opt1sqphsge6t2hq833cdylnuqzzw070nq0866seampsu` |

**Deployer:** `opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my`

---

## Quick Start

```bash
# Frontend
npm install
npm run dev              # http://localhost:3000

# Backend
cd server && npm install && npm start   # port 4000

# Build & Deploy
npm run build
npx wrangler pages deploy dist --project-name=opnet-hub --commit-dirty=true
```

---

## Project Stats

- **191 commits** on dev branch
- **56 frontend source files** (~26K LOC TypeScript/TSX)
- **48 contract source files** (~3.5K LOC AssemblyScript)
- **93 deployment/test scripts**
- **7 deployed smart contracts** on testnet
- **4 backend services** on VPS
- **14 frontend pages** with grouped navigation

---

## Architecture

```
Frontend (React 19 + WalletConnect)
    |
    +-- Contract Cache (singleton instances)
    +-- TX Flow State Machine (multi-step, persistent)
    +-- Token Indexer API integration
    |
Backend (Express + SQLite)
    |
    +-- Game mechanics + leaderboard
    +-- Token Indexer (block scanning)
    +-- FractalSwap Relayer (auto-complete)
    +-- Bob MCP Proxy (AI assistant)
    |
Smart Contracts (AssemblyScript -> WASM -> OPNet)
    |
    +-- OP-20 Tokens (MintableToken)
    +-- SimplePool (Constant Product AMM)
    +-- NativeSwapPool (BTC/Token AMM)
    +-- SimpleStaking (Synthetix rewards)
    +-- P2PMarket (Verify-Don't-Custody)
    +-- CrossChainMarket (BTC escrow bridge)
```

---

Built with Claude Code for the OPNet Vibecoding Challenge | [vibecode.finance](https://vibecode.finance)
