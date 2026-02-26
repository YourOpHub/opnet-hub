import React, { useState, useRef, useEffect, useCallback } from 'react';
import * as bobMcp from '../bob-mcp';

interface Msg { id: number; role: 'bot' | 'user'; text: string; source?: 'mcp' | 'local' }

const KB: Record<string, string> = {
    'opnet': '**OP_NET** is the first consensus layer on Bitcoin — not a metaprotocol, not a sidechain. It brings Turing-complete smart contracts to Bitcoin L1 with cryptographic proof of correct execution. Unlike BRC-20 (indexer hope), OP_NET provides mathematical certainty.',
    'consensus': '**Consensus Layer** means every OP_NET node processing the same Bitcoin blocks arrives at the exact same state. Only ONE honest node is needed. No new trust assumptions beyond Bitcoin itself.',
    'op-20': '**OP-20** is the fungible token standard (like ERC-20). Supports mint, burn, transfer, approve. Tokens exist in verifiable consensus state, not indexer databases.',
    'op_20': '**OP-20** is the fungible token standard (like ERC-20). Deploy yours in our **Token Launcher**!',
    'op-721': '**OP-721** is the NFT standard. Non-fungible tokens directly on Bitcoin L1 consensus.',
    'wasm': 'Smart contracts run in **OP_VM** — a WebAssembly virtual machine. Deterministic execution, gas-metered, supports AssemblyScript, Rust, and C++. Up to 400KB compressed bytecode.',
    'quantum': 'OP_NET requires **ML-DSA** (Module-Lattice Digital Signature Algorithm) for contract interactions — NIST-standardized post-quantum security on top of Bitcoin\'s ECDSA.',
    'epoch': '**Epochs** span 5 Bitcoin blocks (~50 min). At epoch end, a checksum root is computed. SHA-1 miners compete for rewards. State is attested 4 epochs deep (~21 blocks) making forks mathematically impossible.',
    'wallet': 'Use **OP_WALLET** browser extension from Chrome Web Store. Click **Connect** in the header. You sign with ML-DSA for all contract interactions. Get it: chromewebstore.google.com/detail/opwallet',
    'motoswap': '**Motoswap** — first AMM DEX on Bitcoin L1. Uniswap v2 style pools, all secured by OP_NET consensus. Trade at motoswap.org',
    'defi': 'Bitcoin DeFi via OP_NET: **Motoswap** (DEX), **BitLend** (lending), **SatoshiVault** (vault), **Epoch Vault** (time-locks). All consensus-verified on L1.',
    'vibecode': '**Vibecoding Challenge** at vibecode.finance — build Bitcoin L1 apps with Bob. Three themed weeks, real prizes (Motocats NFTs + $PILL tokens). Submit your GitHub repo + tweet with #opnetvibecode @opnetbtc!',
    'bob': 'I\'m **Bob** — the OPNet AI Instructor! The full version of me lives at **ai.opnet.org** as an MCP server. I have **28+ tools** including code scaffolding, security audits, web search, and image generation. Connect me to Cursor, Windsurf, or Claude Desktop — zero config needed!',
    'mcp': '**Bob MCP Server** — connect your AI IDE to ai.opnet.org for 28+ Bitcoin dev tools. Works with **Cursor**, **Windsurf**, and **Claude Desktop**. One command setup, no API keys. I give your AI superpowers for OP_NET development!',
    'hub': '**OPNet Hub** = Mission control for programmable Bitcoin. Dashboard, Portfolio, AI Chat, Tools, Token Launcher, Epoch Miner, News, Ecosystem — all powered by live OP_NET RPC.',
    'portfolio': '**Portfolio** tracks your consensus-verified OP-20 holdings — BTC, WBTC, MOTO. Values in USD/BTC. Connect OP_WALLET for live data.',
    'miner': '**Epoch Miner** — learn OP_NET through gameplay! 12 upgrades themed around OP_NET tech (WASM Compiler, ML-DSA Signer, Merkle Trees, Quantum Shield). 5-block epochs like the real protocol. 6 evolution stages!',
    'launch': '**Token Launcher** — deploy OP-20 tokens on Bitcoin L1. WASM bytecode → tapscript → Bitcoin tx → consensus-verified token. Upload your logo! Uses OP_NET\'s token template from GitHub.',
    'gas': '**Gas** on OP_NET: every WASM operation has a cost. Fees paid in BTC. Transactions ordered by gas price → priority → txid. Check real-time gas in our **Tools** section.',
    'p2op': '**P2OP addresses** use SegWit version 16 with custom HRP. They represent deployed smart contracts and are distinct from regular Bitcoin addresses.',
    'metaprotocol': 'Unlike **BRC-20/Runes/Alkanes** (which rely on indexers that can disagree), OP_NET has cryptographic consensus. Different indexers CANNOT show different balances — the math forces agreement.',
    'opscan': '**OPScan** (opscan.org) — the block explorer for OP_NET. View transactions, contracts, tokens, and consensus state in real-time.',
    'optools': '**OPTools** (optools.org) — developer toolkit for OP_NET. Contract deployment, debugging, and testing utilities.',
    'motocats': '**Motocats** — Bitcoin Ordinals NFT collection. 60 Motocats are prizes in the Vibecoding Challenge! View on Magic Eden.',
    'pill': '**$PILL** (Orange Pill) — OP-20 token on Bitcoin L1. 250M $PILL allocated as prizes in the Vibecoding Challenge.',
    'assemblyscript': '**AssemblyScript** is the primary language for OP_NET smart contracts. TypeScript-like syntax that compiles to WASM. Bob can scaffold complete AS contracts for you!',
    'security': 'OP_NET security: **ML-DSA** post-quantum signatures + **cryptographic consensus** + **deterministic WASM execution** + **4-epoch deep attestation** (~21 blocks). The most secure smart contract platform on Bitcoin.',
};

