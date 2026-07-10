import { useState, useCallback } from 'react';
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import type { QortiumAccount } from './types';
import GatePage from './pages/GatePage/GatePage';
import DashboardPage from './pages/DashboardPage/DashboardPage';

export default function App() {
  const navigate = useNavigate();
  const [account, setAccount] = useState<QortiumAccount | null>(null);

  const handleAccountReady = useCallback((acct: QortiumAccount) => {
    setAccount(acct);
  }, []);

  const handleLogout = useCallback(() => {
    setAccount(null);
    navigate('/');
  }, [navigate]);

  return (
    <Routes>
      <Route
        path="/"
        element={
          account ? (
            <Navigate to="/dashboard" replace />
          ) : (
            <GatePage onAccountReady={handleAccountReady} />
          )
        }
      />
      <Route
        path="/dashboard"
        element={
          account ? (
            <DashboardPage account={account} onLogout={handleLogout} />
          ) : (
            <Navigate to="/" replace />
          )
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
