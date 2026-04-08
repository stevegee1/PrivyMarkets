// CreateMarketModal.jsx — thin wrapper that re-uses AdminMarketCreate
// but exposes it as a self-contained modal overlay
import AdminMarketCreate from './AdminMarketCreate';

export default function CreateMarketModal({ onClose, onCreated }) {
  return (
    <div
      className="relative bg-surface-900 border border-white/10 rounded-2xl
                  max-h-[90vh] overflow-y-auto shadow-2xl"
      onClick={e => e.stopPropagation()}
    >
      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-4 right-4 z-10 p-2 rounded-lg
                   text-gray-400 hover:text-white hover:bg-surface-800 transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>

      {/* Admin create component (already handles the full flow) */}
      <AdminMarketCreate onMarketCreated={onCreated} />
    </div>
  );
}
