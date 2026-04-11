import { Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import ExplorerPage from "./pages/ExplorerPage";
import WarehousePage from "./pages/WarehousePage";
import ShoppingListPage from "./pages/ShoppingListPage";
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
    <Routes>
      <Route
        path="/"
        element={character ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/dashboard"
        element={character ? <DashboardPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/explorer"
        element={character ? <ExplorerPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/warehouse"
        element={character ? <WarehousePage character={character} /> : <Navigate to="/" replace />}
      />
      <Route
        path="/shopping-list"
        element={character ? <ShoppingListPage character={character} /> : <Navigate to="/" replace />}
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
