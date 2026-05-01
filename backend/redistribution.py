from sqlalchemy.orm import Session
from models import Zone, RedistributionPlan
from datetime import datetime


SURPLUS_THRESHOLD = 0.7   # consumption < baseline * 0.7 → surplus
DEFICIT_THRESHOLD = 1.3   # consumption > baseline * 1.3 → deficit


def suggest_redistribution(db: Session) -> dict:
    """
    Algorithm:
    1. Find surplus zones (consumption < baseline * 0.7)
    2. Find deficit zones (consumption > baseline * 1.3)
    3. Match surplus → deficit greedily, up to the surplus available
    Returns structured plan dict.
    """
    zones = db.query(Zone).all()

    surplus_zones = []
    deficit_zones = []

    for zone in zones:
        surplus_capacity = zone.baseline_consumption * SURPLUS_THRESHOLD - zone.current_consumption
        deficit_need = zone.current_consumption - zone.baseline_consumption * DEFICIT_THRESHOLD

        if surplus_capacity > 0:
            surplus_zones.append({
                "id": zone.id,
                "name": zone.name,
                "region": zone.region,
                "current_consumption": zone.current_consumption,
                "baseline_consumption": zone.baseline_consumption,
                "available_surplus": round(surplus_capacity, 2),
            })
        elif deficit_need > 0:
            deficit_zones.append({
                "id": zone.id,
                "name": zone.name,
                "region": zone.region,
                "current_consumption": zone.current_consumption,
                "baseline_consumption": zone.baseline_consumption,
                "deficit_need": round(deficit_need, 2),
            })

    # Greedy matching
    transfers = []
    surplus_remaining = {z["id"]: z["available_surplus"] for z in surplus_zones}

    for deficit in deficit_zones:
        remaining_need = deficit["deficit_need"]

        for surplus in surplus_zones:
            if remaining_need <= 0:
                break
            avail = surplus_remaining.get(surplus["id"], 0)
            if avail <= 0:
                continue

            transfer_amount = min(avail, remaining_need)
            surplus_remaining[surplus["id"]] -= transfer_amount
            remaining_need -= transfer_amount

            transfers.append({
                "from_zone_id": surplus["id"],
                "from_zone_name": surplus["name"],
                "from_zone_region": surplus["region"],
                "to_zone_id": deficit["id"],
                "to_zone_name": deficit["name"],
                "to_zone_region": deficit["region"],
                "amount_litres": round(transfer_amount, 2),
            })

    total_redistributed = sum(t["amount_litres"] for t in transfers)

    return {
        "surplus_zones": surplus_zones,
        "deficit_zones": deficit_zones,
        "transfers": transfers,
        "total_zones_affected": len(set(
            [t["from_zone_id"] for t in transfers] +
            [t["to_zone_id"] for t in transfers]
        )),
        "total_litres_redistributed": round(total_redistributed, 2),
        "generated_at": datetime.utcnow().isoformat(),
    }


def save_redistribution_plan(db: Session, transfers: list) -> list:
    """Persist a list of transfer dicts as RedistributionPlan rows."""
    plans = []
    for t in transfers:
        plan = RedistributionPlan(
            from_zone_id=t["from_zone_id"],
            to_zone_id=t["to_zone_id"],
            amount_litres=t["amount_litres"],
            status="Accepted",
        )
        db.add(plan)
        plans.append(plan)
    db.commit()
    for p in plans:
        db.refresh(p)
    return plans
