import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useWalletConnect } from '@btc-vision/walletconnect';
import { Address, BinaryWriter } from '@btc-vision/transaction';
import { Transaction } from '@btc-vision/bitcoin';
import {
  JSONRpcProvider, getContract, OP_20_ABI, ABIDataTypes, BitcoinAbiTypes, BitcoinUtils,
  type IOP20Contract, type BitcoinInterfaceAbi, type CallResult,
} from 'opnet';
import { getProvider } from '../contractCache';
import { NETWORK } from '../config';
import { ensureAllowance, buildTxParams, withRetry, formatTxError } from '../txUtils';
import * as opnetRpc from '../opnet';
import { fetchBtcPrice } from '../btc-price';
import { addTxRecord, getTxHistory, formatTimeAgo, type TxRecord } from '../txHistory';
import {
  TESTNET_CONTRACTS,
  POOL_ADDRESS, POOL_PUBKEY,
  getTxUrl, getContractOpscanUrl,
} from '../contracts';
import LiquidityModal from './LiquidityModal';

type SwapMainTab = 'swap' | 'pools';

interface UserPool {
  address: string;
  tokenA: string;
  tokenB: string;
  symbolA: string;
  symbolB: string;
  deployedAt: number;
  deployer: string;
}
const FAUCET_URL = 'https://188-137-250-160.sslip.io/faucet';

/** Custom ABI for SimplePool contract */
const POOL_ABI: BitcoinInterfaceAbi = [
  {
    name: 'swap',
    inputs: [
      { name: 'tokenIn', type: ABIDataTypes.ADDRESS },
      { name: 'amountIn', type: ABIDataTypes.UINT256 },
      { name: 'minAmountOut', type: ABIDataTypes.UINT256 },
    ],
    outputs: [{ name: 'amountOut', type: ABIDataTypes.UINT256 }],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'getReserves',
    constant: true,
    inputs: [],
    outputs: [
      { name: 'reserveA', type: ABIDataTypes.UINT256 },
      { name: 'reserveB', type: ABIDataTypes.UINT256 },
    ],
    type: BitcoinAbiTypes.Function,
  },
  {
    name: 'sync',
    inputs: [],
    outputs: [{ name: 'success', type: ABIDataTypes.BOOL }],
    type: BitcoinAbiTypes.Function,
  },
];

/** ABI for MintableToken publicMint method */
const MINTABLE_ABI: BitcoinInterfaceAbi = [
  {
    name: 'publicMint',
    inputs: [{ name: 'amount', type: ABIDataTypes.UINT256 }],
    outputs: [],
    type: BitcoinAbiTypes.Function,
  },
];

const MINT_AMOUNT = 1000; // Fixed 1000 tokens per mint

interface IPoolContract {
  swap(tokenIn: Address, amountIn: bigint, minAmountOut: bigint): Promise<CallResult>;
  getReserves(): Promise<CallResult>;
  sync(): Promise<CallResult>;
}

/** Initial pool reserves (will be read from chain once pool is deployed) */
const INIT_RESERVE_A = 5_000_000;  // MINE
const INIT_RESERVE_B = 25_000_000; // VIBE

function getAmountOut(amountIn: number, reserveIn: number, reserveOut: number): { out: number; impact: number } {
  const fee = amountIn * 0.003;
  const inAfterFee = amountIn - fee;
  const out = (reserveOut * inAfterFee) / (reserveIn + inAfterFee);
  const spotPrice = reserveOut / reserveIn;
  const effectivePrice = out / amountIn;
  const impact = Math.abs(1 - effectivePrice / spotPrice) * 100;
  return { out, impact };
}

interface Token { symbol: string; name: string; icon: string; decimals: number; address: string; pubkey: string; }

const TOKENS: Token[] = [
  { symbol: 'MINE', name: TESTNET_CONTRACTS.MINE.name, icon: TESTNET_CONTRACTS.MINE.icon, decimals: 8, address: TESTNET_CONTRACTS.MINE.address, pubkey: TESTNET_CONTRACTS.MINE.pubkey },
  { symbol: 'VIBE', name: TESTNET_CONTRACTS.VIBE.name, icon: TESTNET_CONTRACTS.VIBE.icon, decimals: 8, address: TESTNET_CONTRACTS.VIBE.address, pubkey: TESTNET_CONTRACTS.VIBE.pubkey },
];

type SwapResultType = { type: 'success' | 'error'; hash?: string; amtOut?: string; error?: string };

const POOL_CREATE_ABI: BitcoinInterfaceAbi = [
  { name: 'getTokens', inputs: [], outputs: [{ name: 'tokenA', type: ABIDataTypes.ADDRESS }, { name: 'tokenB', type: ABIDataTypes.ADDRESS }], type: BitcoinAbiTypes.Function },
  { name: 'getReserves', constant: true, inputs: [], outputs: [{ name: 'reserveA', type: ABIDataTypes.UINT256 }, { name: 'reserveB', type: ABIDataTypes.UINT256 }], type: BitcoinAbiTypes.Function },
];

