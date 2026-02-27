import React, { useState, useCallback, useEffect, Suspense, lazy } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import Landing from './components/Landing';
import QuestPanel from './components/Quests';

const BobChat = lazy(() => import('./components/BobChat'));
const NewsFeed = lazy(() => import('./components/NewsFeed'));
const TokenTools = lazy(() => import('./components/TokenTools'));
const SatoshiMiner = lazy(() => import('./components/SatoshiMiner'));
const EcosystemDir = lazy(() => import('./components/EcosystemDir'));
const Portfolio = lazy(() => import('./components/Portfolio'));
const TokenLauncher = lazy(() => import('./components/TokenLauncher'));
const SwapUI = lazy(() => import('./components/SwapUI'));
const TokenGallery = lazy(() => import('./components/TokenGallery'));

const LazyFallback = () => (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>
        <div style={{ fontSize: '1.4rem', marginBottom: 8 }}>⚡</div>
        <div style={{ fontSize: '.8rem' }}>Loading module…</div>
    </div>
);

const TABS = [
    { id: 'home', i: '🏠', l: 'Home' },
    { id: 'portfolio', i: '💼', l: 'Portfolio' },
    { id: 'bob', i: '🤖', l: 'Bob AI' },
    { id: 'tools', i: '🛠️', l: 'Tools' },
    { id: 'swap', i: '🔄', l: 'Swap' },
    { id: 'launch', i: '🚀', l: 'Launcher' },
    { id: 'gallery', i: '🪙', l: 'Gallery' },
    { id: 'game', i: '⛏️', l: 'Epoch Miner' },
    { id: 'news', i: '📰', l: 'News' },
    { id: 'eco', i: '🔗', l: 'Ecosystem' },
];

const App: React.FC = () => {
    const [tab, setTab] = useState('home');
    const [qOpen, setQOpen] = useState(false);

    const {
        openConnectModal,
        disconnect,
        walletAddress,
        connecting,
    } = useWalletConnect();

    // Сохраняем адрес в localStorage для SatoshiMiner
    useEffect(() => {
        if (walletAddress) {
            localStorage.setItem('hub_wallet', walletAddress);
        } else {
            localStorage.removeItem('hub_wallet');
        }
    }, [walletAddress]);

    const wAddr = walletAddress ?? '';
    const wOn = !!walletAddress;

    const handleWallet = useCallback(() => {
        if (wOn) {
            disconnect();
        } else {
            openConnectModal();
        }
    }, [wOn, disconnect, openConnectModal]);

    const navigate = useCallback((id: string) => {
        setTab(id);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const P = () => {
        switch (tab) {
            case 'home': return <Landing onNav={navigate} />;
            case 'portfolio': return <Portfolio walletAddress={wAddr} />;
            case 'bob': return <BobChat />;
            case 'tools': return <TokenTools />;
            case 'swap': return <SwapUI />;
            case 'launch': return <TokenLauncher />;
            case 'gallery': return <TokenGallery />;
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
                        <button className={`Wb ${wOn ? 'on' : ''}`} onClick={handleWallet} disabled={connecting}>
                            {connecting ? '⏳ Подключение…' : wOn ? `✓ ${wAddr.slice(0, 8)}…` : 'Connect Wallet'}
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

            <main className="M" key={tab}><Suspense fallback={<LazyFallback />}>{P()}</Suspense></main>

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
