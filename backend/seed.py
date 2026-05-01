"""
Seed script — populates the SQLite database with:
  - 10 water distribution zones
  - 30 days of hourly readings (~7,200 rows total)
  - Pre-seeded anomalies and alerts
  - One historical redistribution plan

Run: python seed.py
"""

import sys
import io
import random
import math
from datetime import datetime, timedelta
from database import engine, SessionLocal
from models import Base, Zone, Reading, Alert, RedistributionPlan

# Fix Windows console UTF-8 encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

random.seed(42)

ZONES_DATA = [
    {"name": "Northgate District", "region": "North", "baseline": 850.0},
    {"name": "Riverside Central",  "region": "North", "baseline": 1120.0},
    {"name": "Eastbrook Heights",  "region": "East",  "baseline": 670.0},
    {"name": "Westfield Industrial","region": "West", "baseline": 2300.0},
    {"name": "Southpark Residential","region": "South","baseline": 940.0},
    {"name": "Lakeside Gardens",   "region": "East",  "baseline": 560.0},
    {"name": "Midtown Commercial",  "region": "Central","baseline": 1850.0},
    {"name": "Hillcrest Suburbs",  "region": "South", "baseline": 730.0},
    {"name": "Downtown Core",      "region": "Central","baseline": 3100.0},
    {"name": "Harbor Industrial",  "region": "West",  "baseline": 2650.0},
]

def diurnal_factor(hour: int) -> float:
    """Simulate daily usage curve — peaks at 7–9 AM and 6–8 PM."""
    morning_peak = math.exp(-0.5 * ((hour - 8) / 2.0) ** 2)
    evening_peak = math.exp(-0.5 * ((hour - 19) / 2.5) ** 2)
    night_base   = 0.30
    return night_base + 0.55 * morning_peak + 0.45 * evening_peak


def generate_reading(baseline: float, hour: int, noise_factor: float = 0.08) -> float:
    factor = diurnal_factor(hour)
    noise  = random.gauss(0, baseline * noise_factor)
    return max(0.0, round(baseline * factor + noise, 2))


