// HTLC — Hash Time-Locked Contract for Solana (Anchor framework)
//
// Cross-chain atomic swap: lock SOL with SHA256 hashlock + timelock.
// Counterparty reveals preimage to claim, or maker refunds after expiry.
//
// Usage with OPNet:
//   1. Maker locks SOL on Solana with hashlock = SHA256(preimage)
//   2. Same hashlock used on OPNet side to lock BTC
//   3. One side reveals preimage → both claim
//
// Build: anchor build
// Deploy: anchor deploy --provider.cluster devnet

use anchor_lang::prelude::*;
use anchor_lang::solana_program::hash::hash as sha256_hash;
use anchor_lang::system_program;

declare_id!("HTLCxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx");

#[program]
pub mod htlc {
    use super::*;

    /// Create a new HTLC order by locking SOL
    pub fn create(
        ctx: Context<Create>,
        hashlock: [u8; 32],
        expiry: i64,
        taker: Option<Pubkey>,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, HtlcError::ZeroAmount);
        require!(hashlock != [0u8; 32], HtlcError::InvalidHashlock);

        let clock = Clock::get()?;
        require!(
            expiry >= clock.unix_timestamp + MIN_EXPIRY,
            HtlcError::ExpiryTooSoon
        );
        require!(
            expiry <= clock.unix_timestamp + MAX_EXPIRY,
            HtlcError::ExpiryTooFar
        );

        // Transfer SOL from maker to escrow PDA
        system_program::transfer(
            CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                system_program::Transfer {
                    from: ctx.accounts.maker.to_account_info(),
                    to: ctx.accounts.escrow.to_account_info(),
                },
            ),
            amount,
        )?;

        let order = &mut ctx.accounts.order;
        order.maker = ctx.accounts.maker.key();
        order.taker = taker.unwrap_or(Pubkey::default());
        order.amount = amount;
        order.hashlock = hashlock;
        order.expiry = expiry;
        order.status = OrderStatus::Open as u8;
        order.bump = ctx.bumps.escrow;
        order.order_id = ctx.accounts.config.next_order_id;

        let config = &mut ctx.accounts.config;
        config.next_order_id += 1;

        emit!(OrderCreated {
            order_id: order.order_id,
            maker: order.maker,
            taker: order.taker,
            amount,
            hashlock,
            expiry,
        });

        Ok(())
    }

    /// Claim locked SOL by revealing the preimage
    pub fn claim(ctx: Context<Claim>, preimage: [u8; 32]) -> Result<()> {
        let order = &mut ctx.accounts.order;
        require!(order.status == OrderStatus::Open as u8, HtlcError::NotOpen);

        let clock = Clock::get()?;
        require!(clock.unix_timestamp < order.expiry, HtlcError::Expired);

        // Check taker authorization
        if order.taker != Pubkey::default() {
            require!(
                ctx.accounts.claimer.key() == order.taker,
                HtlcError::NotAuthorized
            );
        }

        // Verify preimage: SHA256(preimage) == hashlock
        let computed = sha256_hash(&preimage);
        require!(
            computed.to_bytes() == order.hashlock,
            HtlcError::InvalidPreimage
        );

        order.status = OrderStatus::Claimed as u8;

        // Calculate fee
        let config = &ctx.accounts.config;
        let fee = (order.amount as u128 * config.fee_bps as u128 / 10000) as u64;
        let payout = order.amount - fee;

        // Transfer payout from escrow to claimer
        let order_id_bytes = order.order_id.to_le_bytes();
        let seeds = &[
            b"escrow",
            order_id_bytes.as_ref(),
            &[order.bump],
        ];
        let signer_seeds = &[&seeds[..]];

        // Transfer payout
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= payout;
        **ctx.accounts.claimer.to_account_info().try_borrow_mut_lamports()? += payout;

        // Transfer fee to owner
        if fee > 0 {
            **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= fee;
            **ctx.accounts.fee_recipient.to_account_info().try_borrow_mut_lamports()? += fee;
        }

        // Close escrow account (return rent to maker)
        let remaining = ctx.accounts.escrow.to_account_info().lamports();
        if remaining > 0 {
            **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? = 0;
            **ctx.accounts.maker_account.to_account_info().try_borrow_mut_lamports()? += remaining;
        }

        // Suppress unused variable warning for signer_seeds (used conceptually for PDA auth)
        let _ = signer_seeds;

        emit!(OrderClaimed {
            order_id: order.order_id,
            claimer: ctx.accounts.claimer.key(),
            preimage,
        });

        Ok(())
    }

    /// Refund locked SOL after expiry (maker only)
    pub fn refund(ctx: Context<Refund>) -> Result<()> {
        let order = &mut ctx.accounts.order;
        require!(order.status == OrderStatus::Open as u8, HtlcError::NotOpen);
        require!(
            ctx.accounts.maker.key() == order.maker,
            HtlcError::NotMaker
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= order.expiry,
            HtlcError::NotExpired
        );

        order.status = OrderStatus::Refunded as u8;

        // Return all SOL from escrow to maker
        let amount = ctx.accounts.escrow.to_account_info().lamports();
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? = 0;
        **ctx.accounts.maker.to_account_info().try_borrow_mut_lamports()? += amount;

        emit!(OrderRefunded {
            order_id: order.order_id,
            maker: order.maker,
        });

        Ok(())
    }

    /// Initialize the config account (once, by deployer)
    pub fn initialize(ctx: Context<Initialize>, fee_bps: u16) -> Result<()> {
        require!(fee_bps <= MAX_FEE_BPS as u16, HtlcError::FeeTooHigh);
        let config = &mut ctx.accounts.config;
        config.owner = ctx.accounts.owner.key();
        config.fee_bps = fee_bps;
        config.next_order_id = 1;
        Ok(())
    }

    /// Update fee (owner only)
    pub fn set_fee(ctx: Context<SetFee>, new_fee_bps: u16) -> Result<()> {
        require!(
            new_fee_bps <= MAX_FEE_BPS as u16,
            HtlcError::FeeTooHigh
        );
        let config = &mut ctx.accounts.config;
        require!(
            ctx.accounts.owner.key() == config.owner,
            HtlcError::NotOwner
        );
        config.fee_bps = new_fee_bps;
        Ok(())
    }
}

