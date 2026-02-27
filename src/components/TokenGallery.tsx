import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import type { Address } from '@btc-vision/transaction';
import { networks } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, ABIDataTypes, BitcoinAbiTypes,
  type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import * as opnet from '../opnet';
import { TESTNET_CONTRACTS, getContractOpscanUrl, getTxUrl } from '../contracts';
import { addTxRecord, getTxHistory, formatTimeAgo, type TxRecord } from '../txHistory';

const NETWORK = networks.testnet;
const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';

/** ABI for MintableToken publicMint method */
const MINTABLE_ABI: BitcoinInterfaceAbi = [
  {
    name: 'publicMint',
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [],
    type: BitcoinAbiTypes.Function,
  },
];

const FAUCET = 'https://faucet.opnet.org';

/** Fetch network gas parameters and build proper tx params */
async function buildTxParams(provider: JSONRpcProvider, refundTo: string) {
  const gas = await provider.gasParameters();
  const feeRate = gas.bitcoin.recommended.medium || gas.bitcoin.conservative || 10;
  const gasPerSat = gas.gasPerSat > 0n ? gas.gasPerSat : 1n;
  const priorityFeeSats = gas.baseGas / gasPerSat;
  const priorityFee = priorityFeeSats < 1000n ? 1000n : priorityFeeSats > 50000n ? 50000n : priorityFeeSats;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    signer: null,
    mldsaSigner: null,
    refundTo,
    maximumAllowedSatToSpend: 100_000n,
    network: NETWORK,
    feeRate,
    priorityFee,
  } as any;
}

interface DeployedToken {
  address: string;
  txid: string;
  name: string;
  symbol: string;
  supply: string;
  decimals: number;
  mode: 'standard' | 'mintable';
  publicMint: boolean;
  maxMintPerTx: string;
  initialMintPct: number;
  deployedAt: number;
  deployer: string;
}