const SwapUI: React.FC = () => {
  const { walletAddress, walletInstance, publicKey, hashedMLDSAKey, address: senderAddr, openConnectModal } = useWalletConnect();

  const [fromIdx, setFromIdx] = useState(0);
  const [toIdx, setToIdx] = useState(1);
  const [fromAmt, setFromAmt] = useState('');
  const [slippage, setSlippage] = useState(0.5);
  const [swapping, setSwapping] = useState(false);
  const [swapStep, setSwapStep] = useState('');
  const [swapResult, setSwapResult] = useState<SwapResultType | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [btcPrice, setBtcPrice] = useState(0);
  const [balances, setBalances] = useState<Record<string, bigint>>({});
  const [balLoading, setBalLoading] = useState(false);
  const [balRefreshKey, setBalRefreshKey] = useState(0);
  const [minting, setMinting] = useState<string | null>(null);
  const [mintResult, setMintResult] = useState<{sym: string; ok: boolean; msg: string} | null>(null);
  const [tokenSupplies, setTokenSupplies] = useState<Record<string, bigint>>({});
  const [reserveA, setReserveA] = useState(INIT_RESERVE_A);
  const [reserveB, setReserveB] = useState(INIT_RESERVE_B);
  const [history, setHistory] = useState<TxRecord[]>([]);
  const [mainTab, setMainTab] = useState<SwapMainTab>('swap');
  const [userPools, setUserPools] = useState<UserPool[]>(() => {
    try { return JSON.parse(localStorage.getItem('hub_user_pools') || '[]'); } catch { return []; }
  });
  const [createPoolOpen, setCreatePoolOpen] = useState(false);
  const [poolTokenA, setPoolTokenA] = useState('');
  const [poolTokenB, setPoolTokenB] = useState('');
  const [poolSymA, setPoolSymA] = useState('');
  const [poolSymB, setPoolSymB] = useState('');
  const [poolSeedA, setPoolSeedA] = useState('');
  const [poolSeedB, setPoolSeedB] = useState('');
  const [deployingPool, setDeployingPool] = useState(false);
  const [poolDeployStep, setPoolDeployStep] = useState('');
  const [poolDeployResult, setPoolDeployResult] = useState<{ ok: boolean; msg: string; address?: string } | null>(null);
  const [showLiquidity, setShowLiquidity] = useState(false);
  const [lpMineAmt, setLpMineAmt] = useState('');
  const [lpVibeAmt, setLpVibeAmt] = useState('');
  const [addingLP, setAddingLP] = useState(false);
  const [lpStep, setLpStep] = useState('');
  const [lpResult, setLpResult] = useState<{ ok: boolean; msg: string } | null>(null);
  const [lpUserMine, setLpUserMine] = useState(() => {
    try { return Number(localStorage.getItem('hub_lp_mine') || '0'); } catch { return 0; }
  });
  const [lpUserVibe, setLpUserVibe] = useState(() => {
    try { return Number(localStorage.getItem('hub_lp_vibe') || '0'); } catch { return 0; }
  });

  useEffect(() => {
    if (walletAddress) setHistory(getTxHistory(walletAddress).filter(r => r.type === 'swap' || r.type === 'mint' || r.type === 'claim'));
  }, [walletAddress, balRefreshKey]);

  const poolReady = !!POOL_ADDRESS;

  /** Fetch pool reserves from chain */
  const fetchReserves = useCallback(async () => {
    if (!POOL_ADDRESS) return;
    try {
      const res = await opnetRpc.callContract(POOL_ADDRESS, '06374bfc');
      if (res) {
        const hex = res.startsWith('0x') ? res.slice(2) : res;
        if (hex.length >= 128) {
          const r0 = Number(BigInt('0x' + hex.slice(0, 64))) / 1e8;
          const r1 = Number(BigInt('0x' + hex.slice(64, 128))) / 1e8;
          if (r0 > 0) setReserveA(r0);
          if (r1 > 0) setReserveB(r1);
        }
      }
    } catch { /* fallback to init */ }
  }, []);

  useEffect(() => { fetchReserves(); }, [fetchReserves]);
  useEffect(() => { fetchBtcPrice().then(p => { if (p.usd > 0) setBtcPrice(p.usd); }); }, []);

  useEffect(() => {
    opnetRpc.setNetwork('testnet');
    Object.entries(TESTNET_CONTRACTS).forEach(([sym, tok]) => {
      opnetRpc.getTokenTotalSupply(tok.address).then(supply => {
        if (supply > 0n) setTokenSupplies(prev => ({ ...prev, [sym]: supply }));
      }).catch(() => {});
    });
  }, []);

  // Fetch balances
  useEffect(() => {
    if (!walletAddress || !hashedMLDSAKey) { setBalances({}); return; }
    opnetRpc.setNetwork('testnet');
    setBalLoading(true);
    const mldsa = hashedMLDSAKey.startsWith('0x') ? hashedMLDSAKey.slice(2) : hashedMLDSAKey;
    const tweaked = publicKey ? (publicKey.startsWith('0x') ? publicKey.slice(2) : publicKey) : undefined;
    const jobs: Promise<void>[] = [];
    for (const [sym, tok] of Object.entries(TESTNET_CONTRACTS)) {
      jobs.push(
        opnetRpc.getTokenBalance(tok.address, mldsa, tweaked)
          .then(b => setBalances(prev => ({ ...prev, [sym]: b })))
          .catch(() => {})
      );
    }
    jobs.push(
      opnetRpc.getBalance(walletAddress)
        .then(b => setBalances(prev => ({ ...prev, BTC: b })))
        .catch(() => {})
    );
    Promise.allSettled(jobs).finally(() => setBalLoading(false));
  }, [walletAddress, hashedMLDSAKey, publicKey, balRefreshKey]);

  const from = TOKENS[fromIdx] || TOKENS[0];
  const to = TOKENS[toIdx] || TOKENS[1];
  const fromVal = parseFloat(fromAmt) || 0;

  // Determine reserves based on direction
  const isAToB = from.symbol === 'MINE';
  const rIn = isAToB ? reserveA : reserveB;
  const rOut = isAToB ? reserveB : reserveA;
  const hasPool = rIn > 0 && rOut > 0;
  const quote = hasPool && fromVal > 0 ? getAmountOut(fromVal, rIn, rOut) : null;
  const toVal = quote?.out ?? 0;
  const priceImpact = quote?.impact ?? 0;
  const rate = hasPool ? rOut / rIn : 0;
  const fee = fromVal * 0.003;

  const fromBal = balances[from.symbol];
  const toBal = balances[to.symbol];
  const fmtBal = (b: bigint | undefined, dec: number) => b != null ? (Number(b) / Math.pow(10, dec)).toLocaleString(undefined, { maximumFractionDigits: 4 }) : (balLoading ? '...' : '--');

  const flip = () => { setFromIdx(toIdx); setToIdx(fromIdx); setFromAmt(''); setSwapResult(null); };

  /** Singleton opnet provider */
  const provider = useMemo(() => getProvider(), []);

  // senderAddr comes directly from useWalletConnect() as 'address'

  /**
   * Execute a REAL on-chain swap via SimplePool AMM:
   * Step 1: increaseAllowance(poolAddress, amountIn) on token-in
   * Step 2: swap(tokenIn, amountIn, minAmountOut) on pool contract
   * Uses getContract() from opnet — proper ABI encoding + wallet signing.
   */
  const doSwap = useCallback(async () => {
    if (!fromVal || fromVal <= 0 || !hasPool) return;

    if (!walletAddress || !walletInstance) {
      openConnectModal();
      return;
    }

    if (!poolReady) {
      setSwapResult({ type: 'error', error: 'Pool contract not yet deployed. Coming soon!' });
      return;
    }

    if (!senderAddr) {
      setSwapResult({ type: 'error', error: 'Wallet public key not available. Reconnect wallet.' });
      return;
    }

    setSwapping(true);
    setSwapResult(null);

    try {
      const rawAmount = BitcoinUtils.expandToDecimals(fromVal, from.decimals);
      const minOut = BitcoinUtils.expandToDecimals(toVal * (1 - slippage / 100), to.decimals);

      // STEP 1: Ensure allowance (check → approve → wait for block)
      await ensureAllowance(
        from.address, POOL_PUBKEY, rawAmount,
        provider, senderAddr as unknown as string, walletAddress!, setSwapStep, from.symbol,
      );

      // STEP 2: Call swap on pool
      setSwapStep('Executing swap on pool...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolContract = getContract<any>(
        POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr as any,
      ) as unknown as IPoolContract;
      const tokenInAddr = Address.fromString(from.pubkey);
      const swapSim = await withRetry(() => poolContract.swap(tokenInAddr, rawAmount, minOut));

      if ((swapSim as CallResult).revert) {
        throw new Error(`Swap simulation reverted: ${(swapSim as CallResult).revert}`);
      }

      const txParams2 = await buildTxParams(provider, walletAddress!);
      const swapReceipt = await (swapSim as CallResult).sendTransaction(txParams2);
      const txHash = swapReceipt.transactionId || '';

      setSwapStep('');
      setSwapResult({
        type: 'success', hash: txHash,
        amtOut: toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }),
      });
      addTxRecord({ type: 'swap', txHash, tokenA: from.symbol, tokenB: to.symbol, amountA: fromVal.toString(), amountB: toVal.toFixed(6), status: 'confirmed', wallet: walletAddress! });
      localStorage.setItem('hub_swapped', '1');
      // Refresh balances after swap
      setTimeout(() => setBalRefreshKey(k => k + 1), 3000);
    } catch (e) {
      console.error('[Swap]', e);
      setSwapStep('');
      setSwapResult({ type: 'error', error: formatTxError(e) });
    } finally {
      setSwapping(false);
    }
  }, [fromVal, hasPool, walletAddress, walletInstance, from, to, toVal, slippage, poolReady, openConnectModal, provider, senderAddr]);

  /** On-chain publicMint — mints fixed 1000 tokens via MintableToken contract */
  const mintTokens = useCallback(async (sym: string) => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    if (!senderAddr) { setMintResult({ sym, ok: false, msg: 'Wallet not available. Reconnect.' }); return; }
    setMinting(sym);
    setMintResult(null);
    try {
      const tok = TESTNET_CONTRACTS[sym as keyof typeof TESTNET_CONTRACTS];
      if (!tok) throw new Error('Unknown token');
      const rawAmount = BitcoinUtils.expandToDecimals(MINT_AMOUNT, tok.decimals);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contract = getContract<any>(tok.address, MINTABLE_ABI, provider, NETWORK, senderAddr as any);
      const sim = await withRetry(() => contract.publicMint(rawAmount));
      if ((sim as CallResult).revert) throw new Error(`Mint reverted: ${(sim as CallResult).revert}`);
      const txParams = await buildTxParams(provider, walletAddress!);
      const receipt = await (sim as CallResult).sendTransaction(txParams);
      const txHash = receipt.transactionId || '';
      setMintResult({ sym, ok: true, msg: `Minted ${MINT_AMOUNT.toLocaleString()} ${sym}! TX: ${txHash.slice(0, 16)}…` });
      addTxRecord({ type: 'mint', txHash, tokenA: sym, amountA: MINT_AMOUNT.toString(), status: 'confirmed', wallet: walletAddress! });
      setTimeout(() => setBalRefreshKey(k => k + 1), 5000);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Mint failed';
      if (msg.toLowerCase().includes('no utxo')) msg = 'No BTC UTXOs. Get testnet BTC: https://faucet.opnet.org';
      setMintResult({ sym, ok: false, msg });
    } finally {
      setMinting(null);
    }
  }, [walletAddress, walletInstance, openConnectModal, provider, senderAddr]);

  /** Add Liquidity: transfer MINE + VIBE to pool → call sync() */
  const addLiquidity = useCallback(async () => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    const mineAmt = parseFloat(lpMineAmt);
    const vibeAmt = parseFloat(lpVibeAmt);
    if (!mineAmt || !vibeAmt || mineAmt <= 0 || vibeAmt <= 0) {
      setLpResult({ ok: false, msg: 'Enter both MINE and VIBE amounts' });
      return;
    }
    if (!senderAddr) { setLpResult({ ok: false, msg: 'Wallet public key not available' }); return; }

    setAddingLP(true);
    setLpResult(null);
    try {
      const poolAddr = Address.fromString(POOL_PUBKEY) as any;

      // 1. Transfer MINE to pool
      setLpStep('Transferring MINE to pool...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mineContract = getContract<IOP20Contract>(TESTNET_CONTRACTS.MINE.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const mineRaw = BitcoinUtils.expandToDecimals(mineAmt, 8);
      const mineSim = await withRetry(() => mineContract.transfer(poolAddr, mineRaw));
      if (mineSim.revert) throw new Error(`MINE transfer failed: ${mineSim.revert}`);
      const txParams1 = await buildTxParams(provider, walletAddress);
      const mineReceipt = await mineSim.sendTransaction(txParams1);
      console.log('[LP] MINE transfer TX:', mineReceipt.transactionId);

      // Wait for confirmation
      setLpStep('Waiting for MINE transfer (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      // 2. Transfer VIBE to pool — fresh txParams (UTXOs changed)
      setLpStep('Transferring VIBE to pool...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const vibeContract = getContract<IOP20Contract>(TESTNET_CONTRACTS.VIBE.address, OP_20_ABI, provider, NETWORK, senderAddr as any);
      const vibeRaw = BitcoinUtils.expandToDecimals(vibeAmt, 8);
      const vibeSim = await withRetry(() => vibeContract.transfer(poolAddr, vibeRaw));
      if (vibeSim.revert) throw new Error(`VIBE transfer failed: ${vibeSim.revert}`);
      const txParams2 = await buildTxParams(provider, walletAddress);
      const vibeReceipt = await vibeSim.sendTransaction(txParams2);
      console.log('[LP] VIBE transfer TX:', vibeReceipt.transactionId);

      // Wait for confirmation
      setLpStep('Waiting for VIBE transfer (~30s)...');
      await new Promise(r => setTimeout(r, 30000));

      // 3. Call sync() on pool — fresh txParams again
      setLpStep('Syncing pool reserves...');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const poolContract = getContract<any>(POOL_ADDRESS, POOL_ABI, provider, NETWORK, senderAddr as any);
      const syncSim = await withRetry(() => poolContract.sync());
      if ((syncSim as CallResult).revert) throw new Error(`Sync failed: ${(syncSim as CallResult).revert}`);
      const txParams3 = await buildTxParams(provider, walletAddress);
      const syncReceipt = await (syncSim as CallResult).sendTransaction(txParams3);

      setLpStep('');
      setLpResult({ ok: true, msg: `Liquidity added! ${mineAmt} MINE + ${vibeAmt} VIBE. Sync TX: ${syncReceipt.transactionId}` });
      addTxRecord({ type: 'mint', txHash: syncReceipt.transactionId || '', tokenA: 'LP', amountA: `${mineAmt}+${vibeAmt}`, status: 'confirmed', wallet: walletAddress });
      setLpUserMine(prev => { const v = prev + mineAmt; localStorage.setItem('hub_lp_mine', String(v)); return v; });
      setLpUserVibe(prev => { const v = prev + vibeAmt; localStorage.setItem('hub_lp_vibe', String(v)); return v; });
      // Refresh reserves + balances after LP
      setTimeout(() => { fetchReserves(); setBalRefreshKey(k => k + 1); }, 3000);
    } catch (e) {
      let msg = e instanceof Error ? e.message : 'Add liquidity failed';
      if (msg.toLowerCase().includes('no utxo')) msg = 'No BTC UTXOs. Get testnet BTC: https://faucet.opnet.org';
      setLpStep('');
      setLpResult({ ok: false, msg });
    } finally {
      setAddingLP(false);
    }
  }, [walletAddress, walletInstance, lpMineAmt, lpVibeAmt, provider, senderAddr, openConnectModal]);

  /** Auto-calculate VIBE amount based on current pool ratio */
  useEffect(() => {
    const mineAmt = parseFloat(lpMineAmt);
    if (mineAmt > 0 && reserveA > 0 && reserveB > 0) {
      const vibeNeeded = mineAmt * (reserveB / reserveA);
      setLpVibeAmt(vibeNeeded.toFixed(2));
    }
  }, [lpMineAmt, reserveA, reserveB]);

  useEffect(() => {
    if (fromIdx === toIdx) setToIdx(fromIdx === 0 ? 1 : 0);
  }, [fromIdx, toIdx]);

  /** Deploy a new SimplePool for any token pair */
  const createPool = useCallback(async () => {
    if (!walletAddress || !walletInstance) { openConnectModal(); return; }
    if (!poolTokenA || !poolTokenB) return;
    if (poolTokenA === poolTokenB) { setPoolDeployResult({ ok: false, msg: 'Token A and B must be different' }); return; }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inst = walletInstance as any;
    const web3 = inst.web3 || inst;
    if (!web3?.deployContract) { setPoolDeployResult({ ok: false, msg: 'Wallet does not support deployment. Use OP_WALLET.' }); return; }

    setDeployingPool(true); setPoolDeployResult(null);
    try {
      setPoolDeployStep('Loading SimplePool bytecode...');
      const base = import.meta.env.BASE_URL || '/';
      const resp = await fetch(`${base}wasm/SimplePool.wasm`);
      if (!resp.ok) throw new Error('Failed to load SimplePool.wasm');
      const bytecode = new Uint8Array(await resp.arrayBuffer());

      setPoolDeployStep('Encoding token addresses...');
      const writer = new BinaryWriter();
      writer.writeAddress(Address.fromString(poolTokenA));
      writer.writeAddress(Address.fromString(poolTokenB));

      setPoolDeployStep('Fetching UTXOs...');
      const provider2 = getProvider();
      const utxos = await provider2.utxoManager.getUTXOs({ address: walletAddress });
      if (!utxos?.length) throw new Error('No UTXOs. Get testnet BTC from faucet.');

      setPoolDeployStep('Sign in your wallet...');
      const result = await web3.deployContract({
        bytecode, calldata: writer.getBuffer(), utxos, from: walletAddress,
        feeRate: 10, priorityFee: 10_000n, gasSatFee: 100_000n,
        revealMLDSAPublicKey: true, linkMLDSAPublicKeyToAddress: true,
      });

      setPoolDeployStep('Broadcasting...');
      const [fundingTx, deployTx] = result.transaction;
      if (fundingTx) await provider2.sendRawTransaction(fundingTx, false);
      if (deployTx) await provider2.sendRawTransaction(deployTx, false);

      let txid = '';
      try { txid = Transaction.fromHex(deployTx || fundingTx || '').getId(); } catch {}

      const newPool: UserPool = {
        address: result.contractAddress || txid,
        tokenA: poolTokenA, tokenB: poolTokenB,
        symbolA: poolSymA || poolTokenA.slice(-6).toUpperCase(),
        symbolB: poolSymB || poolTokenB.slice(-6).toUpperCase(),
        deployedAt: Date.now(), deployer: walletAddress,
      };

      const updatedPools = [...userPools, newPool];
      setUserPools(updatedPools);
      localStorage.setItem('hub_user_pools', JSON.stringify(updatedPools));

      setPoolDeployResult({ ok: true, msg: `Pool deployed at ${newPool.address}`, address: newPool.address });
      setCreatePoolOpen(false);
      setPoolTokenA(''); setPoolTokenB(''); setPoolSymA(''); setPoolSymB('');
      setPoolSeedA(''); setPoolSeedB('');
    } catch (e) {
      setPoolDeployResult({ ok: false, msg: e instanceof Error ? e.message : 'Deployment failed' });
    } finally {
      setDeployingPool(false);
      setPoolDeployStep('');
    }
  }, [walletAddress, walletInstance, poolTokenA, poolTokenB, poolSymA, poolSymB, userPools, openConnectModal]);

  const selectStyle: React.CSSProperties = {
    background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: '14px',
    color: 'var(--w)', padding: '8px 12px', fontSize: '.82rem', fontWeight: 700,
    fontFamily: 'var(--ff)', cursor: 'pointer', outline: 'none',
    flexShrink: 0, minWidth: 120, maxWidth: 140, whiteSpace: 'nowrap',
    textOverflow: 'ellipsis', overflow: 'hidden', appearance: 'none' as const,
    WebkitAppearance: 'none' as const,
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%238b95a9' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
    paddingRight: '28px',
  };

  const connected = !!walletAddress;

  const iStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 12,
    background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
    fontSize: '.78rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box' as const,
  };

  return (
    <div>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* ── Main tabs ── */}
        <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
          {(['swap', 'pools'] as SwapMainTab[]).map(t => (
            <button key={t} onClick={() => setMainTab(t)}
              style={{ padding: '9px 22px', borderRadius: 12, border: '1px solid ' + (mainTab === t ? 'rgba(247,147,26,.4)' : 'var(--bd)'),
                background: mainTab === t ? 'rgba(247,147,26,.08)' : 'var(--bg3)',
                color: mainTab === t ? 'var(--o)' : 'var(--t3)',
                fontSize: '.8rem', cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 700, textTransform: 'capitalize' as const }}>
              {t === 'swap' ? 'Swap' : 'Pools'}
            </button>
          ))}
        </div>

        {/* ══════════════════════════════════
             POOLS TAB
           ══════════════════════════════════ */}
        {mainTab === 'pools' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1rem', color: 'var(--w)' }}>Liquidity Pools</div>
                <div style={{ fontSize: '.66rem', color: 'var(--t4)', marginTop: 2 }}>Create a pool for any OP20 token pair. Earn 0.3% fees on every swap.</div>
              </div>
              <button onClick={() => setCreatePoolOpen(v => !v)} className="lbtn" style={{ padding: '9px 16px', fontSize: '.74rem', flexShrink: 0 }}>
                + Create Pool
              </button>
            </div>

            {/* Create pool form */}
            {createPoolOpen && (
              <div className="P" style={{ padding: 18, marginBottom: 14 }}>
                <div className="Lb" style={{ marginBottom: 12 }}>New Liquidity Pool</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Token A Address</label>
                    <input style={iStyle} value={poolTokenA} onChange={e => setPoolTokenA(e.target.value)} placeholder="opt1sq..." />
                  </div>
                  <div>
                    <label style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Token B Address</label>
                    <input style={iStyle} value={poolTokenB} onChange={e => setPoolTokenB(e.target.value)} placeholder="opt1sq..." />
                  </div>
                  <div>
                    <label style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Symbol A (optional)</label>
                    <input style={iStyle} value={poolSymA} onChange={e => setPoolSymA(e.target.value)} placeholder="e.g. MINE" />
                  </div>
                  <div>
                    <label style={{ fontSize: '.62rem', color: 'var(--t4)', marginBottom: 3, display: 'block' }}>Symbol B (optional)</label>
                    <input style={iStyle} value={poolSymB} onChange={e => setPoolSymB(e.target.value)} placeholder="e.g. VIBE" />
                  </div>
                </div>

                {poolDeployResult && (
                  <div style={{ padding: '9px 12px', borderRadius: 10, fontSize: '.68rem', marginBottom: 10,
                    background: poolDeployResult.ok ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)',
                    color: poolDeployResult.ok ? 'var(--g)' : '#ef4444',
                    border: '1px solid ' + (poolDeployResult.ok ? 'rgba(16,185,129,.15)' : 'rgba(239,68,68,.15)') }}>
                    {poolDeployResult.msg}
                    {poolDeployResult.address && (
                      <a href={getContractOpscanUrl(poolDeployResult.address)} target="_blank" rel="noopener noreferrer"
                        style={{ display: 'block', marginTop: 4, color: 'var(--c2)', fontSize: '.62rem' }}>View on Explorer →</a>
                    )}
                  </div>
                )}

                <button onClick={createPool} disabled={deployingPool || !poolTokenA || !poolTokenB}
                  className="lbtn" style={{ width: '100%', opacity: deployingPool ? 0.6 : 1 }}>
                  {deployingPool ? (poolDeployStep || 'Deploying...') : connected ? 'Deploy SimplePool' : 'Connect Wallet'}
                </button>
                <div style={{ marginTop: 8, fontSize: '.56rem', color: 'var(--t4)', textAlign: 'center' }}>
                  Deploys SimplePool.wasm on-chain. Costs ~100K sats gas. Earn 0.3% on all swaps in your pool.
                </div>
              </div>
            )}

            {/* System pool — always shown */}
            <div style={{ marginBottom: 8 }}>
              <div style={{ fontSize: '.6rem', color: 'var(--t4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>System Pools</div>
              <div style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14, padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontWeight: 700, fontSize: '.84rem' }}>⛏️ MINE / ⚡ VIBE</span>
                    <span style={{ padding: '2px 7px', borderRadius: 6, fontSize: '.52rem', background: 'rgba(16,185,129,.1)', color: 'var(--g)', fontWeight: 700 }}>LIVE</span>
                  </div>
                  <span style={{ fontSize: '.62rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>Fee: 0.3%</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, fontSize: '.66rem' }}>
                  <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--t4)', marginBottom: 2 }}>MINE</div>
                    <div style={{ fontFamily: 'var(--fm)', color: 'var(--t2)', fontWeight: 600 }}>{reserveA.toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--t4)', marginBottom: 2 }}>VIBE</div>
                    <div style={{ fontFamily: 'var(--fm)', color: 'var(--t2)', fontWeight: 600 }}>{reserveB.toLocaleString()}</div>
                  </div>
                  <div style={{ textAlign: 'center', padding: '8px', background: 'rgba(255,255,255,.03)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--t4)', marginBottom: 2 }}>Rate</div>
                    <div style={{ fontFamily: 'var(--fm)', color: 'var(--o)', fontWeight: 600 }}>{reserveA > 0 ? (reserveB / reserveA).toFixed(1) : '—'}</div>
                  </div>
                </div>
                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                  <button onClick={() => { setMainTab('swap'); setShowLiquidity(true); }}
                    style={{ flex: 1, padding: '7px', borderRadius: 9, border: '1px solid rgba(14,165,233,.2)', background: 'rgba(14,165,233,.05)', color: '#0ea5e9', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', fontWeight: 600 }}>
                    💧 Add Liquidity
                  </button>
                  <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
                    style={{ flex: 1, padding: '7px', borderRadius: 9, border: '1px solid var(--bd)', background: 'transparent', color: 'var(--t4)', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', textAlign: 'center', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    OPScan ↗
                  </a>
                </div>
              </div>
            </div>

            {/* User-created pools */}
            {userPools.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: '.6rem', color: 'var(--t4)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>Your Pools</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {userPools.map(pool => (
                    <div key={pool.address} style={{ background: 'var(--bg3)', border: '1px solid var(--bd)', borderRadius: 14, padding: 14 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                        <span style={{ fontWeight: 700, fontSize: '.82rem' }}>{pool.symbolA} / {pool.symbolB}</span>
                        <span style={{ fontSize: '.56rem', color: 'var(--t4)', fontFamily: 'var(--fm)' }}>
                          {new Date(pool.deployedAt).toLocaleDateString()}
                        </span>
                      </div>
                      <div style={{ fontSize: '.6rem', color: 'var(--t4)', wordBreak: 'break-all', marginBottom: 8, fontFamily: 'var(--fm)' }}>
                        {pool.address}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <a href={getContractOpscanUrl(pool.address)} target="_blank" rel="noopener noreferrer"
                          style={{ flex: 1, padding: '6px', borderRadius: 8, border: '1px solid var(--bd)', color: 'var(--t4)', fontSize: '.64rem', textAlign: 'center', textDecoration: 'none', fontFamily: 'var(--ff)' }}>
                          View on OPScan ↗
                        </a>
                        <button onClick={() => { const u = userPools.filter(p => p.address !== pool.address); setUserPools(u); localStorage.setItem('hub_user_pools', JSON.stringify(u)); }}
                          style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid rgba(239,68,68,.15)', background: 'rgba(239,68,68,.04)', color: '#ef4444', fontSize: '.64rem', cursor: 'pointer', fontFamily: 'var(--ff)' }}>
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {userPools.length === 0 && !createPoolOpen && (
              <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--t4)', fontSize: '.78rem' }}>
                <div style={{ fontSize: '2rem', marginBottom: 8 }}>💧</div>
                No user pools yet. Create the first one for your token!
              </div>
            )}
          </div>
        )}

        {/* ══════════════════════════════════
             SWAP TAB
           ══════════════════════════════════ */}
        {mainTab === 'swap' && (<>
        <div style={{
          padding: '24px 22px', position: 'relative', borderRadius: 22,
          background: 'rgba(10,10,18,.6)', border: '1px solid rgba(255,255,255,.06)',
          backdropFilter: 'blur(20px)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '.95rem', fontWeight: 800, color: 'var(--w)', letterSpacing: '-.02em' }}>Swap</span>
              {connected && <span style={{ fontSize: '.5rem', background: 'rgba(16,185,129,.08)', color: '#10b981', padding: '3px 8px', borderRadius: 6, fontWeight: 700 }}>LIVE</span>}
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <button onClick={() => { setShowLiquidity(!showLiquidity); setShowSettings(false); }} style={{
                background: showLiquidity ? 'rgba(14,165,233,.1)' : 'rgba(255,255,255,.03)', border: '1px solid ' + (showLiquidity ? 'rgba(14,165,233,.25)' : 'rgba(255,255,255,.06)'), borderRadius: 10,
                color: showLiquidity ? '#0ea5e9' : 'var(--t4)', padding: '6px 10px', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', transition: 'all .2s'
              }}>💧</button>
              <button onClick={() => { setShowSettings(!showSettings); setShowLiquidity(false); }} style={{
                background: 'rgba(255,255,255,.03)', border: '1px solid rgba(255,255,255,.06)', borderRadius: 10,
                color: 'var(--t4)', padding: '6px 10px', fontSize: '.68rem', cursor: 'pointer', fontFamily: 'var(--ff)', transition: 'all .2s'
              }}>⚙ {slippage}%</button>
            </div>
          </div>

          {showSettings && (
            <div style={{ marginBottom: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: '14px', border: '1px solid var(--bd)' }}>
              <div style={{ fontSize: '.65rem', color: 'var(--t3)', marginBottom: 6, fontWeight: 600 }}>Slippage Tolerance</div>
              <div style={{ display: 'flex', gap: 6 }}>
                {[0.1, 0.5, 1.0, 3.0].map(s => (
                  <button key={s} onClick={() => { setSlippage(s); setShowSettings(false); }} style={{
                    flex: 1, padding: '6px', borderRadius: '14px',
                    background: slippage === s ? 'rgba(247,147,26,.08)' : 'rgba(255,255,255,.04)',
                    border: `1px solid ${slippage === s ? 'rgba(247,147,26,.2)' : 'var(--bd)'}`,
                    color: slippage === s ? 'var(--o)' : 'var(--t2)', fontSize: '.75rem', fontWeight: 600,
                    cursor: 'pointer', fontFamily: 'var(--ff)'
                  }}>{s}%</button>
                ))}
              </div>
            </div>
          )}

          {/* Liquidity Modal */}
          <LiquidityModal
            open={showLiquidity}
            onClose={() => setShowLiquidity(false)}
            reserveA={reserveA}
            reserveB={reserveB}
            balances={balances}
            onRefresh={() => { fetchReserves(); setBalRefreshKey(k => k + 1); }}
          />

          {/* From */}
          <div style={{ padding: '16px', background: 'rgba(255,255,255,.025)', borderRadius: 16, border: '1px solid rgba(255,255,255,.05)', marginBottom: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)', fontWeight: 500 }}>From</span>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)' }}>Balance: {fmtBal(fromBal, from.decimals)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="text" inputMode="decimal" value={fromAmt}
                onChange={e => { setFromAmt(e.target.value); setSwapResult(null); }}
                placeholder="0.0"
                style={{ flex: 1, background: 'none', border: 'none', color: 'var(--w)', fontSize: '1.4rem', fontFamily: 'var(--fm)', fontWeight: 700, outline: 'none', minWidth: 0 }}
              />
              {fromBal != null && fromBal > 0n && (
                <button onClick={() => setFromAmt((Number(fromBal) / Math.pow(10, from.decimals)).toString())} style={{
                  background: 'rgba(247,147,26,.08)', border: '1px solid rgba(247,147,26,.2)', borderRadius: 6,
                  color: 'var(--o)', fontSize: '.6rem', fontWeight: 700, padding: '2px 6px', cursor: 'pointer', fontFamily: 'var(--ff)'
                }}>MAX</button>
              )}
              <select value={fromIdx} onChange={e => setFromIdx(Number(e.target.value))} style={selectStyle}>
                {TOKENS.map((t, i) => <option key={t.symbol} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Flip */}
          <div style={{ display: 'flex', justifyContent: 'center', margin: '-6px 0', position: 'relative', zIndex: 2 }}>
            <button onClick={flip} style={{
              width: 34, height: 34, borderRadius: '50%',
              background: 'linear-gradient(135deg, var(--o), var(--o2))',
              border: '3px solid rgba(10,10,18,.8)', color: '#000', fontSize: '.9rem',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              transition: 'transform .25s cubic-bezier(.4,0,.2,1)', fontWeight: 700,
              boxShadow: '0 2px 12px rgba(247,147,26,.2)',
            }}
              onMouseEnter={e => (e.currentTarget.style.transform = 'rotate(180deg)')}
              onMouseLeave={e => (e.currentTarget.style.transform = 'rotate(0deg)')}
            >↕</button>
          </div>

          {/* To */}
          <div style={{ padding: '16px', background: 'rgba(255,255,255,.025)', borderRadius: 16, border: '1px solid rgba(255,255,255,.05)', marginTop: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)', fontWeight: 500 }}>To (estimated)</span>
              <span style={{ fontSize: '.62rem', color: 'var(--t4)' }}>Balance: {fmtBal(toBal, to.decimals)}</span>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div style={{ flex: 1, fontSize: '1.4rem', fontFamily: 'var(--fm)', fontWeight: 700, color: toVal > 0 ? 'var(--w)' : 'var(--t4)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {toVal > 0 ? toVal.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '0.0'}
              </div>
              <select value={toIdx} onChange={e => setToIdx(Number(e.target.value))} style={selectStyle}>
                {TOKENS.map((t, i) => <option key={t.symbol} value={i}>{t.icon} {t.symbol}</option>)}
              </select>
            </div>
          </div>

          {/* Rate info */}
          {fromVal > 0 && hasPool && (
            <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--bg3)', borderRadius: '14px', border: '1px solid var(--bd)', fontSize: '.72rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>Rate</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>1 {from.symbol} = {rate.toLocaleString(undefined, { maximumFractionDigits: 4 })} {to.symbol}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>LP Fee (0.3%)</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{fee.toFixed(4)} {from.symbol}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: 'var(--t3)' }}>Price Impact</span>
                <span style={{ color: priceImpact > 1 ? 'var(--r)' : 'var(--g)', fontFamily: 'var(--fm)' }}>{priceImpact.toFixed(2)}%</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--t3)' }}>Min. Received</span>
                <span style={{ color: 'var(--t2)', fontFamily: 'var(--fm)' }}>{(toVal * (1 - slippage / 100)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {to.symbol}</span>
              </div>
            </div>
          )}

          {/* Pool badge */}
          {hasPool && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: '.6rem', color: 'var(--t4)' }}>
              <span style={{ width: 5, height: 5, borderRadius: '50%', background: poolReady ? 'var(--g)' : 'var(--y)', display: 'inline-block' }} />
              Pool: {reserveA.toLocaleString()} MINE / {reserveB.toLocaleString()} VIBE {poolReady ? '(on-chain)' : '(deploying)'}
            </div>
          )}

          {/* BTC Balance indicator */}
          {connected && balances.BTC != null && (
            <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(255,255,255,.03)', borderRadius: 10, fontSize: '.6rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--t4)' }}>BTC Balance</span>
              <span style={{ fontFamily: 'var(--fm)', color: Number(balances.BTC) < 5000 ? 'var(--r)' : 'var(--t2)' }}>
                {(Number(balances.BTC) / 1e8).toFixed(6)} BTC ({Number(balances.BTC).toLocaleString()} sats)
                {Number(balances.BTC) < 5000 && <span style={{ color: 'var(--r)', marginLeft: 4 }}>· Need ~5K sats min</span>}
              </span>
            </div>
          )}

          {/* Swap / Connect button */}
          {connected ? (
            <button onClick={doSwap}
              disabled={!fromVal || fromVal <= 0 || swapping || !hasPool}
              style={{
                width: '100%', padding: '14px', marginTop: 10,
                background: fromVal > 0 && hasPool ? 'linear-gradient(135deg, var(--o), var(--o2))' : 'rgba(30,30,50,.8)',
                border: 'none', borderRadius: '14px',
                color: fromVal > 0 && hasPool ? '#000' : 'var(--t4)', fontWeight: 700, fontSize: '.92rem',
                cursor: fromVal > 0 && hasPool ? 'pointer' : 'not-allowed',
                fontFamily: 'var(--ff)', transition: 'all .2s',
                boxShadow: fromVal > 0 && hasPool ? '0 4px 16px rgba(247, 147, 26, .25)' : 'none',
                opacity: swapping ? 0.7 : 1
              }}>
              {swapping ? (swapStep || 'Processing...') : !poolReady ? 'Pool deploying soon...' : !hasPool ? 'No pool for this pair' : fromVal > 0 ? `Swap ${from.symbol} → ${to.symbol}` : 'Enter an amount'}
            </button>
          ) : (
            <button onClick={openConnectModal} style={{
              width: '100%', padding: '14px', marginTop: 10,
              background: 'linear-gradient(135deg, #0ea5e9, #0284c7)', border: 'none', borderRadius: '14px',
              color: '#fff', fontWeight: 700, fontSize: '.92rem', cursor: 'pointer', fontFamily: 'var(--ff)'
            }}>Connect Wallet to Swap</button>
          )}

          {/* Result */}
          {swapResult && (
            <div style={{ marginTop: 12, padding: '10px 12px',
              background: swapResult.type === 'error' ? 'rgba(239,68,68,.06)' : 'rgba(16,185,129,.06)',
              border: `1px solid ${swapResult.type === 'error' ? 'rgba(239,68,68,.2)' : 'rgba(16,185,129,.15)'}`,
              borderRadius: '14px', fontSize: '.72rem' }}>
              {swapResult.type === 'success' && (
                <>
                  <div style={{ color: 'var(--g)', fontWeight: 700, marginBottom: 4 }}>✓ Swap Executed On-Chain</div>
                  <div style={{ color: 'var(--t2)', fontSize: '.7rem' }}>Received: {swapResult.amtOut} {to.symbol}</div>
                  <div style={{ fontFamily: 'var(--fm)', color: 'var(--t3)', wordBreak: 'break-all', fontSize: '.58rem', marginTop: 4 }}>tx: {swapResult.hash}</div>
                  <a href={getTxUrl(swapResult.hash!)} target="_blank" rel="noopener noreferrer"
                    style={{ color: 'var(--c2)', fontSize: '.65rem', marginTop: 4, display: 'block' }}>View on Explorer →</a>
                </>
              )}
              {swapResult.type === 'error' && (
                <>
                  <div style={{ color: '#ef4444', fontWeight: 700, marginBottom: 4 }}>Transaction Failed</div>
                  <div style={{ color: 'var(--t2)', fontSize: '.7rem' }}>{swapResult.error}</div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Mint tokens */}
        <div style={{ marginTop: 14, padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: '.52rem', color: '#4a5568', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em' }}>Mint Testnet Tokens</span>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {Object.entries(TESTNET_CONTRACTS).map(([sym]) => (
              <button key={sym} onClick={() => mintTokens(sym)} disabled={minting === sym}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10, border: 'none', cursor: minting === sym ? 'wait' : 'pointer',
                  background: 'linear-gradient(135deg, #a855f7, #7c3aed)', color: '#fff',
                  fontSize: '.68rem', fontWeight: 700, fontFamily: "'Inter', sans-serif", opacity: minting === sym ? .5 : 1,
                }}>
                {minting === sym ? '...' : `1K ${sym}`}
              </button>
            ))}
          </div>
          {mintResult && (
            <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 10, fontSize: '.65rem', wordBreak: 'break-all',
              background: mintResult.ok ? 'rgba(16,185,129,.06)' : 'rgba(239,68,68,.06)',
              color: mintResult.ok ? '#10b981' : '#ef4444' }}>
              {mintResult.msg}
            </div>
          )}
        </div>

        {/* Pool reserves + LP position compact */}
        <div style={{ marginTop: 10, padding: '14px 18px', borderRadius: 14, background: 'rgba(255,255,255,.015)', border: '1px solid rgba(255,255,255,.04)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.68rem' }}>
            <span style={{ color: '#4a5568' }}>Pool</span>
            <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#fff', fontWeight: 600 }}>
              {reserveA.toLocaleString()} / {reserveB.toLocaleString()}
            </span>
          </div>
          {lpUserMine > 0 && reserveA > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.68rem', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,.03)' }}>
              <span style={{ color: '#4a5568' }}>Your LP</span>
              <span style={{ fontFamily: "'JetBrains Mono', monospace", color: '#0ea5e9', fontWeight: 700 }}>
                {((lpUserMine / reserveA) * 100).toFixed(2)}%
              </span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.58rem', marginTop: 6, paddingTop: 6, borderTop: '1px solid rgba(255,255,255,.03)' }}>
            <span style={{ color: '#2d3548' }}>{poolReady ? 'Live' : 'Deploying...'}</span>
            <a href={getContractOpscanUrl(POOL_ADDRESS)} target="_blank" rel="noopener noreferrer"
              style={{ color: '#4a5568', textDecoration: 'none' }}>OPScan ↗</a>
          </div>
        </div>

        {/* Recent tx — compact */}
        {history.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {history.slice(0, 5).map(tx => (
              <div key={tx.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.03)', fontSize: '.65rem' }}>
                <span style={{ color: '#7a8494', fontWeight: 600 }}>
                  {tx.type === 'swap' ? `${tx.amountA} ${tx.tokenA} → ${tx.amountB} ${tx.tokenB}` : `+${Number(tx.amountA || 0).toLocaleString()} ${tx.tokenA}`}
                </span>
                <span style={{ color: '#2d3548', fontSize: '.55rem' }}>{formatTimeAgo(tx.ts)}</span>
              </div>
            ))}
          </div>
        )}
        </>)} {/* end mainTab === 'swap' */}
      </div>
    </div>
  );
};

export default SwapUI;
