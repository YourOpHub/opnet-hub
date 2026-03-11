import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { logger } from '../logger';
import { useWalletConnect } from '@btc-vision/walletconnect';
import {
  getContract,
  type CallResult, type IOP20Contract,
} from 'opnet';
import { LAUNCHPAD_ABI } from '../abis';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { OPSCAN_API_BASE } from '../contracts';
import { withRetry } from '../txUtils';
import type { LaunchToken } from '../launchpad/types';
import { loadTokens, saveTokens, addToken } from '../launchpad/store';
import { isServerAvailable, fetchTokens, registerToken } from '../launchpad/api';
import { DEPLOYED_CONTRACTS } from '../contracts';

/** Only show our own deployed tokens */
const OUR_ADDRESSES = new Set(
  Object.values(DEPLOYED_CONTRACTS).map(t => t.address),
);
import LaunchpadForm from './launchpad/LaunchpadForm';
import LaunchpadTokenList from './launchpad/LaunchpadTokenList';
import LaunchpadDeployProgress from './launchpad/LaunchpadDeployProgress';

const Launchpad: React.FC = () => {
  const { walletAddress, address: senderAddr } = useWalletConnect();
  const provider = useMemo(() => getProvider(), []);

  const [tokens, setTokens] = useState<LaunchToken[]>(() => loadTokens());
  const [selected, setSelected] = useState<LaunchToken | null>(null);
  const [deployOpen, setDeployOpen] = useState(false);
  const [mintAmt, setMintAmt] = useState('');
  const [minting, setMinting] = useState(false);
  const [mintStep, setMintStep] = useState('');
  const [useServer, setUseServer] = useState(false);
  const [userBal, setUserBal] = useState(0);
  const [opscanHolders, setOpscanHolders] = useState<number | null>(null);
  const [opscanHolderList, setOpscanHolderList] = useState<Array<{ address: string; balance: string }>>([]);

  // Load from server on mount
  useEffect(() => {
    void (async () => {
      const available = await isServerAvailable();
      setUseServer(available);
      let merged: LaunchToken[] = loadTokens();
      if (available) {
        const serverTokens = await fetchTokens();
        if (serverTokens && serverTokens.length > 0) {
          merged = serverTokens.map(st => {
            const lt = merged.find(l => l.address === st.address);
            return lt != null ? { ...lt, replies: st.replies.length > 0 ? st.replies : lt.replies, likes: st.likes > 0 ? st.likes : lt.likes } : st;
          });
          const local = loadTokens();
          local.forEach(lt => { if (!merged.find(m => m.address === lt.address)) merged.push(lt); });
        }
      }
      const ours = merged.filter(t => OUR_ADDRESSES.has(t.address));
      setTokens(ours);
      saveTokens(ours);
    })();
  }, []);

  // On-chain sync for selected token
  const syncToken = useCallback(async (addr: string) => {
    if (!addr.startsWith('opt1sq')) return;
    try {
      const c = getContract<IOP20Contract>(addr, LAUNCHPAD_ABI, provider, NETWORK);
      const [tsR, msR] = await Promise.all([
        withRetry(() => c.totalSupply()),
        withRetry(() => c.maximumSupply()),
      ]);
      if ((tsR as CallResult).revert || (msR as CallResult).revert) return;
      const tsP = (tsR as CallResult).properties as Record<string, unknown>;
      const msP = (msR as CallResult).properties as Record<string, unknown>;
      const total = BigInt(String(tsP?.supply ?? 0));
      const max = BigInt(String(msP?.supply ?? 0));
      const half = max / 2n;
      const minted = total > half ? Number(total - half) / 1e8 : 0;
      setTokens(prev => {
        const copy = prev.map(t => t.address === addr ? { ...t, mintedSupply: minted } : t);
        saveTokens(copy);
        return copy;
      });
      setSelected(prev => prev && prev.address === addr ? { ...prev, mintedSupply: minted } : prev);
    } catch (e) { logger.warn('[LP] sync failed:', e); }
  }, [provider]);

  // On-chain balance for selected token
  const syncBalance = useCallback(async (addr: string) => {
    if (!senderAddr || !addr.startsWith('opt1sq')) { setUserBal(0); return; }
    try {
      const c = getContract<IOP20Contract>(addr, LAUNCHPAD_ABI, provider, NETWORK, senderAddr);
      const res = await c.balanceOf(senderAddr);
      if (!(res as CallResult).revert) {
        const p = (res as CallResult).properties as Record<string, unknown>;
        setUserBal(Number(BigInt(String(p?.balance ?? 0))) / 1e8);
      }
    } catch (e) { logger.warn('[Launchpad] Failed to fetch user token balance:', e); setUserBal(0); }
  }, [senderAddr, provider]);

  // Sync when selected changes
  const selectedAddr = selected?.address;
  useEffect(() => {
    if (!selectedAddr) return;
    void syncToken(selectedAddr);
    void syncBalance(selectedAddr);
  }, [selectedAddr, walletAddress, syncToken, syncBalance]);

  // Auto-select first token
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  useEffect(() => {
    if (!selectedRef.current && tokens.length > 0) setSelected(tokens[0] ?? null);
  }, [tokens]);

  // Fetch holder count from OPScan
  useEffect(() => {
    setOpscanHolders(null);
    setOpscanHolderList([]);
    if (!selectedAddr) return;
    const hexAddr = selectedAddr.startsWith('0x') ? selectedAddr : (selectedAddr.length === 64 ? '0x' + selectedAddr : null);
    if (!hexAddr) return;
    void (async () => {
      try {
        const r = await fetch(`${OPSCAN_API_BASE}/tokens/${hexAddr}/holders`);
        if (!r.ok) return;
        const data = (await r.json()) as { results?: Record<string, unknown>[] } | Record<string, unknown>[];
        const arr: Record<string, unknown>[] = (Array.isArray(data) ? data : (data as { results?: Record<string, unknown>[] }).results) ?? [];
        if (Array.isArray(arr)) {
          setOpscanHolders(arr.length);
          setOpscanHolderList(arr.slice(0, 20).map((h: Record<string, unknown>) => ({
            address: String(h.address ?? h.holderAddress ?? '').slice(0, 20) + '...',
            balance: String(h.balance ?? h.amount ?? '0'),
          })));
        }
      } catch (e) { logger.warn('[Launchpad] Holder data fetch failed:', e); }
    })();
  }, [selectedAddr]);

  const localHolderCount = selected ? new Set(selected.trades.map(t => t.wallet)).size : 0;
  const holderCount = opscanHolders !== null ? opscanHolders : localHolderCount;

  // Token created callback
  const handleCreated = useCallback((token: LaunchToken) => {
    const updated = addToken(token);
    setTokens(updated);
    setSelected(token);
    if (useServer) registerToken(token).catch((e) => { logger.warn('[Launchpad] registerToken error:', e); });
  }, [useServer]);

  return (
    <div className="lp-split" role="region" aria-label="Token Launchpad">
      <LaunchpadTokenList
        tokens={tokens}
        selected={selected}
        onSelect={setSelected}
        onTokensChange={setTokens}
        onDeployOpen={() => setDeployOpen(true)}
        onMintStep={setMintStep}
        useServer={useServer}
      />
      <LaunchpadDeployProgress
        selected={selected}
        userBal={userBal}
        holderCount={holderCount}
        opscanHolderList={opscanHolderList}
        opscanHolders={opscanHolders}
        mintAmt={mintAmt}
        setMintAmt={setMintAmt}
        minting={minting}
        setMinting={setMinting}
        mintStep={mintStep}
        setMintStep={setMintStep}
        onTokensChange={setTokens}
        onSelectedChange={setSelected}
        syncToken={syncToken}
        syncBalance={syncBalance}
      />
      <LaunchpadForm open={deployOpen} onClose={() => setDeployOpen(false)} onCreated={handleCreated} />
    </div>
  );
};

export default Launchpad;
