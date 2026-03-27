// ============================================================================
// VEILED MARKETS - Blockchain Indexer Service
// ============================================================================
// Scans blockchain for market creation events and maintains market registry
// ============================================================================

import * as fs from 'fs';
import * as path from 'path';

export interface IndexedMarket {
    marketId: string;
    transactionId: string;
    creator: string;
    questionHash: string;
    category: number;
    deadline: string;
    resolutionDeadline: string;
    createdAt: number;
    blockHeight: number;
}

/**
 * Known markets from contract deployment
 * In production, this would be fetched from an indexer service or custom node
 * Question hashes are generated from actual market questions using SHA-256
 * 
 * NOTE: veiled_markets_v9.aleo is the version 4 deployment with privacy fix
 * Includes delayed pool updates, noise addition, and commit-reveal betting for better privacy
 */
// NOTE: privymarket_v5.aleo is the unified market program for Wave 4
const KNOWN_MARKETS: IndexedMarket[] = [
    // Add your deployed market IDs here
];

/**
 * Index all markets from blockchain
 * Currently uses known markets. In production, would scan blockchain.
 */
export async function indexAllMarkets(): Promise<IndexedMarket[]> {
    console.log('🔍 Starting market indexing for privymarket_v5.aleo...');
    console.log('📋 Using known market IDs (Aleo explorer API limitations)');
    console.log(`✅ Found ${KNOWN_MARKETS.length} markets.`);
    return KNOWN_MARKETS;
}

/**
 * Get market IDs from indexed data
 */
export function getMarketIds(markets: IndexedMarket[]): string[] {
    return markets.map(m => m.marketId);
}

/**
 * Build question text map from indexed data
 */
export function buildQuestionMap(markets: IndexedMarket[]): Record<string, string> {
    const map: Record<string, string> = {};

    for (const market of markets) {
        // In production, fetch actual question text from IPFS/storage using questionHash
        map[market.questionHash] = `Market ${market.questionHash}`;
    }

    return map;
}

/**
 * Save indexed markets to JSON file (for static deployment)
 */
export async function saveIndexedMarkets(markets: IndexedMarket[]): Promise<void> {
    const data = {
        lastUpdated: new Date().toISOString(),
        totalMarkets: markets.length,
        markets,
        marketIds: getMarketIds(markets),
    };

    // Output to the frontend's public directory
    const publicDir = path.join(process.cwd(), '..', 'frontend', 'public');
    if (!fs.existsSync(publicDir)) {
        // Fallback to local public if frontend doesn't exist
        const localPublic = path.join(process.cwd(), 'public');
        if (!fs.existsSync(localPublic)) fs.mkdirSync(localPublic, { recursive: true });
        const outputPath = path.join(localPublic, 'markets-index.json');
        fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
        console.log(`💾 Saved indexed markets to ${outputPath} (fallback)`);
        return;
    }

    const outputPath = path.join(publicDir, 'markets-index.json');
    fs.writeFileSync(outputPath, JSON.stringify(data, null, 2));
    console.log(`💾 Saved indexed markets to ${outputPath}`);
}

/**
 * Load indexed markets from JSON file
 */
export async function loadIndexedMarkets(): Promise<string[]> {
    try {
        const response = await fetch('/markets-index.json');
        if (!response.ok) return [];

        const data = await response.json();
        return data.marketIds || [];
    } catch (error) {
        console.error('Failed to load indexed markets:', error);
        return [];
    }
}
