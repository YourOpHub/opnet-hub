import React, { useState, useEffect } from 'react';

interface Article { id: number; src: string; title: string; desc: string; time: string; url: string; tag: string; featured?: boolean; img: string }

const NEWS: Article[] = [
    { id: 1, src: 'OP_NET', title: 'OP_NET: The First Consensus Layer on Bitcoin is Live', desc: 'Not a metaprotocol. Not a sidechain. OP_NET brings cryptographic consensus, WASM smart contracts, and post-quantum security directly to Bitcoin Layer 1.', time: '1h', url: 'https://docs.opnet.org', tag: 'Protocol', featured: true, img: '🔗' },
    { id: 2, src: 'MotoSwap', title: 'MotoSwap: Consensus-Verified AMM on Bitcoin L1', desc: 'The first DEX where swap prices are cryptographically proven correct. LP positions secured by OP_NET consensus — your liquidity is protected by mathematical proofs.', time: '2h', url: 'https://motoswap.org', tag: 'DeFi', img: '🔄' },
    { id: 3, src: 'Vibecode', title: 'Vibecode Challenge: 28+ Apps Built in 3 Weeks', desc: 'The OP_NET build challenge has exploded. Teams are shipping DEXes, lending protocols, NFT platforms, and social apps — all running on Bitcoin L1 consensus.', time: '3h', url: 'https://vibecode.finance', tag: 'Hackathon', img: '🏆' },
    { id: 4, src: 'OP_NET', title: 'Why OP-20 Tokens Are Superior to BRC-20', desc: 'BRC-20 tokens exist only in indexer databases that can disagree. OP-20 tokens live in cryptographic consensus state — different nodes literally cannot show different balances.', time: '5h', url: 'https://docs.opnet.org', tag: 'Analysis', img: '⚖️' },
    { id: 5, src: 'OP_NET', title: 'ML-DSA: Post-Quantum Cryptography on Bitcoin L1', desc: 'OP_NET requires NIST-standardized ML-DSA for all contract interactions. Your smart contracts are quantum-resistant today, not someday.', time: '8h', url: 'https://docs.opnet.org', tag: 'Security', img: '🛡️' },
    { id: 6, src: 'MotoSwap', title: 'NativeSwap Factory: Anyone Can Create AMM Pools', desc: 'Deploy your own liquidity pool for any OP-20 token pair. Earn 0.3% on every swap. No permission needed — fully trustless and on-chain.', time: '10h', url: 'https://motoswap.org', tag: 'DeFi', img: '�' },
    { id: 7, src: 'Dev', title: 'Building dApps with Bob AI Agent', desc: 'Describe what you want and Bob writes every line. Contracts compile from AssemblyScript to WASM. Deploy to Bitcoin L1 in minutes.', time: '12h', url: 'https://ai.opnet.org', tag: 'Tutorial', img: '🤖' },
    { id: 8, src: 'OP_NET', title: 'Epoch System: 5-Block Checkpoints', desc: 'State attested 4 epochs deep (~21 blocks). SHA-1 proof-of-work miners compete for rewards but cannot influence consensus.', time: '1d', url: 'https://docs.opnet.org', tag: 'Deep Dive', img: '⛓' },
];

const SOCIAL_LINKS = [
    { name: 'OP_NET Twitter', url: 'https://x.com/opaborat', handle: '@opaborat' },
    { name: 'MotoSwap Twitter', url: 'https://x.com/maboratmarket', handle: '@maboratmarket' },
    { name: 'OP_NET Telegram', url: 'https://t.me/opaborat', handle: 'Telegram' },
    { name: 'OP_NET Discord', url: 'https://discord.gg/opnet', handle: 'Discord' },
];

const NewsFeed: React.FC = () => {
    const [filter, setFilter] = useState('All');
    useEffect(() => { localStorage.setItem('hub_news_visited', '1') }, []);

    const items = filter === 'All' ? NEWS : NEWS.filter(n => n.src === filter);
    const featured = items.find(n => n.featured);
    const rest = items.filter(n => !n.featured);

    return (
        <div>
            {/* Social links bar */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {SOCIAL_LINKS.map(s => (
                    <a key={s.name} href={s.url} target="_blank" rel="noopener noreferrer"
                        style={{ padding: '6px 14px', borderRadius: 10, background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', textDecoration: 'none', color: 'var(--t2)', fontSize: '.68rem', fontWeight: 600, transition: '.2s', display: 'flex', alignItems: 'center', gap: 6 }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(247,147,26,.2)'; e.currentTarget.style.color = '#fff'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'rgba(255,255,255,.06)'; e.currentTarget.style.color = 'var(--t2)'; }}
                    >
                        <span style={{ fontSize: '.75rem' }}>{s.name.includes('Twitter') ? '𝕏' : s.name.includes('Telegram') ? '✈' : '💬'}</span>
                        {s.handle} ↗
                    </a>
                ))}
            </div>

            {/* Filter bar */}
            <div className="fb">
                {['All', 'OP_NET', 'MotoSwap', 'Dev', 'Vibecode'].map(x => (
                    <button key={x} className={`fbn ${filter === x ? 'on' : ''}`} onClick={() => setFilter(x)}>{x}</button>
                ))}
            </div>

            {/* Featured article */}
            {featured && (
                <a href={featured.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit', display: 'block', marginBottom: 12 }}>
                    <div className="Pg" style={{ padding: 0, overflow: 'hidden' }}>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 0 }}>
                            <div style={{ padding: '24px 22px' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <span className="ns">{featured.src}</span>
                                    <div style={{ display: 'flex', gap: 4 }}><span className="ntag">{featured.tag}</span><span className="ntag" style={{ background: 'rgba(16,185,129,.06)', color: 'var(--g)', borderColor: 'rgba(16,185,129,.15)' }}>Featured</span></div>
                                </div>
                                <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--w)', lineHeight: 1.3, marginBottom: 6 }}>{featured.title}</div>
                                <div style={{ fontSize: '.82rem', color: 'var(--t2)', lineHeight: 1.5 }}>{featured.desc}</div>
                                <div style={{ fontSize: '.65rem', color: 'var(--t4)', marginTop: 8 }}>{featured.time} ago · Read more →</div>
                            </div>
                        </div>
                    </div>
                </a>
            )}

            {/* Grid */}
            <div className="ng">
                {rest.map(n => (
                    <a key={n.id} href={n.url} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="Pg nc">
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: '1.2rem' }}>{n.img}</span>
                                    <span className="ns">{n.src}</span>
                                </div>
                                <span className="ntag">{n.tag}</span>
                            </div>
                            <div className="nc-t">{n.title}</div>
                            <div className="nc-d">{n.desc}</div>
                            <div className="nc-m">{n.time} ago</div>
                        </div>
                    </a>
                ))}
            </div>
        </div>
    );
};
export default NewsFeed;
