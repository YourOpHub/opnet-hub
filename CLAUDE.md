# OPNet Hub

Mission control for programmable Bitcoin. Built on OP_NET consensus layer.

## Quick Ref
- `npm run dev` / `npm run build` — dev/prod
- Deploy: `npm run build && npx wrangler pages deploy dist --project-name=opnet-hub --commit-dirty=true`
- VPS: `ssh -i ~/.ssh/server_key root@188.137.250.160` | API port 4001 | service: `opnet-hub-api`
- Bob MCP: ask `opnet_knowledge_search` before deep-diving docs

## Agent Model Guidelines
- Haiku: simple file searches, grep, status checks
- Sonnet: code analysis, medium tasks, script writing
- Opus (default): architecture, audits, complex debugging

## SDK Patterns (DON'T re-lookup)
- `JSONRpcProvider({ url, network })` — config object
- `getContract(addr, abi, provider, network, senderAddr)` — 5 params
- ABI: `type: BitcoinAbiTypes.Function` required
- Simulate: `const sim = await contract.method(args)` → `sim.sendTransaction(params)`
- Frontend TX: NO signer/mldsaSigner keys (absent, not null)
- Backend TX: `{ signer: wallet.keypair, mldsaSigner: wallet.mldsaKeypair, refundTo, network, feeRate: 10, priorityFee: 5000n, maximumAllowedSatToSpend: 50_000n }`
- `maximumAllowedSatToSpend` MUST be BigInt
- Response: `.properties` (named), NOT `.decoded`
- Cross-contract: `Blockchain.call(token, writer, true)` — auto-reverts, no readBoolean needed
- Selectors: sha256-based, NOT keccak256

## Addresses
- Wallet A: `opt1pp76wuync084guctnwl7z2rek978l4dzr9ppkuplq6q7ae2g7palsvtj5my`
- MINE: `opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa`
- VIBE: `opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl`
- Pool v6: `opt1sqz6acsz9tkyfzzlg337x35swysmtp4u8kye8u2pv`
- NativeSwap v5: `opt1sqp3uxpgy9yjrhpvjukhpqhmsqr4qe7hahgup8cuj`
- Market v10: `opt1sqzveth6qep7ajey4vwcuujw049ke4z7khs7097qn`

## Critical Rules
- NEVER `tb1` — always `opt1` for OPNet
- P2OP: `[0x60, 0x20, <32-byte-MLDSA-hash>]` = 34 bytes
- extraOutputs: `{ script: Buffer, value: bigint }` NOT `{ address, value }`
- `wallet._tweakedKey` for Address.fromString 2nd param (NOT keypair.publicKey)
- Epoch finalization: ~5 blocks before new contracts queryable
- `btc_call` `to` = opt1 address, `from` = MLDSA hex + tweaked hex
- Network: `{ ...networks.testnet, bech32: networks.testnet.bech32Opnet }`
