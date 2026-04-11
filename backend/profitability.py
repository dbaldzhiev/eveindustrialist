import math
from dataclasses import dataclass, field


@dataclass
class ProfitSettings:
    broker_fee:          float = 0.0368
    sales_tax:           float = 0.036
    facility_tax:        float = 0.0
    runs:                int   = 1
    structure_me_bonus:  float = 0.0   # % additional ME reduction (e.g. 1.0 = 1%)
    structure_te_bonus:  float = 0.0   # % additional TE reduction (e.g. 15.0 = 15%)
    structure_cost_bonus: float = 0.0  # % job cost reduction from structure (e.g. 3.0 = 3%)
    material_order_type: str  = "sell" # "sell" = buy at sell order price; "buy" = place buy orders
    product_order_type:  str  = "sell" # "sell" = list sell orders; "buy" = sell to buy orders


@dataclass
class MaterialLine:
    type_id:    int
    name:       str
    quantity:   int
    unit_price: float   # price of input material (per unit)
    total_cost: float


@dataclass
class BlueprintProfit:
    blueprint_type_id: int
    blueprint_name:    str
    product_type_id:   int
    product_name:      str
    me:                int
    te:                int
    runs:              int
    is_bpo:            bool
    material_cost:     float
    job_cost:          float
    total_cost:        float
    revenue:           float
    profit:            float
    margin_pct:        float
    isk_per_hour:      float
    sell_price:        float
    product_quantity:  int = 0
    materials: list[MaterialLine] = field(default_factory=list)

    def to_api_dict(self) -> dict:
        return {
            "blueprint_type_id": self.blueprint_type_id,
            "blueprint_name":    self.blueprint_name,
            "product_type_id":   self.product_type_id,
            "product_name":      self.product_name,
            "me":                self.me,
            "te":                self.te,
            "runs":              self.runs,
            "is_bpo":            self.is_bpo,
            "material_cost":     round(self.material_cost, 2),
            "job_cost":          round(self.job_cost, 2),
            "total_cost":        round(self.total_cost, 2),
            "revenue":           round(self.revenue, 2),
            "profit":            round(self.profit, 2),
            "margin_pct":        round(self.margin_pct, 2),
            "isk_per_hour":      round(self.isk_per_hour, 2),
            "sell_price":        round(self.sell_price, 2),
            "product_quantity":  self.product_quantity,
            "materials": [
                {
                    "type_id":    m.type_id,
                    "name":       m.name,
                    "quantity":   m.quantity,
                    "unit_price": round(m.unit_price, 2),
                    "total_cost": round(m.total_cost, 2),
                }
                for m in self.materials
            ],
        }


def calc_qty_with_me(base_qty: int, me: int, structure_me_bonus: float = 0.0) -> int:
    """
    Apply blueprint ME and optional structure ME bonus.
    Both are percentages: me=10 means 10% reduction, structure_me_bonus=1.0 means 1%.
    """
    return max(1, math.ceil(
        base_qty * (1.0 - me / 100.0) * (1.0 - structure_me_bonus / 100.0)
    ))


def calculate_blueprint_profit(
    *,
    blueprint_type_id:  int,
    blueprint_name:     str,
    me:                 int,
    te:                 int,
    is_bpo:             bool,
    sde_materials:      list[dict],
    sde_products:       list[dict],
    base_time_seconds:  int,
    market_prices:      dict[int, dict],
    adjusted_prices:    dict[int, dict],
    system_cost_index:  float,
    settings:           ProfitSettings,
) -> "BlueprintProfit | None":
    if not sde_products:
        return None

    product         = sde_products[0]
    product_type_id = product["type_id"]
    sell_price      = market_prices.get(product_type_id, {}).get(settings.product_order_type, 0.0)

    material_lines: list[MaterialLine] = []
    material_cost = 0.0
    eiv = 0.0

    for mat in sde_materials:
        qty       = calc_qty_with_me(mat["quantity"], me, settings.structure_me_bonus)
        price     = market_prices.get(mat["type_id"], {}).get(settings.material_order_type, 0.0)
        adj_price = adjusted_prices.get(mat["type_id"], {}).get("adjusted_price", 0.0)

        line_cost      = qty * price
        material_cost += line_cost
        eiv           += qty * adj_price

        material_lines.append(MaterialLine(
            type_id=mat["type_id"], name=mat["name"],
            quantity=qty, unit_price=price, total_cost=line_cost,
        ))

    material_cost *= settings.runs
    eiv           *= settings.runs

    # Structure cost bonus reduces the job cost; facility tax is on top
    structure_discount = 1.0 - settings.structure_cost_bonus / 100.0
    job_cost   = eiv * system_cost_index * structure_discount * (1.0 + settings.facility_tax)
    total_cost = material_cost + job_cost

    total_qty     = product["quantity"] * settings.runs
    gross_revenue = total_qty * sell_price
    net_revenue   = gross_revenue * (1.0 - settings.broker_fee) * (1.0 - settings.sales_tax)

    profit     = net_revenue - total_cost
    margin_pct = (profit / total_cost * 100.0) if total_cost > 0 else 0.0

    # TE is 0-20; structure TE bonus is an additional % reduction
    te_factor    = (1.0 - te / 100.0) * (1.0 - settings.structure_te_bonus / 100.0)
    total_hours  = (base_time_seconds * te_factor / 3600.0) * settings.runs
    isk_per_hour = (profit / total_hours) if total_hours > 0 else 0.0

    return BlueprintProfit(
        blueprint_type_id=blueprint_type_id,
        blueprint_name=blueprint_name,
        product_type_id=product_type_id,
        product_name=product["name"],
        me=me, te=te, runs=settings.runs, is_bpo=is_bpo,
        material_cost=material_cost, job_cost=job_cost,
        total_cost=total_cost, revenue=net_revenue,
        profit=profit, margin_pct=margin_pct,
        isk_per_hour=isk_per_hour, sell_price=sell_price,
        materials=material_lines, product_quantity=total_qty,
    )
