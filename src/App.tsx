import React, { useState, useCallback, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import logoUrl from './assets/logo.png';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { networks } from '@btc-vision/bitcoin';
import { JSONRpcProvider, getContract, OP_20_ABI, type IOP20Contract } from 'opnet';
import Landing from './components/Landing';
import QuestPanel from './components/Quests';
// txHistory used in Portfolio, not here
import { TESTNET_CONTRACTS } from './contracts';

const BobChat = lazy(() => import('./components/BobChat'));
const NewsFeed = lazy(() => import('./components/NewsFeed'));
const TokenTools = lazy(() => import('./components/TokenTools'));
const SatoshiMiner = lazy(() => import('./components/SatoshiMiner'));
const EcosystemDir = lazy(() => import('./components/EcosystemDir'));
const Portfolio = lazy(() => import('./components/Portfolio'));
const TokenLauncher = lazy(() => import('./components/TokenLauncher'));
const Launchpad = lazy(() => import('./components/Launchpad'));
const SwapUI = lazy(() => import('./components/SwapUI'));
const TokenGallery = lazy(() => import('./components/TokenGallery'));
const Analytics = lazy(() => import('./components/Analytics'));
const Staking = lazy(() => import('./components/Staking'));
const Marketplace = lazy(() => import('./components/Marketplace'));

const LazyFallback = () => (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>
        <div style={{ fontSize: '1.4rem', marginBottom: 8 }}>⚡</div>
        <div style={{ fontSize: '.8rem' }}>Loading module…</div>
    </div>
);

const TABS = [
    { id: 'home', l: 'Home' },
    { id: 'swap', l: 'Swap' },
    { id: 'staking', l: 'Stake' },
    { id: 'analytics', l: 'Analytics' },
    { id: 'gallery', l: 'Tokens' },
    { id: 'launch', l: 'Launch' },
    { id: 'market', l: 'Market' },
    { id: 'bob', l: 'Bob AI' },
    { id: 'tools', l: 'Tools' },
    { id: 'game', l: 'Miner' },
    { id: 'news', l: 'News' },
    { id: 'eco', l: 'Ecosystem' },
];

const App: React.FC = () => {
    const [tab, setTab] = useState('home');
    const [qOpen, setQOpen] = useState(false);

    const {
        openConnectModal,
        disconnect,
        walletAddress,
        connecting,
        address: senderAddr,
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
    const [wDrop, setWDrop] = useState(false);
    const [balances, setBalances] = useState<Record<string, string>>({});
    const dropRef = useRef<HTMLDivElement>(null);
    const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
    const sdkProvider = useMemo(() => new JSONRpcProvider('https://testnet.opnet.org/api/v1/json-rpc', networks.testnet), []);

    const openDrop = useCallback(() => { clearTimeout(hoverTimer.current); setWDrop(true); }, []);
    const closeDrop = useCallback(() => { hoverTimer.current = setTimeout(() => setWDrop(false), 300); }, []);

    // Fetch balances when dropdown opens — use opnet SDK for accurate results
    useEffect(() => {
        if (!wDrop || !wAddr || !senderAddr) return;
        let cancelled = false;
        Object.entries(TESTNET_CONTRACTS).forEach(([sym, tok]) => {
            (async () => {
                try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const op20 = getContract<IOP20Contract>(tok.address, OP_20_ABI, sdkProvider, networks.testnet, senderAddr as any);
                    const sim = await op20.balanceOf(senderAddr as any);
                    const bal = sim?.properties?.balance ?? 0n;
                    const human = (Number(BigInt(bal.toString())) / Math.pow(10, tok.decimals)).toLocaleString(undefined, { maximumFractionDigits: 2 });
                    if (!cancelled) setBalances(prev => ({ ...prev, [sym]: human }));
                } catch { /* ignore */ }
            })();
        });
        return () => { cancelled = true; };
    }, [wDrop, wAddr, senderAddr, sdkProvider]);

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
            case 'portfolio': return <Portfolio walletAddress={wAddr} senderAddress={senderAddr} />;
            case 'bob': return <BobChat />;
            case 'tools': return <TokenTools />;
            case 'swap': return <SwapUI />;
            case 'staking': return <Staking />;
            case 'analytics': return <Analytics />;
            case 'launch': return <Launchpad />;
            case 'market': return <Marketplace />;
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
                        <img src={logoUrl} alt="OPNet Hub" style={{ height: 32, objectFit: 'contain' }} />
                    </div>
                    <div className="Hr">
                        <div ref={dropRef} style={{ position: 'relative' }}
                            onMouseEnter={wOn ? openDrop : undefined}
                            onMouseLeave={wOn ? closeDrop : undefined}
                        >
                            <button className={`Wb ${wOn ? 'on' : ''}`}
                                onClick={wOn ? () => setWDrop(v => !v) : handleWallet}
                                disabled={connecting}
                            >
                                {connecting ? 'Connecting…' : wOn ? `${wAddr.slice(0, 6)}…${wAddr.slice(-4)}` : 'Connect'}
                            </button>
                            {wDrop && wOn && (
                                <div style={{
                                    position: 'absolute', top: 'calc(100% + 8px)', right: 0, width: 260, zIndex: 999,
                                    background: 'rgba(10,10,18,.96)', border: '1px solid rgba(255,255,255,.06)',
                                    borderRadius: 16, boxShadow: '0 16px 48px rgba(0,0,0,.6)',
                                    backdropFilter: 'blur(24px)', padding: '14px 16px',
                                }}>
                                    <div style={{ fontSize: '.55rem', color: '#2d3548', fontFamily: "'JetBrains Mono', monospace", marginBottom: 10, wordBreak: 'break-all' }}>{wAddr}</div>
                                    {Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => (
                                        <div key={sym} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '.72rem', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                                            <span style={{ color: '#7a8494' }}>{tok.icon} {sym}</span>
                                            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#fff', fontWeight: 600 }}>{balances[sym] ?? '…'}</span>
                                        </div>
                                    ))}
                                    <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                                        <button onClick={() => { navigate('portfolio'); setWDrop(false); }}
                                            style={{ flex: 1, padding: '8px', borderRadius: 10, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, #F7931A, #ffab40)', color: '#000', fontWeight: 700, fontSize: '.68rem', fontFamily: "'Inter', sans-serif" }}>
                                            Portfolio
                                        </button>
                                        <button onClick={() => { disconnect(); setWDrop(false); }}
                                            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid rgba(239,68,68,.15)', background: 'rgba(239,68,68,.04)', cursor: 'pointer', color: '#ef4444', fontSize: '.68rem', fontFamily: "'Inter', sans-serif", fontWeight: 600 }}>
                                            Exit
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <nav className="N">
                <div className="Ni">
                    {TABS.map(t => (
                        <button key={t.id} className={`Nt ${tab === t.id ? 'on' : ''}`} onClick={() => navigate(t.id)}>
                            {t.l}
                        </button>
                    ))}
                </div>
            </nav>

            <main className="M" key={tab}><Suspense fallback={<LazyFallback />}>{P()}</Suspense></main>

            <footer style={{
                marginTop: 'auto', padding: '16px 16px', textAlign: 'center',
                borderTop: '1px solid rgba(255,255,255,.03)', color: '#2d3548',
                fontSize: '.65rem', background: 'rgba(6,6,11,.8)',
            }}>
                <div style={{ display: 'flex', justifyContent: 'center', gap: 18, flexWrap: 'wrap', marginBottom: 8 }}>
                    {[
                        ['Docs', 'https://docs.opnet.org'],
                        ['OPScan', 'https://opscan.org'],
                        ['GitHub', 'https://github.com/YourOpHub/opnet-hub'],
                    ].map(([l, u]) => (
                        <a key={l} href={u} target="_blank" rel="noopener noreferrer"
                            style={{ color: '#4a5568', textDecoration: 'none', fontWeight: 500, transition: 'color .2s', fontSize: '.65rem' }}
                            onMouseEnter={e => (e.currentTarget.style.color = '#F7931A')}
                            onMouseLeave={e => (e.currentTarget.style.color = '#4a5568')}
                        >{l}</a>
                    ))}
                </div>
                <div style={{ color: '#1e2432' }}>OPNet Hub · Bitcoin L1 DeFi</div>
            </footer>

            <button className="q-fab" onClick={() => setQOpen(!qOpen)}>
                <span>🎯</span>
            </button>

            <QuestPanel open={qOpen} onClose={() => setQOpen(false)} onNav={navigate} />
        </>
    );
};
export default App;