const genLogo = (sym: string): string => {
  const s = (sym || '?').toUpperCase().slice(0, 3);
  const cs = [['#F7931A', '#e8850f'], ['#0ea5e9', '#0284c7'], ['#a78bfa', '#7c3aed'], ['#22c55e', '#16a34a'], ['#ec4899', '#db2777'], ['#eab308', '#ca8a04']];
  const [c1, c2] = cs[s.charCodeAt(0) % cs.length];
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg"><circle cx="32" cy="32" r="30" fill="url(#g${s})"/><circle cx="32" cy="32" r="21" fill="rgba(0,0,0,.2)"/><text x="32" y="38" text-anchor="middle" font-family="Inter,sans-serif" font-weight="800" font-size="${s.length > 2 ? 12 : 16}" fill="white">${s}</text><defs><linearGradient id="g${s}" x1="0" y1="0" x2="64" y2="64"><stop stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs></svg>`;
};

const TokenGallery: React.FC = () => {
  const { walletAddress, walletInstance, address: senderAddr, openConnectModal } = useWalletConnect();
  const [tokens, setTokens] = useState<DeployedToken[]>([]);
  const [chainInfo, setChainInfo] = useState<Record<string, { totalSupply: bigint; confirmed: boolean }>>({});
  const [mintAddr, setMintAddr] = useState<string | null>(null);
  const [mintAmount, setMintAmount] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintResult, setMintResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [tab, setTab] = useState<'user' | 'featured'>('featured');
  const [featMintSym, setFeatMintSym] = useState<string | null>(null);
  const [featMintAmt, setFeatMintAmt] = useState('');
  const [featMinting, setFeatMinting] = useState(false);
  const [featMintResult, setFeatMintResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [mintHistory, setMintHistory] = useState<TxRecord[]>([]);
  const [histRefresh, setHistRefresh] = useState(0);

  useEffect(() => {
    if (walletAddress) setMintHistory(getTxHistory(walletAddress).filter(r => r.type === 'mint'));
  }, [walletAddress, histRefresh]);

  // Load user-deployed tokens from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem('hub_deployed_tokens');
      if (raw) setTokens(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  // Check on-chain status for user tokens
  useEffect(() => {
    if (tokens.length === 0) return;
    opnet.setNetwork('testnet');
    tokens.forEach(t => {
      if (!t.address) return;
      opnet.getTokenTotalSupply(t.address).then(supply => {
        setChainInfo(prev => ({ ...prev, [t.address]: { totalSupply: supply, confirmed: supply > 0n } }));
      }).catch(() => {});
    });
  }, [tokens]);

  // Featured tokens (our pre-deployed MINE and VIBE)
  const featured = Object.entries(TESTNET_CONTRACTS).map(([sym, tok]) => ({
    address: tok.address,
    symbol: tok.symbol,
    name: tok.name,
    icon: tok.icon,
    supply: tok.supply.toLocaleString(),
    decimals: tok.decimals,
    deployTxid: tok.deployTxid,
    description: tok.description,
    publicMint: tok.publicMint,
    maxMintPerTx: tok.maxMintPerTx,
  }));

  const provider = useMemo(() => new JSONRpcProvider(RPC_URL, NETWORK), []);

  const doFeaturedMint = useCallback(async (tok: typeof featured[0]) => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    const amt = parseFloat(featMintAmt);
    if (!amt || amt <= 0) { setFeatMintResult({ ok: false, msg: 'Enter a valid amount' }); return; }
    if (!senderAddr) { setFeatMintResult({ ok: false, msg: 'Wallet not available. Reconnect.' }); return; }
    setFeatMinting(true); setFeatMintResult(null);
    try {
      const rawAmount = BigInt(Math.floor(amt * Math.pow(10, tok.decimals)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract = getContract<any>(tok.address, MINTABLE_ABI, provider, NETWORK, senderAddr as any);
      const sim = await contract.publicMint(rawAmount);
      if ((sim as CallResult).revert) throw new Error(`Mint reverted: ${(sim as CallResult).revert}`);
      const txParams = await buildTxParams(provider, walletAddress!);
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      const txHash = receipt.transactionId || '';
      setFeatMintResult({ ok: true, msg: `Minted ${amt.toLocaleString()} ${tok.symbol}! TX: ${txHash}` });
      addTxRecord({ type: 'mint', txHash, tokenA: tok.symbol, amountA: amt.toString(), status: 'confirmed', wallet: walletAddress! });
      setHistRefresh(k => k + 1);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Mint failed';
      if (msg.toLowerCase().includes('no utxo')) msg = `No BTC UTXOs. Get testnet BTC: ${FAUCET}`;
      setFeatMintResult({ ok: false, msg });
    } finally { setFeatMinting(false); }
  }, [walletAddress, walletInstance, featMintAmt, openConnectModal, provider, senderAddr]);

  const removeToken = (addr: string) => {
    const updated = tokens.filter(t => t.address !== addr);
    setTokens(updated);
    localStorage.setItem('hub_deployed_tokens', JSON.stringify(updated));
  };

  const doMint = useCallback(async (token: DeployedToken) => {
    if (!walletAddress || !walletInstance) {
      openConnectModal();
      return;
    }

    const amt = parseFloat(mintAmount);
    if (!amt || amt <= 0) {
      setMintResult({ ok: false, msg: 'Enter a valid amount' });
      return;
    }

    if (!senderAddr) {
      setMintResult({ ok: false, msg: 'Wallet public key not available. Reconnect wallet.' });
      return;
    }

    setMinting(true);
    setMintResult(null);

    try {
      const rawAmount = BigInt(Math.floor(amt * Math.pow(10, token.decimals)));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract = getContract<any>(
        token.address, MINTABLE_ABI, provider, NETWORK, senderAddr as any,
      );
      const sim = await contract.publicMint(rawAmount);

      if ((sim as CallResult).revert) {
        throw new Error(`Mint simulation reverted: ${(sim as CallResult).revert}`);
      }

      const txParams = await buildTxParams(provider, walletAddress!);
      const receipt = await (sim as CallResult).sendTransaction(txParams);

      const txHash = receipt.transactionId || '';
      setMintResult({ ok: true, msg: `Minted ${amt.toLocaleString()} ${token.symbol}! TX: ${txHash}` });
      addTxRecord({ type: 'mint', txHash, tokenA: token.symbol, amountA: amt.toString(), status: 'confirmed', wallet: walletAddress! });
      setHistRefresh(k => k + 1);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Mint failed';
      if (msg.toLowerCase().includes('no utxo')) {
        msg = `No BTC UTXOs. Get testnet BTC: ${FAUCET}`;
      }
      setMintResult({ ok: false, msg });
    } finally {
      setMinting(false);
    }
  }, [walletAddress, walletInstance, mintAmount, openConnectModal, provider, senderAddr]);

  const connected = !!walletAddress;
  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 'var(--rad)',
    background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
    fontSize: '.82rem', fontFamily: 'var(--ff)', outline: 'none',
  };

  return (
    <div>
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '24px 18px' }}>
        <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--w)', marginBottom: 3 }}>Token Gallery</div>
        <div style={{ color: 'var(--t3)', fontSize: '.8rem', maxWidth: 480, margin: '0 auto' }}>
          Browse tokens on OPNet testnet. Mint public tokens directly from your wallet.
        </div>
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {([['featured', 'Featured Tokens'], ['user', `My Tokens (${tokens.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            flex: 1, padding: '10px', borderRadius: 'var(--rad)',
            background: tab === id ? 'var(--oG)' : 'var(--bg3)',
            border: `1px solid ${tab === id ? 'rgba(247,147,26,.3)' : 'var(--bd)'}`,
            color: tab === id ? 'var(--o)' : 'var(--t2)',
            fontSize: '.78rem', fontWeight: 700, cursor: 'pointer', fontFamily: 'var(--ff)',
          }}>{label}</button>
        ))}
      </div>

      {/* Featured tokens */}
      {tab === 'featured' && (
        <div style={{ display: 'grid', gap: 10 }}>
          {featured.map(tok => (
            <div key={tok.symbol} className="P" style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: '1.8rem' }}>{tok.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontWeight: 800, fontSize: '.95rem', color: 'var(--w)' }}>{tok.name}</span>
                    <span style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600, fontSize: '.78rem' }}>${tok.symbol}</span>
                    <span style={{ fontSize: '.48rem', background: 'var(--gG)', color: 'var(--g)', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>ON-CHAIN</span>
                  </div>
                  <div style={{ fontSize: '.68rem', color: 'var(--t3)', marginTop: 2 }}>{tok.description}</div>
                  <div style={{ fontSize: '.62rem', color: 'var(--t4)', marginTop: 4 }}>
                    Supply: {tok.supply} · Decimals: {tok.decimals}
                  </div>
                  <div style={{ fontFamily: 'var(--fm)', fontSize: '.52rem', color: 'var(--t4)', marginTop: 2, wordBreak: 'break-all' }}>{tok.address}</div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                  <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                    className="btn-s" style={{ textDecoration: 'none', fontSize: '.62rem', padding: '6px 10px', textAlign: 'center' }}>OPScan</a>
                  <a href={getTxUrl(tok.deployTxid)} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: '.56rem', color: 'var(--c2)', textAlign: 'center' }}>Deploy TX</a>
                  {tok.publicMint && (
                    <button onClick={() => setFeatMintSym(featMintSym === tok.symbol ? null : tok.symbol)} style={{
                      padding: '5px 8px', borderRadius: 'var(--rad)', fontSize: '.58rem', fontWeight: 700,
                      background: featMintSym === tok.symbol ? 'rgba(168,85,247,.15)' : 'rgba(168,85,247,.08)',
                      border: '1px solid rgba(168,85,247,.2)', color: '#a855f7', cursor: 'pointer', fontFamily: 'var(--ff)',
                    }}>{featMintSym === tok.symbol ? 'Close' : 'Mint'}</button>
                  )}
                </div>
              </div>
              {/* Featured mint panel */}
              {featMintSym === tok.symbol && tok.publicMint && (
                <div style={{ marginTop: 12, padding: 12, background: 'rgba(168,85,247,.05)', border: '1px solid rgba(168,85,247,.15)', borderRadius: 'var(--rad)' }}>
                  <div style={{ fontSize: '.7rem', fontWeight: 700, color: '#a855f7', marginBottom: 6 }}>Public Mint — ${tok.symbol}</div>
                  <div style={{ fontSize: '.58rem', color: 'var(--t3)', marginBottom: 6 }}>Max per tx: {tok.maxMintPerTx.toLocaleString()}</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                    <input style={{ ...inputStyle, flex: 1 }} type="text" inputMode="decimal"
                      value={featMintAmt} onChange={e => setFeatMintAmt(e.target.value)}
                      placeholder={`Amount of ${tok.symbol}`} />
                    {connected ? (
                      <button onClick={() => doFeaturedMint(tok)} disabled={featMinting} style={{
                        padding: '8px 16px', borderRadius: 'var(--rad)', fontWeight: 700, fontSize: '.75rem',
                        background: 'linear-gradient(135deg, #a855f7, #7c3aed)', border: 'none',
                        color: 'white', cursor: featMinting ? 'not-allowed' : 'pointer', fontFamily: 'var(--ff)',
                        opacity: featMinting ? 0.6 : 1, whiteSpace: 'nowrap',
                      }}>{featMinting ? 'Minting...' : 'Mint'}</button>
                    ) : (
                      <button onClick={openConnectModal} style={{
                        padding: '8px 16px', borderRadius: 'var(--rad)', fontWeight: 700, fontSize: '.72rem',
                        background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none',
                        color: 'white', cursor: 'pointer', fontFamily: 'var(--ff)', whiteSpace: 'nowrap',
                      }}>Connect</button>
                    )}
                  </div>
                  {featMintResult && (
                    <div style={{ padding: '8px 10px', borderRadius: 6, fontSize: '.68rem',
                      background: featMintResult.ok ? 'var(--gG)' : 'rgba(239,68,68,.06)',
                      border: `1px solid ${featMintResult.ok ? 'var(--gB)' : 'rgba(239,68,68,.2)'}`,
                      color: featMintResult.ok ? 'var(--g)' : '#ef4444', wordBreak: 'break-all',
                    }}>{featMintResult.msg}</div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Pool card */}
          <div className="P" style={{ padding: 16, border: '1px solid rgba(168,85,247,.15)', background: 'rgba(168,85,247,.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '1.6rem' }}>🔄</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 800, fontSize: '.9rem', color: 'var(--w)' }}>MINE/VIBE Liquidity Pool</div>
                <div style={{ fontSize: '.65rem', color: 'var(--t3)', marginTop: 2 }}>SimplePool AMM · 0.3% fee · 5M MINE / 25M VIBE</div>
                <div style={{ fontFamily: 'var(--fm)', fontSize: '.52rem', color: 'var(--t4)', marginTop: 2, wordBreak: 'break-all' }}>
                  {TESTNET_CONTRACTS.MINE.address ? 'opt1sqq9f2hgrvpmls9yl9nqmmpmgjlt9pep50smqj2u9' : 'Deploying...'}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* User-deployed tokens */}
      {tab === 'user' && (
        <div>
          {tokens.length === 0 ? (
            <div className="P" style={{ padding: 30, textAlign: 'center' }}>
              <div style={{ fontSize: '2rem', marginBottom: 8 }}>🪙</div>
              <div style={{ fontWeight: 700, color: 'var(--t2)', marginBottom: 4 }}>No tokens deployed yet</div>
              <div style={{ fontSize: '.75rem', color: 'var(--t3)' }}>
                Deploy your first token from the <strong>Launcher</strong> tab. It will appear here automatically.
              </div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {tokens.map((tok, idx) => {
                const info = chainInfo[tok.address];
                const isConfirmed = info?.confirmed;
                const isMintOpen = mintAddr === tok.address;

                return (
                  <div key={tok.address || idx} className="P" style={{ padding: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                      <div style={{ width: 48, height: 48, borderRadius: '50%', overflow: 'hidden', flexShrink: 0, border: '2px solid var(--bd2)' }}
                        dangerouslySetInnerHTML={{ __html: genLogo(tok.symbol) }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 800, fontSize: '.9rem', color: 'var(--w)' }}>{tok.name}</span>
                          <span style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600, fontSize: '.78rem' }}>${tok.symbol}</span>
                          {isConfirmed && <span style={{ fontSize: '.48rem', background: 'var(--gG)', color: 'var(--g)', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>ON-CHAIN</span>}
                          {!isConfirmed && tok.address && <span style={{ fontSize: '.48rem', background: 'rgba(234,179,8,.1)', color: 'var(--y)', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>PENDING</span>}
                          {tok.mode === 'mintable' && <span style={{ fontSize: '.48rem', background: 'rgba(168,85,247,.1)', color: '#a855f7', padding: '2px 6px', borderRadius: 3, fontWeight: 700 }}>MINTABLE</span>}
                        </div>
                        <div style={{ fontSize: '.64rem', color: 'var(--t3)', marginTop: 3 }}>
                          Supply: {Number(tok.supply).toLocaleString()} · Decimals: {tok.decimals}
                          {tok.mode === 'mintable' && ` · Initial: ${tok.initialMintPct}% to deployer`}
                        </div>
                        {info?.totalSupply != null && info.totalSupply > 0n && (
                          <div style={{ fontSize: '.6rem', color: 'var(--g)', marginTop: 2 }}>
                            On-chain supply: {(Number(info.totalSupply) / Math.pow(10, tok.decimals)).toLocaleString()}
                          </div>
                        )}
                        {tok.address && (
                          <div style={{ fontFamily: 'var(--fm)', fontSize: '.5rem', color: 'var(--t4)', marginTop: 3, wordBreak: 'break-all' }}>{tok.address}</div>
                        )}
                        <div style={{ fontSize: '.52rem', color: 'var(--t4)', marginTop: 2 }}>
                          Deployed: {new Date(tok.deployedAt).toLocaleString()}
                        </div>
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flexShrink: 0 }}>
                        {tok.address && (
                          <a href={getContractOpscanUrl(tok.address)} target="_blank" rel="noopener noreferrer"
                            className="btn-s" style={{ textDecoration: 'none', fontSize: '.58rem', padding: '5px 8px', textAlign: 'center' }}>OPScan</a>
                        )}
                        {tok.txid && (
                          <a href={getTxUrl(tok.txid)} target="_blank" rel="noopener noreferrer"
                            style={{ fontSize: '.54rem', color: 'var(--c2)', textAlign: 'center' }}>TX</a>
                        )}
                        {tok.publicMint && (
                          <button onClick={() => setMintAddr(isMintOpen ? null : tok.address)} style={{
                            padding: '5px 8px', borderRadius: 'var(--rad)', fontSize: '.58rem', fontWeight: 700,
                            background: isMintOpen ? 'rgba(168,85,247,.15)' : 'rgba(168,85,247,.08)',
                            border: '1px solid rgba(168,85,247,.2)', color: '#a855f7', cursor: 'pointer', fontFamily: 'var(--ff)',
                          }}>{isMintOpen ? 'Close' : 'Mint'}</button>
                        )}
                        <button onClick={() => removeToken(tok.address)} style={{
                          padding: '3px 6px', borderRadius: 4, fontSize: '.48rem', fontWeight: 600,
                          background: 'none', border: '1px solid rgba(239,68,68,.2)', color: '#ef4444',
                          cursor: 'pointer', fontFamily: 'var(--ff)',
                        }}>Remove</button>
                      </div>
                    </div>

                    {/* Mint panel */}
                    {isMintOpen && tok.publicMint && (
                      <div style={{ marginTop: 12, padding: 12, background: 'rgba(168,85,247,.05)', border: '1px solid rgba(168,85,247,.15)', borderRadius: 'var(--rad)' }}>
                        <div style={{ fontSize: '.7rem', fontWeight: 700, color: '#a855f7', marginBottom: 8 }}>Public Mint — ${tok.symbol}</div>
                        {tok.maxMintPerTx && tok.maxMintPerTx !== '0' && (
                          <div style={{ fontSize: '.6rem', color: 'var(--t3)', marginBottom: 6 }}>Max per tx: {Number(tok.maxMintPerTx).toLocaleString()}</div>
                        )}
                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                          <input style={{ ...inputStyle, flex: 1 }} type="text" inputMode="decimal"
                            value={mintAmount} onChange={e => setMintAmount(e.target.value)}
                            placeholder={`Amount of ${tok.symbol} to mint`} />
                          {connected ? (
                            <button onClick={() => doMint(tok)} disabled={minting} style={{
                              padding: '8px 16px', borderRadius: 'var(--rad)', fontWeight: 700, fontSize: '.75rem',
                              background: 'linear-gradient(135deg, #a855f7, #7c3aed)', border: 'none',
                              color: 'white', cursor: minting ? 'not-allowed' : 'pointer', fontFamily: 'var(--ff)',
                              opacity: minting ? 0.6 : 1, whiteSpace: 'nowrap',
                            }}>{minting ? 'Minting...' : 'Mint'}</button>
                          ) : (
                            <button onClick={openConnectModal} style={{
                              padding: '8px 16px', borderRadius: 'var(--rad)', fontWeight: 700, fontSize: '.72rem',
                              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none',
                              color: 'white', cursor: 'pointer', fontFamily: 'var(--ff)', whiteSpace: 'nowrap',
                            }}>Connect</button>
                          )}
                        </div>
                        {mintResult && (
                          <div style={{
                            padding: '8px 10px', borderRadius: 6, fontSize: '.68rem',
                            background: mintResult.ok ? 'var(--gG)' : 'rgba(239,68,68,.06)',
                            border: `1px solid ${mintResult.ok ? 'var(--gB)' : 'rgba(239,68,68,.2)'}`,
                            color: mintResult.ok ? 'var(--g)' : '#ef4444', wordBreak: 'break-all',
                          }}>{mintResult.msg}</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Mint History */}
      {mintHistory.length > 0 && (
        <div className="P" style={{ marginTop: 14, padding: 16 }}>
          <div className="Lb">Mint History</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {mintHistory.slice(0, 10).map(tx => (
              <div key={tx.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: 'var(--bg3)', borderRadius: 8, fontSize: '.72rem' }}>
                <span style={{ fontSize: '.9rem', width: 22, textAlign: 'center' }}>🪙</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 700, color: 'var(--w)' }}>
                    Minted {Number(tx.amountA || 0).toLocaleString()} {tx.tokenA}
                  </div>
                  <div style={{ fontSize: '.58rem', color: 'var(--t4)' }}>{formatTimeAgo(tx.ts)}</div>
                </div>
                {tx.txHash && (
                  <a href={getTxUrl(tx.txHash)} target="_blank" rel="noopener noreferrer" style={{ fontSize: '.56rem', color: 'var(--c2)', textDecoration: 'none', whiteSpace: 'nowrap' }}>TX ↗</a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info section */}
      <div className="P" style={{ marginTop: 14, padding: 16, fontSize: '.72rem', color: 'var(--t3)', lineHeight: 1.5 }}>
        <div className="Lb">About Tokens</div>
        <p>Tokens deployed via <strong>Token Launcher</strong> appear in "My Tokens" automatically. Featured tokens are pre-deployed by the OPNet Hub team.</p>
        <p style={{ marginTop: 6 }}>
          <strong>Mintable tokens</strong> with public mint enabled allow anyone to mint directly from this page using their OP_WALLET.
        </p>
        <div style={{ marginTop: 8, padding: '8px', background: 'rgba(14,165,233,.06)', borderRadius: 'var(--rad)', border: '1px solid rgba(14,165,233,.15)', fontSize: '.62rem', color: 'var(--t3)' }}>
          Need testnet BTC? <a href={FAUCET} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>Get from faucet →</a>
        </div>
      </div>
    </div>
  );
};

export default TokenGallery;
