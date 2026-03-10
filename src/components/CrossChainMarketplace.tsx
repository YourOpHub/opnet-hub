import React from 'react';
import { useCrossChain, resolveToken, getContractOpscanUrl, isUnisatInstalled, TOKEN_OPTIONS, DIR_SELL_TOKEN, DIR_BUY_TOKEN } from '../hooks/useCrossChain';
import { CROSSCHAIN_ADDRESS } from '../contracts';
import { SUPPORTED_CHAINS } from '../crosschain/chains';
import { OrderStatus } from '../crosschain/types';
import CrossChainOrderForm from './crosschain/CrossChainOrderForm';
import { MyOrderRow, AvailableOrderRow, MY_COLS, AV_COLS } from './crosschain/CrossChainOrderRow';
import { EscrowOrderCard } from './crosschain/CrossChainOrderActions';
import { satsToBtc } from './crosschain/types';

const fractalChain = SUPPORTED_CHAINS[0]!; // Fractal Bitcoin

// Token Bridge section hidden — functionality merged into Marketplace
const SHOW_TOKEN_BRIDGE = false as boolean;

const btnSmall: React.CSSProperties = {
  background: 'rgba(255,255,255,.08)', color: 'var(--t2)', border: '1px solid var(--bd)',
  borderRadius: 8, padding: '4px 10px', fontSize: '.68rem', fontWeight: 600, cursor: 'pointer',
};

/* ═══════════════════════════════════════════════════════════════
   FRACTALSWAP — Native BTC ↔ Fractal BTC Exchange
   ═══════════════════════════════════════════════════════════════ */
