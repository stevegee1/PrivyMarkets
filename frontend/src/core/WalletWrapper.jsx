import { useMemo, useEffect, useRef } from "react";
import { AleoWalletProvider, useWallet } from "@provablehq/aleo-wallet-adaptor-react";
import { WalletModalProvider } from "@provablehq/aleo-wallet-adaptor-react-ui";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import "@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css";
import { PROGRAM_ID, USDCX_PROGRAM_ID } from "./constants.js";

// ── Silent reconnect on Shield's spurious disconnect events ─────────────────
function ShieldReconnectGuard({ children }) {
    const { wallet, connect, connecting } = useWallet();
    const reconnectTimer = useRef(null);

    useEffect(() => {
        const adapter = wallet?.adapter;
        if (!adapter) return;

        const onDisconnect = () => {
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
            reconnectTimer.current = setTimeout(() => {
                const hasSession = !!localStorage.getItem('shield-wallet-session')
                    || !!sessionStorage.getItem('shield-wallet-session')
                    || !!localStorage.getItem('shieldWalletConnected');

                if (hasSession && !connecting) {
                    connect().catch(() => {});
                }
            }, 1_000);
        };

        adapter.on?.('disconnect', onDisconnect);
        return () => {
            adapter.off?.('disconnect', onDisconnect);
            if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
        };
    }, [wallet?.adapter, connect, connecting]);

    return children;
}

// ── Main wrapper ─────────────────────────────────────────────────────────────
// Mirror Veiled Market pattern:
//   - ShieldWalletAdapter gets NO constructor args
//   - decryptPermission and programs go to AleoWalletProvider
export const WalletWrapper = ({ children }) => {
    const wallets = useMemo(() => [
        new ShieldWalletAdapter()
    ], []);

    return (
        <AleoWalletProvider
            wallets={wallets}
            network={Network.TESTNET}
            autoConnect={true}
            decryptPermission={DecryptPermission.AutoDecrypt}
            programs={[
                PROGRAM_ID,
                USDCX_PROGRAM_ID,
                'credits.aleo',
                // Transitive dependencies of test_usdcx_stablecoin.aleo
                'merkle_tree.aleo',
                'test_usdcx_multisig_core.aleo',
                'test_usdcx_freezelist.aleo',
            ]}
            onError={(err) => {
                const msg = err?.message ?? '';
                if (
                    msg.includes('not connected') ||
                    msg.includes('connection expired') ||
                    msg.includes('Dapp not connected')
                ) return;
                console.warn('[Wallet]', msg);
            }}
        >
            <WalletModalProvider>
                <ShieldReconnectGuard>
                    {children}
                </ShieldReconnectGuard>
            </WalletModalProvider>
        </AleoWalletProvider>
    );
};
