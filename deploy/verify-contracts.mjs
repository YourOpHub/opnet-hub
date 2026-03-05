/**
 * Verify all deployed contracts work correctly
 * Usage: node deploy/verify-contracts.mjs
 */
const RPC = 'https://testnet.opnet.org/api/v1/json-rpc';

async function rpc(method, params = []) {
    const r = await fetch(RPC, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
        signal: AbortSignal.timeout(15000),
    });
    const d = await r.json();
    if (d.error) return { error: d.error.message };
    return d.result;
}

/** Decode base64 result to hex string */
function b64toHex(b64) {
    return Buffer.from(b64, 'base64').toString('hex');
}

async function callContract(to, calldata) {
    // Positional params: [to, calldata] — object format causes "[object Object]" error
    const r = await rpc('btc_call', [`0x${to}`, calldata]);
    if (r.error) return r;
    if (r.revert) {
        const msg = Buffer.from(r.revert, 'base64').subarray(8).toString('utf-8');
        return { error: `REVERT: ${msg}` };
    }
    // Convert base64 result to hex for parsers
    return { result: b64toHex(r.result) };
}

const CONTRACTS = {
    'MINE Token': {
        hex: 'db2b3427af74557818643536cbb299fb105ac7327c930751ab50d673c1cf0f9d',
        tests: [
            { name: 'balanceOf(deployer)', calldata: '5b46f8f64ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea', parse: hex => {
                return `${Number(BigInt('0x' + hex.substring(0, 64)))/1e8} MINE`;
            }},
        ],
    },
    'VIBE Token': {
        hex: '1aac600a01af5af5210f7d90d9d33ec281ddab4c86394de3cdead6743bced818',
        tests: [
            { name: 'balanceOf(deployer)', calldata: '5b46f8f64ca79348ed8d21c5d4bbacdde9fe4eb7b0b0b2ed495fa81e545d5fbc7b554aea', parse: hex => {
                return `${Number(BigInt('0x' + hex.substring(0, 64)))/1e8} VIBE`;
            }},
        ],
    },
    'SimplePool v4': {
        hex: 'cc89d6c4764ed98b097860c5d8bc6b5432ece5ef11aa3eb7d9b8d65de5262bdc',
        tests: [
            { name: 'getReserves', calldata: '06374bfc', parse: hex => {
                const a = BigInt('0x' + hex.substring(0, 64));
                const b = BigInt('0x' + hex.substring(64, 128));
                return `MINE=${Number(a)/1e8}, VIBE=${Number(b)/1e8}`;
            }},
        ],
    },
    'SimpleStaking v3': {
        hex: '6b92dfca57e7415b6e89868ee1e2c51dcda8f8b4bf9a28b19900e1bfba2121ae',
        tests: [
            { name: 'totalStaked', calldata: 'bacead82', parse: hex => {
                return `staked=${Number(BigInt('0x' + hex.substring(0, 64)))/1e8}`;
            }},
            { name: 'getRewardRate', calldata: '5bb1159d', parse: hex => {
                return `rate=${Number(BigInt('0x' + hex.substring(0, 64)))/1e8} per block`;
            }},
        ],
    },
    'P2PMarket v9': {
        hex: 'd44b7c6a2f1cc47452d81c4184a48acb6cc880549724088d786cbf57a257e595',
        tests: [
            { name: 'getNextOrderId', calldata: 'f4920cae', parse: hex => {
                return `nextOrderId=${Number(BigInt('0x' + hex.substring(0, 64)))}`;
            }},
        ],
    },
    'CrossChainMarket v4': {
        hex: '1f3f8a86d1dd595d8533697c2bff18b1ee30ffb1339499c176a7e0447fd38820',
        tests: [
            { name: 'getNextOrderId', calldata: 'f4920cae', parse: hex => {
                return `nextOrderId=${Number(BigInt('0x' + hex.substring(0, 64)))}`;
            }},
            { name: 'getFeeInfo', calldata: 'f22d798d', parse: hex => {
                const recipient = hex.substring(0, 64);
                const bps = Number(BigInt('0x' + hex.substring(64, 128)));
                return `feeRecipient=0x${recipient.replace(/^0+/, '')}, feeBps=${bps}`;
            }},
        ],
    },
    'NativeSwap v5': {
        hex: '51649d55996afffaad032f897dcd7ad17d6ead208b53a8eee29237494029f900',
        tests: [
            { name: 'getReserves', calldata: '06374bfc', parse: hex => {
                const a = BigInt('0x' + hex.substring(0, 64));
                const b = BigInt('0x' + hex.substring(64, 128));
                return `BTC=${Number(a)} sats, MINE=${Number(b)/1e8}`;
            }},
        ],
    },
};

async function main() {
    const block = await rpc('btc_blockNumber');
    console.log(`Current block: ${parseInt(block, 16)} (${block})\n`);

    let pass = 0, fail = 0;
    for (const [name, config] of Object.entries(CONTRACTS)) {
        // Check code exists (needs 0x prefix)
        const code = await rpc('btc_getCode', [`0x${config.hex}`, true]);
        if (code.error) {
            console.log(`  [FAIL] ${name}: CODE NOT FOUND`);
            fail++;
            continue;
        }
        const codeLen = code.bytecode?.length ? Math.round(code.bytecode.length * 3/4) : '?';

        const results = [];
        for (const test of config.tests) {
            const result = await callContract(config.hex, test.calldata);
            if (result.error) {
                results.push(`${test.name}=ERROR(${result.error})`);
            } else {
                results.push(`${test.name}=${test.parse(result.result)}`);
            }
        }
        console.log(`  [OK] ${name} (${codeLen}B): ${results.join(', ')}`);
        pass++;
    }
    console.log(`\n${pass}/${pass+fail} contracts verified`);
}

main().catch(e => console.error('Fatal:', e.message));
