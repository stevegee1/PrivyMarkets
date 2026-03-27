import test_usdcx_stablecoin.aleo;

program privymarket_v5.aleo {

    // -------------------------------------------------------
    // PUBLIC STATE MAPPINGS
    // -------------------------------------------------------
    // All values in micro-USDCx (u64). 1 USDCx = 1_000_000.

    mapping yes_pools:      field => u64;
    mapping no_pools:       field => u64;
    mapping vault_balances: field => u64;
    mapping market_states:  field => u8;    // 0=OPEN 1=PAUSED 3=RESOLVED
    mapping market_results: field => bool;  // true=YES won
    mapping winning_pools:     field => u64;   // snapshotted at resolution
    mapping total_fees:        field => u64;   // platform fees accumulated per market
    mapping resolution_times:  field => u64;   // WAVE 4: stored for resolution window enforcement

    mapping claimable: field => u64;

    // -------------------------------------------------------
    // RECORDS
    // -------------------------------------------------------

    record AdminCap {
        owner: address,
    }

    // Fully encrypted on-chain — only the position owner can read.
    // entry_price_yes/no stored in basis points (0-10_000).
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
    //   test_usdcx_stablecoin.aleo/approve_public(privymarket_v5.aleo, initial_amount)
    // initial_amount in micro-USDCx (u128): min 2_000_000, must be even.
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

        // WAVE 4: Robust Market ID (prevents collisions and reuse)
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
            Mapping::set(yes_pools,      market_id, initial_yes as u64);
            Mapping::set(no_pools,       market_id, initial_no  as u64);
            Mapping::set(vault_balances, market_id, initial_amount as u64);
            Mapping::set(market_states,  market_id, 0u8);
            Mapping::set(market_results, market_id, false);
            Mapping::set(winning_pools,     market_id, 0u64);
            Mapping::set(total_fees,        market_id, 0u64);
            Mapping::set(resolution_times,  market_id, resolution_time);
        });
    }

    // ── Buy Shares ──────────────────────────────────────────
    // Mirrors Uniswap V2 swapExactTokensForTokens exactly.
    //
    // User pre-approves then bets:
    //   1. test_usdcx_stablecoin.aleo/approve_public(privymarket_v5.aleo, amount)
    //   2. buy_shares(...)
    //
    // PRIVACY:
    //   outcome is PRIVATE — bet direction ZK-hidden ✓
    //   amount  is PUBLIC  — required by transfer_from_public
    //
    // SLIPPAGE PROTECTION:
    //   min_shares_out — tx reverts if shares < this value
    //                    user sets tolerance e.g. preview * 0.995 (0.5% slip)
    //                    no race condition — any pool state that yields
    //                    enough shares is accepted
    //
    // STALENESS PROTECTION:
    //   deadline — block height after which tx auto-reverts
    //              prevents held txs executing at stale prices
    //              recommended: current_block + 20 (~5 min on Aleo)
    //
    // AMM constant product: k = yes_pool * no_pool
    //   YES buy: new_yes = yes + amount  →  shares = no - (k / new_yes)
    //   NO  buy: new_no  = no  + amount  →  shares = yes - (k / new_no)
    async transition buy_shares(
        public market_id:      field,
        public amount:         u128,   // PUBLIC — transfer_from_public constraint
        private outcome:       bool,   // PRIVATE — ZK-hidden ✓
        public expected_yes:   u64,    // current pool snapshot from frontend
        public expected_no:    u64,    // current pool snapshot from frontend
        public min_shares_out: u64,    // slippage tolerance (amountOutMin)
        public deadline:       u32,    // block height expiry
        public timestamp:      u64
    ) -> (Position, Future) {

        assert(amount >= 100_000u128);
        assert(min_shares_out > 0u64);

        let amt64:  u64  = amount as u64;
        let yes128: u128 = expected_yes as u128;
        let no128:  u128 = expected_no  as u128;
        let total:  u128 = yes128 + no128;
        let k:      u128 = yes128 * no128;

        // ── AMM share calculation (transition layer) ─────
        // Computed here using frontend snapshot so Position record
        // carries real share values. Finalize re-verifies against
        // live state and applies slippage check.
        // self.signer is available here — NOT inside async block.
        let yes_new_yes: u128 = yes128 + amount;
        let yes_new_no:  u128 = k / yes_new_yes;
        let yes_shares:  u64  = (no128 - yes_new_no) as u64;

        let no_new_no:   u128 = no128 + amount;
        let no_new_yes:  u128 = k / no_new_no;
        let no_shares:   u64  = (yes128 - no_new_yes) as u64;

        let shares: u64 = outcome ? yes_shares : no_shares;
        assert(shares >= min_shares_out); // early check before paying gas

        let entry_yes: u64 = ((no128  * 10_000u128) / total) as u64;
        let entry_no:  u64 = ((yes128 * 10_000u128) / total) as u64;

        let pos: Position = Position {
            owner:           self.signer,
            market_id:       market_id,
            yes_shares:      outcome ? shares : 0u64,
            no_shares:       outcome ? 0u64   : shares,
            entry_price_yes: entry_yes,
            entry_price_no:  entry_no,
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
            // block.height available in async — self.signer is not.
            assert(block.height <= deadline);

            // ── Market must be open ──────────────────────
            let state: u8 = Mapping::get_or_use(market_states, market_id, 255u8);
            assert_eq(state, 0u8);

            // ── Recompute from live pool state ───────────
            // Finalize reads authoritative on-chain values.
            // If pools moved since frontend snapshot, live_shares
            // may differ from transition-layer shares — slippage
            // check below is the safety net.
            let cur_yes: u64 = Mapping::get(yes_pools, market_id);
            let cur_no:  u64 = Mapping::get(no_pools,  market_id);

            let cy: u128 = cur_yes as u128;
            let cn: u128 = cur_no  as u128;
            let ck: u128 = cy * cn;

            let v_yes_new_yes: u128 = cy + amount;
            let v_yes_new_no:  u128 = ck / v_yes_new_yes;
            let v_no_new_no:   u128 = cn + amount;
            let v_no_new_yes:  u128 = ck / v_no_new_no;

            let live_yes_shares: u64 = (cn - v_yes_new_no)  as u64;
            let live_no_shares:  u64 = (cy - v_no_new_yes)  as u64;
            let live_shares:     u64 = outcome ? live_yes_shares : live_no_shares;

            // ── Slippage check (production standard) ─────
            // Mirrors Uniswap V2: require(amountOut >= amountOutMin)
            // Reverts cleanly if pool moved beyond tolerance.
            assert(live_shares >= min_shares_out);

            // ── Update pool state ────────────────────────
            let store_yes: u64 = outcome ? (v_yes_new_yes as u64) : (v_no_new_yes as u64);
            let store_no:  u64 = outcome ? (v_yes_new_no  as u64) : (v_no_new_no  as u64);

            Mapping::set(yes_pools,      market_id, store_yes);
            Mapping::set(no_pools,       market_id, store_no);

            // WAVE 4: Fee accumulation (0.3%)
            let fee: u64 = amt64 * 30u64 / 10_000u64;
            let current_fees: u64 = Mapping::get_or_use(total_fees, market_id, 0u64);
            Mapping::set(total_fees, market_id, current_fees + fee);

            let cur_vault: u64 = Mapping::get(vault_balances, market_id);
            Mapping::set(vault_balances, market_id, cur_vault + amt64);
        });
    }

    // ── Sell Shares ─────────────────────────────────────────
    // PATTERN: min_payout_out + deadline + claimable
    //
    // AFTER  (fixed):  credits claimable mapping → user calls withdraw()
    //
    // min_payout_out — slippage protection on sell side
    // deadline       — staleness protection
    async transition sell_shares(
        public market_id:     field,
        position:             Position,
        private outcome:      bool,         // PRIVATE ✓
        private share_amount: u64,          // PRIVATE ✓
        public min_payout_out: u64,         // PRODUCTION: slippage tolerance
        public deadline:      u32           // PRODUCTION: block height expiry
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

        return (new_pos, async {
            // ── Staleness guard ──────────────────────────
            assert(block.height <= deadline);

            // ── Market must be open ──────────────────────
            let state: u8 = Mapping::get_or_use(market_states, market_id, 255u8);
            assert_eq(state, 0u8);

            // ── Read live pool state ─────────────────────
            let cur_yes: u64 = Mapping::get(yes_pools, market_id);
            let cur_no:  u64 = Mapping::get(no_pools,  market_id);

            let cy: u128 = cur_yes as u128;
            let cn: u128 = cur_no  as u128;
            let sh: u128 = share_amount as u128;
            let ck: u128 = cy * cn;

            // ── AMM payout calculation ───────────────────
            // SELL YES: shares return to YES pool, payout from NO pool
            // SELL NO:  shares return to NO pool,  payout from YES pool
            let v_yes_new_no:  u128 = cn + sh;
            let v_yes_new_yes: u128 = ck / v_yes_new_no;
            let v_no_new_yes:  u128 = cy + sh;
            let v_no_new_no:   u128 = ck / v_no_new_yes;

            let yes_payout: u64 = (cy - v_yes_new_yes) as u64;
            let no_payout:  u64 = (cn - v_no_new_no)   as u64;

            let payout: u64 = outcome ? yes_payout : no_payout;

            // ── Slippage check ───────────────────────────
            assert(payout >= min_payout_out);

            // ── Solvency check ───────────────────────────
            let cur_vault: u64 = Mapping::get(vault_balances, market_id);
            assert(payout <= cur_vault);

            // ── Update pool state ────────────────────────
            let store_yes: u64 = outcome ? (v_yes_new_yes as u64) : (v_no_new_yes as u64);
            let store_no:  u64 = outcome ? (v_yes_new_no  as u64) : (v_no_new_no  as u64);

            Mapping::set(yes_pools,      market_id, store_yes);
            Mapping::set(no_pools,       market_id, store_no);
            Mapping::set(vault_balances, market_id, cur_vault - payout);

            // WAVE 4: Fee accumulation (0.3% on sell)
            let fee: u64 = payout * 30u64 / 10_000u64;
            let net_payout: u64 = payout - fee;
            let current_fees: u64 = Mapping::get_or_use(total_fees, market_id, 0u64);
            Mapping::set(total_fees, market_id, current_fees + fee);

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

            // WAVE 4: Resolution window check
            // resolution_time is interpreted as block height
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
    //  PATTERN: claimable mapping (no Token record return)
    //
    // Payout = (user_shares / winning_pool) × vault_balance
    // Losers rejected in finalize (user_shares == 0 on winning side).
    // AFTER  (fixed):  credits claimable mapping → user calls withdraw()
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

        return async {
            let state:    u8   = Mapping::get(market_states,  market_id);
            assert_eq(state, 3u8);

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
            Mapping::set(vault_balances, market_id, vault - actual_payout);

            let existing: u64 = Mapping::get_or_use(claimable, claimable_key, 0u64);
            Mapping::set(claimable, claimable_key, existing + actual_payout);
        };
    }

    // ── Withdraw Private ───────────────────────────────────
    // WAVE 4: Return funds as private records for maximum privacy.
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

    // ── Claim Fees ──────────────────────────────────────────
    // WAVE 4: Admin can claim accumulated platform fees.
    async transition claim_fees(
        admin:            AdminCap,
        public market_id: field,
        public amount:    u64
    ) -> (AdminCap, Future) {

        let returned_admin: AdminCap = AdminCap { owner: admin.owner };

        let fut: Future = test_usdcx_stablecoin.aleo/transfer_public(
            self.signer, // Admin address
            amount as u128
        );

        return (returned_admin, async {
            fut.await();
            let available: u64 = Mapping::get(total_fees, market_id);
            assert(available >= amount);
            Mapping::set(total_fees, market_id, available - amount);
        });
    }

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
