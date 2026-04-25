import { createContext, useContext, useEffect, useRef, useState } from "react";
import { fetchCacheStatus, refreshMarketPrices, refreshEsi, refreshSde } from "../api/client";

interface RefreshContextValue {
  pricesKey:        number;
  esiKey:           number;
  sdeKey:           number;
  pricesAt:         number | null;
  esiAt:            number | null;
  sdeAt:            number | null;
  refreshingPrices: boolean;
  refreshingEsi:    boolean;
  refreshingSde:    boolean;
  doRefreshPrices:  () => Promise<void>;
  doRefreshEsi:     () => Promise<void>;
  doRefreshSde:     () => Promise<void>;
}

const RefreshContext = createContext<RefreshContextValue>({
  pricesKey: 0, esiKey: 0, sdeKey: 0,
  pricesAt: null, esiAt: null, sdeAt: null,
  refreshingPrices: false, refreshingEsi: false, refreshingSde: false,
  doRefreshPrices: async () => {}, doRefreshEsi: async () => {}, doRefreshSde: async () => {},
});

export function RefreshProvider({ children }: { children: React.ReactNode }) {
  const [pricesKey,        setPricesKey]        = useState(0);
  const [esiKey,           setEsiKey]           = useState(0);
  const [sdeKey,           setSdeKey]           = useState(0);
  const [pricesAt,         setPricesAt]         = useState<number | null>(null);
  const [esiAt,            setEsiAt]            = useState<number | null>(null);
  const [sdeAt,            setSdeAt]            = useState<number | null>(null);
  const [refreshingPrices, setRefreshingPrices] = useState(false);
  const [refreshingEsi,    setRefreshingEsi]    = useState(false);
  const [refreshingSde,    setRefreshingSde]    = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    fetchCacheStatus()
      .then((s) => {
        if (!mounted.current) return;
        if (s.market_updated_at) setPricesAt(s.market_updated_at * 1000);
        if (s.esi_updated_at)    setEsiAt(s.esi_updated_at    * 1000);
      })
      .catch(() => {});
    return () => { mounted.current = false; };
  }, []);

  const doRefreshPrices = async () => {
    setRefreshingPrices(true);
    try {
      await refreshMarketPrices();
      const now = Date.now();
      if (mounted.current) {
        setPricesAt(now);
        setPricesKey((k) => k + 1);
      }
    } finally {
      if (mounted.current) setRefreshingPrices(false);
    }
  };

  const doRefreshEsi = async () => {
    setRefreshingEsi(true);
    try {
      await refreshEsi();
      const now = Date.now();
      if (mounted.current) {
        setEsiAt(now);
        setEsiKey((k) => k + 1);
      }
    } finally {
      if (mounted.current) setRefreshingEsi(false);
    }
  };

  const doRefreshSde = async () => {
    setRefreshingSde(true);
    try {
      await refreshSde();
      const now = Date.now();
      if (mounted.current) {
        setSdeAt(now);
        setSdeKey((k) => k + 1);
      }
    } finally {
      if (mounted.current) setRefreshingSde(false);
    }
  };

  return (
    <RefreshContext.Provider value={{
      pricesKey, esiKey, sdeKey, pricesAt, esiAt, sdeAt,
      refreshingPrices, refreshingEsi, refreshingSde,
      doRefreshPrices, doRefreshEsi, doRefreshSde,
    }}>
      {children}
    </RefreshContext.Provider>
  );
}

export function useRefresh() {
  return useContext(RefreshContext);
}
