import React, { useState, useRef, useEffect } from 'react';
interface Msg { id: number; role: 'bot' | 'user'; text: string }
const KB: Record<string, string> = {
    'opnet': '**OP_NET** is the first consensus layer on Bitcoin — not a metaprotocol, not a sidechain. It brings Turing-complete smart contracts to Bitcoin L1 with cryptographic proof of correct execution. Unlike BRC-20 (indexer hope), OP_NET provides mathematical certainty.',
    'consensus': '**Consensus Layer** means every OP_NET node processing the same Bitcoin blocks arrives at the exact same state. Only ONE honest node is needed. No new trust assumptions beyond Bitcoin itself.',
    'op-20': '**OP-20** is the fungible token standard (like ERC-20). Supports mint, burn, transfer, approve. Tokens exist in verifiable consensus state, not indexer databases.',
    'op_20': '**OP-20** is the fungible token standard (like ERC-20). Deploy yours in our **Token Launcher**!',
    'op-721': '**OP-721** is the NFT standard. Non-fungible tokens directly on Bitcoin L1 consensus.',
    'wasm': 'Smart contracts run in **OP_VM** — a WebAssembly virtual machine. Deterministic execution, gas-metered, supports AssemblyScript, Rust, and C++. Up to 400KB compressed bytecode.',
    'quantum': 'OP_NET requires **ML-DSA** (Module-Lattice Digital Signature Algorithm) for contract interactions — NIST-standardized post-quantum security on top of Bitcoin\'s ECDSA.',
    'epoch': '**Epochs** span 5 Bitcoin blocks (~50 min). At epoch end, a checksum root is computed. SHA-1 miners compete for rewards. State is attested 4 epochs deep (~21 blocks) making forks mathematically impossible.',
    'wallet': 'Use **OPWallet** browser extension. Click **Connect** in the header. You sign with ML-DSA for contract interactions.',
    'motoswap': '**Motoswap** — first AMM DEX on Bitcoin L1. Uniswap v2 style pools, all secured by OP_NET consensus.',
    'defi': 'Bitcoin DeFi via OP_NET: Motoswap (DEX), BitLend (lending), SatoshiVault (vault), Epoch Vault (time-locks). All consensus-verified on L1.',
    'vibecode': '**Vibecode** — OP_NET build challenge at vibecode.finance. Describe what you want → Bob builds it → submit → weekly reviews → prizes!',
    'bob': 'I\'m **Bob**, your OP_NET copilot. I can explain consensus vs metaprotocols, WASM contracts, post-quantum security, epochs, and every Hub feature.',
    'hub': '**OPNet Hub** = Mission control for programmable Bitcoin. Dashboard, Portfolio, AI Chat, Tools, Token Launcher, Quests, Epoch Miner, News, Ecosystem.',
    'portfolio': '**Portfolio** tracks your consensus-verified OP-20 holdings — BTC, WBTC, MOTO. Values in USD/BTC.',
    'miner': '**Epoch Miner** — learn OP_NET through gameplay! 12 upgrades themed around OP_NET (WASM Compiler, ML-DSA Signer, Merkle Trees). 5-block epochs like the real protocol.',
    'launch': '**Token Launcher** — deploy OP-20 tokens on Bitcoin L1. WASM bytecode → tapscript → Bitcoin tx → consensus-verified token. Upload your logo!',
    'quests': '**Quests** — guided onboarding through OP_NET Hub. Complete tasks, earn XP, level up.',
    'gas': '**Gas** on OP_NET: every WASM operation has a cost. Fees paid in BTC. Transactions ordered by gas price, then priority, then txid.',
    'p2op': '**P2OP addresses** use SegWit version 16 with custom HRP. They represent deployed smart contracts and are distinct from regular Bitcoin addresses.',
    'metaprotocol': 'Unlike **BRC-20/Runes/Alkanes** (which rely on indexers that can disagree), OP_NET has cryptographic consensus. Different indexers CANNOT show different balances — the math forces agreement.',
};
const PROMPTS = [
    { l: '🔗 OP_NET', k: 'opnet' }, { l: '🔐 Consensus', k: 'consensus' }, { l: '⚡ WASM', k: 'wasm' },
    { l: '🛡️ Quantum', k: 'quantum' }, { l: '🔄 Epochs', k: 'epoch' }, { l: '🚀 Launcher', k: 'launch' }, { l: '🤖 About Bob', k: 'bob' },
];
const ans = (q: string): string => {
    const l = q.toLowerCase(); for (const [k, v] of Object.entries(KB)) { if (l.includes(k)) return v }
    if (/hi|hello|hey|привет/.test(l)) return 'Hey! 👋 I\'m Bob — your OP_NET consensus copilot. Ask about the protocol, smart contracts, or any Hub feature!';
    if (/price|цена/.test(l)) return 'Check **Dashboard** for live BTC price + current epoch number!';
    if (/help|помощь|what/.test(l)) return 'I\'m an expert on:\n• **Consensus layer** vs metaprotocols\n• **WASM** smart contracts + **OP_VM**\n• **Post-quantum** security (ML-DSA)\n• **Epochs**, **gas**, **P2OP** addresses\n• All Hub features: Launcher, Portfolio, Quests, Miner';
    return 'I specialize in **OP_NET** — the first consensus layer on Bitcoin. Try asking about **consensus**, **WASM**, **epochs**, **quantum**, or any feature! 🧠';
};
const bold = (t: string) => t.split('**').map((p, i) => i % 2 === 1 ? <strong key={i} style={{ color: 'var(--c2)' }}>{p}</strong> : <span key={i}>{p}</span>);

