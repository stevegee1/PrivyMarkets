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
                // Only reconnect if Shield already has a stored session
                // (i.e. the disconnect was spurious, not intentional)
                const hasSession = !!localStorage.getItem('shield-wallet-session')
                    || !!sessionStorage.getItem('shield-wallet-session')
                    || !!localStorage.getItem('shieldWalletConnected');

                if (hasSession && !connecting) {
                    // Call connect() with NO extra args — Shield reads its own
                    // stored config. Passing network/decrypt again triggers
                    // another "network changed" event and a fresh disconnect loop.
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
export const WalletWrapper = ({ children }) => {
    const wallets = useMemo(() => [
        new ShieldWalletAdapter({
            appName:           "PrivyMarkets",
            // Declare programs and decrypt at construction time only.
            // Passing them again to connect() makes Shield treat them as a
            // network change and fire another disconnect.
            programs:          [PROGRAM_ID, USDCX_PROGRAM_ID],
            decryptPermission: DecryptPermission.UponRequest,
            network:           Network.TESTNET,
        })
    ], []);

    return (
        <AleoWalletProvider
            wallets={wallets}
            autoConnect={false}
            network={Network.TESTNET}
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
