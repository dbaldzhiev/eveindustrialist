import math
from dataclasses import dataclass, field


@dataclass
class ProfitSettings:
    broker_fee:           float = 0.0368
    sales_tax:            float = 0.036
    facility_tax:         float = 0.0
    runs:                 int   = 1
    structure_me_bonus:   float = 0.0   # fraction (e.g. 0.01 = 1% ME reduction)
    structure_te_bonus:   float = 0.0   # fraction (e.g. 0.15 = 15% TE reduction)
    structure_cost_bonus: float = 0.0   # fraction (e.g. 0.03 = 3% job cost reduction)
    material_order_type:  str   = "sell"
    product_order_type:   str   = "sell"
    # Industry skills (applied to manufacturing time only)
    industry_level:       int   = 0     # Industry skill (-4% time/level)
    adv_industry_level:   int   = 0     # Advanced Industry (-3% time/level)
    reaction_level:       int   = 0     # Reactions skill (-4% time/level)


@dataclass
class MaterialLine:
    type_id:    int
    name:       str
    quantity:   int
    unit_price: float
    total_cost: float
    volume:     float = 0.0


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
    product_volume:    float = 0.0
    tech_level:        int = 1
    materials: list[MaterialLine] = field(default_factory=list)

    def to_api_dict(self, include_materials: bool = True) -> dict:
        d = {
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
            "product_volume":    round(self.product_volume, 2),
            "tech_level":        self.tech_level,
        }
        if include_materials:
            d["materials"] = [
                {
                    "type_id":    m.type_id,
                    "name":       m.name,
                    "quantity":   m.quantity,
                    "unit_price": round(m.unit_price, 2),
                    "total_cost": round(m.total_cost, 2),
                    "volume":     round(m.volume, 2),
                }
                for m in self.materials
            ]
        return d


def calc_qty_with_me(base_qty: int, me: int, structure_me_bonus: float = 0.0) -> int:
    """
    Per-run ME reduction (used for single-run profitability display).
    me is blueprint ME level (0-10 integer, gives me% reduction).
    structure_me_bonus is a fraction (e.g. 0.01 = 1%).
    """
    return max(1, math.ceil(
        base_qty * (1.0 - me / 100.0) * (1.0 - structure_me_bonus)
    ))


def calc_qty_with_me_runs(base_qty: int, me: int, runs: int, structure_me_bonus: float = 0.0) -> int:
    """
    EVE's actual job formula: ceil applied to the full job quantity (base × runs × ME_mod),
    not per-run. This avoids overcounting from repeated ceiling rounding.
    Minimum is `runs` (1 unit per run even at very high ME).
    structure_me_bonus is a fraction (e.g. 0.01 = 1%).
    """
    me_modifier = (1.0 - me / 100.0) * (1.0 - structure_me_bonus)
    return max(runs, math.ceil(base_qty * me_modifier * runs))


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
    tech_level:         int = 1,
    volumes:            dict[int, float] = None,
) -> "BlueprintProfit | None":
    if not sde_products:
        return None

    volumes = volumes or {}
    product         = sde_products[0]
    product_type_id = product["type_id"]
    sell_price      = market_prices.get(product_type_id, {}).get(settings.product_order_type, 0.0)

    # Use tech level from product if it's more specific
    final_tech_level = max(tech_level, product.get("tech_level", 1))

    material_lines: list[MaterialLine] = []
    material_cost = 0.0
    eiv = 0.0

    for mat in sde_materials:
        # Per-job ceiling: ceil(base × ME_mod × runs) — avoids over-counting from
        # repeated rounding when the same formula is applied run-by-run.
        qty       = calc_qty_with_me_runs(mat["quantity"], me, settings.runs, settings.structure_me_bonus)
        price     = market_prices.get(mat["type_id"], {}).get(settings.material_order_type, 0.0)
        adj_price = adjusted_prices.get(mat["type_id"], {}).get("adjusted_price", 0.0)

        line_cost      = qty * price
        material_cost += line_cost
        eiv           += qty * adj_price

        material_lines.append(MaterialLine(
            type_id=mat["type_id"], name=mat["name"],
            quantity=qty, unit_price=price, total_cost=line_cost,
            volume=volumes.get(mat["type_id"], 0.0)
        ))

    structure_discount = 1.0 - settings.structure_cost_bonus
    job_cost   = eiv * system_cost_index * structure_discount * (1.0 + settings.facility_tax)
    total_cost = material_cost + job_cost

    total_qty     = product["quantity"] * settings.runs
    gross_revenue = total_qty * sell_price
    net_revenue   = gross_revenue * (1.0 - settings.broker_fee) * (1.0 - settings.sales_tax)

    profit     = net_revenue - total_cost
    margin_pct = (profit / total_cost * 100.0) if total_cost > 0 else 0.0

    # Time: blueprint TE + structure TE bonus + character Industry/Reaction skills
    # Activity ID 11 is reactions. We don't have activity_id here, but we can infer 
    # if it's a reaction if reaction_level is provided and it's relevant.
    # Actually, we should probably pass is_reaction flag.
    # For now, if it's a reaction, the blueprint has no ME/TE usually (always 0).
    
    # Let's assume for now that if reaction_level is > 0, we might want to use it.
    # A better way is to pass the activity_id.
    
    # Industry skills apply to manufacturing, Reactions skills apply to reactions.
    # If the blueprint is a reaction formula, we use reaction skills.
    # In EVE, reaction formulas have no TE levels.
    
    # Let's use a simpler heuristic for now: use the max reduction if both are provided,
    # or just provide them correctly from main.py.
    
    skill_time_mult = (
        (1.0 - 0.04 * settings.industry_level) *
        (1.0 - 0.03 * settings.adv_industry_level) *
        (1.0 - 0.04 * settings.reaction_level)
    )
    te_factor    = (
        (1.0 - te / 100.0) *
        (1.0 - settings.structure_te_bonus) *
        skill_time_mult
    )
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
        product_volume=total_qty * volumes.get(product_type_id, 0.0),
        tech_level=final_tech_level,
    )