const PROMPTS = [
    { l: '🔗 OP_NET', k: 'opnet' }, { l: '🔐 Consensus', k: 'consensus' }, { l: '⚡ WASM', k: 'wasm' },
    { l: '🛡️ Quantum', k: 'quantum' }, { l: '🔄 Epochs', k: 'epoch' }, { l: '🤖 Bob MCP', k: 'mcp' },
    { l: '🏆 Vibecode', k: 'vibecode' }, { l: '💰 DeFi', k: 'defi' },
    { l: '📜 Contracts', k: 'show contract addresses' }, { l: '🔒 Audit', k: 'security audit' },
    { l: '💻 CLI', k: 'cli deploy' }, { l: '📊 BTC Monitor', k: 'btc monitor' },
];

const localAns = (q: string): string => {
    const l = q.toLowerCase(); for (const [k, v] of Object.entries(KB)) { if (l.includes(k)) return v }
    if (/hi|hello|hey|привет/.test(l)) return 'Hey! 👋 I\'m Bob — your OP_NET AI Instructor. I know everything about building on Bitcoin L1. Ask about the protocol, smart contracts, or try the full version at **ai.opnet.org**!';
    if (/price|цена/.test(l)) return 'Check **Dashboard** for live BTC price + current OP_NET epoch number! Data comes from CoinGecko + live OP_NET RPC.';
    if (/help|помощь|what/.test(l)) return 'I\'m an expert on:\n• **Consensus layer** vs metaprotocols\n• **WASM** smart contracts + **OP_VM**\n• **Post-quantum** security (ML-DSA)\n• **Epochs**, **gas**, **P2OP** addresses\n• **DeFi**: Motoswap, lending, vaults\n• **Vibecoding Challenge** prizes\n\nFor the full AI experience with 28+ tools, visit **ai.opnet.org**!';
    if (/challenge|prize|contest|submit/.test(l)) return 'The **Vibecoding Challenge** runs at vibecode.finance/challenge. Three themed weeks with **Motocats NFTs** + **$PILL tokens** as prizes. Build with Bob, tweet with #opnetvibecode @opnetbtc, submit your GitHub repo. Judges score independently!';
    return 'I specialize in **OP_NET** — the first consensus layer on Bitcoin. Try asking about **consensus**, **WASM**, **epochs**, **DeFi**, **vibecoding**, or any feature! For full AI dev tools, connect Bob at **ai.opnet.org** 🧠';
};

/** Trim MCP markdown to a concise chat reply */
function trimMcp(raw: string): string {
    const lines = raw.split('\n').filter(l => l.trim());
    // Take first meaningful section (up to ~600 chars)
    let out = '';
    for (const line of lines) {
        if (out.length > 600) break;
        // Skip fetch instructions and file paths
        if (line.startsWith('**Fetch:**') || line.match(/^`[a-z].*\.md`$/)) continue;
        out += line + '\n';
    }
    return out.trim() || raw.slice(0, 600);
}

const bold = (t: string) => t.split('**').map((p, i) => i % 2 === 1 ? <strong key={i} style={{ color: 'var(--c2)' }}>{p}</strong> : <span key={i}>{p}</span>);

