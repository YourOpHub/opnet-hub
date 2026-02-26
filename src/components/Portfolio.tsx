import React from 'react';
interface T { name: string; symbol: string; amount: number; price: number; change: number; icon: string }
const TK: T[] = [
    { name: 'Bitcoin', symbol: 'BTC', amount: 1.2345, price: 97842, change: 2.34, icon: '₿' },
    { name: 'WBTC', symbol: 'WBTC', amount: .5, price: 97800, change: 2.1, icon: '🔶' },
    { name: 'Motoswap', symbol: 'MOTO', amount: 15000, price: .42, change: 12.5, icon: '🏎️' },
    { name: 'OPNet Token', symbol: 'OPN', amount: 50000, price: .085, change: -3.2, icon: '⚡' },
    { name: 'SatForge', symbol: 'FORGE', amount: 8000, price: .15, change: 8.7, icon: '🔨' },
    { name: 'BlockTip', symbol: 'BLOCK', amount: 25000, price: .032, change: -1.5, icon: '💸' },
];
const Portfolio: React.FC = () => {
    const tot = TK.reduce((s, t) => s + t.amount * t.price, 0); const btc = tot / TK[0].price;
    const avg = TK.reduce((s, t) => s + t.change, 0) / TK.length;
    return (
        <div>
            <div className="ph">
                <div className="P pm"><div className="pm-v" style={{ color: 'var(--o)' }}>${tot >= 1e6 ? (tot / 1e6).toFixed(2) + 'M' : tot.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div><div className="pm-l">Total (USD)</div></div>
                <div className="P pm"><div className="pm-v" style={{ color: 'var(--y)' }}>{btc.toFixed(6)} BTC</div><div className="pm-l">BTC Value</div></div>
                <div className="P pm"><div className="pm-v" style={{ color: avg >= 0 ? 'var(--g)' : 'var(--r)' }}>{avg >= 0 ? '+' : ''}{avg.toFixed(2)}%</div><div className="pm-l">Avg 24h</div></div>
                <div className="P pm"><div className="pm-v">{TK.length}</div><div className="pm-l">OP-20 Assets</div></div>
            </div>
            <div className="P" style={{ overflow: 'auto' }}>
                <div className="Lb">💼 Consensus-Verified Holdings <span className="tag tag-g">Verified</span></div>
                <table className="pt">
                    <thead><tr><th>Asset</th><th>Balance</th><th>Price</th><th>Value</th><th>24h</th></tr></thead>
                    <tbody>{TK.map((t, i) => (
                        <tr key={i}>
                            <td><div style={{ display: 'flex', alignItems: 'center', gap: 7 }}><span style={{ fontSize: '1rem' }}>{t.icon}</span><div><div style={{ fontWeight: 600, color: 'var(--w)' }}>{t.name}</div><div style={{ fontSize: '.6rem', color: 'var(--t3)' }}>{t.symbol}</div></div></div></td>
                            <td className="mono">{t.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                            <td className="mono">${t.price >= 1 ? t.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : t.price.toFixed(4)}</td>
                            <td className="mono" style={{ color: 'var(--o)' }}>${(t.amount * t.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                            <td><span style={{ color: t.change >= 0 ? 'var(--g)' : 'var(--r)', fontWeight: 600, fontFamily: 'var(--fm)', fontSize: '.78rem' }}>{t.change >= 0 ? '+' : ''}{t.change.toFixed(2)}%</span></td>
                        </tr>
                    ))}</tbody>
                </table>
            </div>
        </div>
    );
};
export default Portfolio;