def main():
    print("[*] Creating database tables...")
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    try:
        # Clear existing data
        db.query(RedistributionPlan).delete()
        db.query(Alert).delete()
        db.query(Reading).delete()
        db.query(Zone).delete()
        db.commit()

        print("[*] Seeding zones...")
        zones = []
        for z in ZONES_DATA:
            zone = Zone(
                name=z["name"],
                region=z["region"],
                baseline_consumption=z["baseline"],
                current_consumption=generate_reading(z["baseline"], datetime.utcnow().hour),
                status="Normal",
            )
            db.add(zone)
            zones.append(zone)
        db.commit()
        for z in zones:
            db.refresh(z)

        print("[*] Seeding 30 days of hourly readings...")
        now = datetime.utcnow().replace(minute=0, second=0, microsecond=0)
        start_time = now - timedelta(days=30)

        # Anomaly injection schedule: (zone_index, day_offset, hour, type)
        anomaly_injections = [
            (0, 25, 14, "spike"),    # Northgate spike
            (2,  3, 22, "spike"),    # Eastbrook night spike
            (4, 10,  9, "spike"),    # Southpark morning spike
            (6, 18, 16, "spike"),    # Midtown spike
            (8,  7, 11, "spike"),    # Downtown spike
            (1, 20,  3, "low"),      # Riverside low usage
            (5, 15,  2, "low"),      # Lakeside low usage
            (3, 28, 13, "spike"),    # Westfield industrial spike
            (9,  5, 20, "spike"),    # Harbor spike
            (7, 22,  8, "spike"),    # Hillcrest morning spike
        ]

        # Build a set of anomaly timestamps for quick lookup
        anomaly_set = set()
        for zone_idx, day_offset, hour, atype in anomaly_injections:
            ts = start_time + timedelta(days=day_offset, hours=hour)
            ts = ts.replace(minute=0, second=0, microsecond=0)
            anomaly_set.add((zone_idx, ts))

        reading_count = 0
        anomalous_readings = []

        for zone_idx, zone in enumerate(zones):
            prev_value = None
            hours_total = 30 * 24

            for h in range(hours_total):
                ts = start_time + timedelta(hours=h)
                ts_norm = ts.replace(minute=0, second=0, microsecond=0)

                # Check anomaly injection
                is_injected = (zone_idx, ts_norm) in anomaly_set
                atype_injected = None
                for zi, day_off, hr, atype in anomaly_injections:
                    inj_ts = (start_time + timedelta(days=day_off, hours=hr)).replace(minute=0, second=0, microsecond=0)
                    if zi == zone_idx and inj_ts == ts_norm:
                        atype_injected = atype
                        break

                if is_injected and atype_injected == "spike":
                    value = round(zone.baseline_consumption * random.uniform(2.2, 3.5), 2)
                elif is_injected and atype_injected == "low":
                    value = round(zone.baseline_consumption * random.uniform(0.05, 0.15), 2)
                else:
                    value = generate_reading(zone.baseline_consumption, ts.hour)

                # Simple spike check
                spike_detected = False
                if prev_value and prev_value > 0:
                    spike_pct = (value - prev_value) / prev_value * 100
                    spike_detected = spike_pct > 40

                # Z-score requires context — mark the injected ones directly
                reading = Reading(
                    zone_id=zone.id,
                    timestamp=ts,
                    consumption_value=value,
                    is_anomaly=is_injected,
                    anomaly_score=round(random.uniform(65, 95), 1) if is_injected else 0.0,
                    anomaly_type="leak" if (is_injected and atype_injected == "spike") else
                                 ("unusual_pattern" if (is_injected and atype_injected == "low") else None),
                    anomaly_reason=(
                        f"Consumption spiked to {value:.1f} L/hr — "
                        f"{value / zone.baseline_consumption:.1f}× the 30-day average of "
                        f"{zone.baseline_consumption:.1f} L/hr. Likely pipe burst or unauthorized discharge."
                        if is_injected and atype_injected == "spike" else
                        f"Consumption dropped to {value:.1f} L/hr, only "
                        f"{value / zone.baseline_consumption * 100:.0f}% of the expected {zone.baseline_consumption:.1f} L/hr. "
                        f"Possible supply interruption or sensor fault."
                        if is_injected and atype_injected == "low" else None
                    ),
                )
                db.add(reading)
                reading_count += 1

                if is_injected:
                    anomalous_readings.append((zone, reading, ts))

                prev_value = value

                if reading_count % 500 == 0:
                    db.commit()
                    print(f"   ... {reading_count} readings committed")

        db.commit()
        print(f"[OK] {reading_count} readings seeded, {len(anomalous_readings)} anomalies injected")

        # Update zone statuses based on recent readings
        print("[*] Updating zone statuses...")
        now = datetime.utcnow()
        for zone in zones:
            latest = (
                db.query(Reading)
                .filter(Reading.zone_id == zone.id)
                .order_by(Reading.timestamp.desc())
                .first()
            )
            if latest:
                zone.current_consumption = latest.consumption_value
                deviation = (latest.consumption_value - zone.baseline_consumption) / zone.baseline_consumption
                if abs(deviation) > 0.5:
                    zone.status = "Critical"
                elif abs(deviation) > 0.2:
                    zone.status = "Anomaly"
                else:
                    zone.status = "Normal"

        # Force some zones into interesting states for demo
        zones[0].status = "Critical"
        zones[0].current_consumption = zones[0].baseline_consumption * 2.8
        zones[2].status = "Anomaly"
        zones[2].current_consumption = zones[2].baseline_consumption * 1.4
        zones[5].status = "Anomaly"
        zones[5].current_consumption = zones[5].baseline_consumption * 0.5
        db.commit()

        print("[*] Seeding alerts...")
        alerts_data = [
            (0, "Critical", "Pipe burst suspected in Northgate District. Consumption at 280% of baseline. Emergency crew dispatched."),
            (8, "Critical", "Downtown Core: Sudden pressure drop detected across grid sectors A3–A7. Isolating affected mains."),
            (2, "Warning",  "Eastbrook Heights: Consumption 40% above baseline for past 6 hours. Monitoring for escalation."),
            (5, "Warning",  "Lakeside Gardens: Unusually low consumption — possible supply blockage or sensor failure."),
            (6, "Warning",  "Midtown Commercial: Meter irregularities detected. Calibration check scheduled."),
            (3, "Info",     "Westfield Industrial: Scheduled maintenance window active. Elevated readings expected 10:00–14:00."),
            (7, "Info",     "Hillcrest Suburbs: Demand spike correlates with community event at Recreation Centre."),
            (4, "Info",     "Southpark Residential: Minor deviation logged. Within acceptable tolerance range."),
        ]

        for zone_idx, severity, message in alerts_data:
            alert = Alert(
                zone_id=zones[zone_idx].id,
                severity=severity,
                message=message,
                created_at=now - timedelta(hours=random.randint(0, 12)),
                resolved=False,
            )
            db.add(alert)

        # Add some resolved alerts
        resolved_alerts = [
            (1, "Warning",  "Riverside Central: Brief surge resolved after pressure regulator adjustment."),
            (9, "Critical", "Harbor Industrial: Valve malfunction detected and repaired. System stable."),
        ]
        for zone_idx, severity, message in resolved_alerts:
            alert = Alert(
                zone_id=zones[zone_idx].id,
                severity=severity,
                message=message,
                created_at=now - timedelta(days=2),
                resolved=True,
            )
            db.add(alert)
        db.commit()

        print("[*] Seeding historical redistribution plans...")
        historical_plans = [
            (5, 2, 280.0),   # Lakeside → Eastbrook
            (1, 0, 420.0),   # Riverside → Northgate
        ]
        for from_idx, to_idx, amount in historical_plans:
            plan = RedistributionPlan(
                from_zone_id=zones[from_idx].id,
                to_zone_id=zones[to_idx].id,
                amount_litres=amount,
                created_at=now - timedelta(days=random.randint(1, 7)),
                status="Accepted",
            )
            db.add(plan)
        db.commit()

        print("[OK] Database seeding complete!")
        print(f"   Zones:    {len(zones)}")
        print(f"   Readings: {reading_count}")
        print(f"   Alerts:   {len(alerts_data) + len(resolved_alerts)}")
        print(f"   Plans:    {len(historical_plans)}")

    finally:
        db.close()


if __name__ == "__main__":
    main()
