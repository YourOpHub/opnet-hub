# OPNet Hub — Roadmap & Future Direction

## Current State (v1.0)
- **9 tabs**: Home, Bob AI, Tools, Swap, Launcher, Tokens, Epoch Miner, News, Ecosystem
- **3 deployed contracts**: $MINE, $VIBE (MintableToken), SimplePool AMM
- **Live features**: on-chain swap, publicMint, token deployment, portfolio (via wallet dropdown), live block feed, gas metrics, pool rate display
- **Deployed**: https://yourophub.github.io/opnet-hub/

---

## Phase 2 — DeFi Expansion

### 2.1 Multi-Pool Support
- Deploy additional liquidity pools (e.g. MINE/BTC, VIBE/BTC)
- Pool discovery page — list all available pools with TVL, volume, APR
- Add liquidity UI — allow users to become LPs and earn fees

### 2.2 Staking Contract
- Deploy a staking contract using OPNet's STAKING_ABI
- Stake MINE or VIBE to earn rewards
- Staking dashboard showing APR, total staked, user position
- Uses: `stake()`, `unstake()`, `claim()`, `stakedAmount()`, `stakedReward()`

### 2.3 Token Analytics Dashboard
- Real-time charts for MINE/VIBE price (from pool reserves over time)
- Volume tracking per epoch
- Holder count and distribution
- Top holders leaderboard

---

## Phase 3 — NFT & Social

### 3.1 OP-721 NFT Gallery
- Mint and display NFTs on Bitcoin L1 via OPNet's OP-721 standard
- Reservation system for fair minting (OPNet-specific feature)
- NFT marketplace with on-chain listings

### 3.2 Community Features
- Token-gated chat/forum using OP-20 balances
- Governance proposals — vote with MINE/VIBE tokens
- Achievement badges as OP-721 NFTs

---

## Phase 4 — Advanced Features

### 4.1 Oracle Integration
- Self-contained oracle pattern (no external dependencies)
- BTC/USD price feed on-chain for DeFi calculations
- Used for automated liquidations, dynamic fees

### 4.2 Proof of Position (PoP) — When Available
OPNet is developing PoP — a virtual execution layer for sub-minute confirmations:
- Pure-state operations (OP-20 transfers) execute without individual BTC transactions
- Wesolowski VDF for deterministic slot timing
- Hash-derived leaderless transaction ordering
- Commit-reveal MEV protection
- **Impact on Hub**: instant token transfers, real-time swap confirmations, much higher throughput

### 4.3 Cross-Pool Routing
- Smart order routing across multiple pools
- Split trades for better execution
- Aggregator-style best-price discovery

---

## Phase 5 — Platform Growth

### 5.1 Plugin System
- Allow third-party developers to add custom tabs/widgets
- Plugin marketplace with OP-20 payment
- Bob AI integration for plugin development assistance

### 5.2 Mobile Optimization
- PWA (Progressive Web App) with offline support
- Mobile-optimized swap and mint flows
- Push notifications for transaction confirmations

### 5.3 Advanced Token Launcher
- Vesting schedules
- Multi-sig admin controls
- Automatic liquidity pool creation on deploy
- Presale/IDO mechanics

---

## Technical Debt & Improvements

| Item | Priority | Description |
|------|----------|-------------|
| Contract caching | Done | `contractCache.ts` created — use `getCachedOP20`/`getCachedMintable` |
| JSONRpcProvider config object | Low | Switch from positional args to `{ url, network }` config |
| AddressVerificator | Low | Use OPNet's validator instead of manual prefix checks |
| E2E tests | Medium | Playwright tests for swap, mint, portfolio flows |
| Error boundaries | Medium | React error boundaries per tab to prevent full-app crashes |
| i18n | Low | Russian/English language toggle |
| Dark/light theme | Low | CSS variable-based theme switching |

---

## Contest Submission Summary

**GitHub**: https://github.com/YourOpHub/opnet-hub
**Live**: https://yourophub.github.io/opnet-hub/

### Deployed Contracts (testnet)
| Contract | Address | TX |
|----------|---------|-----|
| $MINE | `opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa` | `25843e96...` |
| $VIBE | `opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802` | `bfbe3f54...` |
| MINE/VIBE Pool | `opt1sqqslqmts6wcchuh55f7hf6hurux2d4363cthz9p0` | `b2a8c306...` |

### Key Technical Highlights
- Real on-chain swap via SimplePool AMM (approve → swap)
- Real on-chain publicMint (not faucet)
- Token deployment with WASM upload
- opnet SDK: `getContract → simulate → sendTransaction`
- `signer: null, mldsaSigner: null` per OPNet security rules
- `BitcoinUtils.expandToDecimals` for all token amounts
- Live consensus data (blocks, epochs, gas, pool reserves)
- Code-split lazy loading per tab
- No secrets in repo, no raw PSBT, no UnisatSigner