// ── Constants ──

const MIN_EXPIRY: i64 = 3600;       // 1 hour minimum
const MAX_EXPIRY: i64 = 7 * 86400;  // 7 days maximum
const MAX_FEE_BPS: u64 = 500;       // 5% max fee

// ── Account structs ──

#[account]
pub struct Config {
    pub owner: Pubkey,
    pub fee_bps: u16,
    pub next_order_id: u64,
}

#[account]
pub struct Order {
    pub order_id: u64,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub amount: u64,
    pub hashlock: [u8; 32],
    pub expiry: i64,
    pub status: u8,
    pub bump: u8,
}

#[repr(u8)]
pub enum OrderStatus {
    Invalid = 0,
    Open = 1,
    Claimed = 2,
    Refunded = 3,
}

// ── Instruction contexts ──

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + 32 + 2 + 8,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Create<'info> {
    #[account(
        init,
        payer = maker,
        space = 8 + 8 + 32 + 32 + 8 + 32 + 8 + 1 + 1,
        seeds = [b"order", config.next_order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub order: Account<'info, Order>,
    /// CHECK: Escrow PDA holds the locked SOL
    #[account(
        mut,
        seeds = [b"escrow", config.next_order_id.to_le_bytes().as_ref()],
        bump
    )]
    pub escrow: AccountInfo<'info>,
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub maker: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Claim<'info> {
    #[account(mut)]
    pub order: Account<'info, Order>,
    /// CHECK: Escrow PDA
    #[account(
        mut,
        seeds = [b"escrow", order.order_id.to_le_bytes().as_ref()],
        bump = order.bump
    )]
    pub escrow: AccountInfo<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub claimer: Signer<'info>,
    /// CHECK: Fee recipient = config.owner
    #[account(mut, constraint = fee_recipient.key() == config.owner)]
    pub fee_recipient: AccountInfo<'info>,
    /// CHECK: Original maker for rent return
    #[account(mut, constraint = maker_account.key() == order.maker)]
    pub maker_account: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct Refund<'info> {
    #[account(mut)]
    pub order: Account<'info, Order>,
    /// CHECK: Escrow PDA
    #[account(
        mut,
        seeds = [b"escrow", order.order_id.to_le_bytes().as_ref()],
        bump = order.bump
    )]
    pub escrow: AccountInfo<'info>,
    #[account(mut)]
    pub maker: Signer<'info>,
}

#[derive(Accounts)]
pub struct SetFee<'info> {
    #[account(mut, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub owner: Signer<'info>,
}

// ── Events ──

#[event]
pub struct OrderCreated {
    pub order_id: u64,
    pub maker: Pubkey,
    pub taker: Pubkey,
    pub amount: u64,
    pub hashlock: [u8; 32],
    pub expiry: i64,
}

#[event]
pub struct OrderClaimed {
    pub order_id: u64,
    pub claimer: Pubkey,
    pub preimage: [u8; 32],
}

#[event]
pub struct OrderRefunded {
    pub order_id: u64,
    pub maker: Pubkey,
}

// ── Errors ──

#[error_code]
pub enum HtlcError {
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Invalid hashlock")]
    InvalidHashlock,
    #[msg("Expiry too soon (min 1 hour)")]
    ExpiryTooSoon,
    #[msg("Expiry too far (max 7 days)")]
    ExpiryTooFar,
    #[msg("Order not open")]
    NotOpen,
    #[msg("Order expired")]
    Expired,
    #[msg("Not authorized taker")]
    NotAuthorized,
    #[msg("Invalid preimage")]
    InvalidPreimage,
    #[msg("Not the maker")]
    NotMaker,
    #[msg("Order not expired yet")]
    NotExpired,
    #[msg("Fee too high (max 5%)")]
    FeeTooHigh,
    #[msg("Not the owner")]
    NotOwner,
}
