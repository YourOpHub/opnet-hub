# OPNet Hub Security Audit

**Date**: 2026-03-03
**Scope**: 5 smart contracts deployed on OPNet Testnet (Signet fork)
**Methodology**: AI-assisted audit using OPNet Security Guidelines + manual code review
**Auditor**: Claude (AI) + Bob MCP

> **DISCLAIMER**: This audit is AI-assisted and may contain errors, false positives, or miss critical vulnerabilities. This is NOT a substitute for a professional security audit. Do NOT deploy to mainnet based solely on this review.

---

## Contracts Audited

| # | Contract | Address | Type | Lines |
|---|----------|---------|------|-------|
| 1 | MineToken | `opt1sqry48kzm2glqu7heyyygw5lwnlvadpqxdujpntpa` | OP-20 Token | 75 |
| 2 | VibeToken | `opt1sqrctjfhdku23shnqje26f4n5gne45zylwvm9f802` | OP-20 Token | 75 |
| 3 | SimplePool | `opt1sqqslqmts6wcchuh55f7hf6hurux2d4363cthz9p0` | AMM Pool | 304 |
| 4 | SimpleStaking | `opt1sqpxk2hqaux0upqyz7wz3egnv8rfjrusj058388t8` | Staking | 248 |
| 5 | P2PMarket | `opt1sqqd334lec0t5kg8enjn5kpusgw7v9cc6qg7zqmsn` | P2P Orderbook | 458 |

---

## Executive Summary

All 5 contracts follow OPNet best practices: SafeMath for arithmetic, ReentrancyGuard on contracts with external calls, CEI (Checks-Effects-Interactions) pattern, and deployer-only access control on admin functions.

**Overall Risk: LOW** (for testnet deployment)

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 2 |
| Low | 3 |
| Informational | 4 |

---

## Findings

### M-1: Staking reward fund not guaranteed (SimpleStaking)

**Severity**: Medium
**Location**: `SimpleStaking.ts:claim()` (line 124-139)

**Description**: The staking contract distributes rewards by calling `_transfer()` on the token contract, but there is no mechanism to ensure the staking contract holds sufficient tokens for reward distribution. If reward emissions exceed the contract's token balance, `claim()` will revert.

**Recommendation**: Add a `fundRewards(amount)` method or check available balance before reward calculation. Document that deployer must manually fund the staking contract.

**Status**: Acknowledged — deployer uses `fund-staking.mjs` script to fund rewards.

---

### M-2: SimplePool LP tracking is per-deposit, not proportional (SimplePool)

**Severity**: Medium
**Location**: `SimplePool.ts:addLiquidity()` (lines 95-122)

**Description**: LP positions track the exact amounts deposited per-user (`_userLpA`, `_userLpB`), not proportional shares. This means:
- If fees accrue (via swaps), they benefit the pool but LP providers cannot withdraw more than they deposited
- The pool accumulates fees internally but has no mechanism to distribute them to LPs

**Recommendation**: This is acceptable for a testnet demo. For production, implement LP token minting proportional to `sqrt(amountA * amountB)` following Uniswap V2 pattern.

---

### L-1: airdrop() does not check maxSupply (MineToken, VibeToken)

**Severity**: Low
**Location**: `MineToken.ts:airdrop()` (lines 54-73)

**Description**: The `airdrop()` function mints tokens via `balanceOfMap.set()` and increments `_totalSupply`, but does not check if the new total exceeds `maximumSupply`. However, this is deployer-only and the standard OP-20 `_mint()` internal method does check supply caps.

**Recommendation**: Use `_mint()` in the loop instead of direct balance manipulation, or add a supply cap check.

---

### L-2: No event emission on key operations (SimplePool, SimpleStaking, P2PMarket)

**Severity**: Low
**Location**: All custom contracts

**Description**: None of the custom contracts emit events for key operations (swap, stake, unstake, claim, createOrder, fillOrder, cancelOrder). This makes off-chain indexing and monitoring difficult.