const BobChat: React.FC = () => {
    const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, role: 'bot', text: '🧠 I\'m **Bob**, the OP_NET AI Instructor. I know everything about building on Bitcoin L1 — smart contracts, epochs, post-quantum security, DeFi, and the Vibecoding Challenge.\n\nI\'m connected to the **live Bob MCP server** at ai.opnet.org with **28+ dev tools**. Ask me anything!' }]);
    const [inp, setInp] = useState('');
    const [typ, setTyp] = useState(false);
    const [mcpStatus, setMcpStatus] = useState<'connecting' | 'live' | 'local'>('connecting');
    const end = useRef<HTMLDivElement>(null);

    useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, typ]);

    // Try to connect to MCP on mount
    useEffect(() => {
        bobMcp.initBob().then(ok => setMcpStatus(ok ? 'live' : 'local')).catch(() => setMcpStatus('local'));
    }, []);

    const send = useCallback(async (t: string) => {
        if (!t.trim() || typ) return;
        localStorage.setItem('hub_bob_used', '1');
        const userText = t.trim();
        setMsgs(p => [...p, { id: Date.now(), role: 'user', text: userText }]);
        setInp('');
        setTyp(true);

        // Try MCP first, fall back to local KB
        let reply: string;
        let source: 'mcp' | 'local' = 'local';

        if (mcpStatus === 'live') {
            try {
                let mcpResult: string | null = null;
                const lq = userText.toLowerCase();
                // Route to the best Bob tool based on query
                if (/contract.?address|motoswap.?addr|staking.?addr|token.?addr/i.test(lq)) {
                    mcpResult = await bobMcp.getContractAddresses();
                } else if (/audit|security|vulnerabilit/i.test(lq)) {
                    mcpResult = await bobMcp.getAuditInfo();
                } else if (/cli|deploy|compil|mldsa.?key|keygen/i.test(lq)) {
                    mcpResult = await bobMcp.getCliHelp();
                } else if (/monitor|mempool|track|block.*watch/i.test(lq)) {
                    mcpResult = await bobMcp.getBtcMonitor();
                } else if (/guide|tutorial|doc|how.?to|develop/i.test(lq)) {
                    mcpResult = await bobMcp.getDevDocs();
                } else if (/skill|capabilit|what.?can|tools/i.test(lq)) {
                    mcpResult = await bobMcp.getSkillCatalog();
                } else {
                    mcpResult = await bobMcp.searchKnowledge(userText);
                }
                if (mcpResult && mcpResult.length > 20) {
                    reply = trimMcp(mcpResult);
                    source = 'mcp';
                } else {
                    reply = localAns(userText);
                }
            } catch {
                reply = localAns(userText);
            }
        } else {
            // Simulate slight delay for local responses
            await new Promise(r => setTimeout(r, 300 + Math.random() * 300));
            reply = localAns(userText);
        }

        setMsgs(p => [...p, { id: Date.now() + 1, role: 'bot', text: reply, source }]);
        setTyp(false);
    }, [typ, mcpStatus]);

    const statusColor = mcpStatus === 'live' ? 'var(--g)' : mcpStatus === 'connecting' ? 'var(--y)' : 'var(--t3)';
    const statusLabel = mcpStatus === 'live' ? 'MCP Live' : mcpStatus === 'connecting' ? 'Connecting...' : 'Local KB';

    return (
        <div className="P chat-w">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="Lb" style={{ marginBottom: 0 }}>🤖 Bob AI — OP_NET Instructor</div>
                <span className="tag" style={{ background: `${statusColor}15`, color: statusColor, border: `1px solid ${statusColor}30` }}>{statusLabel}</span>
            </div>
            <a href="https://ai.opnet.org" target="_blank" rel="noopener noreferrer" style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', marginBottom: 10,
                background: 'rgba(14,165,233,.06)', border: '1px solid rgba(14,165,233,.15)', borderRadius: 'var(--rad)',
                textDecoration: 'none', color: 'var(--c2)', fontSize: '.78rem', fontWeight: 600, transition: 'all .2s'
            }}>
                <span style={{ fontSize: '1.2rem' }}>🔗</span>
                <span>Full Bob MCP Server — 28+ AI tools for Bitcoin dev → <strong>ai.opnet.org</strong></span>
            </a>
            <div className="chips">{PROMPTS.map(p => <button key={p.k} className="chip" onClick={() => send(p.l.replace(/^[^ ]+ /, ''))}>{p.l}</button>)}</div>
            <div className="chat-b">
                {msgs.map(m => (
                    <div key={m.id} className={`bub ${m.role === 'bot' ? 'ai' : 'me'}`}>
                        <div className="bub-w" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            {m.role === 'bot' ? '🤖 Bob' : '👤 You'}
                            {m.source === 'mcp' && <span style={{ fontSize: '.5rem', background: 'var(--gG)', color: 'var(--g)', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>MCP</span>}
                        </div>
                        <div>{bold(m.text)}</div>
                    </div>
                ))}
                {typ && <div className="bub ai"><div className="bub-w">🤖 Bob</div><div className="dots"><span>●</span><span>●</span><span>●</span></div></div>}
                <div ref={end} />
            </div>
            <div className="chat-f"><input className="chat-i" value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === 'Enter' && send(inp)} placeholder="Ask about OP_NET, consensus, WASM, DeFi..." /><button className="snd" onClick={() => send(inp)}>Send</button></div>
        </div>
    );
};
export default BobChat;
