import React, { useState, useEffect } from 'react';

interface Article { id: number; src: string; title: string; desc: string; time: string; url: string; tag: string; featured?: boolean; img: string }

const NEWS: Article[] = [
    { id: 1, src: 'OP_NET', title: 'OP_NET: The First Consensus Layer on Bitcoin is Live', desc: 'Not a metaprotocol. Not a sidechain. OP_NET brings cryptographic consensus, WASM smart contracts, and post-quantum security directly to Bitcoin Layer 1. Every node derives the exact same state — mathematical certainty, not indexer hope.', time: '1h', url: 'https://docs.opnet.org', tag: 'Protocol', featured: true, img: '🔗' },
    { id: 2, src: 'Vibecode', title: 'Vibecode Challenge: 28+ Apps Built in 3 Weeks', desc: 'The OP_NET build challenge has exploded. Teams are shipping DEXes, lending protocols, NFT platforms, and social apps — all running on Bitcoin L1 consensus. Weekly prizes in PILL and Motocats NFTs.', time: '2h', url: 'https://vibecode.finance', tag: 'Hackathon', img: '🏆' },
    { id: 3, src: 'Bitcoin', title: 'Bitcoin Surges Past $97K — ETF Inflows Break $1.2B', desc: 'Institutional demand at all-time highs. BlackRock\'s Bitcoin ETF now holds over $20B. Analysts project $120K by Q3 as supply shock intensifies post-halving.', time: '3h', url: '#', tag: 'Markets', img: '📈' },
    { id: 4, src: 'OP_NET', title: 'Motoswap V2: Consensus-Verified AMM Pools', desc: 'The first DEX where swap prices are cryptographically proven correct. LP positions secured by OP_NET consensus — your liquidity is protected by mathematical proofs, not trust.', time: '4h', url: '#', tag: 'DeFi', img: '🔄' },
    { id: 5, src: 'OP_NET', title: 'Why OP-20 Tokens Are Superior to BRC-20', desc: 'BRC-20 tokens exist only in indexer databases that can disagree. OP-20 tokens live in cryptographic consensus state — different nodes literally cannot show different balances.', time: '5h', url: 'https://docs.opnet.org', tag: 'Analysis', img: '⚖️' },
    { id: 6, src: 'Bitcoin', title: 'Bitcoin Hash Rate Hits 780 EH/s — New All-Time High', desc: 'Mining infrastructure expanding globally. The network has never been more secure, and OP_NET inherits every bit of that security for its consensus layer.', time: '6h', url: '#', tag: 'Mining', img: '⛏️' },
    { id: 7, src: 'OP_NET', title: 'ML-DSA: Post-Quantum Cryptography Protecting Bitcoin L1', desc: 'OP_NET requires NIST-standardized ML-DSA (Module-Lattice Digital Signature Algorithm) for all contract interactions. Your smart contracts are quantum-resistant today.', time: '8h', url: '#', tag: 'Security', img: '🛡️' },
    { id: 8, src: 'Dev', title: 'Building Your First OP_NET dApp in 10 Minutes', desc: 'With Bob AI as your dev agent, you describe what you want and Bob writes every line of code. No Solidity knowledge needed — contracts compile from AssemblyScript to WASM.', time: '10h', url: 'https://ai.opnet.org', tag: 'Tutorial', img: '🤖' },
    { id: 9, src: 'OP_NET', title: 'Epoch System: How 5-Block Checkpoints Make Forks Impossible', desc: 'State attested 4 epochs deep (~21 blocks). SHA-1 proof-of-work miners compete for rewards but cannot influence consensus. Forks are mathematically impossible, not just unlikely.', time: '12h', url: 'https://docs.opnet.org/epochs-and-mining', tag: 'Deep Dive', img: '🔄' },
];

const NewsFeed: React.FC = () => {
    const [filter, setFilter] = useState('All');
    useEffect(() => { localStorage.setItem('hub_news_visited', '1') }, []);

    const items = filter === 'All' ? NEWS : NEWS.filter(n => n.src === filter);
    const featured = items.find(n => n.featured);
    const rest = items.filter(n => !n.featured);

    return (
        <div>
            {/* Filter bar */}
            <div className="fb">
                {['All', 'OP_NET', 'Bitcoin', 'Dev', 'Vibecode'].map(x => (
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