**Recommendation**: Add `@emit` decorators and create event classes for all state-changing operations.

---

### L-3: cancelOrder returns tokens to sender, not creator for sell orders (P2PMarket)

**Severity**: Low
**Location**: `P2PMarket.ts:cancelOrder()` (line 349)

**Description**: For sell order cancellation, tokens are transferred to `sender` (line 349), but the validation only checks that `sender == creator`. This is correct but brittle — if the access control check is ever relaxed, tokens could go to the wrong address.

**Recommendation**: Explicitly use `this._u256ToAddress(creatorU256)` instead of `sender` for sell order refunds.

---

### I-1: All supply minted to deployer on deployment (MineToken, VibeToken)

**Severity**: Informational

**Description**: Both tokens mint 100% of supply to the deployer address on deployment. This creates centralization risk but is standard for testnet tokens. For production, consider vesting schedules or community distribution.

---

### I-2: Hardcoded 0.3% swap fee (SimplePool)

**Severity**: Informational
**Location**: `SimplePool.ts:swap()` (lines 213-214)

**Description**: Swap fee is hardcoded at 0.3% (997/1000). There is no governance mechanism to adjust fees.

---

### I-3: No pagination for order queries (P2PMarket)

**Severity**: Informational

**Description**: `getOrder()` only returns one order at a time. There is no `getOrders(startId, count)` batch method, requiring N RPC calls to fetch N orders.

---

### I-4: Staking uses block number for time, not epochs (SimpleStaking)

**Severity**: Informational

**Description**: Reward calculation uses `Blockchain.block.number`. This is correct per OPNet guidelines (block numbers are preferred over timestamps), but reward rate perception depends on block time consistency.

---

## Checklist Results

### Smart Contract Security

| Check | MINE | VIBE | Pool | Staking | Market |
|-------|------|------|------|---------|--------|
| SafeMath for all u256 ops | PASS | PASS | PASS | PASS | PASS |
| No while loops | PASS | PASS | PASS | PASS | PASS |
| For loops bounded | PASS | PASS | N/A | N/A | N/A |
| CEI pattern | N/A | N/A | PASS | PASS | PASS |
| ReentrancyGuard | N/A | N/A | PASS | PASS | PASS |
| Access control | PASS | PASS | PASS | PASS | PASS |
| No tx.origin auth | PASS | PASS | PASS | PASS | PASS |
| No floating point | PASS | PASS | PASS | PASS | PASS |
| No Buffer usage | PASS | PASS | PASS | PASS | PASS |
| Uses Blockchain.block.number | N/A | N/A | N/A | PASS | N/A |
| Unique storage pointers | PASS | PASS | PASS | PASS | PASS |
| No map key iteration | PASS | PASS | PASS | PASS | PASS |

### OPNet-Specific

| Check | Status |
|-------|--------|
| @method/@returns not imported | PASS |
| ABIDataTypes globally injected | PASS |
| Correct OP-20 selectors (sha256) | PASS |
| No approve() usage | PASS |
| Constructor contains only super() | PASS |
| Logic in onDeployment() | PASS |

---

## Frontend Security Notes

- `networks.opnetTestnet` correctly used (fixed from `networks.testnet`)
- No private keys in frontend code
- Wallet signing delegated to OPWallet extension
- `signer=null, mldsaSigner=null` in `sendTransaction()` (correct for frontend)
- All token amounts use `bigint` (not `number`)
- Provider is singleton via `contractCache.ts`

---

## Recommendations Summary

1. **Before mainnet**: Get a professional human audit
2. **Add events** to all custom contracts for indexing
3. **Fund staking rewards** contract before enabling staking UI
4. **Implement LP tokens** for fair fee distribution in pool
5. **Add batch order query** to P2PMarket for better UX
6. **Use `_mint()` in airdrop** to enforce supply caps
