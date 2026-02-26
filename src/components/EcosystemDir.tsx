import React, { useEffect, useState } from 'react';

interface App { n: string; d: string; t: string[]; u: string; lv: boolean; icon: string; cat: string }

const APPS: App[] = [
    { n: 'Motoswap', d: 'Uniswap-style AMM DEX with consensus-verified swap prices. The first place to trade OP-20 tokens.', t: ['DeFi', 'AMM', 'Trading'], u: 'https://vibecode.finance', lv: true, icon: '🔄', cat: 'DeFi' },
    { n: 'BitLend L1', d: 'Borrow against BTC holdings. Lending rates determined by consensus smart contracts, not oracles.', t: ['DeFi', 'Lending'], u: 'https://vibecode.finance/apps/bitlend-l1-mm1gx7rx', lv: true, icon: '🏦', cat: 'DeFi' },
    { n: 'SatoshiVault', d: 'Auto-compounding yield vault. Deposits and rewards secured by cryptographic consensus proofs.', t: ['DeFi', 'Yield'], u: 'https://vibecode.finance/apps/satoshivault', lv: true, icon: '🏰', cat: 'DeFi' },
    { n: 'Epoch Vault', d: 'Time-locked savings. Funds release after N epochs — enforced by consensus, not promises.', t: ['DeFi', 'Savings'], u: 'https://vibecode.finance/apps/epoch-vault', lv: true, icon: '⏰', cat: 'DeFi' },
    { n: 'SatForge', d: 'No-code OP-20 token launcher with live preview, auto-generated logos, and instant deployment.', t: ['Tools', 'Token'], u: 'https://vibecode.finance/apps/satforge-op20-token-launcher', lv: true, icon: '🔨', cat: 'Tools' },
    { n: 'BobBTC Insight', d: 'Real-time Bitcoin L1 + OP_NET data dashboard. Block explorer, epoch tracker, gas analytics.', t: ['Tools', 'Analytics'], u: 'https://vibecode.finance/apps/bobbtc-insight-', lv: true, icon: '📊', cat: 'Tools' },
    { n: 'Faucet Decentralizator', d: 'Aggregated Bitcoin testnet faucets in one place. Get regtest BTC for OP_NET development.', t: ['Tools', 'Dev'], u: 'https://vibecode.finance/apps/faucet-decentralizator', lv: true, icon: '🚰', cat: 'Tools' },
    { n: 'Bitcoin DeFi Bible', d: 'Complete interactive guide to Bitcoin L1 DeFi via OP_NET. From basics to advanced strategies.', t: ['Education', 'DeFi'], u: 'https://vibecode.finance/apps/defibible', lv: true, icon: '📖', cat: 'Education' },
    { n: 'BlockTip', d: 'First tip bot on Bitcoin L1 using OP-20 tokens. Send tips on social media backed by consensus.', t: ['Social', 'Payments'], u: 'https://vibecode.finance/apps/blocktip', lv: true, icon: '💸', cat: 'Social' },
    { n: 'Eternal Sentinel', d: 'Dead Man\'s Switch — inheritance vault. Funds auto-transfer if you don\'t check in for N epochs.', t: ['Security', 'Vault'], u: 'https://vibecode.finance/apps/eternalsentinel', lv: false, icon: '🗡️', cat: 'Security' },
    { n: 'Bitcoin Nation', d: 'NFT-gated community forums using OP-721 collections. Token-gate your content with consensus proofs.', t: ['NFT', 'Social'], u: '#', lv: false, icon: '🏛️', cat: 'Social' },
    { n: 'BitLaunch', d: 'Token launchpad with presale mechanics, vesting schedules, and anti-rug features — all on L1.', t: ['DeFi', 'Launchpad'], u: '#', lv: false, icon: '🎯', cat: 'DeFi' },
];

const CATS = ['All', 'DeFi', 'Tools', 'Education', 'Social', 'Security'];

const EcosystemDir: React.FC = () => {
    const [cat, setCat] = useState('All');
    useEffect(() => { localStorage.setItem('hub_eco_visited', '1') }, []);

    const filtered = cat === 'All' ? APPS : APPS.filter(a => a.cat === cat);
    const live = filtered.filter(a => a.lv).length;

    return (
        <div>
            {/* Header */}
            <div className="Pg" style={{ marginBottom: 14, padding: '22px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                <div>
                    <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)' }}><span style={{ color: 'var(--o)' }}>{APPS.length}</span> Apps on Bitcoin's Consensus Layer</div>
                    <div style={{ color: 'var(--t3)', fontSize: '.76rem', marginTop: 2 }}>Every app runs on cryptographic consensus. <a href="https://vibecode.finance" target="_blank" rel="noopener noreferrer">vibecode.finance</a></div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <div className="P" style={{ padding: '6px 14px', textAlign: 'center' }}><div style={{ fontFamily: 'var(--fm)', fontWeight: 700, color: 'var(--g)', fontSize: '.9rem' }}>{live}</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Live</div></div>
                    <div className="P" style={{ padding: '6px 14px', textAlign: 'center' }}><div style={{ fontFamily: 'var(--fm)', fontWeight: 700, color: 'var(--p)', fontSize: '.9rem' }}>{filtered.length - live}</div><div style={{ fontSize: '.5rem', color: 'var(--t4)' }}>Building</div></div>
                </div>
            </div>

            {/* Category filter */}
            <div className="fb">
                {CATS.map(c => (
                    <button key={c} className={`fbn ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c}</button>
                ))}
            </div>

            {/* App grid */}
            <div className="eg">
                {filtered.map((a, i) => (
                    <a key={i} href={a.u} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: 'inherit' }}>
                        <div className="Pg ei">
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <div style={{ fontSize: '1.4rem', width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(255,255,255,.04)', borderRadius: 8, border: '1px solid var(--bd)', flexShrink: 0 }}>{a.icon}</div>
                                <div style={{ flex: 1 }}>
                                    <div className="ei-t" style={{ marginBottom: 0 }}>
                                        <div className="ei-n">{a.n}</div>
                                        <span className={`ei-s ${a.lv ? 'lv' : 'wp'}`}>{a.lv ? '● Live' : '○ Building'}</span>
                                    </div>
                                </div>
                            </div>
                            <div className="ei-d">{a.d}</div>
                            <div className="ei-gs">{a.t.map(t => <span key={t} className="ei-g">{t}</span>)}</div>
                        </div>
                    </a>
                ))}
            </div>
        </div>
    );
};
export default EcosystemDir;
