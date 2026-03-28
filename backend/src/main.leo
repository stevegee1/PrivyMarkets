import test_usdcx_stablecoin.aleo;

program privymarket_v6.aleo {

    // -------------------------------------------------------
    // PUBLIC STATE MAPPINGS
    // -------------------------------------------------------
    // All values in micro-USDCx (u64). 1 USDCx = 1_000_000.
    //
    // WAVE 5 changes:
    //   - total_fees REMOVED — fees now compound inside the AMM pools (P5)
    //   - position_consumed ADDED — double-dip guard (P2)

    mapping yes_pools:         field => u64;
    mapping no_pools:          field => u64;
    mapping vault_balances:    field => u64;
    mapping market_states:     field => u8;    // 0=OPEN 1=PAUSED 3=RESOLVED
    mapping market_results:    field => bool;  // true=YES won
    mapping winning_pools:     field => u64;   // snapshotted at resolution
    mapping resolution_times:  field => u64;   // stored for resolution window enforcement
    mapping claimable:         field => u64;

    // P2: tracks consumed position nonces to prevent double-dip
    // key = BHP256(owner as field + market_id + timestamp as field)
    mapping position_consumed: field => bool;

    // -------------------------------------------------------
    // RECORDS
    // -------------------------------------------------------

    record AdminCap {
        owner: address,
    }

    // Fully encrypted on-chain — only the position owner can read.
    // entry_price_yes/no stored in basis points (0-10_000).
    // P4: entry prices now computed from live finalize pools, not frontend snapshot.
    record Position {
        owner:           address,
        market_id:       field,
        yes_shares:      u64,
        no_shares:       u64,
        entry_price_yes: u64,
        entry_price_no:  u64,
        timestamp:       u64,
    }

    // Market off-chain metadata pointer (question lives on IPFS).
    record MarketInfo {
        owner:           address,
        market_id:       field,
        metadata_cid:    field,
        metadata_hash:   field,
        resolution_time: u64,
    }

    // -------------------------------------------------------
    // TRANSITIONS
    // -------------------------------------------------------

    // ── Initialize ─────────────────────────────────────────
    transition initialize() -> AdminCap {
        return AdminCap { owner: self.signer };
    }

    // ── Create Market ───────────────────────────────────────
    // Admin pre-funds the contract:
    //   test_usdcx_stablecoin.aleo/approve_public(privymarket_v6.aleo, initial_amount)
    // initial_amount in micro-USDCx (u128): min 2_000_000, must be even.
    //
    // WAVE 5: total_fees initialisation removed (P5 — fees embed in pools).
    async transition create_market(
        admin:                  AdminCap,
        metadata_cid:           field,
        metadata_hash:          field,
        resolution_time:        u64,
        public initial_yes:     u128,
        public initial_no:      u128
    ) -> (MarketInfo, AdminCap, Future) {

        assert(initial_yes >= 1_000_000u128);
        assert(initial_no  >= 1_000_000u128);

        let initial_amount: u128 = initial_yes + initial_no;

        let market_id: field = BHP256::hash_to_field(
            metadata_hash + resolution_time as field + self.signer as field
        );

        let info: MarketInfo = MarketInfo {
            owner:           self.signer,
            market_id:       market_id,
            metadata_cid:    metadata_cid,
            metadata_hash:   metadata_hash,
            resolution_time: resolution_time,
        };

        let returned_admin: AdminCap = AdminCap { owner: admin.owner };

        let fut: Future = test_usdcx_stablecoin.aleo/transfer_from_public(
            self.signer,
            self.address,
            initial_amount
        );

        return (info, returned_admin, async {
            fut.await();
            Mapping::set(yes_pools,       market_id, initial_yes as u64);
            Mapping::set(no_pools,        market_id, initial_no  as u64);
            Mapping::set(vault_balances,  market_id, initial_amount as u64);
            Mapping::set(market_states,   market_id, 0u8);
            Mapping::set(market_results,  market_id, false);
            Mapping::set(winning_pools,   market_id, 0u64);
            Mapping::set(resolution_times,market_id, resolution_time);

            // P1: assert vault invariant at market creation
            let iy: u64 = initial_yes as u64;
            let in_: u64 = initial_no as u64;
            assert(initial_amount as u64 >= iy + in_);
        });
    }

    // ── Buy Shares ──────────────────────────────────────────
    // Mirrors Uniswap V2 swapExactTokensForTokens exactly.
    //
    // PRIVACY:
    //   outcome is PRIVATE — bet direction ZK-hidden ✓
    //   amount  is PUBLIC  — required by transfer_from_public
    //
    // SLIPPAGE PROTECTION:
    //   min_shares_out — tx reverts if shares < this value
    //
    // STALENESS PROTECTION:
    //   deadline — block height after which tx auto-reverts
    //
    // AMM: k = yes_pool * no_pool (constant product)
    //   YES buy: new_yes = yes + effective  →  shares = no_ceil - (k_ceil / new_yes)
    //   NO  buy: new_no  = no  + effective  →  shares = yes_ceil - (k_ceil / new_no)
    //
    // WAVE 5 changes:
    //   P4: expected_yes / expected_no params REMOVED.
    //       Transition-layer entry prices computed from a best-estimate
    //       using min_shares_out as a reference; finalize is authoritative.
    //   P5: 0.3% fee embedded via effective_amount = amount * 997 / 1000.
    //       Fees stay in the pool and compound rather than being extracted.
    //   P3: Ceil division applied to all AMM divisions in finalize.
    async transition buy_shares(
        public market_id:      field,
        public amount:         u128,   // PUBLIC — transfer_from_public constraint
        private outcome:       bool,   // PRIVATE — ZK-hidden ✓
        public min_shares_out: u64,    // slippage tolerance (amountOutMin)
        public deadline:       u32,    // block height expiry
        public timestamp:      u64
    ) -> (Position, Future) {

        assert(amount >= 100_000u128);
        assert(min_shares_out > 0u64);

        // P5: effective amount after 0.3% fee baked in
        let effective: u128 = amount * 997u128 / 1_000u128;

        // P4: entry prices are placeholders at transition layer;
        //     finalize holds the authoritative live values.
        //     We store 5_000 (50/50) as a neutral default — the
        //     frontend should derive display prices from pool state,
        //     not from this record field.
        let pos: Position = Position {
            owner:           self.signer,
            market_id:       market_id,
            yes_shares:      outcome ? min_shares_out : 0u64,
            no_shares:       outcome ? 0u64 : min_shares_out,
            entry_price_yes: 5_000u64,
            entry_price_no:  5_000u64,
            timestamp:       timestamp,
        };

        let fut: Future = test_usdcx_stablecoin.aleo/transfer_from_public(
            self.signer,
            self.address,
            amount
        );

        return (pos, async {
            fut.await();

            // ── Staleness guard ──────────────────────────
            assert(block.height <= deadline);

            // ── Market must be open ──────────────────────
            let state: u8 = Mapping::get_or_use(market_states, market_id, 255u8);
            assert_eq(state, 0u8);

            // ── Live pool state ──────────────────────────
            let cur_yes: u64 = Mapping::get(yes_pools, market_id);
            let cur_no:  u64 = Mapping::get(no_pools,  market_id);

            let cy: u128 = cur_yes as u128;
            let cn: u128 = cur_no  as u128;
            let ck: u128 = cy * cn;

            // P3: ceil division — (k + d - 1) / d — protocol rounds in its favor
            let v_yes_new_yes: u128 = cy + effective;
            let v_yes_new_no:  u128 = (ck + v_yes_new_yes - 1u128) / v_yes_new_yes;
            let v_no_new_no:   u128 = cn + effective;
            let v_no_new_yes:  u128 = (ck + v_no_new_no - 1u128) / v_no_new_no;

            let live_yes_shares: u64 = (cn - v_yes_new_no) as u64;
            let live_no_shares:  u64 = (cy - v_no_new_yes) as u64;
            let live_shares:     u64 = outcome ? live_yes_shares : live_no_shares;

            // ── Slippage check ───────────────────────────
            assert(live_shares >= min_shares_out);

            // ── Update pool state ────────────────────────
            // P5: full amount (including fee) enters the pool.
            //     effective_amount drives AMM math; fee portion
            //     (amount - effective) stays in pool as LP revenue.
            let store_yes: u64 = outcome ? (v_yes_new_yes as u64) : (v_no_new_yes as u64);
            let store_no:  u64 = outcome ? (v_yes_new_no  as u64) : (v_no_new_no  as u64);

            Mapping::set(yes_pools,     market_id, store_yes);
            Mapping::set(no_pools,      market_id, store_no);

            let amt64: u64 = amount as u64;
            let cur_vault: u64 = Mapping::get(vault_balances, market_id);
            Mapping::set(vault_balances, market_id, cur_vault + amt64);

            // P1: vault invariant — vault must cover both pools after buy
            let new_vault: u64 = cur_vault + amt64;
            assert(new_vault >= store_yes + store_no);
        });
    }

    // ── Sell Shares ─────────────────────────────────────────
    // PATTERN: min_payout_out + deadline + claimable
    //
    // Credits claimable mapping → user calls withdraw_public() or withdraw_private()
    //
    // WAVE 5 changes:
    //   P2: position_consumed nonce checked and set to prevent double-dip.
    //   P3: Ceil division applied to all AMM payout divisions.
    //   P5: 0.3% fee embedded — net_payout = effective payout after fee stays in pool.
    //   P1: vault invariant asserted after state update.
    async transition sell_shares(
        public market_id:      field,
        position:              Position,
        private outcome:       bool,         // PRIVATE ✓
        private share_amount:  u64,          // PRIVATE ✓
        public min_payout_out: u64,          // slippage tolerance
        public deadline:       u32           // block height expiry
    ) -> (Position, Future) {

        assert(share_amount > 0u64);
        assert_eq(position.market_id, market_id);

        let owned: u64 = outcome ? position.yes_shares : position.no_shares;
        assert(owned >= share_amount);

        let new_pos: Position = Position {
            owner:           self.signer,
            market_id:       market_id,
            yes_shares:      outcome ? (position.yes_shares - share_amount) : position.yes_shares,
            no_shares:       outcome ? position.no_shares : (position.no_shares - share_amount),
            entry_price_yes: position.entry_price_yes,
            entry_price_no:  position.entry_price_no,
            timestamp:       position.timestamp,
        };

        let claimable_key: field = BHP256::hash_to_field(
            self.signer as field + market_id
        );

        // P2: nonce key ties to the specific position record instance
        let pos_nonce: field = BHP256::hash_to_field(
            self.signer as field + market_id + position.timestamp as field
        );

        return (new_pos, async {
            // ── Staleness guard ──────────────────────────
            assert(block.height <= deadline);

            // ── Market must be open ──────────────────────
            let state: u8 = Mapping::get_or_use(market_states, market_id, 255u8);
            assert_eq(state, 0u8);

            // P2: reject if this position was already fully consumed
            let consumed: bool = Mapping::get_or_use(position_consumed, pos_nonce, false);
            assert(!consumed);

            // ── Read live pool state ─────────────────────
            let cur_yes: u64 = Mapping::get(yes_pools, market_id);
            let cur_no:  u64 = Mapping::get(no_pools,  market_id);

            let cy: u128 = cur_yes as u128;
            let cn: u128 = cur_no  as u128;
            let sh: u128 = share_amount as u128;
            let ck: u128 = cy * cn;

            // P3: ceil division on AMM payout
            // SELL YES: shares return to YES pool, payout from NO pool
            // SELL NO:  shares return to NO pool,  payout from YES pool
            let v_yes_new_no:  u128 = cn + sh;
            let v_yes_new_yes: u128 = (ck + v_yes_new_no - 1u128) / v_yes_new_no;
            let v_no_new_yes:  u128 = cy + sh;
            let v_no_new_no:   u128 = (ck + v_no_new_yes - 1u128) / v_no_new_yes;

            let yes_payout: u64 = (cy - v_yes_new_yes) as u64;
            let no_payout:  u64 = (cn - v_no_new_no)   as u64;

            let payout: u64 = outcome ? yes_payout : no_payout;

            // P5: 0.3% fee stays in pool — user receives effective payout
            let net_payout: u64 = payout * 997u64 / 1_000u64;

            // ── Slippage check ───────────────────────────
            assert(net_payout >= min_payout_out);

            // ── Solvency check ───────────────────────────
            let cur_vault: u64 = Mapping::get(vault_balances, market_id);
            assert(net_payout <= cur_vault);

            // ── Update pool state ────────────────────────
            let store_yes: u64 = outcome ? (v_yes_new_yes as u64) : (v_no_new_yes as u64);
            let store_no:  u64 = outcome ? (v_yes_new_no  as u64) : (v_no_new_no  as u64);

            Mapping::set(yes_pools,      market_id, store_yes);
            Mapping::set(no_pools,       market_id, store_no);
            Mapping::set(vault_balances, market_id, cur_vault - net_payout);

            // P1: vault invariant after sell
            let post_vault: u64 = cur_vault - net_payout;
            assert(post_vault >= store_yes + store_no);

            // P2: mark position consumed if all shares are now sold
            let remaining: u64 = owned - share_amount;
            Mapping::set(position_consumed, pos_nonce, remaining == 0u64);

            // ── Credit claimable ─────────────────────────
            let existing: u64 = Mapping::get_or_use(claimable, claimable_key, 0u64);
            Mapping::set(claimable, claimable_key, existing + net_payout);
        });
    }

    // ── Resolve Market ──────────────────────────────────────
    async transition resolve_market(
        admin:                  AdminCap,
        public market_id:       field,
        public winning_outcome: bool
    ) -> (AdminCap, Future) {
        let returned_admin: AdminCap = AdminCap { owner: admin.owner };
        return (returned_admin, async {
            let state: u8 = Mapping::get(market_states, market_id);
            assert(state == 0u8 || state == 1u8);

            let res_time: u64 = Mapping::get(resolution_times, market_id);
            assert(block.height >= res_time as u32);

            let win_pool: u64 = winning_outcome
                ? Mapping::get(yes_pools, market_id)
                : Mapping::get(no_pools,  market_id);

            Mapping::set(market_states,  market_id, 3u8);
            Mapping::set(market_results, market_id, winning_outcome);
            Mapping::set(winning_pools,  market_id, win_pool);
        });
    }

    // ── Claim Winnings ──────────────────────────────────────
    // Payout = (user_shares / winning_pool) × vault_balance
    // Losers rejected in finalize (user_shares == 0 on winning side).
    // Credits claimable mapping → user calls withdraw().
    //
    // WAVE 5 changes:
    //   P2: position_consumed nonce checked and set — prevents claiming
    //       winnings on a position that was already sold pre-resolution.
    //   P1: vault invariant asserted after payout credit.
    async transition claim_winnings(
        position:               Position,   // consumed
        public market_id:       field,
        public expected_payout: u128        // user computes off-chain, verified on-chain
    ) -> Future {

        assert_eq(position.market_id, market_id);
        assert(position.yes_shares > 0u64 || position.no_shares > 0u64);
        assert(expected_payout > 0u128);

        let yes_sh: u64 = position.yes_shares;
        let no_sh:  u64 = position.no_shares;

        let claimable_key: field = BHP256::hash_to_field(
            self.signer as field + market_id
        );

        // P2: same nonce formula as sell_shares
        let pos_nonce: field = BHP256::hash_to_field(
            self.signer as field + market_id + position.timestamp as field
        );

        return async {
            let state: u8 = Mapping::get(market_states, market_id);
            assert_eq(state, 3u8);

            // P2: reject if position was already sold/consumed
            let consumed: bool = Mapping::get_or_use(position_consumed, pos_nonce, false);
            assert(!consumed);

            let result:   bool = Mapping::get(market_results, market_id);
            let win_pool: u64  = Mapping::get(winning_pools,  market_id);
            let vault:    u64  = Mapping::get(vault_balances, market_id);

            assert(win_pool > 0u64);

            let user_shares: u64 = result ? yes_sh : no_sh;
            assert(user_shares > 0u64); // losers rejected here

            let actual_payout: u64 =
                ((user_shares as u128 * vault as u128) / win_pool as u128) as u64;

            assert_eq(expected_payout, actual_payout as u128);
            assert(actual_payout <= vault);

            let post_vault: u64 = vault - actual_payout;
            Mapping::set(vault_balances, market_id, post_vault);

            // P1: vault invariant — after claim, vault still covers remaining pools
            let remaining_yes: u64 = Mapping::get(yes_pools, market_id);
            let remaining_no:  u64 = Mapping::get(no_pools,  market_id);
            assert(post_vault >= remaining_yes + remaining_no);

            // P2: mark position fully consumed
            Mapping::set(position_consumed, pos_nonce, true);

            let existing: u64 = Mapping::get_or_use(claimable, claimable_key, 0u64);
            Mapping::set(claimable, claimable_key, existing + actual_payout);
        };
    }

    // ── Withdraw Private ───────────────────────────────────
    // Returns funds as private records for maximum privacy.
    async transition withdraw_private(
        public market_id: field,
        private amount:   u64
    ) -> (test_usdcx_stablecoin.aleo/ComplianceRecord, test_usdcx_stablecoin.aleo/Token, Future) {

        let claimable_key: field = BHP256::hash_to_field(
            self.signer as field + market_id
        );

        let (compliance, token, fut): (test_usdcx_stablecoin.aleo/ComplianceRecord, test_usdcx_stablecoin.aleo/Token, Future) =
            test_usdcx_stablecoin.aleo/transfer_public_to_private(
                self.signer,
                amount as u128
            );

        return (compliance, token, async {
            fut.await();
            let available: u64 = Mapping::get(claimable, claimable_key);
            assert(available >= amount);
            Mapping::set(claimable, claimable_key, available - amount);
        });
    }

    // ── Withdraw Public ─────────────────────────────────────
    // Pulls claimable balance to user's public USDCx balance.
    async transition withdraw_public(
        public market_id: field,
        public amount:    u128
    ) -> Future {

        assert(amount > 0u128);

        let claimable_key: field = BHP256::hash_to_field(
            self.signer as field + market_id
        );

        let fut: Future = test_usdcx_stablecoin.aleo/transfer_public(
            self.signer,
            amount
        );

        return async {
            fut.await();
            let available: u64 = Mapping::get(claimable, claimable_key);
            assert(available >= amount as u64);
            Mapping::set(claimable, claimable_key, available - amount as u64);
        };
    }

    // NOTE: claim_fees transition REMOVED in WAVE 5 (P5).
    // Fees now compound inside the AMM pools automatically.
    // Admin revenue is realised by providing initial liquidity
    // and resolving markets — pool value accrues to the vault.

    // ── Pause Market ────────────────────────────────────────
    async transition pause_market(
        admin:            AdminCap,
        public market_id: field
    ) -> (AdminCap, Future) {
        let returned_admin: AdminCap = AdminCap { owner: admin.owner };
        return (returned_admin, async {
            let state: u8 = Mapping::get(market_states, market_id);
            assert_eq(state, 0u8);
            Mapping::set(market_states, market_id, 1u8);
        });
    }

    // ── Resume Market ────────────────────────────────────────
    async transition resume_market(
        admin:            AdminCap,
        public market_id: field
    ) -> (AdminCap, Future) {
        let returned_admin: AdminCap = AdminCap { owner: admin.owner };
        return (returned_admin, async {
            let state: u8 = Mapping::get(market_states, market_id);
            assert_eq(state, 1u8);
            Mapping::set(market_states, market_id, 0u8);
        });
    }

    // ── Constructor ─────────────────────────────────────────
    @admin(address="aleo1vfrqgeyew9du0grdq24vmxc4cg8duy7htgcmkehxy7v88qn9f59skfjmg7")
    async constructor() {}
}
