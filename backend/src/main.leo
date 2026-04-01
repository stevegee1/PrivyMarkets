import test_usdcx_stablecoin.aleo;

program privymarket_v6.aleo {

    // -------------------------------------------------------
    // PUBLIC STATE MAPPINGS
    // -------------------------------------------------------
    // All values in micro-USDCx (u64). 1 USDCx = 1_000_000.
    //
    // Wave 4 changes:
    //   - total_fees REMOVED — fees now compound inside the AMM pools (P5)
    //   - position_consumed ADDED — double-dip guard (P2)

    mapping yes_pools:         field => u64;
    mapping no_pools:          field => u64;
    mapping vault_balances:    field => u64;
    mapping market_states:     field => u8;    // 0=OPEN 1=PAUSED 3=RESOLVED
    mapping market_results:    field => bool;  // true=YES won
    mapping winning_pools:     field => u64;   // snapshotted at resolution
    mapping resolution_times:  field => u64;
    mapping claimable:         field => u64;

    // P2: tracks consumed position nonces to prevent double-dip
    mapping position_consumed: field => bool;

    // -------------------------------------------------------
    // RECORDS
    // -------------------------------------------------------

    record AdminCap {
        owner: address,
    }

    record Position {
        owner:           address,
        market_id:       field,
        yes_shares:      u64,
        no_shares:       u64,
        entry_price_yes: u64,
        entry_price_no:  u64,
        timestamp:       u64,
    }

    record MarketInfo {
        owner:           address,
        market_id:       field,
        metadata_cid:    field,
        metadata_hash:   field,
        resolution_time: u64,
    }

    // -------------------------------------------------------
    // ENTRY FUNCTIONS
    // -------------------------------------------------------

    // ── Initialize ─────────────────────────────────────────
    fn initialize() -> AdminCap {
        return AdminCap { owner: self.signer };
    }

    // ── Create Market ───────────────────────────────────────
    fn create_market(
        admin:              AdminCap,
        metadata_cid:       field,
        metadata_hash:      field,
        resolution_time:    u64,
        public initial_yes: u128,
        public initial_no:  u128
    ) -> (MarketInfo, AdminCap, Final) {

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

        let fut: Final = test_usdcx_stablecoin.aleo::transfer_from_public(
            self.signer,
            self.address,
            initial_amount
        );

        return (info, returned_admin, final {
            fut.run();
            Mapping::set(yes_pools,        market_id, initial_yes as u64);
            Mapping::set(no_pools,         market_id, initial_no  as u64);
            Mapping::set(vault_balances,   market_id, initial_amount as u64);
            Mapping::set(market_states,    market_id, 0u8);
            Mapping::set(market_results,   market_id, false);
            Mapping::set(winning_pools,    market_id, 0u64);
            Mapping::set(resolution_times, market_id, resolution_time);
            // P1: vault invariant
            let iy: u64  = initial_yes as u64;
            let in_: u64 = initial_no  as u64;
            assert(initial_amount as u64 >= iy + in_);
        });
    }

    // ── Buy Shares ──────────────────────────────────────────
    // Wave 4: P4 removed expected_yes/no, P5 fees embedded, P3 ceil division.
    fn buy_shares(
        public market_id:      field,
        public amount:         u128,
        private outcome:       bool,
        public min_shares_out: u64,
        public deadline:       u32,
        public timestamp:      u64
    ) -> (Position, Final) {

        assert(amount >= 100_000u128);
        assert(min_shares_out > 0u64);

        let effective: u128 = amount * 997u128 / 1_000u128;

        let pos: Position = Position {
            owner:           self.signer,
            market_id:       market_id,
            yes_shares:      outcome ? min_shares_out : 0u64,
            no_shares:       outcome ? 0u64 : min_shares_out,
            entry_price_yes: 5_000u64,
            entry_price_no:  5_000u64,
            timestamp:       timestamp,
        };

        let fut: Final = test_usdcx_stablecoin.aleo::transfer_from_public(
            self.signer,
            self.address,
            amount
        );

        return (pos, final {
            fut.run();
            assert(block.height <= deadline);

            let state: u8 = Mapping::get_or_use(market_states, market_id, 255u8);
            assert_eq(state, 0u8);

            let cur_yes: u64 = Mapping::get(yes_pools, market_id);
            let cur_no:  u64 = Mapping::get(no_pools,  market_id);
            let cy: u128 = cur_yes as u128;
            let cn: u128 = cur_no  as u128;
            let ck: u128 = cy * cn;

            // P3: ceil division
            let v_yes_new_yes: u128 = cy + effective;
            let v_yes_new_no:  u128 = (ck + v_yes_new_yes - 1u128) / v_yes_new_yes;
            let v_no_new_no:   u128 = cn + effective;
            let v_no_new_yes:  u128 = (ck + v_no_new_no - 1u128) / v_no_new_no;

            let live_yes_shares: u64 = (cn - v_yes_new_no) as u64;
            let live_no_shares:  u64 = (cy - v_no_new_yes) as u64;
            let live_shares:     u64 = outcome ? live_yes_shares : live_no_shares;

            assert(live_shares >= min_shares_out);

            let store_yes: u64 = outcome ? (v_yes_new_yes as u64) : (v_no_new_yes as u64);
            let store_no:  u64 = outcome ? (v_yes_new_no  as u64) : (v_no_new_no  as u64);
            Mapping::set(yes_pools, market_id, store_yes);
            Mapping::set(no_pools,  market_id, store_no);

            let cur_vault: u64 = Mapping::get(vault_balances, market_id);
            let new_vault: u64 = cur_vault + (amount as u64);
            Mapping::set(vault_balances, market_id, new_vault);

            // P1: vault invariant
            assert(new_vault >= store_yes + store_no);
        });
    }

    // ── Sell Shares ─────────────────────────────────────────
    fn sell_shares(
        public market_id:      field,
        position:              Position,
        private outcome:       bool,
        private share_amount:  u64,
        public min_payout_out: u64,
        public deadline:       u32
    ) -> (Position, Final) {

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

        let claimable_key: field = BHP256::hash_to_field(self.signer as field + market_id);
        let pos_nonce:     field = BHP256::hash_to_field(
            self.signer as field + market_id + position.timestamp as field
        );

        return (new_pos, final {
            assert(block.height <= deadline);

            let state: u8 = Mapping::get_or_use(market_states, market_id, 255u8);
            assert_eq(state, 0u8);

            // P2: double-dip guard
            let consumed: bool = Mapping::get_or_use(position_consumed, pos_nonce, false);
            assert(!consumed);

            let cur_yes: u64 = Mapping::get(yes_pools, market_id);
            let cur_no:  u64 = Mapping::get(no_pools,  market_id);
            let cy: u128 = cur_yes as u128;
            let cn: u128 = cur_no  as u128;
            let sh: u128 = share_amount as u128;
            let ck: u128 = cy * cn;

            // P3: ceil division
            let v_yes_new_no:  u128 = cn + sh;
            let v_yes_new_yes: u128 = (ck + v_yes_new_no - 1u128) / v_yes_new_no;
            let v_no_new_yes:  u128 = cy + sh;
            let v_no_new_no:   u128 = (ck + v_no_new_yes - 1u128) / v_no_new_yes;

            let yes_payout: u64 = (cy - v_yes_new_yes) as u64;
            let no_payout:  u64 = (cn - v_no_new_no)   as u64;
            let payout:     u64 = outcome ? yes_payout : no_payout;

            // P5: fee stays in pool
            let net_payout: u64 = payout * 997u64 / 1_000u64;
            assert(net_payout >= min_payout_out);

            let cur_vault: u64 = Mapping::get(vault_balances, market_id);
            assert(net_payout <= cur_vault);

            let store_yes: u64 = outcome ? (v_yes_new_yes as u64) : (v_no_new_yes as u64);
            let store_no:  u64 = outcome ? (v_yes_new_no  as u64) : (v_no_new_no  as u64);
            Mapping::set(yes_pools,      market_id, store_yes);
            Mapping::set(no_pools,       market_id, store_no);

            let post_vault: u64 = cur_vault - net_payout;
            Mapping::set(vault_balances, market_id, post_vault);

            // P1: vault invariant
            assert(post_vault >= store_yes + store_no);

            // P2: mark consumed if fully sold
            let remaining: u64 = owned - share_amount;
            Mapping::set(position_consumed, pos_nonce, remaining == 0u64);

            let existing: u64 = Mapping::get_or_use(claimable, claimable_key, 0u64);
            Mapping::set(claimable, claimable_key, existing + net_payout);
        });
    }

    // ── Resolve Market ──────────────────────────────────────
    fn resolve_market(
        admin:                  AdminCap,
        public market_id:       field,
        public winning_outcome: bool
    ) -> (AdminCap, Final) {
        let returned_admin: AdminCap = AdminCap { owner: admin.owner };
        return (returned_admin, final {
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
    fn claim_winnings(
        position:               Position,
        public market_id:       field,
        public expected_payout: u128
    ) -> Final {

        assert_eq(position.market_id, market_id);
        assert(position.yes_shares > 0u64 || position.no_shares > 0u64);
        assert(expected_payout > 0u128);

        let yes_sh: u64 = position.yes_shares;
        let no_sh:  u64 = position.no_shares;
        let claimable_key: field = BHP256::hash_to_field(self.signer as field + market_id);
        let pos_nonce:     field = BHP256::hash_to_field(
            self.signer as field + market_id + position.timestamp as field
        );

        return final {
            let state: u8 = Mapping::get(market_states, market_id);
            assert_eq(state, 3u8);

            // P2
            let consumed: bool = Mapping::get_or_use(position_consumed, pos_nonce, false);
            assert(!consumed);

            let result:   bool = Mapping::get(market_results, market_id);
            let win_pool: u64  = Mapping::get(winning_pools,  market_id);
            let vault:    u64  = Mapping::get(vault_balances, market_id);
            assert(win_pool > 0u64);

            let user_shares: u64 = result ? yes_sh : no_sh;
            assert(user_shares > 0u64);

            let actual_payout: u64 =
                ((user_shares as u128 * vault as u128) / win_pool as u128) as u64;
            assert_eq(expected_payout, actual_payout as u128);
            assert(actual_payout <= vault);

            let post_vault: u64 = vault - actual_payout;
            Mapping::set(vault_balances, market_id, post_vault);

            // P1: vault invariant
            let rem_yes: u64 = Mapping::get(yes_pools, market_id);
            let rem_no:  u64 = Mapping::get(no_pools,  market_id);
            assert(post_vault >= rem_yes + rem_no);

            // P2: mark consumed
            Mapping::set(position_consumed, pos_nonce, true);

            let existing: u64 = Mapping::get_or_use(claimable, claimable_key, 0u64);
            Mapping::set(claimable, claimable_key, existing + actual_payout);
        };
    }

    // ── Withdraw Private ───────────────────────────────────
    fn withdraw_private(
        public market_id: field,
        private amount:   u64
    ) -> (test_usdcx_stablecoin.aleo::ComplianceRecord, test_usdcx_stablecoin.aleo::Token, Final) {

        let claimable_key: field = BHP256::hash_to_field(self.signer as field + market_id);

        let (compliance, token, fut): (
            test_usdcx_stablecoin.aleo::ComplianceRecord,
            test_usdcx_stablecoin.aleo::Token,
            Final
        ) = test_usdcx_stablecoin.aleo::transfer_public_to_private(
            self.signer,
            amount as u128
        );

        return (compliance, token, final {
            fut.run();
            let available: u64 = Mapping::get(claimable, claimable_key);
            assert(available >= amount);
            Mapping::set(claimable, claimable_key, available - amount);
        });
    }

    // ── Withdraw Public ─────────────────────────────────────
    fn withdraw_public(
        public market_id: field,
        public amount:    u128
    ) -> Final {

        assert(amount > 0u128);

        let claimable_key: field = BHP256::hash_to_field(self.signer as field + market_id);

        let fut: Final = test_usdcx_stablecoin.aleo::transfer_public(
            self.signer,
            amount
        );

        return final {
            fut.run();
            let available: u64 = Mapping::get(claimable, claimable_key);
            assert(available >= amount as u64);
            Mapping::set(claimable, claimable_key, available - amount as u64);
        };
    }

    // ── Pause Market ────────────────────────────────────────
    fn pause_market(
        admin:            AdminCap,
        public market_id: field
    ) -> (AdminCap, Final) {
        let returned_admin: AdminCap = AdminCap { owner: admin.owner };
        return (returned_admin, final {
            let state: u8 = Mapping::get(market_states, market_id);
            assert_eq(state, 0u8);
            Mapping::set(market_states, market_id, 1u8);
        });
    }

    // ── Resume Market ────────────────────────────────────────
    fn resume_market(
        admin:            AdminCap,
        public market_id: field
    ) -> (AdminCap, Final) {
        let returned_admin: AdminCap = AdminCap { owner: admin.owner };
        return (returned_admin, final {
            let state: u8 = Mapping::get(market_states, market_id);
            assert_eq(state, 1u8);
            Mapping::set(market_states, market_id, 0u8);
        });
    }

    // ── Constructor ─────────────────────────────────────────
    @admin(address="aleo1aqwe9742m69tq0hr5645qcsw5a77u025s0xpedx0y602she0jsyq5pjghk")
    constructor() {}
}
