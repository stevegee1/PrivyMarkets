import { useMemo } from "react";
import { AleoWalletProvider } from "@provablehq/aleo-wallet-adaptor-react";
import { WalletModalProvider } from "@provablehq/aleo-wallet-adaptor-react-ui";
import { PROGRAM_ID } from "./constants.js";
import { ShieldWalletAdapter } from "@provablehq/aleo-wallet-adaptor-shield";
import { LeoWalletAdapter } from "@provablehq/aleo-wallet-adaptor-leo";
import { PuzzleWalletAdapter } from "@provablehq/aleo-wallet-adaptor-puzzle";
import { Network } from "@provablehq/aleo-types";
import { DecryptPermission } from "@provablehq/aleo-wallet-adaptor-core";
import "@provablehq/aleo-wallet-adaptor-react-ui/dist/styles.css";

// Configure the wallet options to be used in the application.
export const WalletWrapper = ({ children }) => {
    // Initialize wallets inside a functional component using useMemo.
    const wallets = useMemo(
        () => [
            new ShieldWalletAdapter({ appName: "PrivyMarkets" }),
            new LeoWalletAdapter({ appName: "PrivyMarkets" }),
            new PuzzleWalletAdapter({ appName: "PrivyMarkets" }),
        ],
        []
    );

    return (
        <AleoWalletProvider
            wallets={wallets}
            autoConnect={false}
            network={Network.TESTNET}
            decryptPermission={DecryptPermission.UponRequest}
            programs={[PROGRAM_ID, "credits.aleo"]}
        >
            <WalletModalProvider>
                {children}
            </WalletModalProvider>
        </AleoWalletProvider>
    );
};
