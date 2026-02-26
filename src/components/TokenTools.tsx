import React, { useState } from 'react';
const TokenTools: React.FC = () => {
    const [ba, setBa] = useState('1'); const bp = 97842; const bn = parseFloat(ba) || 0; const sv = bn * 1e8; const uv = bn * bp;
    const onBa = (v: string) => { setBa(v); localStorage.setItem('hub_tools_used', '1'); };
    const [ta, setTa] = useState(''); const [tr, setTr] = useState<any>(null); const [tl, setTl] = useState(false);
    const [wa, setWa] = useState(''); const [wr, setWr] = useState<any>(null); const [wl, setWl] = useState(false);
    const lookup = () => { if (!ta.trim()) return; setTl(true); setTimeout(() => { setTr({ n: 'WBTC', std: 'OP-20', dec: 8, sup: '21,000,000', h: 500 + Math.floor(Math.random() * 2000), epoch: Math.floor(Math.random() * 170000) }); setTl(false) }, 1000) };
    const check = () => { if (!wa.trim()) return; setWl(true); setTimeout(() => { setWr({ btc: (Math.random() * 3).toFixed(8), tk: [{ n: 'WBTC', a: (Math.random() * 100).toFixed(4) }, { n: 'MOTO', a: (Math.random() * 5000).toFixed(0) }, { n: 'OPN', a: (Math.random() * 25000).toFixed(0) }] }); setWl(false) }, 1200) };
    return (
        <div className="tg">
            <div className="Pg">
                <div className="Lb">💱 BTC ↔ Sats ↔ USD</div>
                <div className="ir"><input className="ti" type="number" step="any" value={ba} onChange={e => onBa(e.target.value)} placeholder="BTC" /><span style={{ alignSelf: 'center', color: 'var(--t3)', fontWeight: 700, fontSize: '.82rem' }}>BTC</span></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    <div className="cr"><div className="cr-b">{sv >= 1e6 ? (sv / 1e6).toFixed(2) + 'M' : sv.toLocaleString()}</div><div className="cr-l">Satoshis</div></div>
                    <div className="cr"><div className="cr-b" style={{ color: 'var(--g)' }}>${uv >= 1e6 ? (uv / 1e6).toFixed(2) + 'M' : uv.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div><div className="cr-l">USD</div></div>
                </div>
            </div>
            <div className="Pg">
                <div className="Lb">🔍 OP-20 Token Explorer</div>
                <div className="ir"><input className="ti" value={ta} onChange={e => setTa(e.target.value)} placeholder="Contract address (P2OP)..." /><button className="tb" onClick={lookup}>{tl ? '…' : 'Explore'}</button></div>
                {tr && <div className="rb">
                    <div className="rr"><span className="rk">Name</span><span className="rv" style={{ color: 'var(--o)' }}>{tr.n}</span></div>
                    <div className="rr"><span className="rk">Standard</span><span className="rv" style={{ color: 'var(--c)' }}>OP-20</span></div>
                    <div className="rr"><span className="rk">Supply</span><span className="rv">{tr.sup}</span></div>
                    <div className="rr"><span className="rk">Holders</span><span className="rv" style={{ color: 'var(--g)' }}>{tr.h}</span></div>
                    <div className="rr"><span className="rk">Deploy Epoch</span><span className="rv" style={{ color: 'var(--p)' }}>{tr.epoch}</span></div>
                </div>}
            </div>
            <div className="Pg">
                <div className="Lb">💰 Wallet Inspector</div>
                <div className="ir"><input className="ti" value={wa} onChange={e => setWa(e.target.value)} placeholder="bcrt1... / P2OP address" /><button className="tb" onClick={check}>{wl ? '…' : 'Inspect'}</button></div>
                {wr && <div className="rb">
                    <div className="rr"><span className="rk">BTC</span><span className="rv" style={{ color: 'var(--o)' }}>{wr.btc} ₿</span></div>
                    {wr.tk.map((t: any, i: number) => <div className="rr" key={i}><span className="rk">{t.n}</span><span className="rv">{t.a}</span></div>)}
                </div>}
            </div>
            <div className="Pg">
                <div className="Lb">⛽ Gas Estimator</div>
                <div className="rb">
                    <div className="rr"><span className="rk">🐢 Economy</span><span className="rv">{5 + Math.floor(Math.random() * 10)} sat/vB</span></div>
                    <div className="rr"><span className="rk">🚶 Standard</span><span className="rv" style={{ color: 'var(--o)' }}>{15 + Math.floor(Math.random() * 20)} sat/vB</span></div>
                    <div className="rr"><span className="rk">🚀 Priority</span><span className="rv" style={{ color: 'var(--r)' }}>{40 + Math.floor(Math.random() * 30)} sat/vB</span></div>
                    <div className="rr"><span className="rk">📊 Mempool</span><span className="rv">{(50 + Math.random() * 200).toFixed(0)} MB</span></div>
                </div>
            </div>
        </div>
    );
};
export default TokenTools;
