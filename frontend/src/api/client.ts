import axios from "axios";
import type {
  Character, CharacterGroup, Region, SolarSystem, BlueprintResult, Settings,
  MarketHub, Structure, WarehouseItem, TypeResult,
  CharacterSlots, Plan, PlanItem, PlanStats, PlanShoppingResult, AppSettings,
  AssetLocation,
} from "../types";

const api = axios.create({
  baseURL: "/",
  withCredentials: true,
});

// ---------------------------------------------------------------------------
// Auth / Me
// ---------------------------------------------------------------------------

export async function fetchMe(): Promise<Character> {
  const { data } = await api.get<Character>("/api/me");
  return data;
}

export async function fetchCharacterGroup(): Promise<CharacterGroup> {
  const { data } = await api.get<CharacterGroup>("/api/characters");
  return data;
}

export async function logout(): Promise<void> {
  await api.get("/auth/logout");
}

// ---------------------------------------------------------------------------
// Regions / Systems
// ---------------------------------------------------------------------------

export async function fetchRegions(): Promise<Region[]> {
  const { data } = await api.get<Region[]>("/api/regions");
  return data;
}

export async function searchSystems(query: string): Promise<SolarSystem[]> {
  const { data } = await api.get<SolarSystem[]>("/api/systems/search", {
    params: { q: query },
  });
  return data;
}

export async function fetchMarketHubs(): Promise<MarketHub[]> {
  const { data } = await api.get<MarketHub[]>("/api/market/hubs");
  return data;
}

export async function searchTypes(query: string): Promise<TypeResult[]> {
  const { data } = await api.get<TypeResult[]>("/api/types/search", {
    params: { q: query },
  });
  return data;
}

export interface BlueprintSearchResult {
  blueprint_type_id: number;
  blueprint_name:    string;
  product_type_id:   number;
  product_name:      string;
}

export async function searchBlueprintsApi(query: string): Promise<BlueprintSearchResult[]> {
  const { data } = await api.get<BlueprintSearchResult[]>("/api/blueprints/search", {
    params: { q: query },
  });
  return data;
}

// ---------------------------------------------------------------------------
// Blueprints / Explorer
// ---------------------------------------------------------------------------

function bpParams(s: Settings) {
  return {
    solar_system_id:      s.solar_system_id,
    price_region_id:      s.price_region_id,
    runs:                 s.runs,
    broker_fee:           s.broker_fee,
    sales_tax:            s.sales_tax,
    facility_tax:         s.facility_tax,
    structure_me_bonus:   s.structure_me_bonus,
    structure_te_bonus:   s.structure_te_bonus,
    structure_cost_bonus: s.structure_cost_bonus,
    material_order_type:  s.material_order_type,
    product_order_type:   s.product_order_type,
    min_profit:           s.min_profit,
    industry_level:       s.industry_level,
    adv_industry_level:   s.adv_industry_level,
    reaction_facility_tax: s.reaction_facility_tax,
    reaction_me_bonus:     s.reaction_me_bonus,
    reaction_te_bonus:     s.reaction_te_bonus,
    reaction_cost_bonus:   s.reaction_cost_bonus,
  };
}

export async function fetchBlueprints(
  settings: Settings,
  forceRefresh: boolean = false,
  mode: string = "build",
  decryptorStrategy: string = "none",
  decryptorTypeId: number | null = null,
  individual: boolean = false,
): Promise<BlueprintResult[]> {
  const { data } = await api.get<BlueprintResult[]>("/api/blueprints", {
    params: {
      ...bpParams(settings),
      force_refresh: forceRefresh,
      mode,
      decryptor_strategy: decryptorStrategy,
      decryptor_type_id: decryptorTypeId,
      individual,
    },
  });
  return data;
}

export async function fetchReactions(settings: Settings, forceRefresh: boolean = false): Promise<BlueprintResult[]> {
  return fetchBlueprints(settings, forceRefresh, "react");
}

export async function fetchExplore(settings: Settings, forceRefresh: boolean = false): Promise<BlueprintResult[]> {
  const { data } = await api.get<BlueprintResult[]>("/api/blueprints/explore", {
    params: {
      ...bpParams(settings),
      assumed_me: settings.assumed_me,
      assumed_te: settings.assumed_te,
      force_refresh: forceRefresh,
    },
    timeout: 120_000,
  });
  return data;
}

export async function fetchReactionsExplore(settings: Settings, forceRefresh: boolean = false): Promise<BlueprintResult[]> {
  const { data } = await api.get<BlueprintResult[]>("/api/blueprints/reactions/explore", {
    params: {
      ...bpParams(settings),
      force_refresh: forceRefresh,
    },
    timeout: 120_000,
  });
  return data;
}

// ---------------------------------------------------------------------------
// Structures
// ---------------------------------------------------------------------------

export async function fetchStructures(): Promise<Structure[]> {
  const { data } = await api.get<Structure[]>("/api/structures");
  return data;
}

export async function createStructure(body: Omit<Structure, "id" | "character_id">): Promise<Structure> {
  const { data } = await api.post<Structure>("/api/structures", body);
  return data;
}

export async function deleteStructure(id: number): Promise<void> {
  await api.delete(`/api/structures/${id}`);
}

// ---------------------------------------------------------------------------
// Warehouse (ESI assets)
// ---------------------------------------------------------------------------

export async function fetchWarehouse(): Promise<WarehouseItem[]> {
  const { data } = await api.get<WarehouseItem[]>("/api/warehouse");
  return data;
}

