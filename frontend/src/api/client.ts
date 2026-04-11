import axios from "axios";
import type {
  Character, Region, SolarSystem, BlueprintResult, Settings,
  MarketHub, Structure, WarehouseItem, ShoppingListItem,
  ShoppingMaterial, TypeResult,
} from "../types";

const api = axios.create({
  baseURL: "/",
  withCredentials: true,
});

export async function fetchMe(): Promise<Character> {
  const { data } = await api.get<Character>("/api/me");
  return data;
}

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
  };
}

export async function fetchBlueprints(settings: Settings): Promise<BlueprintResult[]> {
  const { data } = await api.get<BlueprintResult[]>("/api/blueprints", {
    params: bpParams(settings),
  });
  return data;
}

export async function fetchExplore(settings: Settings): Promise<BlueprintResult[]> {
  const { data } = await api.get<BlueprintResult[]>("/api/blueprints/explore", {
    params: {
      ...bpParams(settings),
      assumed_me: settings.assumed_me,
      assumed_te: settings.assumed_te,
    },
    timeout: 120_000,
  });
  return data;
}

// Structures
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

// Warehouse
export async function fetchWarehouse(): Promise<WarehouseItem[]> {
  const { data } = await api.get<WarehouseItem[]>("/api/warehouse");
  return data;
}

export async function setWarehouseItem(item: WarehouseItem): Promise<void> {
  await api.put("/api/warehouse/items", item);
}

export async function deleteWarehouseItem(typeId: number): Promise<void> {
  await api.delete(`/api/warehouse/items/${typeId}`);
}

// Shopping list
export async function fetchShoppingList(): Promise<ShoppingListItem[]> {
  const { data } = await api.get<ShoppingListItem[]>("/api/shopping-list");
  return data;
}

export async function addShoppingItem(body: Omit<ShoppingListItem, "id" | "character_id">): Promise<ShoppingListItem> {
  const { data } = await api.post<ShoppingListItem>("/api/shopping-list/items", body);
  return data;
}

export async function updateShoppingItemRuns(id: number, runs: number): Promise<void> {
  await api.patch(`/api/shopping-list/items/${id}`, { runs });
}

export async function removeShoppingItem(id: number): Promise<void> {
  await api.delete(`/api/shopping-list/items/${id}`);
}

export async function clearShoppingList(): Promise<void> {
  await api.delete("/api/shopping-list");
}

export async function fetchShoppingMaterials(
  structure_me_bonus = 0
): Promise<{ materials: ShoppingMaterial[]; multibuy: string }> {
  const { data } = await api.get("/api/shopping-list/materials", {
    params: { structure_me_bonus },
  });
  return data;
}
