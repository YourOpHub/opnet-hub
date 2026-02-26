import React, { useState, useCallback } from 'react';
import Landing from './components/Landing';
import Dashboard from './components/Dashboard';
import BobChat from './components/BobChat';
import NewsFeed from './components/NewsFeed';
import TokenTools from './components/TokenTools';
import SatoshiMiner from './components/SatoshiMiner';
import EcosystemDir from './components/EcosystemDir';
import Portfolio from './components/Portfolio';
import TokenLauncher from './components/TokenLauncher';
import SwapUI from './components/SwapUI';
import QuestPanel from './components/Quests';

const TABS = [
    { id: 'home', i: '🏠', l: 'Home' },
    { id: 'dash', i: '📊', l: 'Dashboard' },
    { id: 'portfolio', i: '💼', l: 'Portfolio' },
    { id: 'bob', i: '🤖', l: 'Bob AI' },
    { id: 'tools', i: '🛠️', l: 'Tools' },
    { id: 'swap', i: '🔄', l: 'Swap' },
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

    const conn = useCallback(async () => {
        // Try OP_WALLET extension first
        try {
            const w = (window as unknown as { opnet?: { requestAccounts: () => Promise<string[]> }; unisat?: { requestAccounts: () => Promise<string[]> } }).opnet || (window as unknown as { unisat?: { requestAccounts: () => Promise<string[]> } }).unisat;
            if (w) {
                const a = await w.requestAccounts();
                if (a?.length) { setWAddr(a[0]); setWOn(true); localStorage.setItem('hub_wallet', '1'); return; }
            }
        } catch { /* extension not available or user rejected */ }
        // Fallback: demo mode with simulated address
        const addr = 'opt1p' + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12);
        setWAddr(addr); setWOn(true); localStorage.setItem('hub_wallet', '1');
    }, []);

    const navigate = useCallback((id: string) => {
        setTab(id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const P = () => {
        switch (tab) {
            case 'home': return <Landing onNav={navigate} />;
            case 'dash': return <Dashboard />;
            case 'portfolio': return <Portfolio walletAddress={wAddr} />;
            case 'bob': return <BobChat />;
            case 'tools': return <TokenTools />;
            case 'swap': return <SwapUI walletAddress={wAddr} />;
            case 'launch': return <TokenLauncher />;
            case 'game': return <SatoshiMiner />;
            case 'news': return <NewsFeed />;
            case 'eco': return <EcosystemDir />;
            default: return <Landing onNav={navigate} />;
        }
    };

    return (
        <>
            <div className="site-bg" />
            <div className="particles"><span /><span /><span /><span /><span /><span /><span /><span /></div>

            <header className="H">
                <div className="Hi">
                    <div className="Lo" onClick={() => navigate('home')}>
                        <div className="Lm">⚡</div>
                        <span>OPNet Hub</span>
                        <span className="s">Consensus Layer</span>
                    </div>
                    <div className="Hr">
                        <a className="Ha" href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer">Docs</a>
                        <a className="Ha" href="https://vibecode.finance" target="_blank" rel="noopener noreferrer">Vibecode</a>
                        <button className={`Wb ${wOn ? 'on' : ''}`} onClick={conn}>
                            {wOn ? `✓ ${wAddr.slice(0, 8)}…` : 'Connect Wallet'}
                        </button>
                    </div>
                </div>
            </header>

            <nav className="N">
                <div className="Ni">
                    {TABS.map(t => (
                        <button key={t.id} className={`Nt ${tab === t.id ? 'on' : ''}`} onClick={() => navigate(t.id)}>
                            <span>{t.i}</span>{t.l}
                        </button>
                    ))}
                </div>
            </nav>

            <main className="M" key={tab}>{P()}</main>

            <footer className="F">
                <div style={{ display: 'flex', justifyContent: 'center', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                    <a href="https://docs.opnet.org" target="_blank" rel="noopener noreferrer">Docs</a>
                    <a href="https://ai.opnet.org" target="_blank" rel="noopener noreferrer">Bob AI</a>
                    <a href="https://opscan.org" target="_blank" rel="noopener noreferrer">OPScan</a>
                    <a href="https://motoswap.org" target="_blank" rel="noopener noreferrer">Motoswap</a>
                    <a href="https://vibecode.finance" target="_blank" rel="noopener noreferrer">Vibecode</a>
                    <a href="https://github.com/YourOpHub/opnet-hub" target="_blank" rel="noopener noreferrer">GitHub</a>
                </div>
                <strong>OPNet Hub</strong> — Mission Control for Programmable Bitcoin · Built for the <a href="https://vibecode.finance/challenge" target="_blank" rel="noopener noreferrer">#opnetvibecode</a> Challenge
            </footer>

            <button className="q-fab" onClick={() => setQOpen(!qOpen)}>
                <span>🎯</span>
            </button>

            <QuestPanel open={qOpen} onClose={() => setQOpen(false)} onNav={navigate} />
        </>
    );
};
export default App;
