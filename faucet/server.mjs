/**
 * OPNet Testnet Token Faucet
 * 
 * Runs on VPS, transfers MINE/VIBE tokens to requesters via deployer wallet.
 * 
 * ENV vars required:
 *   OPNET_MNEMONIC  — deployer wallet mnemonic (12 words)
 *   PORT            — server port (default 3456)
 * 
 * Endpoints:
 *   GET  /health              — health check
 *   GET  /info                — token info + limits
 *   POST /claim               — claim tokens { token: "MINE"|"VIBE", address: "opt1..." }
 */
import express from 'express';
import cors from 'cors';
import {
    Mnemonic, TransactionFactory, ChallengeSolution,
    OPNetLimitedProvider, BinaryWriter, Address,
} from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';

/** Decode opt1 bech32m address to 32-byte witness program */
function decodeOpt1Program(address) {
    const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    const sepIdx = address.lastIndexOf('1');
    if (sepIdx < 1) throw new Error('Invalid bech32m address');
    const data = address.slice(sepIdx + 1);
    // Decode chars to 5-bit values (skip last 6 = checksum)
    const values = [];
    for (let i = 0; i < data.length - 6; i++) {
        const v = CHARSET.indexOf(data[i]);
        if (v === -1) throw new Error('Invalid bech32m character: ' + data[i]);
        values.push(v);
    }
    // Skip first value (witness version), convert rest from 5-bit to 8-bit
    const words = values.slice(1);
    const bytes = [];
    let acc = 0, bits = 0;
    for (const w of words) {
        acc = (acc << 5) | w;
        bits += 5;
        while (bits >= 8) {
            bits -= 8;
            bytes.push((acc >> bits) & 0xff);
        }
    }
    return Buffer.from(bytes);
}

const PORT = parseInt(process.env.PORT || '3456');
const RPC_URL = 'https://testnet.opnet.org';
const network = { ...networks.testnet, bech32: networks.testnet.bech32Opnet };

// ── Deployer wallet ───────────────────────────────────────────────────────────
const phrase = process.env.OPNET_MNEMONIC;
if (!phrase) { console.error('❌ Set OPNET_MNEMONIC env var'); process.exit(1); }
const mnemonic = new Mnemonic(phrase, '', network);
const wallet = mnemonic.deriveOPWallet(undefined, 0);
console.log('✅ Faucet wallet:', wallet.p2tr);

const provider = new OPNetLimitedProvider(RPC_URL);
const factory = new TransactionFactory();

// ── Token config (update addresses after redeployment) ────────────────────────
// These will be loaded from env or config file
const TOKENS = {
    MINE: {
        address: process.env.MINE_ADDRESS || 'opt1sqrwvpmkj7syt6c4g2c5x46g2k7dpypl7accseewa',
        decimals: 8,
        claimAmount: 100_000,      // 100K MINE per claim
        symbol: 'MINE',
    },
    VIBE: {
        address: process.env.VIBE_ADDRESS || 'opt1sqzc940wqqhjrvxj8zw04xuqps992aknmpq5ts8fl',
        decimals: 8,
        claimAmount: 500_000,      // 500K VIBE per claim
        symbol: 'VIBE',
    },
};

// ── Rate limiting (per IP, per token) ─────────────────────────────────────────
const COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between claims
const claimHistory = new Map(); // key: `${ip}:${token}` => timestamp

function canClaim(ip, token) {
    const key = `${ip}:${token}`;
    const last = claimHistory.get(key);
    if (!last) return { ok: true };
    const elapsed = Date.now() - last;
    if (elapsed < COOLDOWN_MS) {
        const waitSec = Math.ceil((COOLDOWN_MS - elapsed) / 1000);
        return { ok: false, waitSec };
    }
    return { ok: true };
}

function recordClaim(ip, token) {
    claimHistory.set(`${ip}:${token}`, Date.now());
}

// ── OPNet helpers ─────────────────────────────────────────────────────────────
const TRANSFER_SELECTOR = 0x3b88ef57;

async function getChallenge() {
    const res = await fetch(`${RPC_URL}/api/v1/json-rpc`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'btc_latestEpoch', params: [], id: 1 }),
        signal: AbortSignal.timeout(12000),
    });
    const { result: e } = await res.json();
    return new ChallengeSolution({
        epochNumber: e.epochNumber,
        mldsaPublicKey: e.proposer.mldsaPublicKey,
        legacyPublicKey: e.proposer.legacyPublicKey,
        solution: e.proposer.solution,
        salt: e.proposer.salt,
        graffiti: e.proposer.graffiti,
        difficulty: Number(e.difficultyScaled),
        verification: {
            epochHash: e.epochHash, epochRoot: e.epochRoot,
            targetHash: e.targetHash, targetChecksum: e.targetHash,
            startBlock: e.startBlock, endBlock: e.endBlock,
            proofs: e.proofs,
        },
    });
}

