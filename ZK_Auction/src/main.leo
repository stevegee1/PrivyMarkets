import credits.aleo;

program ZK_Auction.aleo {

    struct item {
        id: field,
        offchain_data: [field; 4],
    }

    struct auction {
        starting_bid: u64,
        name: field,
        item: item,
    }

    struct privacy_settings {
        auction_privacy: u8,
        bid_types_accepted: u8,
    }

    struct bid {
        amount: u64,
        auction_id: field,
        bid_public_key: group,
    }

    mapping auction_public_keys: field => group;
    mapping auction_owners: field => address;
    mapping public_auctions: field => auction;
    mapping auction_privacy_settings: field => privacy_settings;
    mapping highest_bids: field => u64;
    mapping bid_count: field => u64;
    mapping winning_bids: field => field;
    mapping redemptions: field => bool;
    mapping public_bids: field => bid;
    mapping public_bid_owners: field => address;

    record AuctionTicket {
        owner: address,
        auction: auction,
        auction_id: field,
        settings: privacy_settings,
    }

    record AuctionInvite {
        owner: address,
        auction: auction,
        auctioneer: address,
        auction_id: field,
        settings: privacy_settings,
    }

    record BidReceipt {
        owner: address,
        auction_id: field,
        bid: bid,
        bid_id: field,
    }

    record PrivateBid {
        owner: address,
        bid: bid,
        bid_id: field,
    }

    async transition create_private_auction(
        public bid_types_accepted: u8,
        public item_id: field,
        public auction_name: field,
        public item_offchain_data: [field; 4],
        public starting_bid: u64,
        public nonce: scalar,
    ) -> (AuctionTicket, Future) {

        assert(bid_types_accepted < 3u8);

        let auction_public_key: group = nonce * group::GEN;
        let signer_group: group = self.signer as group;
        let commit_key: group = nonce * signer_group;

        let settings: privacy_settings = privacy_settings {
            auction_privacy: 0u8,
            bid_types_accepted: bid_types_accepted,
        };

        let auction_item: item = item {
            id: item_id,
            offchain_data: item_offchain_data,
        };

        let new_auction: auction = auction {
            starting_bid: starting_bid,
            name: auction_name,
            item: auction_item,
        };

        let auction_hash: scalar = Poseidon2::hash_to_scalar(starting_bid);
        let auction_id_scalar: scalar = Poseidon2::hash_to_scalar(auction_hash * commit_key);
        let auction_id: field = auction_id_scalar as field;

        let ticket: AuctionTicket = AuctionTicket {
            owner: self.signer,
            auction: new_auction,
            auction_id: auction_id,
            settings: settings,
        };

        return (ticket, finalize_create_auction(auction_id, auction_public_key, self.signer));
    }

    async function finalize_create_auction(
        public auction_id: field,
        public auction_public_key: group,
        public owner: address
    ) {
        assert(!Mapping::contains(auction_public_keys, auction_id));
        Mapping::set(auction_public_keys, auction_id, auction_public_key);
        Mapping::set(auction_owners, auction_id, owner);
    }

    async transition bid_public(
        public amount: u64,
        public auction_id: field,
        public nonce: scalar,
        public bidder: address,
    ) -> (BidReceipt, Future) {

        let bid_public_key: group = nonce * group::GEN;

        let new_bid: bid = bid {
            amount: amount,
            auction_id: auction_id,
            bid_public_key: bid_public_key,
        };

        let signer_group: group = self.signer as group;
        let commit_key: group = nonce * signer_group;
        let bid_hash: scalar = Poseidon2::hash_to_scalar(amount);
        let bid_id_scalar: scalar = Poseidon2::hash_to_scalar(bid_hash * commit_key);
        let bid_id: field = bid_id_scalar as field;

        let receipt: BidReceipt = BidReceipt {
            owner: self.signer,
            auction_id: auction_id,
            bid: new_bid,
            bid_id: bid_id,
        };

        return (receipt, finalize_bid_public(new_bid, bid_id, bidder));
    }

    async function finalize_bid_public(
        public public_bid: bid,
        public bid_id: field,
        public bidder: address
    ) {
        assert(Mapping::contains(auction_public_keys, public_bid.auction_id));
        assert(!Mapping::contains(winning_bids, public_bid.auction_id));
        assert(!Mapping::contains(public_bids, bid_id));

        Mapping::set(public_bids, bid_id, public_bid);

        let count: u64 = Mapping::get_or_use(bid_count, public_bid.auction_id, 0u64);
        Mapping::set(bid_count, public_bid.auction_id, count + 1u64);

        let highest: u64 = Mapping::get_or_use(highest_bids, public_bid.auction_id, 0u64);

        if (public_bid.amount > highest) {
            Mapping::set(highest_bids, public_bid.auction_id, public_bid.amount);
        }

        Mapping::set(public_bid_owners, bid_id, bidder);
    }

    async transition select_winner_private(
        auction_ticket: AuctionTicket,
        private_bid: PrivateBid,
    ) -> Future {

        assert_eq(auction_ticket.auction_id, private_bid.bid.auction_id);
        assert(private_bid.bid.amount >= auction_ticket.auction.starting_bid);

        return finalize_select_winner(
            private_bid.bid.auction_id,
            private_bid.bid_id,
            private_bid.bid.amount
        );
    }

    async function finalize_select_winner(
        public auction_id: field,
        public bid_id: field,
        public amount: u64
    ) {
        let highest: u64 = Mapping::get_or_use(highest_bids, auction_id, 0u64);
        assert_eq(amount, highest);
        Mapping::set(winning_bids, auction_id, bid_id);
    }

    async transition redeem_bid_public(
        auctioneer: address,
        bid_receipt: BidReceipt,
    ) -> Future {

        return finalize_redeem(
            auctioneer,
            bid_receipt.bid.auction_id,
            bid_receipt.bid_id,
            credits.aleo::transfer_public_as_signer(auctioneer, bid_receipt.bid.amount)
        );
    }

    async function finalize_redeem(
        public auctioneer: address,
        public auction_id: field,
        public bid_id: field,
        public transfer: Future
    ) {
        assert_eq(Mapping::get(auction_owners, auction_id), auctioneer);
        assert_eq(Mapping::get(winning_bids, auction_id), bid_id);
        assert(!Mapping::contains(redemptions, auction_id));

        transfer.await();
        Mapping::set(redemptions, auction_id, true);
    }
}
