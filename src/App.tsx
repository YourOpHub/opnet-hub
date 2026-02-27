import React, { useState, useCallback, useEffect, useRef, useMemo, Suspense, lazy } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { networks } from '@btc-vision/bitcoin';
import { JSONRpcProvider, getContract, OP_20_ABI, type IOP20Contract } from 'opnet';
import Landing from './components/Landing';
import QuestPanel from './components/Quests';
import { getTxHistory, formatTimeAgo } from './txHistory';
import { TESTNET_CONTRACTS } from './contracts';

const BobChat = lazy(() => import('./components/BobChat'));
const NewsFeed = lazy(() => import('./components/NewsFeed'));
const TokenTools = lazy(() => import('./components/TokenTools'));
const SatoshiMiner = lazy(() => import('./components/SatoshiMiner'));
const EcosystemDir = lazy(() => import('./components/EcosystemDir'));
const Portfolio = lazy(() => import('./components/Portfolio'));
const TokenLauncher = lazy(() => import('./components/TokenLauncher'));
const SwapUI = lazy(() => import('./components/SwapUI'));
const TokenGallery = lazy(() => import('./components/TokenGallery'));
const Analytics = lazy(() => import('./components/Analytics'));
const Staking = lazy(() => import('./components/Staking'));

const LazyFallback = () => (
    <div style={{ padding: 40, textAlign: 'center', color: 'var(--t3)' }}>
        <div style={{ fontSize: '1.4rem', marginBottom: 8 }}>⚡</div>
        <div style={{ fontSize: '.8rem' }}>Loading module…</div>
    </div>
);

const TABS = [
    { id: 'home', i: '🏠', l: 'Home' },
    { id: 'swap', i: '🔄', l: 'Swap' },
    { id: 'staking', i: '🏦', l: 'Staking' },
    { id: 'analytics', i: '�', l: 'Analytics' },
    { id: 'gallery', i: '🪙', l: 'Tokens' },
    { id: 'launch', i: '🚀', l: 'Launcher' },
    { id: 'bob', i: '🤖', l: 'Bob AI' },
    { id: 'tools', i: '🛠️', l: 'Tools' },
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
                        <div ref={dropRef} style={{ position: 'relative' }}
                            onMouseEnter={wOn ? openDrop : undefined}
                            onMouseLeave={wOn ? closeDrop : undefined}
                        >
                            <button className={`Wb ${wOn ? 'on' : ''}`}
                                onClick={wOn ? () => setWDrop(v => !v) : handleWallet}
                                disabled={connecting}
                            >
                                {connecting ? '⏳ Connecting…' : wOn ? `✓ ${wAddr.slice(0, 8)}…` : 'Connect Wallet'}
                            </button>
                            {wDrop && wOn && (
                                <div style={{
                                    position: 'absolute', top: '110%', right: 0, width: 280, zIndex: 999,
                                    background: 'var(--bg2)', border: '1px solid var(--bd)', borderRadius: 12,
                                    boxShadow: '0 12px 40px rgba(0,0,0,.5)', padding: 14,
                                }}>
                                    <div style={{ fontSize: '.62rem', color: 'var(--t4)', fontFamily: 'var(--fm)', marginBottom: 10, wordBreak: 'break-all' }}>{wAddr}</div>
                                    <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>Balances</div>
                                    {Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => (
                                        <div key={sym} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '.72rem' }}>
                                            <span>{tok.icon} {sym}</span>
                                            <span style={{ fontFamily: 'var(--fm)', color: 'var(--w)' }}>{balances[sym] ?? '…'}</span>
                                        </div>
                                    ))}
                                    <div style={{ borderTop: '1px solid var(--bd)', margin: '10px 0 8px' }} />
                                    <div style={{ fontSize: '.68rem', fontWeight: 700, color: 'var(--t2)', marginBottom: 6 }}>Recent Activity</div>
                                    {getTxHistory(wAddr).slice(0, 5).map(tx => (
                                        <div key={tx.id} style={{ fontSize: '.62rem', color: 'var(--t3)', padding: '3px 0', display: 'flex', justifyContent: 'space-between' }}>
                                            <span>{tx.type === 'swap' ? '🔄' : tx.type === 'mint' ? '🪙' : '🎁'} {tx.type === 'swap' ? `${tx.amountA} ${tx.tokenA}→${tx.tokenB}` : `${tx.type} ${Number(tx.amountA||0).toLocaleString()} ${tx.tokenA}`}</span>
                                            <span style={{ color: 'var(--t4)' }}>{formatTimeAgo(tx.ts)}</span>
                                        </div>
                                    ))}
                                    {getTxHistory(wAddr).length === 0 && <div style={{ fontSize: '.62rem', color: 'var(--t4)' }}>No activity yet</div>}
                                    <div style={{ borderTop: '1px solid var(--bd)', margin: '8px 0' }} />
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        <button onClick={() => { navigate('portfolio'); setWDrop(false); }}
                                            style={{ flex: 1, padding: '8px', borderRadius: 8, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg, var(--o), var(--o2))', color: '#000', fontWeight: 700, fontSize: '.7rem', fontFamily: 'var(--ff)' }}>
                                            💼 Portfolio
                                        </button>
                                        <button onClick={() => { disconnect(); setWDrop(false); }}
                                            style={{ padding: '8px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,.3)', background: 'transparent', cursor: 'pointer', color: '#ef4444', fontSize: '.7rem', fontFamily: 'var(--ff)' }}>
                                            Disconnect
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
