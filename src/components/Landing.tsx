import React, { useState, useEffect } from 'react';
const Landing: React.FC<{ onNav: (t: string) => void }> = ({ onNav }) => {
    const [price, setPrice] = useState<number | null>(null);
    const [chg, setChg] = useState(0);
    const [blk, setBlk] = useState(0);
    useEffect(() => {
        (async () => {
            try {
                const [p, b] = await Promise.all([
                    fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true').then(r => r.json()),
                    fetch('https://blockchain.info/q/getblockcount').then(r => r.text()),
                ]);
                setPrice(p.bitcoin.usd); setChg(p.bitcoin.usd_24h_change); setBlk(parseInt(b));
            } catch { setPrice(97842); setChg(2.34); setBlk(888421); }
        })();
    }, []);
    const f = (n: number) => '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    const epoch = blk > 0 ? Math.floor(blk / 5) : 0;

    return (
        <div>
            <div className="hero-l">
                <div className="hero-badge"><span className="dot" /> Consensus Layer Active</div>
                <h1 className="hero-h1">Bitcoin Just Became<br /><span className="hero-ac">Programmable</span></h1>
                <p className="hero-p">
                    OP_NET is the first consensus layer on Bitcoin — Turing-complete smart contracts,
                    post-quantum security, and deterministic execution. No bridges. No sidechains.
                    Pure Bitcoin L1.
                </p>
                <div className="hero-ctas">
                    <button className="btn-p" onClick={() => onNav('bob')}>🤖 Ask Bob AI</button>
                    <button className="btn-s" onClick={() => onNav('launch')}>🚀 Deploy a Token</button>
                    <a className="btn-s" href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none' }}>📖 Read Docs</a>
                </div>

                <div className="pillars">
                    <div className="pillar">
                        <div className="pillar-i">🔐</div>
                        <div className="pillar-t">Cryptographic Consensus</div>
                        <div className="pillar-d">Not indexer hope. Mathematical proof of correct execution.</div>
                    </div>
                    <div className="pillar">
                        <div className="pillar-i">⚡</div>
                        <div className="pillar-t">WASM Smart Contracts</div>
                        <div className="pillar-d">Full Turing-complete execution. AssemblyScript, Rust, C++.</div>
                    </div>
                    <div className="pillar">
                        <div className="pillar-i">🛡️</div>
                        <div className="pillar-t">Post-Quantum Security</div>
                        <div className="pillar-d">ML-DSA signatures. Protected against quantum attacks.</div>
                    </div>
                </div>

                <div className="ticker">
                    <div className="tk"><div className="tk-l">BTC Price</div><div className="tk-v">{price ? f(price) : '…'}</div>{price && <div className={`tk-c ${chg >= 0 ? 'u' : 'd'}`}>{chg >= 0 ? '↑' : '↓'}{Math.abs(chg).toFixed(2)}%</div>}</div>
                    <div className="tk-s" />
                    <div className="tk"><div className="tk-l">Block</div><div className="tk-v">{blk > 0 ? blk.toLocaleString() : '…'}</div></div>
                    <div className="tk-s" />
                    <div className="tk"><div className="tk-l">Epoch</div><div className="tk-v" style={{ color: 'var(--p)' }}>{epoch > 0 ? epoch.toLocaleString() : '…'}</div></div>
                    <div className="tk-s" />
                    <div className="tk"><div className="tk-l">Ecosystem</div><div className="tk-v" style={{ color: 'var(--g)' }}>26+</div></div>
                </div>
            </div>

            <div className="fgrid">
                {[
                    { i: '🤖', t: 'Bob AI Agent', d: 'OP_NET knowledge copilot. Consensus, tokens, DeFi.', tab: 'bob' },
                    { i: '🚀', t: 'Token Launcher', d: 'Deploy OP-20 contracts on Bitcoin L1.', tab: 'launch' },
                    { i: '💼', t: 'Portfolio', d: 'Consensus-verified OP-20 holdings.', tab: 'portfolio' },
                    { i: '🛠️', t: 'Tools', d: 'Explorer, converter, fee estimation.', tab: 'tools' },
                    { i: '⛏️', t: 'Epoch Miner', d: 'Learn OP_NET epochs through gameplay.', tab: 'game' },
                    { i: '🎯', t: 'Quests', d: 'Guided onboarding. Earn XP.', tab: 'quests' },
                ].map(c => (
                    <div key={c.tab} className="P fc" onClick={() => onNav(c.tab)}>
                        <div className="fc-i">{c.i}</div><div className="fc-t">{c.t}</div><div className="fc-d">{c.d}</div>
                    </div>
                ))}
            </div>

            <div className="eco-bn">
                <div>
                    <div style={{ fontSize: '1rem', fontWeight: 700 }}>The <span style={{ color: 'var(--o)' }}>Programmable Bitcoin</span> Ecosystem</div>
                    <div style={{ color: 'var(--t3)', fontSize: '.78rem', marginTop: 2 }}>26+ apps built on OP_NET. Submit yours at vibecode.finance</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                    <a href="https://vibecode.finance" target="_blank" rel="noopener noreferrer" className="btn-p" style={{ textDecoration: 'none', fontSize: '.75rem', padding: '8px 18px' }}>Explore →</a>
                    <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer" className="btn-s" style={{ textDecoration: 'none', fontSize: '.75rem', padding: '8px 18px' }}>Docs →</a>
                </div>
            </div>
        </div>
    );
};
export default Landing;
