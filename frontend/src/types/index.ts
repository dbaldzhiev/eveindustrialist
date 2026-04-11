export interface Character {
  character_id: number;
  character_name: string;
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
  blueprint_name: string;
  product_type_id: number;
  product_name: string;
  me: number;
  te: number;
  runs: number;
  is_bpo: boolean;
  material_cost: number;
  job_cost: number;
  total_cost: number;
  revenue: number;
  profit: number;
  margin_pct: number;
  isk_per_hour: number;
  sell_price: number;
  product_quantity: number;
  materials: MaterialLine[];
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
}

export interface ShoppingListItem {
  id:                number;
  character_id:      number;
  blueprint_type_id: number;
  blueprint_name:    string;
  product_type_id:   number;
  product_name:      string;
  runs:              number;
  me:                number;
  te:                number;
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
