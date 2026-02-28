import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { networks, Transaction } from '@btc-vision/bitcoin';
import { BinaryWriter } from '@btc-vision/transaction';
import {
  JSONRpcProvider, getContract, ABIDataTypes, BitcoinAbiTypes, BitcoinUtils,
  type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import { buildTxParams, withRetry } from '../txUtils';
import { TESTNET_CONTRACTS } from '../contracts';
import type { LaunchToken, TradeRecord } from '../launchpad/types';
import {
  getPrice, getMarketCap, getProgress, isGraduated, getPriceAtPct,
  fmtMcap, fmtNum, hashColor, genLogo, timeAgo, GRADUATION_PCT,
} from '../launchpad/types';
import { loadTokens, saveTokens, addToken, addTrade, addReply, toggleLike } from '../launchpad/store';
import { isServerAvailable, fetchTokens, serverBuy, serverSell, serverReply, serverLike, registerToken, fetchAccount } from '../launchpad/api';

const NETWORK = networks.testnet;
const RPC_URL = 'https://testnet.opnet.org/api/v1/json-rpc';
const MINTABLE_ABI: BitcoinInterfaceAbi = [
  { name: 'publicMint', inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }], outputs: [], type: BitcoinAbiTypes.Function },
];

type View = 'grid' | 'detail' | 'create';
type Filter = 'all' | 'bonding' | 'graduated' | 'new';
type Sort = 'mcap' | 'new' | 'progress' | 'replies';

/* ═══════════════════════════════════════════════════════════════
   BONDING CURVE CHART (SVG)
   ═══════════════════════════════════════════════════════════════ */
