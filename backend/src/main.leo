// privymarkets - Private Prediction Markets on Aleo

import credits.aleo;

program privymarkets_v2.aleo {

    // PUBLIC STATE MAPPINGS
    mapping yes_pools: field => u64;
    mapping no_pools: field => u64;
    mapping vault_balances: field => u64;
    mapping market_states: field => u8; // 0=OPEN, 1=PAUSED, 3=RESOLVED
    mapping market_results: field => bool;

    // RECORDS
    record AdminCap { owner: address, }

    record Position {
        owner: address,
        market_id: field,
        yes_shares: u64,
        no_shares: u64,
        timestamp: u64
    }

    record MarketInfo {
        owner: address,
        market_id: field,
        metadata_cid: field,
        metadata_hash: field,
        resolution_time: u64
    }

    // ------------------------------------------------------
    // TRANSITIONS
    // ------------------------------------------------------

    // Initialize
    transition initialize() -> AdminCap {
        return AdminCap { owner: self.signer };
    }

    // Create Market
    async transition create_market(
        admin: AdminCap,
        public market_id: field,
        metadata_cid: field,
        metadata_hash: field,
        resolution_time: u64,
        initial_credits: credits.aleo/credits,
        public initial_amount: u64
    ) -> (MarketInfo, AdminCap, credits.aleo/credits, Future) {
        assert(initial_amount >= 2_000_000u64);

        // market_id is passed in
        // let market_id: field = BHP256::hash_to_field(metadata_hash);

        let info: MarketInfo = MarketInfo {
            owner: self.signer,
            market_id: market_id,
            metadata_cid: metadata_cid,
            metadata_hash: metadata_hash,
            resolution_time: resolution_time
        };

        let returned_admin: AdminCap = AdminCap { owner: admin.owner };

        // Transfer funds to PROGRAM
        let (rem, fut): (credits.aleo/credits, Future) = credits.aleo/transfer_private_to_public(
            initial_credits,
            privymarkets_v2.aleo,
            initial_amount
        );

        return (info, returned_admin, rem, async {
            fut.await();

            let half: u64 = initial_amount / 2u64;
            Mapping::set(yes_pools, market_id, half);
            Mapping::set(no_pools, market_id, half);
            Mapping::set(vault_balances, market_id, initial_amount);
            Mapping::set(market_states, market_id, 0u8);
            Mapping::set(market_results, market_id, false);
        });
    }

    // Buy Shares
    async transition buy_shares(
        public market_id: field,
        payment: credits.aleo/credits,
        public outcome: bool,
        public amount: u64,
        public expected_yes: u64,
        public expected_no: u64,
        public timestamp: u64
    ) -> (Position, credits.aleo/credits, Future) {
        assert(amount >= 100_000u64);

        let target_pool: u64 = outcome ? expected_yes : expected_no;
        let other_pool: u64 = outcome ? expected_no : expected_yes;
        let new_target_pool: u64 = target_pool + amount;
        let total_before: u64 = target_pool + other_pool;
        let total_after: u64 = new_target_pool + other_pool;

        let price_before: u64 = (target_pool * 10000u64) / total_before;
        let price_after: u64 = (new_target_pool * 10000u64) / total_after;
        let avg_price: u64 = (price_before + price_after) / 2u64;
        let shares: u64 = (amount * 10000u64) / avg_price;

        assert(shares > 0u64);

        let pos: Position = Position {
            owner: self.signer,
            market_id: market_id,
            yes_shares: outcome ? shares : 0u64,
            no_shares: outcome ? 0u64 : shares,
            timestamp: timestamp
        };

        let (rem, fut): (credits.aleo/credits, Future) = credits.aleo/transfer_private_to_public(
            payment,
            privymarkets_v2.aleo,
            amount
        );

        return (pos, rem, async {
            fut.await();

            let state: u8 = Mapping::get_or_use(market_states, market_id, 255u8);
            assert_eq(state, 0u8);

            let current_yes: u64 = Mapping::get(yes_pools, market_id);
            let current_no: u64 = Mapping::get(no_pools, market_id);
            assert_eq(current_yes, expected_yes);
            assert_eq(current_no, expected_no);

            if outcome {
                Mapping::set(yes_pools, market_id, current_yes + amount);
            } else {
                Mapping::set(no_pools, market_id, current_no + amount);
            }
            let current_bal: u64 = Mapping::get(vault_balances, market_id);
            Mapping::set(vault_balances, market_id, current_bal + amount);
        });
    }

    // Sell Shares
    async transition sell_shares(
        public market_id: field,
        position: Position,
        public outcome: bool,
        public share_amount: u64,
        public expected_yes: u64,
        public expected_no: u64
    ) -> (Position, credits.aleo/credits, Future) {
        assert(share_amount > 0u64);

        // Calculate Payout based on linear pool proportion (consistent with buy)
        let target_pool: u64 = outcome ? expected_yes : expected_no;
        let other_pool: u64 = outcome ? expected_no : expected_yes;
        let total_pool: u64 = target_pool + other_pool;

        // Payout = (Shares * TargetPool) / TotalPool

        let payout: u64 = (share_amount * target_pool) / total_pool;

        // Return remaining shares
        let new_yes: u64 = outcome ? (position.yes_shares - share_amount) : position.yes_shares;
        let new_no: u64 = outcome ? position.no_shares : (position.no_shares - share_amount);

        let new_pos: Position = Position {
            owner: self.signer,
            market_id: market_id,
            yes_shares: new_yes,
            no_shares: new_no,
            timestamp: position.timestamp
        };

        // Refund Credits from Program Public Balance -> User Private Record
        let (refund, fut): (credits.aleo/credits, Future) = credits.aleo/transfer_public_to_private(
            position.owner,
            payout
        );

        return (new_pos, refund, async {
            fut.await();

            // Verify State
            let state: u8 = Mapping::get_or_use(market_states, market_id, 255u8);
            assert_eq(state, 0u8);

            let current_yes: u64 = Mapping::get(yes_pools, market_id);
            let current_no: u64 = Mapping::get(no_pools, market_id);
            assert_eq(current_yes, expected_yes);
            assert_eq(current_no, expected_no);

            // Update Pools (Deduct Payout from Target)
            if outcome {
                Mapping::set(yes_pools, market_id, current_yes - payout);
            } else {
                Mapping::set(no_pools, market_id, current_no - payout);
            }

            let current_bal: u64 = Mapping::get(vault_balances, market_id);
            Mapping::set(vault_balances, market_id, current_bal - payout);
        });
    }

    // Resolve Market
    async transition resolve_market(
        admin: AdminCap,
        public market_id: field,
        public winning_outcome: bool
    ) -> (AdminCap, Future) {
        let returned_admin: AdminCap = AdminCap { owner: admin.owner };
        return (returned_admin, async {
            let state: u8 = Mapping::get(market_states, market_id);
            assert(state == 0u8 || state == 1u8);
            Mapping::set(market_states, market_id, 3u8);
            Mapping::set(market_results, market_id, winning_outcome);
        });
    }

    // Constructor
  @admin(address="aleo1s3qmy92sh6q7hgwdeqnzslycag0tfzdgzwqyh7pejkv23daqgq9qns8n7h")
    async constructor() {}
}