// Transfer lock to prevent concurrent transfers
let transferLock = false;

async function transferTokens(tokenKey, recipientAddress) {
    if (transferLock) throw new Error('Server busy, try again in a few seconds');
    transferLock = true;

    try {
        const tok = TOKENS[tokenKey];
        const rawAmount = BigInt(tok.claimAmount) * (10n ** BigInt(tok.decimals));

        // Decode opt1 bech32m address to 32-byte witness program for transfer calldata
        const recipientBytes = decodeOpt1Program(recipientAddress);
        const recipientAddr = new Uint8Array(recipientBytes);

        const challenge = await getChallenge();
        const utxos = await provider.fetchUTXO({
            address: wallet.p2tr,
            minAmount: 10000n,
            requestedAmount: 200000n,
        });

        if (!utxos || utxos.length === 0) {
            throw new Error('Faucet wallet has no UTXOs. Please fund it.');
        }

        // Build transfer calldata
        const writer = new BinaryWriter();
        writer.writeSelector(TRANSFER_SELECTOR);
        writer.writeAddress(recipientAddr);
        writer.writeU256(rawAmount);

        const result = await factory.signInteraction({
            signer: wallet.keypair,
            mldsaSigner: wallet.mldsaKeypair,
            network,
            utxos,
            from: wallet.p2tr,
            to: tok.address,
            contract: tok.address,
            calldata: writer.getBuffer(),
            feeRate: 2,
            priorityFee: 1000n,
            gasSatFee: 50_000n,
            challenge,
            linkMLDSAPublicKeyToAddress: true,
            revealMLDSAPublicKey: true,
        });

        // Broadcast
        const b1 = await provider.broadcastTransaction(result.transaction[0], false);
        console.log(`[${tokenKey}] Funding TX:`, JSON.stringify(b1));
        await new Promise(r => setTimeout(r, 2000));
        const b2 = await provider.broadcastTransaction(result.transaction[1], false);
        console.log(`[${tokenKey}] Transfer TX:`, JSON.stringify(b2));

        return {
            token: tokenKey,
            amount: tok.claimAmount,
            recipient: recipientAddress,
            txResult: b2,
        };
    } finally {
        transferLock = false;
    }
}

// ── Express server ────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
    res.json({ status: 'ok', wallet: wallet.p2tr, uptime: process.uptime() });
});

app.get('/info', (_req, res) => {
    res.json({
        tokens: Object.fromEntries(
            Object.entries(TOKENS).map(([k, v]) => [k, {
                symbol: v.symbol,
                address: v.address,
                claimAmount: v.claimAmount,
                cooldownMinutes: COOLDOWN_MS / 60000,
            }])
        ),
        wallet: wallet.p2tr,
    });
});

app.post('/claim', async (req, res) => {
    try {
        const { token, address } = req.body || {};

        // Validate token
        if (!token || !TOKENS[token.toUpperCase()]) {
            return res.status(400).json({ error: `Invalid token. Use: ${Object.keys(TOKENS).join(', ')}` });
        }
        const tokenKey = token.toUpperCase();

        // Validate address
        if (!address || typeof address !== 'string' || !address.startsWith('opt1')) {
            return res.status(400).json({ error: 'Invalid address. Must be an opt1... address.' });
        }

        // Rate limit
        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
        const rateCheck = canClaim(ip, tokenKey);
        if (!rateCheck.ok) {
            return res.status(429).json({
                error: `Rate limited. Wait ${rateCheck.waitSec}s before claiming ${tokenKey} again.`,
                waitSec: rateCheck.waitSec,
            });
        }

        console.log(`[Claim] ${tokenKey} → ${address} (from ${ip})`);

        const result = await transferTokens(tokenKey, address);
        recordClaim(ip, tokenKey);

        res.json({
            success: true,
            token: tokenKey,
            amount: TOKENS[tokenKey].claimAmount,
            recipient: address,
            message: `Sent ${TOKENS[tokenKey].claimAmount.toLocaleString()} ${tokenKey} to ${address}`,
        });
    } catch (e) {
        console.error('[Claim error]', e.message);
        res.status(500).json({ error: e.message || 'Transfer failed' });
    }
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 OPNet Faucet running on port ${PORT}`);
    console.log(`   Tokens: ${Object.keys(TOKENS).join(', ')}`);
    console.log(`   Health: http://0.0.0.0:${PORT}/health`);
});
