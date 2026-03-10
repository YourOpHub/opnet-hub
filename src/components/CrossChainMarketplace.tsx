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
          <h2 style={{ margin: 0, fontSize: '1.3rem', fontWeight: 800, letterSpacing: '-.02em' }}>
            FractalSwap
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: '.78rem', color: 'var(--t2)' }}>
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
      <div className="Pg" style={{ marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {/* OPNet Wallet */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(245,158,11,.06)', border: '1px solid rgba(245,158,11,.15)' }}>
          <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
            OPNet Wallet
          </div>
          {walletAddress ? (
            <div>
              <div className="fs-72 text-mono c-w word-break">
                {walletAddress.slice(0, 12)}...{walletAddress.slice(-8)}
              </div>
              <div className="fs-66 mt-2" style={{ color: 'var(--g)' }}>Connected</div>
            </div>
          ) : (
            <button className="btn-p" style={{ fontSize: '.7rem', padding: '6px 12px', width: '100%' }}
              onClick={openConnectModal}>
              Connect OPWallet
            </button>
          )}
        </div>

        {/* UniSat Wallet (Fractal) */}
        <div style={{ padding: '10px 14px', borderRadius: 10, background: 'rgba(139,92,246,.06)', border: '1px solid rgba(139,92,246,.15)' }}>
          <div style={{ fontSize: '.68rem', fontWeight: 700, color: '#8b5cf6', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 6 }}>
            UniSat Wallet (Fractal)
          </div>
          {unisat.connected ? (
            <div>
              <div className="fs-72 text-mono c-w word-break">
                {unisat.address.slice(0, 12)}...{unisat.address.slice(-8)}
              </div>
              <div className="flex-between mt-2">
                <span className="fs-66" style={{ color: 'var(--g)' }}>
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
      {false && (
        <>
          {/* Contract not deployed notice */}
          {!escrowReady && (
            <div className="Pg text-center mb-16" style={{ padding: '32px 20px' }}>
              <div className="empty-icon">{'\u{1F6A7}'}</div>
              <h3 style={{ margin: '0 0 8px', fontWeight: 800 }}>Token Escrow Contract Pending</h3>
              <p style={{ color: 'var(--t2)', fontSize: '.82rem', maxWidth: 500, margin: '0 auto' }}>
                The TokenEscrowBridge contract is ready for deployment. Once deployed,
                you can trade OP-20 tokens for BTC with trustless escrow.
              </p>
              <div className="mt-12 fs-72 c-t3">
                <code>cd deploy/OP_20 && npx asc --target tokenescrow</code>
              </div>
            </div>
          )}

          {/* Stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <div className="Pg p-14-center text-center">
              <div className="stat-label">Active Orders</div>
              <div className="stat-val">{activeEscrowOrders.length}</div>
            </div>
            <div className="Pg p-14-center text-center">
              <div className="stat-label">Sell Orders</div>
              <div className="stat-val" style={{ color: '#ef4444' }}>{sellTokenOrders.length}</div>
            </div>
            <div className="Pg p-14-center text-center">
              <div className="stat-label">Buy Orders</div>
              <div className="stat-val" style={{ color: '#22c55e' }}>{buyTokenOrders.length}</div>
            </div>
          </div>

          {/* Create Token Escrow Order */}
          <div className="Pg mb-16">
            <div className="fw-700-fs82-mb10" style={{ marginBottom: 12 }}>Create Token Escrow Order</div>

            {/* Direction toggle */}
            <div className="flex-gap8-mb12">
              <button
                className={tbDirection === DIR_SELL_TOKEN ? 'btn-p' : 'btn-s'}
                style={{ flex: 1, fontSize: '.76rem', padding: '10px 0' }}
                onClick={() => setTbDirection(DIR_SELL_TOKEN)}
              >
                Sell Tokens for BTC
              </button>
              <button
                className={tbDirection === DIR_BUY_TOKEN ? 'btn-p' : 'btn-s'}
                style={{ flex: 1, fontSize: '.76rem', padding: '10px 0' }}
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
                    className={tbToken === tok.address ? 'btn-p' : 'btn-s'}
                    style={{ padding: '8px 16px', fontSize: '.76rem', fontWeight: 700 }}
                    onClick={() => setTbToken(tok.address)}
                  >
                    {tok.icon} {tok.symbol}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
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
              <div style={{ marginTop: 10, fontSize: '.76rem', color: 'var(--t2)', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                <span>
                  {tbDirection === DIR_SELL_TOKEN ? 'Selling' : 'Buying'}: <b style={{ color: 'var(--w)' }}>
                    {tbTokenAmount} {selectedTbToken?.symbol}
                  </b>
                </span>
                <span>
                  For: <b style={{ color: 'var(--o)' }}>{satsToBtc(tbBtcPriceSats)}</b>
                </span>
                <span>
                  Taker fee: <b>{Number(tbFeeSats).toLocaleString()} sats</b>
                </span>
                {tbDirection === DIR_SELL_TOKEN && (
                  <span style={{ color: 'var(--y)', fontSize: '.7rem' }}>
                    Tokens will be locked in contract on creation
                  </span>
                )}
              </div>
            )}

            {tbStep && (
              <div style={{ marginTop: 8, fontSize: '.72rem', color: 'var(--o)', fontFamily: 'var(--fm)' }}>
                {tbStep}
              </div>
            )}

            <button className="btn-p" style={{ width: '100%', marginTop: 12, padding: '10px 0' }}
              disabled={tbCreating || !tbTokenAmount || !tbBtcPrice || !tbMakerAddr || !escrowReady || tbTokenAmountRaw <= 0n}
              onClick={handleTbCreate}
            >
              {tbCreating ? 'Creating...' : tbDirection === DIR_SELL_TOKEN ? 'Create Sell Order (Lock Tokens)' : 'Create Buy Order (Intent)'}
            </button>
          </div>

          {/* Order Book */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '.78rem', marginBottom: 8, color: '#ef4444' }}>
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
              <div className="fs-78 fw-700 mb-8" style={{ color: '#22c55e' }}>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[
                { num: '1', title: 'Create Order', desc: 'Sell: tokens locked in contract. Buy: intent posted (no lock).' },
                { num: '2', title: 'Take Order', desc: 'Taker commits + pays fee. For buy orders, taker locks tokens.' },
                { num: '3', title: 'BTC Payment', desc: 'BTC buyer sends payment to counterparty\'s address.' },
                { num: '4', title: 'Reveal & Settle', desc: 'Reveal preimage to confirm swap. Tokens released to buyer.' },
              ].map(s => (
                <div key={s.num} className="text-center">
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', background: 'rgba(245,158,11,.2)',
                    color: '#f59e0b', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 8px', fontWeight: 800, fontSize: '.82rem',
                  }}>{s.num}</div>
                  <div className="fs-72 fw-700 mb-4">{s.title}</div>
                  <div className="fs-66 c-t3" style={{ lineHeight: 1.4 }}>{s.desc}</div>
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
              <h3 style={{ margin: '0 0 8px', fontWeight: 800 }}>Contract Pending Deployment</h3>
              <p style={{ color: 'var(--t2)', fontSize: '.82rem', maxWidth: 500, margin: '0 auto' }}>
                The FractalSwap contract is ready. Once deployed to OPNet,
                you can swap native BTC with Fractal Bitcoin via trustless atomic swaps.
              </p>
              <div className="mt-12 fs-72 c-t3">
                <code>cd deploy/OP_20 && npx asc src/crosschain/index.ts --target crosschain</code>
              </div>
            </div>
          )}

          {/* Stats bar */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
            <div className="Pg p-14-center text-center" style={{ cursor: 'pointer' }} onClick={() => { fetchOrders(); }}>
              <div className="stat-label-ls">Active Orders ↻</div>
              <div className="stat-val">{activeOrders.length}</div>
            </div>
            <div className="Pg p-14-center text-center">
              <div className="stat-label-ls">Total Volume</div>
              <div className="stat-val c-o">{satsToBtc(totalVolumeSats)}</div>
            </div>
            <div className="Pg p-14-center text-center">
              <div className="stat-label-ls">Fee</div>
              <div className="stat-val" style={{ color: '#8b5cf6' }}>{feeBps / 100}%</div>
            </div>
          </div>

          {/* Message */}
          {msg && (
            <div style={{
              background: 'rgba(34,197,94,.12)', border: '1px solid rgba(34,197,94,.3)',
              borderRadius: 12, padding: '10px 16px', marginBottom: 12,
              fontSize: '.78rem', color: '#22c55e', fontWeight: 600,
            }}>
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
            <div className="P" style={{ padding: 0, marginBottom: 16, overflow: 'hidden' }}>
              <div style={{
                padding: '10px 10px 0', fontWeight: 700, fontSize: '.78rem', color: '#f59e0b',
                display: 'flex', alignItems: 'center', gap: 6,
              }}>
                <span style={{
                  width: 6, height: 6, borderRadius: '50%', background: '#f59e0b',
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
            {/* Buy FB — taker pays BTC, gets FB */}
            <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.86rem', color: '#22c55e', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                Buy FB
                <span style={{ fontSize: '.62rem', fontWeight: 400, color: 'var(--t2)' }}>pay BTC &#x2192; get FB</span>
                <span className="ob-badge" style={{ background: 'rgba(34,197,94,.1)', color: '#22c55e', marginLeft: 'auto' }}>{availBuyFb.length}</span>
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
                    <span className="ob-r" style={{ color: '#22c55e' }}>You Get</span><span className="ob-r">You Pay</span>
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
            <div className="P" style={{ padding: 0, overflow: 'hidden' }}>
              <div style={{ padding: '12px 12px 6px', fontWeight: 700, fontSize: '.86rem', color: '#f59e0b', display: 'flex', alignItems: 'baseline', gap: 6 }}>
                Get BTC
                <span style={{ fontSize: '.62rem', fontWeight: 400, color: 'var(--t2)' }}>pay FB &#x2192; get BTC</span>
                <span className="ob-badge" style={{ background: 'rgba(245,158,11,.1)', color: '#f59e0b', marginLeft: 'auto' }}>{availGetBtc.length}</span>
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
                    <span className="ob-r" style={{ color: '#22c55e' }}>You Get</span><span className="ob-r">You Pay</span>
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
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
              {[
                { num: '1', title: 'Create Order', desc: 'Post what you want to swap. BTC is locked in the smart contract for safety.' },
                { num: '2', title: 'Take & Auto-Swap', desc: 'One click: pay fee \u2192 send Fractal BTC \u2192 claim locked BTC. Fully automatic.' },
                { num: '3', title: 'Done', desc: 'Both sides receive their funds. Track progress in the Operations panel.' },
              ].map(s => (
                <div key={s.num} className="text-center">
                  <div style={{
                    width: 32, height: 32, borderRadius: '50%', background: 'rgba(139,92,246,.2)',
                    color: '#8b5cf6', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 8px', fontWeight: 800, fontSize: '.82rem',
                  }}>{s.num}</div>
                  <div className="fs-72 fw-700 mb-4">{s.title}</div>
                  <div className="fs-66 c-t3" style={{ lineHeight: 1.4 }}>{s.desc}</div>
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
