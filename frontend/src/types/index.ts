export interface Character {
  character_id: number;
  character_name: string;
}

export interface CharacterGroup {
  primary_character_id: number;
  characters: Character[];
}

export interface Region {
  region_id: number;
  name: string;
}

export interface SolarSystem {
  solar_system_id: number;
  name: string;
  region_name: string;
  security: number;
}

export interface MarketHub {
  region_id: number;
  name: string;
}

export interface MaterialLine {
  type_id:    number;
  name:       string;
  quantity:   number;
  unit_price: number;
  total_cost: number;
}

export interface BlueprintResult {
  blueprint_type_id: number;
  blueprint_name:    string;
  product_type_id:   number;
  product_name:      string;
  me:                number;
  te:                number;
  runs:              number;
  is_bpo:            boolean;
  item_id?:          number;
  is_invention?:     boolean;
  decryptor_name?:   string;
  bpc_count?:        number;
  bpc_total_runs?:   number;
  material_cost:     number;
  job_cost:          number;

  total_cost: number;
  revenue: number;
  profit: number;
  margin_pct: number;
  isk_per_hour: number;
  sell_price: number;
  product_quantity: number;
  materials: MaterialLine[];
  category_name?: string;
}

export type SortKey =
  | "blueprint_name"
  | "profit"
  | "margin_pct"
  | "isk_per_hour"
  | "material_cost"
  | "total_cost"
  | "revenue";

export interface Settings {
  solar_system_id:      number | null;
  runs:                 number;
  broker_fee:           number;
  sales_tax:            number;
  facility_tax:         number;
  min_profit:           number;
  price_region_id:      number;
  material_order_type:  "sell" | "buy";
  product_order_type:   "sell" | "buy";
  structure_me_bonus:   number;
  structure_te_bonus:   number;
  structure_cost_bonus: number;
  assumed_me:           number;
  assumed_te:           number;
  industry_level:       number;
  adv_industry_level:   number;
  reaction_facility_tax: number;
  reaction_me_bonus:     number;
  reaction_te_bonus:     number;
  reaction_cost_bonus:   number;
}

export interface Structure {
  id:              number;
  character_id:    number;
  name:            string;
  solar_system_id: number | null;
  me_bonus:        number;
  te_bonus:        number;
  cost_bonus:      number;
}

export interface WarehouseItem {
  type_id:   number;
  type_name: string;
  quantity:  number;
  location?: string;
  category_name?: string;
  estimated_price?: number;
}

export interface ShoppingMaterial {
  type_id:  number;
  name:     string;
  needed:   number;
  in_stock: number;
  to_buy:   number;
}

export interface TypeResult {
  type_id:   number;
  type_name: string;
}

// Slots / Dashboard
export interface SlotSuggestion {
  blueprint_type_id: number;
  blueprint_name:    string;
  product_name:      string;
  profit:            number;
  isk_per_hour:      number;
  margin_pct:        number;
}

export interface CharacterSlots {
  character_id:         number;
  character_name:       string;
  mfg_used:             number;
  mfg_max:              number;
  research_used:        number;
  research_max:         number;
  reaction_used:        number;
  reaction_max:         number;
  active_jobs:          ActiveJob[];
  suggestions:          SlotSuggestion[];
}

export interface ActiveJob {
  job_id:          number;
  activity_name:   string;
  product_name:    string;
  product_type_id: number;
  runs:            number;
  end_date:        string;
}

// Plans
export interface Plan {
  id:         number;
  name:       string;
  created_at: number;  // unix timestamp
}

export interface PlanItem {
  id:               number;
  plan_id:          number;
  blueprint_type_id: number;
  blueprint_name:   string;
  product_type_id:  number;
  product_name:     string;
  runs:             number;
  me:               number;
  te:               number;
}

export interface PlanStats {
  total_material_cost:  number;
  total_job_cost:       number;
  total_cost:           number;
  total_revenue:        number;
  total_profit:         number;
  total_margin_pct:     number;
  items:                PlanStatItem[];
}

export interface PlanStatItem {
  blueprint_name: string;
  product_name:   string;
  runs:           number;
  profit:         number;
  isk_per_hour:   number;
}

export interface PlanShoppingResult {
  materials: ShoppingMaterial[];
  multibuy:  string;
}

// App settings (global, persisted on backend)
export interface AppSettings {
  default_system_id:       number | null;
  default_price_region:    number;
  broker_fee:              number;
  sales_tax:               number;
  facility_tax:            number;
  structure_me_bonus:      number;
  structure_te_bonus:      number;
  structure_cost_bonus:    number;
  industry_level:          number;
  adv_industry_level:      number;
  runs:                    number;
  min_profit:              number;
  material_order_type:     "sell" | "buy";
  product_order_type:      "sell" | "buy";
  warehouse_character_id:  number | null;
  warehouse_location_id:   number | null;
  warehouse_location_name: string | null;
  reaction_facility_tax:   number;
  reaction_me_bonus:       number;
  reaction_te_bonus:       number;
  reaction_cost_bonus:     number;
}

// Warehouse location picker
export interface AssetLocation {
  character_id:   number;
  character_name: string;
  loc_id:         number;
  location_name:  string;
  container_name: string;
  is_container:   number;   // 0 or 1
  type_count:     number;
  total_quantity: number;
}
