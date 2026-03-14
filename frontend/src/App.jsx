import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useWallet } from '@provablehq/aleo-wallet-adaptor-react';
import { WalletWrapper } from './core/WalletWrapper';
import Landing from './pages/Landing';
import Dashboard from './pages/Dashboard';
import MarketDetail from './pages/MarketDetail';
import MyPositions from './pages/MyPositions';
import './index.css';

// Guard — redirects to / if wallet not connected, with 2.5s grace for auto-reconnect
function ProtectedRoute({ children }) {
  const { connected, connecting } = useWallet();

  if (connecting) {
    return (
      <div className="min-h-screen bg-surface-950 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!connected) {
    return <Navigate to="/" replace />;
  }

  return children;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute>
            <Dashboard />
          </ProtectedRoute>
        }
      />
      <Route
        path="/market/:marketId"
        element={
          <ProtectedRoute>
            <MarketDetail />
          </ProtectedRoute>
        }
      />
      <Route
        path="/positions"
        element={
          <ProtectedRoute>
            <MyPositions />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

function App() {
  return (
    <WalletWrapper>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </WalletWrapper>
  );
}

export default App;
