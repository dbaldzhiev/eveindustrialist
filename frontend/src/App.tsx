import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import InventionPage from "./pages/InventionPage";
import CopyingPage from "./pages/CopyingPage";
import ExplorerPage from "./pages/ExplorerPage";
import SellerPage from "./pages/SellerPage";
import ReactionsPage from "./pages/ReactionsPage";
import WarehousePage from "./pages/WarehousePage";
import SlotsPage from "./pages/SlotsPage";
import PlansPage from "./pages/PlansPage";
import SettingsPage from "./pages/SettingsPage";
import { RefreshProvider } from "./context/RefreshContext";
import { fetchMe } from "./api/client";
import type { Character } from "./types";

export default function App() {
  const [character, setCharacter] = useState<Character | null | undefined>(undefined);

  useEffect(() => {
    fetchMe()
      .then(setCharacter)
      .catch(() => setCharacter(null));
  }, []);

  if (character === undefined) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-eve-muted text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <RefreshProvider>
    <Routes>
      <Route
        path="/"
        element={character ? <Navigate to="/slots" replace /> : <LoginPage />}
      />
      <Route
        path="/slots"
        element={character ? <SlotsPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/dashboard"
        element={character ? <DashboardPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/invention"
        element={character ? <InventionPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/copying"
        element={character ? <CopyingPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/explorer"
        element={character ? <ExplorerPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/seller"
        element={character ? <SellerPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/reactions"
        element={character ? <ReactionsPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/warehouse"
        element={character ? <WarehousePage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/plans"
        element={character ? <PlansPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/settings"
        element={character ? <SettingsPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </RefreshProvider>
  );
}