export async function fetchSimulationData(settings: Settings): Promise<BlueprintResult[]> {
  return fetchBlueprints({ ...settings, min_profit: -1e15 }, false, "build");
}

export async function fetchBlueprintDetail(
  blueprintTypeId: number,
  me: number,
  te: number,
  runs: number,
  settings: Settings,
): Promise<BlueprintResult> {
  const { data } = await api.get<BlueprintResult>("/api/blueprints/detail", {
    params: {
      blueprint_type_id:    blueprintTypeId,
      me, te, runs,
      solar_system_id:      settings.solar_system_id,
      price_region_id:      settings.price_region_id,
      broker_fee:           settings.broker_fee,
      sales_tax:            settings.sales_tax,
      facility_tax:         settings.facility_tax,
      structure_me_bonus:   settings.structure_me_bonus,
      structure_te_bonus:   settings.structure_te_bonus,
      structure_cost_bonus: settings.structure_cost_bonus,
      material_order_type:  settings.material_order_type,
      product_order_type:   settings.product_order_type,
      industry_level:       settings.industry_level,
      adv_industry_level:   settings.adv_industry_level,
    },
  });
  return data;
}

export async function updatePlanItemApi(
  planId: number,
  itemId: number,
  runs: number,
  me: number,
  te: number,
): Promise<void> {
  await api.patch(`/api/plans/${planId}/items/${itemId}`, { runs, me, te });
}

export async function syncWarehouse(): Promise<{ synced: number }> {
  const { data } = await api.post<{ synced: number }>("/api/warehouse/sync");
  return data;
}

// ---------------------------------------------------------------------------
// Slots / Dashboard
// ---------------------------------------------------------------------------

export async function fetchSlots(): Promise<CharacterSlots[]> {
  const { data } = await api.get<CharacterSlots[]>("/api/characters/slots");
  return data;
}

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export async function fetchPlans(): Promise<Plan[]> {
  const { data } = await api.get<Plan[]>("/api/plans");
  return data;
}

export async function createPlan(name: string): Promise<Plan> {
  const { data } = await api.post<Plan>("/api/plans", { name });
  return data;
}

export async function deletePlan(planId: number): Promise<void> {
  await api.delete(`/api/plans/${planId}`);
}

export async function fetchPlanItems(planId: number): Promise<PlanItem[]> {
  const { data } = await api.get<PlanItem[]>(`/api/plans/${planId}/items`);
  return data;
}

export async function addPlanItem(
  planId: number,
  body: {
    blueprint_type_id: number;
    blueprint_name:    string;
    product_type_id:   number;
    product_name:      string;
    runs: number;
    me:   number;
    te:   number;
  },
): Promise<PlanItem> {
  const { data } = await api.post<PlanItem>(`/api/plans/${planId}/items`, body);
  return data;
}

export async function deletePlanItem(planId: number, itemId: number): Promise<void> {
  await api.delete(`/api/plans/${planId}/items/${itemId}`);
}

export async function fetchPlanStats(planId: number, settings: Settings): Promise<PlanStats> {
  const { data } = await api.get<PlanStats>(`/api/plans/${planId}/stats`, {
    params: bpParams(settings),
  });
  return data;
}

export async function fetchPlanShoppingList(
  planId: number,
  settings: Settings,
  useWarehouse: boolean,
): Promise<PlanShoppingResult> {
  const { data } = await api.get<PlanShoppingResult>(`/api/plans/${planId}/shopping-list`, {
    params: { ...bpParams(settings), use_warehouse: useWarehouse },
  });
  return data;
}

// ---------------------------------------------------------------------------
// App Settings (global, server-persisted)
// ---------------------------------------------------------------------------

export async function fetchAppSettings(): Promise<AppSettings> {
  const { data } = await api.get<AppSettings>("/api/settings");
  return data;
}

export async function saveAppSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  const { data } = await api.put<AppSettings>("/api/settings", settings);
  return data;
}

// ---------------------------------------------------------------------------
// Asset locations (warehouse source picker)
// ---------------------------------------------------------------------------

export interface Decryptor {
  name:      string;
  type_id:   number | null;
  prob_mult: number;
  me_mod:    number;
  te_mod:    number;
  runs_mod:  number;
}

export interface SuggestResult {
  strategy:        string;
  open_slots:      number;
  suggested_items: BlueprintResult[];
  reason?:         string;
}

export async function fetchSuggestedPlan(strategy: string = "profit"): Promise<SuggestResult> {
  const { data } = await api.get<SuggestResult>("/api/plans/suggest", {
    params: { strategy },
  });
  return data;
}

export async function fetchAssetLocations(): Promise<AssetLocation[]> {
  const { data } = await api.get<AssetLocation[]>("/api/assets/locations");
  return data;
}

export async function fetchDecryptors(): Promise<Decryptor[]> {
  const { data } = await api.get<Decryptor[]>("/api/market/decryptors");
  return data;
}

export async function refreshMarketPrices(): Promise<void> {
  await api.post("/api/market/refresh");
}

export interface CacheStatus {
  market_updated_at: number | null;
  esi_updated_at:    number | null;
}

export async function fetchCacheStatus(): Promise<CacheStatus> {
  const { data } = await api.get<CacheStatus>("/api/cache/status");
  return data;
}

export async function refreshEsi(): Promise<void> {
  await api.post("/api/esi/refresh");
}