const CrossChainMarketplace: React.FC = () => {
  const {
    // Wallet state
    walletAddress,
    openConnectModal,
    unisat,
    unisatConnecting,
    handleConnectUnisat,
    handleDisconnectUnisat,

    // FractalSwap order state
    loading,
    currentBlock,
    expandedOrder,
    setExpandedOrder,
    feeBps,
    locks,

    // Create form state
    formDirection,
    setFormDirection,
    formAmount,
    setFormAmount,
    formReceive,
    setFormReceive,
    formMakerAddr,
    setFormMakerAddr,
    setMakerAddrManual,
    formExpiry,
    setFormExpiry,
    creating,
    createStep,

    // Action state
    actionStep,
    actioning,
    msg,

    // Preimage store
    preimageStore,

    // Contract readiness
    contractReady,
    escrowReady,

    // FractalSwap derived state
    activeOrders,
    myOrders,
    totalVolumeSats,
    availBuyFb,
    availGetBtc,
    isMyOrderFn,
    isTakerFn,
    mldsaHex,

    // Computed form values
    formAmountSats,
    formReceiveSats,
    formFeeSats,
    formRate,
    sendUnit,
    receiveUnit,

    // FractalSwap handlers
    fetchOrders,
    handleCreate,
    handleTake,
    handleTakeAndSwap,
    handleComplete,
    handleSendAndClaim,
    handleCancel,
    handleRefund,

    // Token Bridge state
    escrowOrders,
    escrowLoading,
    tbToken,
    setTbToken,
    tbDirection,
    setTbDirection,
    tbTokenAmount,
    setTbTokenAmount,
    tbBtcPrice,
    setTbBtcPrice,
    tbMakerAddr,
    setTbMakerAddr,
    tbExpiry,
    setTbExpiry,
    tbCreating,
    tbStep,

    // Token Bridge derived state
    activeEscrowOrders,
    sellTokenOrders,
    buyTokenOrders,
    selectedTbToken,
    tbTokenAmountRaw,
    tbBtcPriceSats,
    tbFeeSats,
    expiryOpts,

    // Token Bridge handlers
    handleTbCreate,
    handleTbTake,
    handleTbConfirm,
    handleTbCancel,
    handleTbRefund,
  } = useCrossChain();

  const iStyle: React.CSSProperties = {
    width: '100%', padding: '10px 12px', borderRadius: 12,
    background: 'var(--bg3)', border: '1px solid var(--bd)', color: 'var(--w)',
    fontSize: '.78rem', fontFamily: 'var(--fm)', outline: 'none', boxSizing: 'border-box',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block', fontSize: '.7rem', fontWeight: 600, color: 'var(--t2)',
    marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.04em',
  };

  return (
    <div>
      {/* Header */}
      <div className="flex-between-wrap gap-12 mb-16">
        <div>
          <h2 className="h-title">
            FractalSwap
          </h2>
          <p className="h-subtitle">
            Native BTC &#x2194; Fractal BTC exchange &#x2014; trustless atomic swaps, {feeBps / 100}% fee
          </p>
        </div>
        <div className="flex-center gap-8">
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            background: `${fractalChain.color}22`, color: fractalChain.color,
            padding: '6px 14px', borderRadius: 10, fontSize: '.76rem', fontWeight: 700,
            border: `1px solid ${fractalChain.color}44`,
          }}>
            {fractalChain.icon} {fractalChain.name}
          </span>
          {currentBlock > 0 && (
            <span className="fs-sm c-t3">Block #{currentBlock.toLocaleString()}</span>
          )}
        </div>
      </div>

      {/* Dual Wallet Connection */}
      <div className="Pg grid-2col mb-16" role="region" aria-label="Wallet connections" style={{ gap: 12 }}>
        {/* OPNet Wallet */}
        <div className="cc-wallet-opnet">
          <div className="cc-wallet-label">
            OPNet Wallet
          </div>
          {walletAddress ? (
            <div>
              <div className="fs-72 text-mono c-w word-break">
                {walletAddress.slice(0, 12)}...{walletAddress.slice(-8)}
              </div>
              <div className="fs-66 mt-2 c-g">Connected</div>
            </div>
          ) : (
            <button className="btn-p fs-70 w-full" style={{ padding: '6px 12px' }}
              onClick={openConnectModal}>
              Connect OPWallet
            </button>
          )}
        </div>

        {/* UniSat Wallet (Fractal) */}
        <div className="cc-wallet-unisat">
          <div className="cc-wallet-label">
            UniSat Wallet (Fractal)
          </div>
          {unisat.connected ? (
            <div>
              <div className="fs-72 text-mono c-w word-break">
                {unisat.address.slice(0, 12)}...{unisat.address.slice(-8)}
              </div>
              <div className="flex-between mt-2">
                <span className="fs-66 c-g">
                  {(unisat.balance.total / 1e8).toFixed(6)} FB
                </span>
                <button style={{ ...btnSmall, fontSize: '.6rem', padding: '2px 6px' }} onClick={handleDisconnectUnisat}>
                  Disconnect
                </button>
              </div>
              {unisat.chain.enum && (
                <div className="fs-xs c-t3 mt-2">
                  {unisat.chain.name}
                </div>
              )}
            </div>
          ) : (
            <button className="btn-p" style={{
              fontSize: '.7rem', padding: '6px 12px', width: '100%',
              background: isUnisatInstalled() ? undefined : 'rgba(107,114,128,.3)',
            }}
              disabled={unisatConnecting}
              onClick={handleConnectUnisat}>
              {unisatConnecting ? 'Connecting...' : isUnisatInstalled() ? 'Connect UniSat' : 'Install UniSat Wallet'}
            </button>
          )}
        </div>
      </div>

      {/* Token Bridge removed — functionality merged into Marketplace */}
      {SHOW_TOKEN_BRIDGE && (
        <>
          {/* Contract not deployed notice */}
          {!escrowReady && (
            <div className="Pg text-center mb-16" style={{ padding: '32px 20px' }}>
              <div className="empty-icon">{'\u{1F6A7}'}</div>
              <h3 className="fw-800" style={{ margin: '0 0 8px' }}>Token Escrow Contract Pending</h3>
              <p className="c-t2 fs-82" style={{ maxWidth: 500, margin: '0 auto' }}>
                The TokenEscrowBridge contract is ready for deployment. Once deployed,
                you can trade OP-20 tokens for BTC with trustless escrow.
              </p>
              <div className="mt-12 fs-72 c-t3">
                <code>cd deploy/OP_20 && npx asc --target tokenescrow</code>
              </div>
            </div>
          )}

          {/* Stats */}
          <div className="grid-3col gap-10 mb-16">
            <div className="Pg p-14-center text-center">
              <div className="stat-label">Active Orders</div>
              <div className="stat-val">{activeEscrowOrders.length}</div>
            </div>
            <div className="Pg p-14-center text-center">
              <div className="stat-label">Sell Orders</div>
              <div className="stat-val c-r">{sellTokenOrders.length}</div>
            </div>
            <div className="Pg p-14-center text-center">
              <div className="stat-label">Buy Orders</div>
              <div className="stat-val c-g">{buyTokenOrders.length}</div>
            </div>
          </div>

          {/* Create Token Escrow Order */}
          <div className="Pg mb-16">
            <div className="fw-700-fs82-mb10 mb-12">Create Token Escrow Order</div>

            {/* Direction toggle */}
            <div className="flex-gap8-mb12">
              <button
                className={`${tbDirection === DIR_SELL_TOKEN ? 'btn-p' : 'btn-s'} flex-1 fs-76`}
                style={{ padding: '10px 0' }}
                onClick={() => setTbDirection(DIR_SELL_TOKEN)}
              >
                Sell Tokens for BTC
              </button>
              <button
                className={`${tbDirection === DIR_BUY_TOKEN ? 'btn-p' : 'btn-s'} flex-1 fs-76`}
                style={{ padding: '10px 0' }}
                onClick={() => setTbDirection(DIR_BUY_TOKEN)}
              >
                Buy Tokens with BTC
              </button>
            </div>

            {/* Token selector */}
            <div className="mb-12">
              <label style={labelStyle}>Token</label>
              <div className="flex-center gap-6">
                {TOKEN_OPTIONS.map(tok => (
                  <button key={tok.address}
                    className={`${tbToken === tok.address ? 'btn-p' : 'btn-s'} fs-76 fw-700`}
                    style={{ padding: '8px 16px' }}
                    onClick={() => setTbToken(tok.address)}
                  >
                    {tok.icon} {tok.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid-2col gap-10">
              {/* Token Amount */}
              <div>
                <label style={labelStyle}>Token Amount ({selectedTbToken?.symbol || 'TOKEN'})</label>
                <input style={iStyle} type="number" placeholder="1000" value={tbTokenAmount}
                  onChange={e => setTbTokenAmount(e.target.value)} min="0" step="any" />
                {tbTokenAmountRaw > 0n && (
                  <div className="fs-66 c-t3 mt-2">
                    = {tbTokenAmountRaw.toLocaleString()} raw units
                  </div>
                )}
              </div>

              {/* BTC Price */}
              <div>
                <label style={labelStyle}>BTC Price (total sats)</label>
                <input style={iStyle} type="number" placeholder="0.001" value={tbBtcPrice}
                  onChange={e => setTbBtcPrice(e.target.value)} min="0" step="any" />
                {tbBtcPriceSats > 0n && (
                  <div className="fs-66 c-o mt-2 fw-600">
                    = {Number(tbBtcPriceSats).toLocaleString()} sats
                  </div>
                )}
              </div>

              {/* Expiry */}
              <div>
                <label style={labelStyle}>Expiry</label>
                <select style={iStyle as React.CSSProperties} value={tbExpiry} onChange={e => setTbExpiry(e.target.value)}>
                  <option value={String(expiryOpts.min)}>~12h ({expiryOpts.min} blocks)</option>
                  <option value={String(expiryOpts.default)}>~24h ({expiryOpts.default} blocks) - Recommended</option>
                  <option value="288">~48h (288 blocks)</option>
                  <option value={String(expiryOpts.max)}>~4 days ({expiryOpts.max} blocks)</option>
                </select>
              </div>

              {/* Your receiving address */}
              <div>
                <label style={labelStyle}>
                  Your Receiving Address (for {tbDirection === DIR_SELL_TOKEN ? 'BTC' : 'tokens'})
                </label>
                <input style={iStyle}
                  placeholder={tbDirection === DIR_SELL_TOKEN ? 'bc1p... or opt1...' : 'opt1...'}
                  value={tbMakerAddr}
                  onChange={e => setTbMakerAddr(e.target.value)} />
              </div>
            </div>

            {/* Summary */}
            {tbTokenAmountRaw > 0n && tbBtcPriceSats > 0n && (
              <div className="mt-10 fs-76 c-t2 flex-center flex-wrap gap-16">
                <span>
                  {tbDirection === DIR_SELL_TOKEN ? 'Selling' : 'Buying'}: <b className="c-w">
                    {tbTokenAmount} {selectedTbToken?.symbol}
                  </b>
                </span>
                <span>
                  For: <b className="c-o">{satsToBtc(tbBtcPriceSats)}</b>
                </span>
                <span>
                  Taker fee: <b>{Number(tbFeeSats).toLocaleString()} sats</b>
                </span>
                {tbDirection === DIR_SELL_TOKEN && (
                  <span className="c-y fs-70">
                    Tokens will be locked in contract on creation
                  </span>
                )}
              </div>
            )}

            {tbStep && (
              <div className="mt-8 fs-72 c-o text-mono">
                {tbStep}
              </div>
            )}

            <button className="btn-p w-full mt-12" style={{ padding: '10px 0' }}
              disabled={tbCreating || !tbTokenAmount || !tbBtcPrice || !tbMakerAddr || !escrowReady || tbTokenAmountRaw <= 0n}
              onClick={handleTbCreate}
            >
              {tbCreating ? 'Creating...' : tbDirection === DIR_SELL_TOKEN ? 'Create Sell Order (Lock Tokens)' : 'Create Buy Order (Intent)'}
            </button>
          </div>

          {/* Order Book */}
          <div className="grid-2col gap-12">
            <div>
              <div className="fw-700 fs-78 mb-8 c-r">
                Selling Tokens ({sellTokenOrders.length})
              </div>
              {escrowLoading ? (
                <div className="Pg p-28-center-t3">Loading...</div>
              ) : sellTokenOrders.length === 0 ? (
                <div className="Pg p-28-center-t3">
                  <div className="empty-icon">📭</div>
                  <div className="fs-72">No sell orders yet</div>
                </div>
              ) : (
                sellTokenOrders.map(order => (
                  <EscrowOrderCard key={`tb_${order.id}`} order={order}
                    currentBlock={currentBlock} actioning={actioning} actionStep={actionStep}
                    feeBps={feeBps} mldsaHex={mldsaHex} preimageStore={preimageStore}
                    expandedOrder={expandedOrder} setExpandedOrder={setExpandedOrder}
                    tokenInfo={resolveToken(order.tokenHex)}
                    onTake={handleTbTake} onConfirm={handleTbConfirm}
                    onRefund={handleTbRefund} onCancel={handleTbCancel} />
                ))
              )}
            </div>
            <div>
              <div className="fs-78 fw-700 mb-8 c-g">
                Buying Tokens ({buyTokenOrders.length})
              </div>
              {escrowLoading ? (
                <div className="Pg p-28-center-t3">Loading...</div>
              ) : buyTokenOrders.length === 0 ? (
                <div className="Pg p-28-center-t3">
                  <div className="empty-icon">📭</div>
                  <div className="fs-72">No buy orders yet</div>
                </div>
              ) : (
                buyTokenOrders.map(order => (
                  <EscrowOrderCard key={`tb_${order.id}`} order={order}
                    currentBlock={currentBlock} actioning={actioning} actionStep={actionStep}
                    feeBps={feeBps} mldsaHex={mldsaHex} preimageStore={preimageStore}
                    expandedOrder={expandedOrder} setExpandedOrder={setExpandedOrder}
                    tokenInfo={resolveToken(order.tokenHex)}
                    onTake={handleTbTake} onConfirm={handleTbConfirm}
                    onRefund={handleTbRefund} onCancel={handleTbCancel} />
                ))
              )}
            </div>
          </div>

          {/* How it works */}
          <div className="Pg mt-20" style={{ padding: '16px 20px' }}>
            <div className="fw-700-fs82-mb10">How Token Bridge Works</div>
            <div className="grid-4col gap-12">
              {[
                { num: '1', title: 'Create Order', desc: 'Sell: tokens locked in contract. Buy: intent posted (no lock).' },
                { num: '2', title: 'Take Order', desc: 'Taker commits + pays fee. For buy orders, taker locks tokens.' },
                { num: '3', title: 'BTC Payment', desc: 'BTC buyer sends payment to counterparty\'s address.' },
                { num: '4', title: 'Reveal & Settle', desc: 'Reveal preimage to confirm swap. Tokens released to buyer.' },
              ].map(s => (
                <div key={s.num} className="text-center">
                  <div className="step-num step-num-yellow">{s.num}</div>
                  <div className="fs-72 fw-700 mb-4">{s.title}</div>
                  <div className="fs-66 c-t3 lh-14">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Explorer link */}
          {escrowReady && (
            <div className="mt-12 text-center">
              <a href={getContractOpscanUrl(escrowOrders.length > 0 ? escrowOrders[0]!.id : '')}
                target="_blank" rel="noopener noreferrer"
                className="fs-72 c-o no-decoration">
                View Token Escrow on OPScan &#x2192;
              </a>
            </div>
          )}
        </>
      )}

      {/* ═══════ FRACTALSWAP ═══════ */}
      {(
        <>
          {/* Contract not deployed notice */}
          {!contractReady && (
            <div className="Pg text-center mb-16" style={{ padding: '32px 20px' }}>
              <div className="empty-icon">{'\u{1F6A7}'}</div>
              <h3 className="fw-800" style={{ margin: '0 0 8px' }}>Contract Pending Deployment</h3>
              <p className="c-t2 fs-82" style={{ maxWidth: 500, margin: '0 auto' }}>
                The FractalSwap contract is ready. Once deployed to OPNet,
                you can swap native BTC with Fractal Bitcoin via trustless atomic swaps.
              </p>
              <div className="mt-12 fs-72 c-t3">
                <code>cd deploy/OP_20 && npx asc src/crosschain/index.ts --target crosschain</code>
              </div>
            </div>
          )}

          {/* Stats bar */}
          <div className="grid-3col gap-10 mb-16" role="region" aria-label="FractalSwap statistics">
            <div className="Pg p-14-center text-center pointer" onClick={() => { fetchOrders(); }} role="button" tabIndex={0} aria-label="Refresh active orders" onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fetchOrders(); } }}>
              <div className="stat-label-ls">Active Orders ↻</div>
              <div className="stat-val">{activeOrders.length}</div>
            </div>
            <div className="Pg p-14-center text-center">
              <div className="stat-label-ls">Total Volume</div>
              <div className="stat-val c-o">{satsToBtc(totalVolumeSats)}</div>
            </div>
            <div className="Pg p-14-center text-center">
              <div className="stat-label-ls">Fee</div>
              <div className="stat-val c-p">{feeBps / 100}%</div>
            </div>
          </div>

          {/* Message */}
          {msg && (
            <div className="cc-msg mb-12" role="alert" aria-live="polite">
              {msg}
            </div>
          )}

          {/* Create Order Form */}
          <CrossChainOrderForm
            formDirection={formDirection}
            setFormDirection={setFormDirection}
            formAmount={formAmount}
            setFormAmount={setFormAmount}
            formReceive={formReceive}
            setFormReceive={setFormReceive}
            formMakerAddr={formMakerAddr}
            setFormMakerAddr={setFormMakerAddr}
            setMakerAddrManual={setMakerAddrManual}
            formExpiry={formExpiry}
            setFormExpiry={setFormExpiry}
            creating={creating}
            createStep={createStep}
            contractReady={contractReady}
            feeBps={feeBps}
            formAmountSats={formAmountSats}
            formReceiveSats={formReceiveSats}
            formFeeSats={formFeeSats}
            formRate={formRate}
            sendUnit={sendUnit}
            receiveUnit={receiveUnit}
            onSubmit={handleCreate}
          />

          {/* ── Your Orders (table) ── */}
          {myOrders.length > 0 && (
            <div className="P p-0-overflow-hidden mb-16">
              <div className="order-header c-y">
                <span className="order-dot" style={{
                  animation: myOrders.some(o => o.status === OrderStatus.Taken) ? 'pulse 2s infinite' : 'none',
                }} />
                Your Orders ({myOrders.length})
              </div>
              <div className="ob-scroll">
                <div className="ob-hdr" style={{ gridTemplateColumns: MY_COLS }}>
                  <span>#</span><span>Dir</span><span className="ob-r">BTC</span><span className="ob-r">FB</span>
                  <span className="ob-r">Rate</span><span>Status</span><span className="ob-r">Action</span>
                </div>
                {myOrders.map(order => (
                  <MyOrderRow
                    key={order.id}
                    order={order}
                    currentBlock={currentBlock}
                    actioning={actioning}
                    actionStep={actionStep}
                    isMyOrder={isMyOrderFn(order)}
                    isTaker={isTakerFn(order)}
                    unisatConnected={unisat.connected}
                    unisatConnecting={unisatConnecting}
                    onCancel={handleCancel}
                    onSendAndClaim={handleSendAndClaim}
                    onComplete={handleComplete}
                    onRefund={handleRefund}
                    onConnectUnisat={handleConnectUnisat}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Available Swaps — split by direction ── */}
          <div className="grid-2col gap-12 mb-16" role="region" aria-label="Available swaps">
            {/* Buy FB — taker pays BTC, gets FB */}
            <div className="P p-0-overflow-hidden">
              <div className="ob-section-hdr c-g fs-86">
                Buy FB
                <span className="ob-section-sub">pay BTC &#x2192; get FB</span>
                <span className="ob-badge ml-auto" style={{ background: 'rgba(34,197,94,.1)', color: '#22c55e' }}>{availBuyFb.length}</span>
              </div>
              {loading ? (
                <div className="p-28-center-t2">Loading...</div>
              ) : availBuyFb.length === 0 ? (
                <div className="ob-empty">
                  <div className="empty-icon-med">&#x1F517;</div>
                  No cross-chain swaps yet — create one above!
                </div>
              ) : (
                <div className="ob-scroll">
                  <div className="ob-hdr" style={{ gridTemplateColumns: AV_COLS }}>
                    <span className="ob-r c-g">You Get</span><span className="ob-r">You Pay</span>
                    <span className="ob-r">Rate</span>
                    <span className="ob-r">Action</span>
                  </div>
                  {availBuyFb.map(order => (
                    <AvailableOrderRow
                      key={order.id}
                      order={order}
                      currentBlock={currentBlock}
                      actioning={actioning}
                      actionStep={actionStep}
                      feeBps={feeBps}
                      isLocked={!!locks[`fractalswap:${order.id}`] && locks[`fractalswap:${order.id}`]?.locked_by !== walletAddress}
                      walletAddress={walletAddress}
                      unisatAddress={unisat.address || ''}
                      onTakeAndSwap={handleTakeAndSwap}
                      onTake={handleTake}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Get BTC — taker pays FB, gets BTC */}
            <div className="P p-0-overflow-hidden">
              <div className="ob-section-hdr c-y fs-86">
                Get BTC
                <span className="ob-section-sub">pay FB &#x2192; get BTC</span>
                <span className="ob-badge ml-auto" style={{ background: 'rgba(245,158,11,.1)', color: '#f59e0b' }}>{availGetBtc.length}</span>
              </div>
              {loading ? (
                <div className="p-28-center-t2">Loading...</div>
              ) : availGetBtc.length === 0 ? (
                <div className="ob-empty">
                  <div className="empty-icon-med">&#x1F517;</div>
                  No cross-chain swaps yet — create one above!
                </div>
              ) : (
                <div className="ob-scroll">
                  <div className="ob-hdr" style={{ gridTemplateColumns: AV_COLS }}>
                    <span className="ob-r c-g">You Get</span><span className="ob-r">You Pay</span>
                    <span className="ob-r">Rate</span>
                    <span className="ob-r">Action</span>
                  </div>
                  {availGetBtc.map(order => (
                    <AvailableOrderRow
                      key={order.id}
                      order={order}
                      currentBlock={currentBlock}
                      actioning={actioning}
                      actionStep={actionStep}
                      feeBps={feeBps}
                      isLocked={!!locks[`fractalswap:${order.id}`] && locks[`fractalswap:${order.id}`]?.locked_by !== walletAddress}
                      walletAddress={walletAddress}
                      unisatAddress={unisat.address || ''}
                      onTakeAndSwap={handleTakeAndSwap}
                      onTake={handleTake}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* How it works */}
          <div className="Pg mt-20" style={{ padding: '16px 20px' }}>
            <div className="fw-700-fs82-mb10">How It Works</div>
            <div className="grid-3col gap-12">
              {[
                { num: '1', title: 'Create Order', desc: 'Post what you want to swap. BTC is locked in the smart contract for safety.' },
                { num: '2', title: 'Take & Auto-Swap', desc: 'One click: pay fee \u2192 send Fractal BTC \u2192 claim locked BTC. Fully automatic.' },
                { num: '3', title: 'Done', desc: 'Both sides receive their funds. Track progress in the Operations panel.' },
              ].map(s => (
                <div key={s.num} className="text-center">
                  <div className="step-num step-num-purple">{s.num}</div>
                  <div className="fs-72 fw-700 mb-4">{s.title}</div>
                  <div className="fs-66 c-t3 lh-14">{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Explorer link */}
          {contractReady && (
            <div className="mt-12 text-center">
              <a href={getContractOpscanUrl(CROSSCHAIN_ADDRESS)}
                target="_blank" rel="noopener noreferrer"
                className="fs-72 c-o no-decoration">
                View contract on OPScan &#x2192;
              </a>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default CrossChainMarketplace;
