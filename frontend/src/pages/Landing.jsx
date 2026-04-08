import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { useWalletModal } from '@provablehq/aleo-wallet-adaptor-react-ui';
import ThemeToggle from '../components/ThemeToggle';

export default function Landing() {
  const navigate  = useNavigate();
  const { address, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const addr = address ? `${address.slice(0,6)}…${address.slice(-4)}` : '';

  // Redirect if already connected
  useEffect(() => { if (connected) navigate('/dashboard'); }, [connected, navigate]);

  const [hovered, setHovered] = useState(null);

  if (connected) return null;

  return (
    <div className="min-h-screen bg-bg dark:bg-gray-900 font-sans">

      {/* ── Header ── */}
      <header className="sticky top-0 z-40 bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 shadow-sm">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 flex items-center justify-between h-14">
          {/* Logo */}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-md bg-pm-blue flex items-center justify-center">
              <span className="text-white font-black text-xs">P</span>
            </div>
            <span className="font-bold text-gray-900 dark:text-white text-lg tracking-tight">PrivyMarkets</span>
          </div>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {addr ? (
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 text-xs font-mono text-gray-600 dark:text-gray-300">
                <span className="w-2 h-2 rounded-full bg-yes-DEFAULT" /> {addr}
              </div>
            ) : (
              <button
                onClick={() => setVisible(true)}
                className="px-4 py-2 text-sm font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors shadow-sm"
              >
                Connect Wallet
              </button>
            )}
          </div>
        </div>
      </header>

      {/* ── Hero ── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-pm-blueLight text-pm-blue text-xs font-semibold mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-yes-DEFAULT animate-pulse" />
              Live on Aleo Testnet
            </div>

            <h1 className="text-4xl sm:text-5xl font-black text-gray-900 dark:text-white leading-tight mb-4">
              Predict the future,<br />
              <span className="text-pm-blue">privately.</span>
            </h1>

            <p className="text-lg text-gray-500 dark:text-gray-400 mb-8 leading-relaxed">
              The prediction market where your bets stay encrypted.
              Zero-knowledge proofs keep your positions completely private.
            </p>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setVisible(true)}
                className="px-6 py-3 rounded-lg bg-pm-blue text-white font-semibold hover:bg-blue-700 transition-colors shadow-sm"
              >
                Start predicting
              </button>
              <button
                onClick={() => document.getElementById('features-section')?.scrollIntoView({ behavior: 'smooth' })}
                className="px-6 py-3 rounded-lg border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-semibold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                How it works
              </button>
            </div>

            {/* Trust stats */}
            <div className="mt-10 grid grid-cols-3 gap-6 pt-8 border-t border-gray-200 dark:border-gray-700">
              {[
                { val: 'ZK',     label: 'Powered' },
                { val: '100%',   label: 'Private' },
                { val: 'CPMM',   label: 'AMM' },
              ].map(({ val, label }) => (
                <div key={label}>
                  <div className="text-2xl font-black text-gray-900 dark:text-white">{val}</div>
                  <div className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Market preview */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3">Live Markets</p>

            {[
              { q: 'Bitcoin hits $100k by Q3 2026?',   yes: 67, vol: '$4.2M' },
              { q: 'US Presidential Election winner?',   yes: 52, vol: '$18M' },
              { q: 'ETH breaks $5k before June?',       yes: 38, vol: '$2.1M' },
              { q: 'Champions League Winner 2026?',      yes: 26, vol: '$3.5M' },
            ].map(({ q, yes, vol }, i) => (
              <div
                key={i}
                className="pm-card p-4 cursor-pointer hover:shadow-md transition-shadow"
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => setVisible(true)}
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-slate-700 flex items-center justify-center text-lg flex-shrink-0">
                    {['₿', '🏗', '⟠', '⚽'][i]}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 dark:text-white line-clamp-1">{q}</p>
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{vol} Vol.</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-yes-dark font-bold text-sm">{yes}%</span>
                    <div className="flex gap-1">
                      <span className="btn-yes py-1 px-2.5 text-xs">Yes</span>
                      <span className="btn-no py-1 px-2.5 text-xs">No</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <button
              onClick={() => setVisible(true)}
              className="w-full py-2.5 text-sm font-semibold text-pm-blue dark:text-blue-400 bg-pm-blueLight dark:bg-blue-900/20 rounded-xl hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors"
            >
              View all markets →
            </button>
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features-section" className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 py-16">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-10 text-center">
            Why PrivyMarkets?
          </h2>
          <div className="grid sm:grid-cols-3 gap-8">
            {[
              { emoji: '🔒', title: 'Hidden Positions',   desc: 'Your bet direction is a private ZK input — never visible on-chain. Only you know which side you took.' },
              { emoji: '⚡', title: 'MEV Protected',      desc: 'Zero front-running. CPMM pricing ensures fair execution with on-chain slippage protection.' },
              { emoji: '🕵️', title: 'Anonymous Betting',  desc: 'No wallet tracking. Bet freely without social pressure or reputational risk.' },
            ].map(({ emoji, title, desc }) => (
              <div key={title} className="text-center">
                <div className="w-12 h-12 rounded-2xl bg-pm-blueLight dark:bg-blue-900/30 flex items-center justify-center text-2xl mx-auto mb-4">{emoji}</div>
                <h3 className="font-bold text-gray-900 dark:text-white mb-2">{title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA banner ── */}
      <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16">
        <div className="bg-pm-blue rounded-2xl p-10 text-center">
          <h2 className="text-3xl font-black text-white mb-3">Ready to predict?</h2>
          <p className="text-blue-200 mb-6">Connect your Aleo wallet and start earning on your insights.</p>
          <button
            onClick={() => setVisible(true)}
            className="px-8 py-3 bg-white text-pm-blue font-bold rounded-lg hover:bg-blue-50 transition-colors shadow-lg"
          >
            Connect Wallet
          </button>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-6 text-center">
        <p className="text-sm text-gray-400 dark:text-gray-500">
          © 2026 PrivyMarkets · Private Prediction Markets on Aleo · CPMM-Powered
        </p>
      </footer>
    </div>
  );
}
