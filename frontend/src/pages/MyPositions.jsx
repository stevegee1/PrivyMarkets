import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import MyPositionsComponent from '../components/MyPositions';
import ThemeToggle from '../components/ThemeToggle';
import { useWalletModal } from '@provablehq/aleo-wallet-adaptor-react-ui';

export default function MyPositions() {
  const navigate = useNavigate();
  const { address } = useWallet();
  const { setVisible } = useWalletModal();

  const addr = address ? `${address.slice(0,6)}…${address.slice(-4)}` : '';

  return (
    <div className="min-h-screen bg-bg dark:bg-gray-900 font-sans">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm h-14 flex items-center px-4 sm:px-6 lg:px-8 gap-3">
        <button onClick={() => navigate('/dashboard')}
          className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-1.5">
          <div className="w-6 h-6 rounded-md bg-pm-blue flex items-center justify-center">
            <span className="text-white font-black text-[10px]">P</span>
          </div>
          <span className="font-semibold text-gray-900 dark:text-white">PrivyMarkets</span>
        </div>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">My Bets</span>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          {addr ? (
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-mono text-gray-600 dark:text-gray-300">
              <span className="w-2 h-2 rounded-full bg-yes-DEFAULT" /> {addr}
            </div>
          ) : (
            <button
              onClick={() => setVisible(true)}
              className="px-4 py-2 text-xs font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors flex-shrink-0 shadow-sm"
            >
              Connect Wallet
            </button>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8">
        <MyPositionsComponent />
      </div>
    </div>
  );
}
