import React, { useState } from 'react';
import Landing from './components/Landing';
import Dashboard from './components/Dashboard';
import BobChat from './components/BobChat';
import NewsFeed from './components/NewsFeed';
import TokenTools from './components/TokenTools';
import SatoshiMiner from './components/SatoshiMiner';
import EcosystemDir from './components/EcosystemDir';
import Portfolio from './components/Portfolio';
import TokenLauncher from './components/TokenLauncher';
import QuestPanel from './components/Quests';

const TABS = [
    { id: 'home', i: '🏠', l: 'Home' },
    { id: 'portfolio', i: '💼', l: 'Portfolio' },
    { id: 'bob', i: '🤖', l: 'Bob AI' },
    { id: 'tools', i: '🛠️', l: 'Tools' },
    { id: 'launch', i: '🚀', l: 'Launcher' },
    { id: 'game', i: '⛏️', l: 'Epoch Miner' },
    { id: 'news', i: '📰', l: 'News' },
    { id: 'eco', i: '🔗', l: 'Ecosystem' },
];

const App: React.FC = () => {
    const [tab, setTab] = useState('home');
    const [wOn, setWOn] = useState(false);
    const [wAddr, setWAddr] = useState('');
    const [qOpen, setQOpen] = useState(false);

    const conn = async () => {
        try { const w = (window as any).opnet; if (w) { const a = await w.requestAccounts(); if (a?.length) { setWAddr(a[0]); setWOn(true); localStorage.setItem('hub_wallet', '1'); return; } } } catch { }
        const addr = 'bcrt1q' + Math.random().toString(36).slice(2, 12);
        setWAddr(addr); setWOn(true); localStorage.setItem('hub_wallet', '1');
    };

    const P = () => {
        switch (tab) {
            case 'home': return <Landing onNav={setTab} />;
            case 'dash': return <Dashboard />;
            case 'portfolio': return <Portfolio />;
            case 'bob': return <BobChat />;
            case 'tools': return <TokenTools />;
            case 'launch': return <TokenLauncher />;
            case 'game': return <SatoshiMiner />;
            case 'news': return <NewsFeed />;
            case 'eco': return <EcosystemDir />;
            default: return <Landing onNav={setTab} />;
        }
    };

    return (
        <>
            <div className="site-bg" />
            <div className="particles"><span /><span /><span /><span /><span /><span /><span /><span /></div>
            <header className="H"><div className="Hi">
                <div className="Lo" onClick={() => setTab('home')}><div className="Lm">⚡</div><span>OPNet Hub</span><span className="s">Consensus Layer</span></div>
                <div className="Hr">
                    <a className="Ha" href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer">Docs</a>
                    <a className="Ha" href="https://vibecode.finance" target="_blank" rel="noopener noreferrer">Vibecode</a>
                    <button className={`Wb ${wOn ? 'on' : ''}`} onClick={conn}>{wOn ? `✓ ${wAddr.slice(0, 8)}…` : 'Connect Wallet'}</button>
                </div>
            </div></header>
            <nav className="N"><div className="Ni">{TABS.map(t => <button key={t.id} className={`Nt ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}><span>{t.i}</span>{t.l}</button>)}</div></nav>
            <main className="M">{P()}</main>
            <footer className="F">⚡ <strong>OPNet Hub</strong> — Mission Control for Programmable Bitcoin · <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer">docs.opnet.org</a></footer>

            {/* Quest FAB */}
            <button className="q-fab" onClick={() => setQOpen(!qOpen)}>
                <span>🎯</span>
            </button>

            {/* Quest slide-out panel */}
            <QuestPanel open={qOpen} onClose={() => setQOpen(false)} onNav={setTab} />
        </>
    );
};
export default App;