const BobChat: React.FC = () => {
    const [msgs, setMsgs] = useState<Msg[]>([{ id: 0, role: 'bot', text: '🧠 I\'m **Bob**, the OP_NET consensus copilot. I know everything about the first consensus layer on Bitcoin — smart contracts, epochs, post-quantum security, and every feature of OPNet Hub. Ask me anything!' }]);
    const [inp, setInp] = useState(''); const [typ, setTyp] = useState(false);
    const end = useRef<HTMLDivElement>(null);
    useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs, typ]);
    const send = (t: string) => { if (!t.trim()) return; localStorage.setItem('hub_bob_used', '1'); setMsgs(p => [...p, { id: Date.now(), role: 'user', text: t.trim() }]); setInp(''); setTyp(true); setTimeout(() => { setMsgs(p => [...p, { id: Date.now() + 1, role: 'bot', text: ans(t) }]); setTyp(false) }, 400 + Math.random() * 400) };
    return (
        <div className="P chat-w">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="Lb" style={{ marginBottom: 0 }}>🤖 Bob AI — Consensus Copilot</div><span className="tag tag-g">Online</span>
            </div>
            <div className="chips">{PROMPTS.map(p => <button key={p.k} className="chip" onClick={() => send(p.l.replace(/^[^ ]+ /, ''))}>{p.l}</button>)}</div>
            <div className="chat-b">
                {msgs.map(m => <div key={m.id} className={`bub ${m.role === 'bot' ? 'ai' : 'me'}`}><div className="bub-w">{m.role === 'bot' ? '🤖 Bob' : '👤 You'}</div><div>{bold(m.text)}</div></div>)}
                {typ && <div className="bub ai"><div className="bub-w">🤖 Bob</div><div className="dots"><span>●</span><span>●</span><span>●</span></div></div>}
                <div ref={end} />
            </div>
            <div className="chat-f"><input className="chat-i" value={inp} onChange={e => setInp(e.target.value)} onKeyDown={e => e.key === 'Enter' && send(inp)} placeholder="Ask about OP_NET consensus layer..." /><button className="snd" onClick={() => send(inp)}>Send</button></div>
        </div>
    );
};
export default BobChat;