const BondingChart: React.FC<{ token: LaunchToken; width?: number; height?: number }> = ({ token, width = 400, height = 180 }) => {
  const pts: string[] = [];
  const steps = 60;
  const pub = token.publicMintSupply;
  const curPct = getProgress(token);
  const gradPct = GRADUATION_PCT;

  // Find max price for scaling
  let maxP = 0;
  for (let i = 0; i <= steps; i++) {
    const p = getPriceAtPct(i / steps, pub);
    if (p > maxP) maxP = p;
  }
  const pad = { t: 12, b: 24, l: 8, r: 8 };
  const cw = width - pad.l - pad.r;
  const ch = height - pad.t - pad.b;

  for (let i = 0; i <= steps; i++) {
    const pct = i / steps;
    const price = getPriceAtPct(pct, pub);
    const x = pad.l + (pct * cw);
    const y = pad.t + ch - (price / maxP) * ch;
    pts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
  }

  const curX = pad.l + curPct * cw;
  const curPrice = getPrice(token.mintedSupply, pub);
  const curY = pad.t + ch - (curPrice / maxP) * ch;
  const gradX = pad.l + gradPct * cw;

  const areaPath = `M${pts[0]} ${pts.map(p => `L${p}`).join(' ')} L${pad.l + cw},${pad.t + ch} L${pad.l},${pad.t + ch} Z`;
  const linePath = `M${pts[0]} ${pts.map(p => `L${p}`).join(' ')}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} style={{ width: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id="curveGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F7931A" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#F7931A" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Grid lines */}
      {[0.25, 0.5, 0.75].map(p => (
        <line key={p} x1={pad.l} x2={pad.l + cw} y1={pad.t + ch * (1 - p)} y2={pad.t + ch * (1 - p)} stroke="rgba(255,255,255,.04)" strokeWidth="0.5" />
      ))}
      {/* Graduation line */}
      <line x1={gradX} x2={gradX} y1={pad.t} y2={pad.t + ch} stroke="rgba(16,185,129,.3)" strokeWidth="1" strokeDasharray="4,3" />
      <text x={gradX + 3} y={pad.t + 10} fill="rgba(16,185,129,.5)" fontSize="7" fontFamily="var(--fm)">GRAD</text>
      {/* Area fill */}
      <path d={areaPath} fill="url(#curveGrad)" />
      {/* Curve line */}
      <path d={linePath} fill="none" stroke="#F7931A" strokeWidth="1.5" />
      {/* Current position dot */}
      <circle cx={curX} cy={curY} r="4" fill="#F7931A" stroke="#fff" strokeWidth="1.5" />
      <line x1={curX} x2={curX} y1={curY} y2={pad.t + ch} stroke="#F7931A" strokeWidth="0.5" strokeDasharray="3,2" />
      {/* Labels */}
      <text x={pad.l + 2} y={height - 4} fill="rgba(255,255,255,.25)" fontSize="7" fontFamily="var(--fm)">0%</text>
      <text x={pad.l + cw - 20} y={height - 4} fill="rgba(255,255,255,.25)" fontSize="7" fontFamily="var(--fm)">100%</text>
      <text x={curX - 15} y={height - 4} fill="#F7931A" fontSize="7" fontWeight="700" fontFamily="var(--fm)">{(curPct * 100).toFixed(1)}%</text>
    </svg>
  );
};

/* ═══════════════════════════════════════════════════════════════
   TOKEN CARD
   ═══════════════════════════════════════════════════════════════ */
const TokenCard: React.FC<{ token: LaunchToken; onClick: () => void }> = ({ token, onClick }) => {
  const progress = getProgress(token);
  const mcap = getMarketCap(token);
  const price = getPrice(token.mintedSupply, token.publicMintSupply);
  const grad = isGraduated(token);
  const [c1] = hashColor(token.symbol);
  const imgSrc = token.image || genLogo(token.symbol);

  return (
    <div className="lp-card" onClick={onClick} style={{ cursor: 'pointer' }}>
      <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
        <img src={imgSrc} alt={token.symbol} style={{ width: 44, height: 44, borderRadius: '50%', objectFit: 'cover', border: `2px solid ${c1}33` }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 700, fontSize: '.82rem', color: 'var(--w)' }}>{token.name}</span>
            {grad && <span className="lp-badge grad">GRADUATED</span>}
          </div>
          <div style={{ fontFamily: 'var(--fm)', color: c1, fontWeight: 600, fontSize: '.72rem' }}>${token.symbol}</div>
        </div>
      </div>
      <div style={{ fontSize: '.66rem', color: 'var(--t3)', marginBottom: 8, lineHeight: 1.4, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
        {token.description}
      </div>
      {/* Stats row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.62rem', marginBottom: 8 }}>
        <div><span style={{ color: 'var(--t4)' }}>MCap</span> <span style={{ color: 'var(--w)', fontWeight: 700, fontFamily: 'var(--fm)' }}>{fmtMcap(mcap)} VIBE</span></div>
        <div><span style={{ color: 'var(--t4)' }}>Price</span> <span style={{ color: 'var(--o)', fontWeight: 700, fontFamily: 'var(--fm)' }}>{price < 0.001 ? price.toExponential(1) : price.toFixed(4)}</span></div>
      </div>
      {/* Progress bar */}
      {!grad && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.56rem', color: 'var(--t4)', marginBottom: 3 }}>
            <span>Bonding Progress</span>
            <span>{(progress * 100).toFixed(1)}%</span>
          </div>
          <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,.06)' }}>
            <div style={{ height: '100%', borderRadius: 2, background: `linear-gradient(90deg, ${c1}, var(--o))`, width: `${progress * 100}%`, transition: 'width .3s' }} />
          </div>
        </div>
      )}
      {/* Footer */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.56rem', color: 'var(--t4)' }}>
        <span>{token.creator.slice(0, 10)}...</span>
        <div style={{ display: 'flex', gap: 8 }}>
          <span>💬 {token.replies.length}</span>
          <span>❤️ {token.likes}</span>
          <span>{timeAgo(token.createdAt)}</span>
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   DETAIL VIEW
   ═══════════════════════════════════════════════════════════════ */
const DetailView: React.FC<{
  token: LaunchToken;
  onBack: () => void;
  onBuy: (amount: number) => Promise<void>;
  onSell: (amount: number) => Promise<void>;
  onReply: (text: string) => void;
  onLike: () => void;
  buying: boolean;
  buyStep: string;
  userBalance: number;
  walletConnected: boolean;
}> = ({ token, onBack, onBuy, onSell, onReply, onLike, buying, buyStep, userBalance, walletConnected }) => {
  const [buyAmt, setBuyAmt] = useState('');
  const [replyText, setReplyText] = useState('');
  const [tradeMode, setTradeMode] = useState<'buy' | 'sell'>('buy');
  const progress = getProgress(token);
  const mcap = getMarketCap(token);
  const price = getPrice(token.mintedSupply, token.publicMintSupply);
  const grad = isGraduated(token);
  const [c1] = hashColor(token.symbol);
  const imgSrc = token.image || genLogo(token.symbol);

  const handleTrade = async () => {
    const amt = parseFloat(buyAmt);
    if (!amt || amt <= 0) return;
    if (tradeMode === 'buy') await onBuy(amt);
    else await onSell(amt);
    setBuyAmt('');
  };

  const handleReply = () => {
    if (!replyText.trim()) return;
    onReply(replyText.trim());
    setReplyText('');
  };

  return (
    <div>
      <button onClick={onBack} className="lp-back">← Back to tokens</button>

      <div className="lp-detail-grid">
        {/* Left: Chart + Trades + Replies */}
        <div>
          {/* Token header */}
          <div className="P" style={{ padding: 16, marginBottom: 10 }}>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginBottom: 12 }}>
              <img src={imgSrc} alt={token.symbol} style={{ width: 56, height: 56, borderRadius: '50%', border: `2px solid ${c1}44` }} />
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--w)' }}>{token.name}</span>
                  <span style={{ fontFamily: 'var(--fm)', color: c1, fontWeight: 600, fontSize: '.85rem' }}>${token.symbol}</span>
                  {grad && <span className="lp-badge grad">GRADUATED</span>}
                </div>
                <div style={{ color: 'var(--t3)', fontSize: '.72rem', marginTop: 2 }}>{token.description}</div>
                <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: '.62rem' }}>
                  {token.website && <a href={`https://${token.website}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>🌐 Website</a>}
                  {token.twitter && <a href={`https://x.com/${token.twitter}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>𝕏 Twitter</a>}
                  {token.telegram && <a href={`https://t.me/${token.telegram}`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--c2)' }}>✈ Telegram</a>}
                </div>
              </div>
            </div>
          </div>

          {/* Chart */}
          <div className="P" style={{ padding: 14, marginBottom: 10 }}>
            <div className="Lb">Bonding Curve</div>
            <BondingChart token={token} />
            <div style={{ display: 'flex', justifyContent: 'space-around', marginTop: 8, fontSize: '.65rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--t4)' }}>Price</div>
                <div style={{ color: 'var(--o)', fontWeight: 700, fontFamily: 'var(--fm)' }}>{price < 0.001 ? price.toExponential(2) : price.toFixed(4)} VIBE</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--t4)' }}>Market Cap</div>
                <div style={{ color: 'var(--w)', fontWeight: 700, fontFamily: 'var(--fm)' }}>{fmtMcap(mcap)} VIBE</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--t4)' }}>Progress</div>
                <div style={{ color: grad ? 'var(--g)' : c1, fontWeight: 700, fontFamily: 'var(--fm)' }}>{(progress * 100).toFixed(1)}%</div>
              </div>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: 'var(--t4)' }}>Trades</div>
                <div style={{ color: 'var(--w)', fontWeight: 700, fontFamily: 'var(--fm)' }}>{token.trades.length}</div>
              </div>
            </div>
          </div>

          {/* Trade history */}
          <div className="P" style={{ padding: 14, marginBottom: 10 }}>
            <div className="Lb">Recent Trades</div>
            <div style={{ maxHeight: 200, overflow: 'auto' }}>
              {token.trades.slice().reverse().slice(0, 20).map(tr => (
                <div key={tr.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.64rem' }}>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <span style={{ color: tr.type === 'buy' ? 'var(--g)' : '#ef4444', fontWeight: 700 }}>{tr.type === 'buy' ? 'BUY' : 'SELL'}</span>
                    <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{fmtNum(tr.amount)} {token.symbol}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8, color: 'var(--t4)' }}>
                    <span>{tr.wallet.slice(0, 8)}...</span>
                    <span>{timeAgo(tr.timestamp)}</span>
                  </div>
                </div>
              ))}
              {token.trades.length === 0 && <div style={{ color: 'var(--t4)', fontSize: '.7rem', textAlign: 'center', padding: 16 }}>No trades yet. Be the first!</div>}
            </div>
          </div>

          {/* Thread / Replies */}
          <div className="P" style={{ padding: 14 }}>
            <div className="Lb" style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Thread ({token.replies.length})</span>
              <button onClick={onLike} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '.7rem', color: 'var(--t3)' }}>❤️ {token.likes}</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <input value={replyText} onChange={e => setReplyText(e.target.value)} placeholder="Post a reply..." onKeyDown={e => e.key === 'Enter' && handleReply()}
                style={{ flex: 1, padding: '8px 10px', borderRadius: 10, background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)', fontSize: '.72rem', fontFamily: 'var(--ff)', outline: 'none' }} />
              <button onClick={handleReply} className="btn-s" style={{ padding: '8px 14px' }}>Post</button>
            </div>
            {token.replies.slice().reverse().map(r => (
              <div key={r.id} style={{ padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.58rem', color: 'var(--t4)', marginBottom: 3 }}>
                  <span style={{ fontFamily: 'var(--fm)' }}>{r.wallet}</span>
                  <span>{timeAgo(r.timestamp)}</span>
                </div>
                <div style={{ fontSize: '.72rem', color: 'var(--t2)' }}>{r.text}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right sidebar: Buy + Token Info */}
        <div>
          {/* Trade Panel */}
          <div className="P" style={{ padding: 16, marginBottom: 10 }}>
            {grad ? (
              <div style={{ padding: 16, textAlign: 'center', fontSize: '.76rem', color: 'var(--t3)' }}>
                <div style={{ fontSize: '1.5rem', marginBottom: 6 }}>🎓</div>
                <div style={{ fontWeight: 700, color: 'var(--g)', marginBottom: 4 }}>Token Graduated!</div>
                <div>Trade on the <strong>Swap</strong> page via SimplePool AMM.</div>
              </div>
            ) : (
              <>
                {/* Buy/Sell tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                  {(['buy', 'sell'] as const).map(m => (
                    <button key={m} onClick={() => setTradeMode(m)}
                      style={{ flex: 1, padding: '8px', borderRadius: 10, border: `1px solid ${tradeMode === m ? (m === 'buy' ? 'rgba(16,185,129,.3)' : 'rgba(239,68,68,.3)') : 'var(--bd)'}`, background: tradeMode === m ? (m === 'buy' ? 'rgba(16,185,129,.08)' : 'rgba(239,68,68,.08)') : 'var(--bg3)', color: tradeMode === m ? (m === 'buy' ? 'var(--g)' : '#ef4444') : 'var(--t3)', fontWeight: 700, fontSize: '.76rem', cursor: 'pointer', fontFamily: 'var(--ff)', textTransform: 'uppercase' }}>
                      {m}
                    </button>
                  ))}
                </div>
                {/* User balance */}
                {walletConnected && userBalance > 0 && (
                  <div style={{ fontSize: '.64rem', color: 'var(--t3)', marginBottom: 8, padding: '5px 8px', background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
                    Your balance: <strong style={{ color: 'var(--w)', fontFamily: 'var(--fm)' }}>{fmtNum(userBalance)} {token.symbol}</strong>
                  </div>
                )}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 4 }}>
                    {tradeMode === 'buy' ? `Amount to buy (max ${fmtNum(token.maxMintPerTx)}/tx)` : `Amount to sell (have ${fmtNum(userBalance)})`}
                  </div>
                  <input type="text" inputMode="numeric" value={buyAmt} onChange={e => setBuyAmt(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={tradeMode === 'buy' ? `Max ${fmtNum(token.maxMintPerTx)}` : `Max ${fmtNum(userBalance)}`}
                    style={{ width: '100%', padding: '10px 12px', borderRadius: 14, background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)', fontSize: '.82rem', fontFamily: 'var(--fm)', outline: 'none' }} />
                </div>
                <div style={{ display: 'flex', gap: 4, marginBottom: 10 }}>
                  {(tradeMode === 'buy' ? [1000, 10000, 100000, token.maxMintPerTx] : [Math.floor(userBalance * 0.25), Math.floor(userBalance * 0.5), Math.floor(userBalance * 0.75), userBalance]).filter(v => v > 0).map((v, i) => (
                    <button key={i} onClick={() => setBuyAmt(String(v))}
                      style={{ flex: 1, padding: '5px 2px', borderRadius: 8, background: 'rgba(255,255,255,.04)', border: '1px solid var(--bd)', color: 'var(--t3)', fontSize: '.58rem', cursor: 'pointer', fontFamily: 'var(--fm)' }}>
                      {tradeMode === 'sell' && i < 3 ? `${[25, 50, 75][i]}%` : fmtNum(v)}
                    </button>
                  ))}
                </div>
                {buyAmt && parseFloat(buyAmt) > 0 && (
                  <div style={{ fontSize: '.64rem', color: 'var(--t3)', marginBottom: 8, padding: '6px 8px', background: tradeMode === 'buy' ? 'rgba(247,147,26,.06)' : 'rgba(239,68,68,.06)', borderRadius: 8, border: `1px solid ${tradeMode === 'buy' ? 'rgba(247,147,26,.1)' : 'rgba(239,68,68,.1)'}` }}>
                    {tradeMode === 'buy' ? '≈ Cost: ' : '≈ Receive: '}
                    <strong style={{ color: tradeMode === 'buy' ? 'var(--o)' : '#ef4444' }}>{(parseFloat(buyAmt) * price).toFixed(2)} VIBE</strong>
                    {tradeMode === 'buy' ? ' (virtual)' : ''}
                  </div>
                )}
                <button onClick={handleTrade} disabled={buying || !buyAmt}
                  className="lbtn" style={{ width: '100%', opacity: buying ? 0.6 : 1, background: tradeMode === 'sell' ? 'linear-gradient(135deg, #ef4444, #dc2626)' : undefined }}>
                  {buying ? buyStep || (tradeMode === 'buy' ? 'Buying...' : 'Selling...') : `${tradeMode === 'buy' ? 'Buy' : 'Sell'} ${token.symbol}`}
                </button>
              </>
            )}
          </div>

          {/* Token Info */}
          <div className="P" style={{ padding: 16, marginBottom: 10 }}>
            <div className="Lb">Token Info</div>
            <div style={{ fontSize: '.68rem' }}>
              {[
                ['Contract', token.address],
                ['Creator', token.creator],
                ['Total Supply', fmtNum(token.totalSupply)],
                ['Public Mint', fmtNum(token.publicMintSupply)],
                ['Minted', `${fmtNum(token.mintedSupply)} (${(progress * 100).toFixed(1)}%)`],
                ['Max/TX', fmtNum(token.maxMintPerTx)],
                ['Decimals', String(token.decimals)],
                ['Created', new Date(token.createdAt).toLocaleDateString()],
              ].map(([label, val]) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,.03)' }}>
                  <span style={{ color: 'var(--t4)' }}>{label}</span>
                  <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)', maxWidth: '60%', textAlign: 'right', wordBreak: 'break-all', fontSize: '.62rem' }}>{val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bonding progress */}
          {!grad && (
            <div className="P" style={{ padding: 16 }}>
              <div className="Lb">Graduation Progress</div>
              <div style={{ position: 'relative', height: 12, borderRadius: 6, background: 'rgba(255,255,255,.06)', marginBottom: 8, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 6, background: `linear-gradient(90deg, ${c1}, var(--g))`, width: `${Math.min(progress / GRADUATION_PCT, 1) * 100}%`, transition: 'width .3s' }} />
              </div>
              <div style={{ textAlign: 'center', fontSize: '.65rem', color: 'var(--t3)' }}>
                {(Math.min(progress / GRADUATION_PCT, 1) * 100).toFixed(1)}% to graduation
              </div>
              <div style={{ marginTop: 8, fontSize: '.6rem', color: 'var(--t4)', lineHeight: 1.5, textAlign: 'center' }}>
                When {(GRADUATION_PCT * 100).toFixed(0)}% of supply is minted, this token graduates to the SimplePool AMM for real trading.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   CREATE MODAL
   ═══════════════════════════════════════════════════════════════ */
const CreateModal: React.FC<{
  open: boolean;
  onClose: () => void;
  onCreated: (token: LaunchToken) => void;
}> = ({ open, onClose, onCreated }) => {
  const { walletAddress, walletInstance, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => new JSONRpcProvider(RPC_URL, NETWORK), []);

  const [name, setName] = useState('');
  const [symbol, setSymbol] = useState('');
  const [supply, setSupply] = useState('1000000000');
  const [desc, setDesc] = useState('');
  const [website, setWebsite] = useState('');
  const [twitter, setTwitter] = useState('');
  const [telegram, setTelegram] = useState('');
  const [img, setImg] = useState<string | null>(null);
  const [deploying, setDeploying] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const handleImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => setImg(ev.target?.result as string);
    r.readAsDataURL(f);
  };

  const deploy = async () => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    if (!name.trim() || !symbol.trim()) { setError('Name and symbol required'); return; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inst = walletInstance as any;
    const web3 = inst.web3 || inst;
    if (!web3?.deployContract) { setError('Wallet does not support deployment. Use OP_WALLET.'); return; }

    setDeploying(true); setError('');
    try {
      setStep('Loading MintableToken bytecode...');
      const base = import.meta.env.BASE_URL || '/';
      const resp = await fetch(`${base}wasm/MintableToken.wasm`);
      if (!resp.ok) throw new Error('Failed to load MintableToken.wasm');
      const bytecode = new Uint8Array(await resp.arrayBuffer());

      setStep('Encoding parameters...');
      const supplyNum = parseFloat(supply) || 1_000_000_000;
      const decimals = 8;
      const maxSupply = BigInt(Math.floor(supplyNum)) * (10n ** 8n);
      const initialMintAmount = maxSupply / 2n; // 50% to deployer
      const maxPerTx = BigInt(Math.floor(supplyNum * 0.01)) * (10n ** 8n); // 1% per TX

      const writer = new BinaryWriter();
      writer.writeU256(maxSupply);
      writer.writeU8(decimals);
      writer.writeStringWithLength(name.trim());
      writer.writeStringWithLength(symbol.trim().toUpperCase());
      writer.writeU256(initialMintAmount);
      writer.writeBoolean(true); // publicMint enabled
      writer.writeU256(maxPerTx);

      setStep('Fetching UTXOs...');
      const utxos = await provider.utxoManager.getUTXOs({ address: walletAddress });
      if (!utxos?.length) throw new Error('No UTXOs. Get testnet BTC from faucet.');

      setStep('Sign deployment in your wallet...');
      const result = await web3.deployContract({
        bytecode, calldata: writer.getBuffer(), utxos, from: walletAddress,
        feeRate: 10, priorityFee: 10_000n, gasSatFee: 100_000n,
        revealMLDSAPublicKey: true, linkMLDSAPublicKeyToAddress: true,
      });

      setStep('Broadcasting...');
      const [fundingTx, deployTx] = result.transaction;
      if (fundingTx) await provider.sendRawTransaction(fundingTx, false);
      if (deployTx) await provider.sendRawTransaction(deployTx, false);

      let txid = '';
      try { txid = Transaction.fromHex(deployTx || fundingTx || '').getId(); } catch {}

      const token: LaunchToken = {
        address: result.contractAddress || txid || `opt1sq_${Date.now()}`,
        name: name.trim(), symbol: symbol.trim().toUpperCase(), decimals: 8,
        totalSupply: supplyNum, publicMintSupply: supplyNum / 2,
        maxMintPerTx: Math.floor(supplyNum * 0.01),
        mintedSupply: 0, creator: walletAddress,
        createdAt: Date.now(), description: desc.trim() || `${name.trim()} on Bitcoin L1`,
        image: img, website, twitter, telegram,
        status: 'bonding', txHash: txid, trades: [], replies: [], likes: 0,
      };

      onCreated(token);
      setStep(''); setDeploying(false);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Deployment failed');
      setStep(''); setDeploying(false);
    }
  };

  if (!open) return null;

  const iStyle: React.CSSProperties = {
    width: '100%', padding: '9px 11px', borderRadius: 12,
    background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
    fontSize: '.78rem', fontFamily: 'var(--ff)', outline: 'none',
  };

  return (
    <div className="lp-modal-overlay" onClick={onClose}>
      <div className="lp-modal" onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--w)' }}>Launch Token</div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--t3)', fontSize: '1.2rem', cursor: 'pointer' }}>✕</button>
        </div>

        {/* Image upload */}
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 14 }}>
          <div onClick={() => fileRef.current?.click()}
            style={{ width: 72, height: 72, borderRadius: '50%', border: '2px dashed var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', overflow: 'hidden', background: 'var(--bg3)' }}>
            <input ref={fileRef} type="file" accept="image/*" onChange={handleImage} style={{ display: 'none' }} />
            {img ? <img src={img} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              : <span style={{ fontSize: '1.5rem', color: 'var(--t4)' }}>+</span>}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          <div style={{ flex: 2 }}>
            <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Name *</label>
            <input style={iStyle} value={name} onChange={e => setName(e.target.value)} placeholder="Bitcoin Pepe" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Ticker *</label>
            <input style={{ ...iStyle, textTransform: 'uppercase' }} value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase().slice(0, 6))} placeholder="BPEPE" maxLength={6} />
          </div>
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Description</label>
          <textarea style={{ ...iStyle, minHeight: 60, resize: 'vertical' }} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Tell the world about your token..." />
        </div>

        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: '.64rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Total Supply</label>
          <input style={iStyle} type="text" inputMode="numeric" value={supply} onChange={e => setSupply(e.target.value.replace(/[^0-9]/g, ''))} placeholder="1000000000" />
          <div style={{ fontSize: '.56rem', color: 'var(--t4)', marginTop: 2 }}>50% to you · 50% for public mint · 1% max per TX</div>
        </div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '.58rem', color: 'var(--t4)' }}>Website</label>
            <input style={{ ...iStyle, fontSize: '.7rem' }} value={website} onChange={e => setWebsite(e.target.value)} placeholder="example.com" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '.58rem', color: 'var(--t4)' }}>Twitter</label>
            <input style={{ ...iStyle, fontSize: '.7rem' }} value={twitter} onChange={e => setTwitter(e.target.value)} placeholder="@handle" />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ fontSize: '.58rem', color: 'var(--t4)' }}>Telegram</label>
            <input style={{ ...iStyle, fontSize: '.7rem' }} value={telegram} onChange={e => setTelegram(e.target.value)} placeholder="t.me/group" />
          </div>
        </div>

        <div style={{ padding: '8px 10px', background: 'rgba(247,147,26,.06)', border: '1px solid rgba(247,147,26,.12)', borderRadius: 10, fontSize: '.65rem', color: 'var(--t3)', marginBottom: 12 }}>
          Deploy cost: <strong style={{ color: 'var(--o)' }}>~50K sats (~0.0005 BTC)</strong> · Token goes live on Bitcoin L1
        </div>

        {error && <div style={{ padding: '8px 10px', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)', borderRadius: 8, color: '#ef4444', fontSize: '.72rem', marginBottom: 10 }}>{error}</div>}

        <button onClick={deploy} disabled={deploying} className="lbtn" style={{ width: '100%', opacity: deploying ? 0.6 : 1 }}>
          {deploying ? step || 'Deploying...' : walletAddress ? `Launch $${symbol || 'TOKEN'}` : 'Connect Wallet'}
        </button>
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════════════════════════
   MAIN LAUNCHPAD PAGE
   ═══════════════════════════════════════════════════════════════ */
const Launchpad: React.FC = () => {
  const { walletAddress, address: senderAddr, openConnectModal } = useWalletConnect();
  const provider = useMemo(() => new JSONRpcProvider(RPC_URL, NETWORK), []);

  const [view, setView] = useState<View>('grid');
  const [tokens, setTokens] = useState<LaunchToken[]>(() => loadTokens());
  const [selected, setSelected] = useState<LaunchToken | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [sort, setSort] = useState<Sort>('mcap');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [buying, setBuying] = useState(false);
  const [buyStep, setBuyStep] = useState('');
  const [useServer, setUseServer] = useState(false);
  const [userBalances, setUserBalances] = useState<Record<string, number>>({});

  // Check server availability on mount + load from server if available
  useEffect(() => {
    (async () => {
      const available = await isServerAvailable();
      setUseServer(available);
      if (available) {
        const serverTokens = await fetchTokens();
        if (serverTokens && serverTokens.length > 0) {
          setTokens(serverTokens);
          saveTokens(serverTokens);
        }
      }
    })();
  }, []);

  // Load user balances when wallet connected
  useEffect(() => {
    if (!walletAddress) return;
    (async () => {
      const acct = await fetchAccount(walletAddress);
      if (acct) {
        const bals: Record<string, number> = {};
        acct.forEach(b => { bals[b.address] = b.amount; });
        setUserBalances(bals);
      }
    })();
  }, [walletAddress, tokens]);

  // Refresh token list
  const refresh = useCallback(async () => {
    if (useServer) {
      const serverTokens = await fetchTokens();
      if (serverTokens) { setTokens(serverTokens); saveTokens(serverTokens); return; }
    }
    setTokens(loadTokens());
  }, [useServer]);

  // Filter & sort
  const filtered = useMemo(() => {
    let list = [...tokens];
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(t => t.name.toLowerCase().includes(q) || t.symbol.toLowerCase().includes(q));
    }
    if (filter === 'bonding') list = list.filter(t => !isGraduated(t));
    else if (filter === 'graduated') list = list.filter(t => isGraduated(t));
    else if (filter === 'new') list = list.filter(t => Date.now() - t.createdAt < 86400_000);

    if (sort === 'mcap') list.sort((a, b) => getMarketCap(b) - getMarketCap(a));
    else if (sort === 'new') list.sort((a, b) => b.createdAt - a.createdAt);
    else if (sort === 'progress') list.sort((a, b) => getProgress(b) - getProgress(a));
    else if (sort === 'replies') list.sort((a, b) => b.replies.length - a.replies.length);
    return list;
  }, [tokens, filter, sort, search]);

  // Stats
  const totalLaunches = tokens.length;
  const graduated = tokens.filter(t => isGraduated(t)).length;
  const totalMcap = tokens.reduce((s, t) => s + getMarketCap(t), 0);

  // Open detail
  const openDetail = useCallback((t: LaunchToken) => {
    setSelected(t);
    setView('detail');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // INSTANT BUY — server first, localStorage fallback
  const handleBuy = useCallback(async (amount: number) => {
    if (!walletAddress || !selected) { openConnectModal(); return; }
    setBuying(true); setBuyStep('Processing...');
    try {
      if (useServer) {
        // Server-side instant trade
        const result = await serverBuy(selected.address, walletAddress, amount);
        // Update state instantly from server response
        setTokens(prev => prev.map(t => t.address === result.token.address ? result.token : t));
        setSelected(result.token);
        setUserBalances(prev => ({ ...prev, [selected.address]: result.balance }));
        setBuyStep('');
      } else {
        // Optimistic localStorage update (instant UI)
        const trade: TradeRecord = {
          id: `t_${Date.now()}`, type: 'buy', amount,
          price: getPrice(selected.mintedSupply, selected.publicMintSupply),
          wallet: `${walletAddress.slice(0, 10)}...${walletAddress.slice(-4)}`,
          txHash: '', timestamp: Date.now(),
        };
        const updated = addTrade(selected.address, trade);
        setTokens(updated);
        const refreshed = updated.find(t => t.address === selected.address);
        if (refreshed) setSelected(refreshed);
        setUserBalances(prev => ({ ...prev, [selected.address]: (prev[selected.address] || 0) + amount }));
        setBuyStep('');

        // Background on-chain publicMint (non-blocking)
        if (senderAddr && selected.address.startsWith('opt1sq') && !selected.address.includes('_demo')) {
          (async () => {
            try {
              const rawAmount = BitcoinUtils.expandToDecimals(amount, selected.decimals);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const contract = getContract<any>(selected.address, MINTABLE_ABI, provider, NETWORK, senderAddr as any);
              const sim = await withRetry(() => contract.publicMint(rawAmount));
              if (!(sim as CallResult).revert) {
                const txParams = await buildTxParams(provider, walletAddress);
                await (sim as CallResult).sendTransaction(txParams);
                console.log('[Launchpad] On-chain mint confirmed');
              }
            } catch (e) { console.warn('[Launchpad] Background mint failed (state already updated):', e); }
          })();
        }
      }
    } catch (e) {
      console.error('[Launchpad Buy]', e);
      setBuyStep(e instanceof Error ? e.message : 'Buy failed');
      setTimeout(() => setBuyStep(''), 4000);
    } finally {
      setBuying(false);
    }
  }, [walletAddress, senderAddr, selected, provider, useServer, openConnectModal]);

  // INSTANT SELL
  const handleSell = useCallback(async (amount: number) => {
    if (!walletAddress || !selected) { openConnectModal(); return; }
    setBuying(true); setBuyStep('Selling...');
    try {
      if (useServer) {
        const result = await serverSell(selected.address, walletAddress, amount);
        setTokens(prev => prev.map(t => t.address === result.token.address ? result.token : t));
        setSelected(result.token);
        setUserBalances(prev => ({ ...prev, [selected.address]: result.balance }));
      } else {
        // Optimistic localStorage sell
        const trade: TradeRecord = {
          id: `t_${Date.now()}`, type: 'sell', amount,
          price: getPrice(selected.mintedSupply, selected.publicMintSupply),
          wallet: `${walletAddress.slice(0, 10)}...${walletAddress.slice(-4)}`,
          txHash: '', timestamp: Date.now(),
        };
        // Decrease minted supply for sell
        const toksCopy = loadTokens();
        const tok = toksCopy.find(t => t.address === selected.address);
        if (tok) {
          tok.mintedSupply = Math.max(0, tok.mintedSupply - amount);
          tok.trades.push(trade);
          saveTokens(toksCopy);
          setTokens(toksCopy);
          setSelected(tok);
        }
        setUserBalances(prev => ({ ...prev, [selected.address]: Math.max(0, (prev[selected.address] || 0) - amount) }));
      }
      setBuyStep('');
    } catch (e) {
      console.error('[Launchpad Sell]', e);
      setBuyStep(e instanceof Error ? e.message : 'Sell failed');
      setTimeout(() => setBuyStep(''), 4000);
    } finally {
      setBuying(false);
    }
  }, [walletAddress, selected, useServer, openConnectModal]);

  // Reply — server + localStorage
  const handleReply = useCallback((text: string) => {
    if (!walletAddress || !selected) return;
    const walletShort = `${walletAddress.slice(0, 10)}...${walletAddress.slice(-4)}`;
    // Optimistic local update
    const updated = addReply(selected.address, walletShort, text);
    setTokens(updated);
    const refreshed = updated.find(t => t.address === selected.address);
    if (refreshed) setSelected(refreshed);
    // Server sync
    if (useServer) serverReply(selected.address, walletAddress, text).catch(() => {});
  }, [walletAddress, selected, useServer]);

  // Like — server + localStorage
  const handleLike = useCallback(() => {
    if (!selected) return;
    const updated = toggleLike(selected.address);
    setTokens(updated);
    const refreshed = updated.find(t => t.address === selected.address);
    if (refreshed) setSelected(refreshed);
    if (useServer) serverLike(selected.address).catch(() => {});
  }, [selected, useServer]);

  // Token created callback
  const handleCreated = useCallback((token: LaunchToken) => {
    const updated = addToken(token);
    setTokens(updated);
    setSelected(token);
    setView('detail');
    // Register on server
    if (useServer) registerToken(token).catch(() => {});
  }, [useServer]);

  /* ─── Render ─── */
  if (view === 'detail' && selected) {
    return (
      <div>
        <DetailView
          token={selected} onBack={() => { setView('grid'); refresh(); }}
          onBuy={handleBuy} onSell={handleSell} onReply={handleReply} onLike={handleLike}
          buying={buying} buyStep={buyStep}
          userBalance={userBalances[selected.address] || 0}
          walletConnected={!!walletAddress}
        />
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="Pg" style={{ marginBottom: 14, textAlign: 'center', padding: '20px 18px' }}>
        <div style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--w)', marginBottom: 2 }}>
          <span style={{ background: 'linear-gradient(135deg, #F7931A, #ffab40)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>OPNet Launchpad</span>
        </div>
        <div style={{ color: 'var(--t3)', fontSize: '.78rem', maxWidth: 500, margin: '0 auto 12px' }}>
          Launch tokens on Bitcoin L1. Bonding curve → Graduation → AMM trading.
        </div>
        {/* Stats row */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: 24, flexWrap: 'wrap' }}>
          {[
            ['Launches', String(totalLaunches)],
            ['Graduated', String(graduated)],
            ['Total MCap', `${fmtMcap(totalMcap)} VIBE`],
          ].map(([label, val]) => (
            <div key={label} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '.6rem', color: 'var(--t4)', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
              <div style={{ fontSize: '.9rem', fontWeight: 700, color: 'var(--w)', fontFamily: 'var(--fm)' }}>{val}</div>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8, fontSize: '.56rem', color: useServer ? 'var(--g)' : 'var(--t4)' }}>
          {useServer ? '● Server mode — instant trades' : '● Local mode — trades update locally'}
        </div>
      </div>

      {/* Toolbar: search + filters + create */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search tokens..."
          style={{ flex: '1 1 180px', padding: '9px 12px', borderRadius: 14, background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)', fontSize: '.78rem', fontFamily: 'var(--ff)', outline: 'none' }} />

        <div style={{ display: 'flex', gap: 4 }}>
          {([['all', 'All'], ['bonding', '🔥 Bonding'], ['graduated', '🎓 Graduated'], ['new', '✨ New']] as const).map(([f, label]) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`lp-filter ${filter === f ? 'on' : ''}`}>
              {label}
            </button>
          ))}
        </div>

        <select value={sort} onChange={e => setSort(e.target.value as Sort)}
          style={{ padding: '8px 10px', borderRadius: 10, background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--t2)', fontSize: '.7rem', fontFamily: 'var(--ff)', cursor: 'pointer' }}>
          <option value="mcap">Sort: Market Cap</option>
          <option value="new">Sort: Newest</option>
          <option value="progress">Sort: Progress</option>
          <option value="replies">Sort: Most Active</option>
        </select>

        <button onClick={() => setCreateOpen(true)} className="lbtn" style={{ padding: '9px 20px', fontSize: '.78rem' }}>
          + Launch Token
        </button>
      </div>

      {/* Token Grid */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 40, color: 'var(--t4)' }}>
          <div style={{ fontSize: '2rem', marginBottom: 8 }}>🔍</div>
          <div style={{ fontSize: '.82rem' }}>No tokens found</div>
        </div>
      ) : (
        <div className="lp-grid">
          {filtered.map(t => (
            <TokenCard key={t.address} token={t} onClick={() => openDetail(t)} />
          ))}
        </div>
      )}

      {/* Create Modal */}
      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={handleCreated} />
    </div>
  );
};

export default Launchpad;
