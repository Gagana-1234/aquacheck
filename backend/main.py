from fastapi import FastAPI, Depends, HTTPException, Query, Body
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func
from datetime import datetime, timedelta
from typing import Optional, List
import math
import os
import pathlib
import random
import re

from database import engine, get_db, SessionLocal
from models import Base, Zone, Reading, Alert, RedistributionPlan, CommunityReport, CitizenReward, Redemption
from anomaly import get_anomaly_explanation
from redistribution import suggest_redistribution, save_redistribution_plan
from predict import forecast_zone, compute_network_health

Base.metadata.create_all(bind=engine)

# ─── Auto-seed on first startup ─────────────────────────────────────────────
# If the database is empty (no zones), run the seed script automatically.
# This ensures the app works immediately after a fresh deploy on Render/Railway.
def _auto_seed():
    db = SessionLocal()
    try:
        if db.query(Zone).count() == 0:
            print("[startup] Empty database detected — running seed...")
            import seed
            seed.main()
            print("[startup] Seeding complete!")
    except Exception as e:
        print(f"[startup] Seed error (non-fatal): {e}")
    finally:
        db.close()

_auto_seed()


app = FastAPI(
    title="Water Systems Monitoring API",
    description="Real-time water distribution monitoring, anomaly detection and redistribution planning",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# ─── Frontend Static File Serving ───────────────────────────────────────────
# Serves the entire frontend from the same FastAPI server.
# Works both locally (localhost:8000) and on any cloud platform.
_FRONTEND_DIR = pathlib.Path(__file__).parent.parent / "frontend"

if _FRONTEND_DIR.exists():
    # Serve CSS and JS at root-relative paths (e.g. /css/style.css, /js/api.js)
    if (_FRONTEND_DIR / "css").exists():
        app.mount("/css", StaticFiles(directory=str(_FRONTEND_DIR / "css")), name="css")
        app.mount("/app/css", StaticFiles(directory=str(_FRONTEND_DIR / "css")), name="app_css")
    if (_FRONTEND_DIR / "js").exists():
        app.mount("/js", StaticFiles(directory=str(_FRONTEND_DIR / "js")), name="js")
        app.mount("/app/js", StaticFiles(directory=str(_FRONTEND_DIR / "js")), name="app_js")
    if (_FRONTEND_DIR / "images").exists():
        app.mount("/images", StaticFiles(directory=str(_FRONTEND_DIR / "images")), name="images")

@app.get("/")
def root():
    if _FRONTEND_DIR.exists():
        return FileResponse(str(_FRONTEND_DIR / "index.html"))
    return {"status": "AquaWatch API running"}

# Serve any .html page directly (e.g. /zones.html, /anomalies.html)
@app.get("/{page_name}.html")
def serve_page(page_name: str):
    if _FRONTEND_DIR.exists():
        file_path = _FRONTEND_DIR / f"{page_name}.html"
        if file_path.exists():
            return FileResponse(str(file_path))
    raise HTTPException(status_code=404, detail="Page not found")

# ─── /app/ path aliases (handles relative-link resolution under /app/) ────────
@app.get("/app/")
@app.get("/app/index.html")
def serve_app_root():
    if _FRONTEND_DIR.exists():
        return FileResponse(str(_FRONTEND_DIR / "index.html"))
    raise HTTPException(status_code=404, detail="Page not found")

@app.get("/app/{page_name}.html")
def serve_app_page(page_name: str):
    if _FRONTEND_DIR.exists():
        file_path = _FRONTEND_DIR / f"{page_name}.html"
        if file_path.exists():
            return FileResponse(str(file_path))
    raise HTTPException(status_code=404, detail="Page not found")


# ─── Helper ──────────────────────────────────────────────────────────────────

def zone_to_dict(zone: Zone, latest_reading: Optional[Reading] = None) -> dict:
    current = zone.current_consumption
    baseline = zone.baseline_consumption
    deviation_pct = round((current - baseline) / baseline * 100, 1) if baseline else 0
    return {
        "id": zone.id,
        "name": zone.name,
        "region": zone.region,
        "baseline_consumption": baseline,
        "current_consumption": round(current, 2),
        "status": zone.status,
        "deviation_pct": deviation_pct,
        "latest_reading_at": latest_reading.timestamp.isoformat() if latest_reading else None,
    }


# ─── Zones ───────────────────────────────────────────────────────────────────

@app.get("/zones")
def get_zones(db: Session = Depends(get_db)):
    zones = db.query(Zone).all()
    result = []
    for zone in zones:
        latest = (
            db.query(Reading)
            .filter(Reading.zone_id == zone.id)
            .order_by(Reading.timestamp.desc())
            .first()
        )
        result.append(zone_to_dict(zone, latest))
    return result


@app.get("/zones/{zone_id}")
def get_zone(zone_id: int, db: Session = Depends(get_db)):
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    latest = (
        db.query(Reading)
        .filter(Reading.zone_id == zone.id)
        .order_by(Reading.timestamp.desc())
        .first()
    )
    return zone_to_dict(zone, latest)


@app.get("/zones/{zone_id}/readings")
def get_zone_readings(
    zone_id: int,
    days: int = Query(7, ge=1, le=30),
    db: Session = Depends(get_db),
):
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")

    since = datetime.utcnow() - timedelta(days=days)
    readings = (
        db.query(Reading)
        .filter(Reading.zone_id == zone_id, Reading.timestamp >= since)
        .order_by(Reading.timestamp.asc())
        .all()
    )
    return [
        {
            "id": r.id,
            "timestamp": r.timestamp.isoformat(),
            "consumption_value": round(r.consumption_value, 2),
            "is_anomaly": r.is_anomaly,
            "anomaly_score": r.anomaly_score,
            "anomaly_type": r.anomaly_type,
        }
        for r in readings
    ]


@app.get("/zones/{zone_id}/forecast")
def get_zone_forecast(
    zone_id: int,
    hours: int = Query(6, ge=1, le=24),
    db: Session = Depends(get_db),
):
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found")
    return forecast_zone(zone_id, db, hours_ahead=hours)


# ─── Anomalies ───────────────────────────────────────────────────────────────

@app.get("/anomalies")
def get_anomalies(
    severity: Optional[str] = Query(None),
    zone_id: Optional[int] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    query = db.query(Reading).filter(Reading.is_anomaly == True)

    if zone_id:
        query = query.filter(Reading.zone_id == zone_id)

    if severity:
        # Map severity to score ranges
        if severity.lower() == "critical":
            query = query.filter(Reading.anomaly_score >= 70)
        elif severity.lower() == "warning":
            query = query.filter(Reading.anomaly_score >= 40, Reading.anomaly_score < 70)
        elif severity.lower() == "info":
            query = query.filter(Reading.anomaly_score < 40)

    readings = query.order_by(Reading.timestamp.desc()).limit(limit).all()

    result = []
    for r in readings:
        zone = db.query(Zone).filter(Zone.id == r.zone_id).first()
        severity_label = (
            "Critical" if r.anomaly_score >= 70
            else "Warning" if r.anomaly_score >= 40
            else "Info"
        )
        result.append({
            "id": r.id,
            "zone_id": r.zone_id,
            "zone_name": zone.name if zone else "Unknown",
            "zone_region": zone.region if zone else "Unknown",
            "timestamp": r.timestamp.isoformat(),
            "consumption_value": round(r.consumption_value, 2),
            "anomaly_score": r.anomaly_score,
            "anomaly_type": r.anomaly_type,
            "severity": severity_label,
            "anomaly_reason": r.anomaly_reason,
        })
    return result


@app.get("/anomalies/{anomaly_id}/explain")
def explain_anomaly(anomaly_id: int, db: Session = Depends(get_db)):
    reading = db.query(Reading).filter(
        Reading.id == anomaly_id, Reading.is_anomaly == True
    ).first()
    if not reading:
        raise HTTPException(status_code=404, detail="Anomaly not found")

    explanation = get_anomaly_explanation(reading)
    zone = db.query(Zone).filter(Zone.id == reading.zone_id).first()

    return {
        "id": reading.id,
        "zone_id": reading.zone_id,
        "zone_name": zone.name if zone else "Unknown",
        "timestamp": reading.timestamp.isoformat(),
        "consumption_value": round(reading.consumption_value, 2),
        "anomaly_score": reading.anomaly_score,
        "anomaly_type": reading.anomaly_type,
        "explanation": explanation,
    }


@app.post("/anomalies/{anomaly_id}/resolve")
def resolve_anomaly(anomaly_id: int, db: Session = Depends(get_db)):
    reading = db.query(Reading).filter(
        Reading.id == anomaly_id, Reading.is_anomaly == True
    ).first()
    if not reading:
        raise HTTPException(status_code=404, detail="Anomaly not found")

    reading.anomaly_type = f"resolved_{reading.anomaly_type or 'unknown'}"
    db.commit()
    return {"status": "resolved", "id": anomaly_id}


# ─── Redistribution ──────────────────────────────────────────────────────────

@app.get("/redistribution/suggest")
def get_redistribution_suggestion(db: Session = Depends(get_db)):
    return suggest_redistribution(db)


@app.post("/redistribution/accept")
def accept_redistribution(transfers: List[dict], db: Session = Depends(get_db)):
    if not transfers:
        raise HTTPException(status_code=400, detail="No transfers provided")
    plans = save_redistribution_plan(db, transfers)
    return {
        "status": "accepted",
        "plans_created": len(plans),
        "plan_ids": [p.id for p in plans],
    }


@app.get("/redistribution/history")
def get_redistribution_history(db: Session = Depends(get_db)):
    plans = db.query(RedistributionPlan).order_by(RedistributionPlan.created_at.desc()).all()
    result = []
    for p in plans:
        from_zone = db.query(Zone).filter(Zone.id == p.from_zone_id).first()
        to_zone   = db.query(Zone).filter(Zone.id == p.to_zone_id).first()
        result.append({
            "id": p.id,
            "created_at": p.created_at.isoformat(),
            "from_zone_id": p.from_zone_id,
            "from_zone_name": from_zone.name if from_zone else "Unknown",
            "to_zone_id": p.to_zone_id,
            "to_zone_name": to_zone.name if to_zone else "Unknown",
            "amount_litres": p.amount_litres,
            "status": p.status,
        })
    return result


# ─── Dashboard Stats ─────────────────────────────────────────────────────────

@app.get("/dashboard/stats")
def get_dashboard_stats(db: Session = Depends(get_db)):
    total_zones = db.query(Zone).count()
    active_leaks = db.query(Zone).filter(Zone.status == "Critical").count()

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    anomalies_today = db.query(Reading).filter(
        Reading.is_anomaly == True,
        Reading.timestamp >= today_start,
    ).count()

    # Water saved = sum of (baseline - current) for surplus zones, in litres over 24h
    zones = db.query(Zone).all()
    water_saved = 0.0
    for zone in zones:
        diff = zone.baseline_consumption - zone.current_consumption
        if diff > 0:
            water_saved += diff * 24  # L/hr × 24 hrs

    # Recent alerts
    recent_alerts = (
        db.query(Alert)
        .filter(Alert.resolved == False)
        .order_by(Alert.created_at.desc())
        .limit(5)
        .all()
    )

    alerts_list = []
    for a in recent_alerts:
        zone = db.query(Zone).filter(Zone.id == a.zone_id).first()
        alerts_list.append({
            "id": a.id,
            "zone_name": zone.name if zone else "Unknown",
            "severity": a.severity,
            "message": a.message,
            "created_at": a.created_at.isoformat(),
        })

    # 24-hour consumption data (aggregate per hour across all zones)
    since_24h = datetime.utcnow() - timedelta(hours=24)
    hourly_readings = (
        db.query(
            func.strftime("%Y-%m-%dT%H:00:00", Reading.timestamp).label("hour"),
            func.sum(Reading.consumption_value).label("total"),
        )
        .filter(Reading.timestamp >= since_24h)
        .group_by("hour")
        .order_by("hour")
        .all()
    )

    consumption_chart = [
        {"hour": row.hour, "total": round(row.total or 0, 2)}
        for row in hourly_readings
    ]

    # Zone summary for map
    zone_summary = []
    for zone in zones:
        deviation = (zone.current_consumption - zone.baseline_consumption) / zone.baseline_consumption * 100
        zone_summary.append({
            "id": zone.id,
            "name": zone.name,
            "region": zone.region,
            "status": zone.status,
            "deviation_pct": round(deviation, 1),
        })

    return {
        "total_zones": total_zones,
        "active_leaks": active_leaks,
        "anomalies_today": anomalies_today,
        "water_saved_litres": round(water_saved, 0),
        "recent_alerts": alerts_list,
        "consumption_chart": consumption_chart,
        "zone_summary": zone_summary,
    }


# ─── Reports ─────────────────────────────────────────────────────────────────

@app.get("/reports")
def get_reports(
    from_date: Optional[str] = Query(None, alias="from"),
    to_date: Optional[str] = Query(None, alias="to"),
    db: Session = Depends(get_db),
):
    try:
        dt_from = datetime.fromisoformat(from_date) if from_date else datetime.utcnow() - timedelta(days=7)
        dt_to   = datetime.fromisoformat(to_date)   if to_date   else datetime.utcnow()
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use ISO 8601 (YYYY-MM-DD).")

    # Anomaly counts per day
    anomaly_by_day = (
        db.query(
            func.strftime("%Y-%m-%d", Reading.timestamp).label("day"),
            func.count().label("count"),
        )
        .filter(
            Reading.is_anomaly == True,
            Reading.timestamp >= dt_from,
            Reading.timestamp <= dt_to,
        )
        .group_by("day")
        .order_by("day")
        .all()
    )

    # Zone-wise average consumption in range
    zone_consumption = []
    zones = db.query(Zone).all()
    for zone in zones:
        avg = (
            db.query(func.avg(Reading.consumption_value))
            .filter(
                Reading.zone_id == zone.id,
                Reading.timestamp >= dt_from,
                Reading.timestamp <= dt_to,
            )
            .scalar()
        )
        zone_consumption.append({
            "zone_id": zone.id,
            "zone_name": zone.name,
            "region": zone.region,
            "avg_consumption": round(avg or 0, 2),
            "baseline": zone.baseline_consumption,
            "deviation_pct": round(((avg or 0) - zone.baseline_consumption) / zone.baseline_consumption * 100, 1),
        })

    total_anomalies = sum(r.count for r in anomaly_by_day)
    total_readings  = db.query(Reading).filter(
        Reading.timestamp >= dt_from, Reading.timestamp <= dt_to
    ).count()

    return {
        "from_date": dt_from.isoformat(),
        "to_date": dt_to.isoformat(),
        "total_readings": total_readings,
        "total_anomalies": total_anomalies,
        "anomaly_rate_pct": round(total_anomalies / total_readings * 100, 2) if total_readings else 0,
        "anomaly_by_day": [{"day": r.day, "count": r.count} for r in anomaly_by_day],
        "zone_consumption": zone_consumption,
    }


# ─── Network Health ─────────────────────────────────────────────────────────

@app.get("/network/health")
def get_network_health(db: Session = Depends(get_db)):
    return compute_network_health(db)


# ─── Alerts ──────────────────────────────────────────────────────────────────

@app.get("/alerts")
def get_alerts(resolved: Optional[bool] = Query(None), db: Session = Depends(get_db)):
    query = db.query(Alert)
    if resolved is not None:
        query = query.filter(Alert.resolved == resolved)
    alerts = query.order_by(Alert.created_at.desc()).all()
    result = []
    for a in alerts:
        zone = db.query(Zone).filter(Zone.id == a.zone_id).first()
        result.append({
            "id": a.id,
            "zone_id": a.zone_id,
            "zone_name": zone.name if zone else "Unknown",
            "severity": a.severity,
            "message": a.message,
            "created_at": a.created_at.isoformat(),
            "resolved": a.resolved,
        })
    return result


# ─── Community Reporting & Rewards ───────────────────────────────────────────

COIN_TABLE = {
    "pipe_leak": {"Low": 30, "Medium": 60, "High": 100, "Critical": 180},
    "unauthorized_discharge": {"Low": 50, "Medium": 90, "High": 150, "Critical": 250},
    "water_wastage": {"Low": 20, "Medium": 40, "High": 70, "Critical": 120},
    "other": {"Low": 15, "Medium": 30, "High": 55, "Critical": 80},
}

TIER_THRESHOLDS = [
    (2000, "Legend"),
    (1000, "Platinum"),
    (500, "Gold"),
    (150, "Silver"),
    (0, "Bronze"),
]


def compute_tier(coins: int) -> str:
    for threshold, tier in TIER_THRESHOLDS:
        if coins >= threshold:
            return tier
    return "Bronze"


def simulate_ai_analysis(report_type: str, has_image: bool) -> dict:
    """Simulate AI image analysis confidence score."""
    base = 0.65 if has_image else 0.40
    noise = random.uniform(-0.1, 0.2)
    confidence = min(max(base + noise, 0.25), 0.98)
    tags = {
        "pipe_leak": ["water-spray", "pipe-damage", "wet-surface", "infrastructure"],
        "unauthorized_discharge": ["discharge-point", "runoff", "contamination", "illegal-tap"],
        "water_wastage": ["open-tap", "overflow", "irrigation-waste", "pooling-water"],
        "other": ["water-issue", "infrastructure"],
    }
    detected = random.sample(tags.get(report_type, ["water-issue"]), k=min(2, len(tags.get(report_type, []))))
    return {
        "confidence": round(confidence, 3),
        "detected_tags": detected,
        "auto_verified": confidence >= 0.72,
    }


@app.post("/community/reports")
def submit_community_report(
    reporter_name: str = Body(...),
    reporter_email: str = Body(""),
    zone_id: Optional[int] = Body(None),
    report_type: str = Body(...),
    severity: str = Body("Medium"),
    description: str = Body(""),
    location_text: str = Body(""),
    image_data: str = Body(""),
    image_filename: str = Body(""),
    db: Session = Depends(get_db),
):
    if report_type not in COIN_TABLE:
        report_type = "other"
    if severity not in ["Low", "Medium", "High", "Critical"]:
        severity = "Medium"

    ai = simulate_ai_analysis(report_type, bool(image_data))
    coins = COIN_TABLE[report_type][severity]
    # Bonus coins for high AI confidence
    if ai["confidence"] >= 0.85:
        coins = int(coins * 1.3)
    status = "Verified" if ai["auto_verified"] else "Pending"

    report = CommunityReport(
        reporter_name=reporter_name,
        reporter_email=reporter_email,
        zone_id=zone_id,
        report_type=report_type,
        severity=severity,
        description=description,
        location_text=location_text,
        image_data=image_data if image_data else None,
        image_filename=image_filename if image_filename else None,
        status=status,
        aqua_coins_awarded=coins if status == "Verified" else 0,
        ai_confidence=ai["confidence"],
        submitted_at=datetime.utcnow(),
        verified_at=datetime.utcnow() if status == "Verified" else None,
    )
    db.add(report)
    db.flush()

    # Update or create citizen reward record
    citizen = db.query(CitizenReward).filter(
        CitizenReward.citizen_name == reporter_name
    ).first()
    if not citizen:
        citizen = CitizenReward(
            citizen_name=reporter_name,
            citizen_email=reporter_email,
            total_aqua_coins=0,
            total_reports=0,
            verified_reports=0,
        )
        db.add(citizen)
        db.flush()

    citizen.total_reports += 1
    citizen.last_activity = datetime.utcnow()
    if status == "Verified":
        citizen.total_aqua_coins += coins
        citizen.verified_reports += 1
    citizen.tier = compute_tier(citizen.total_aqua_coins)

    db.commit()
    db.refresh(report)

    return {
        "id": report.id,
        "status": status,
        "aqua_coins_awarded": report.aqua_coins_awarded,
        "ai_confidence": ai["confidence"],
        "ai_tags": ai["detected_tags"],
        "auto_verified": ai["auto_verified"],
        "citizen_total_coins": citizen.total_aqua_coins,
        "citizen_tier": citizen.tier,
        "message": (
            f"Report verified! You earned {coins} AquaCoins 🎉"
            if status == "Verified"
            else "Report submitted! Pending manual verification."
        ),
    }


@app.get("/community/reports")
def get_community_reports(
    status: Optional[str] = Query(None),
    report_type: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
):
    query = db.query(CommunityReport)
    if status:
        query = query.filter(CommunityReport.status == status)
    if report_type:
        query = query.filter(CommunityReport.report_type == report_type)
    reports = query.order_by(CommunityReport.submitted_at.desc()).limit(limit).all()
    result = []
    for r in reports:
        zone = db.query(Zone).filter(Zone.id == r.zone_id).first() if r.zone_id else None
        result.append({
            "id": r.id,
            "reporter_name": r.reporter_name,
            "zone_id": r.zone_id,
            "zone_name": zone.name if zone else "Unknown Location",
            "report_type": r.report_type,
            "severity": r.severity,
            "description": r.description,
            "location_text": r.location_text,
            "status": r.status,
            "aqua_coins_awarded": r.aqua_coins_awarded,
            "ai_confidence": r.ai_confidence,
            "submitted_at": r.submitted_at.isoformat(),
            "has_image": bool(r.image_data),
        })
    return result


@app.get("/community/reports/{report_id}")
def get_report_detail(report_id: int, db: Session = Depends(get_db)):
    r = db.query(CommunityReport).filter(CommunityReport.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    zone = db.query(Zone).filter(Zone.id == r.zone_id).first() if r.zone_id else None
    return {
        "id": r.id,
        "reporter_name": r.reporter_name,
        "reporter_email": r.reporter_email,
        "zone_id": r.zone_id,
        "zone_name": zone.name if zone else "Unknown Location",
        "report_type": r.report_type,
        "severity": r.severity,
        "description": r.description,
        "location_text": r.location_text,
        "status": r.status,
        "aqua_coins_awarded": r.aqua_coins_awarded,
        "ai_confidence": r.ai_confidence,
        "submitted_at": r.submitted_at.isoformat(),
        "image_data": r.image_data,
        "image_filename": r.image_filename,
    }


@app.post("/community/reports/{report_id}/verify")
def manually_verify_report(report_id: int, db: Session = Depends(get_db)):
    r = db.query(CommunityReport).filter(CommunityReport.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    if r.status == "Verified":
        return {"status": "already_verified"}

    coins = COIN_TABLE.get(r.report_type, COIN_TABLE["other"]).get(r.severity, 30)
    r.status = "Verified"
    r.aqua_coins_awarded = coins
    r.verified_at = datetime.utcnow()

    citizen = db.query(CitizenReward).filter(CitizenReward.citizen_name == r.reporter_name).first()
    if citizen:
        citizen.total_aqua_coins += coins
        citizen.verified_reports += 1
        citizen.tier = compute_tier(citizen.total_aqua_coins)
        citizen.last_activity = datetime.utcnow()

    db.commit()
    return {"status": "verified", "aqua_coins_awarded": coins}


@app.post("/community/reports/{report_id}/reject")
def reject_report(report_id: int, db: Session = Depends(get_db)):
    r = db.query(CommunityReport).filter(CommunityReport.id == report_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Report not found")
    r.status = "Rejected"
    db.commit()
    return {"status": "rejected"}


@app.get("/community/leaderboard")
def get_leaderboard(limit: int = Query(10, ge=1, le=50), db: Session = Depends(get_db)):
    citizens = (
        db.query(CitizenReward)
        .order_by(CitizenReward.total_aqua_coins.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "rank": i + 1,
            "citizen_name": c.citizen_name,
            "total_aqua_coins": c.total_aqua_coins,
            "total_reports": c.total_reports,
            "verified_reports": c.verified_reports,
            "tier": c.tier,
            "joined_at": c.joined_at.isoformat(),
        }
        for i, c in enumerate(citizens)
    ]


@app.get("/community/stats")
def get_community_stats(db: Session = Depends(get_db)):
    total_reports = db.query(CommunityReport).count()
    verified = db.query(CommunityReport).filter(CommunityReport.status == "Verified").count()
    pending  = db.query(CommunityReport).filter(CommunityReport.status == "Pending").count()
    total_coins = db.query(func.sum(CitizenReward.total_aqua_coins)).scalar() or 0
    active_citizens = db.query(CitizenReward).count()

    by_type = (
        db.query(CommunityReport.report_type, func.count().label("count"))
        .group_by(CommunityReport.report_type)
        .all()
    )

    # Community-reported zones with most issues (for redistribution insights)
    community_hotspots = (
        db.query(CommunityReport.zone_id, func.count().label("cnt"))
        .filter(CommunityReport.zone_id != None, CommunityReport.status == "Verified")
        .group_by(CommunityReport.zone_id)
        .order_by(func.count().desc())
        .limit(5)
        .all()
    )
    hotspot_list = []
    for zh in community_hotspots:
        zone = db.query(Zone).filter(Zone.id == zh.zone_id).first()
        hotspot_list.append({
            "zone_id": zh.zone_id,
            "zone_name": zone.name if zone else "Unknown",
            "verified_reports": zh.cnt,
        })

    return {
        "total_reports": total_reports,
        "verified_reports": verified,
        "pending_reports": pending,
        "total_aqua_coins_distributed": int(total_coins),
        "active_citizens": active_citizens,
        "by_type": [{"type": r.report_type, "count": r.count} for r in by_type],
        "community_hotspots": hotspot_list,
    }


@app.get("/community/citizen/{name}")
def get_citizen_profile(name: str, db: Session = Depends(get_db)):
    citizen = db.query(CitizenReward).filter(CitizenReward.citizen_name == name).first()
    if not citizen:
        raise HTTPException(status_code=404, detail="Citizen not found")
    reports = (
        db.query(CommunityReport)
        .filter(CommunityReport.reporter_name == name)
        .order_by(CommunityReport.submitted_at.desc())
        .all()
    )
    report_list = [
        {
            "id": r.id,
            "report_type": r.report_type,
            "severity": r.severity,
            "status": r.status,
            "aqua_coins_awarded": r.aqua_coins_awarded,
            "submitted_at": r.submitted_at.isoformat(),
        }
        for r in reports
    ]
    next_tier_info = None
    for threshold, tier in reversed(TIER_THRESHOLDS):
        if citizen.total_aqua_coins < threshold:
            next_tier_info = {"tier": tier, "coins_needed": threshold - citizen.total_aqua_coins}
    return {
        "citizen_name": citizen.citizen_name,
        "citizen_email": citizen.citizen_email,
        "total_aqua_coins": citizen.total_aqua_coins,
        "total_reports": citizen.total_reports,
        "verified_reports": citizen.verified_reports,
        "tier": citizen.tier,
        "joined_at": citizen.joined_at.isoformat(),
        "last_activity": citizen.last_activity.isoformat(),
        "next_tier": next_tier_info,
        "reports": report_list,
    }


@app.get("/community/redistribution-insights")
def get_community_redistribution_insights(db: Session = Depends(get_db)):
    """Enhance redistribution plan with community-reported leak hotspots."""
    base = suggest_redistribution(db)

    # Zones with highest community-reported issues (verified leaks/wastage)
    hotspot_zones = (
        db.query(CommunityReport.zone_id, func.count().label("cnt"))
        .filter(
            CommunityReport.zone_id != None,
            CommunityReport.status == "Verified",
            CommunityReport.report_type.in_(["pipe_leak", "unauthorized_discharge"]),
        )
        .group_by(CommunityReport.zone_id)
        .order_by(func.count().desc())
        .all()
    )
    hotspot_ids = {h.zone_id: h.cnt for h in hotspot_zones}

    # Annotate transfers with community urgency flag
    for t in base.get("transfers", []):
        to_id = t.get("to_zone_id")
        community_reports = hotspot_ids.get(to_id, 0)
        t["community_reports"] = community_reports
        t["community_urgency"] = "High" if community_reports >= 3 else ("Medium" if community_reports >= 1 else "Normal")
        if community_reports >= 2:
            t["amount_litres"] = round(t.get("amount_litres", 0) * 1.15, 2)  # 15% boost for reported zones
            t["community_boost"] = True
        else:
            t["community_boost"] = False

    base["community_hotspots"] = [
        {"zone_id": zid, "report_count": cnt}
        for zid, cnt in hotspot_ids.items()
    ]
    return base


# ─── AquaCoins Redemption ────────────────────────────────────────────────────

REWARDS_CATALOG = [
    {"id": "plant_kit",       "name": "Water-Saving Plant Kit",     "description": "Drought-resistant indoor plants + care guide",       "coins": 200,  "icon": "🌿", "category": "Eco"},
    {"id": "water_bottle",    "name": "AquaWatch Steel Bottle",     "description": "1L insulated bottle with AquaWatch branding",         "coins": 350,  "icon": "🍶", "category": "Merch"},
    {"id": "rain_gauge",      "name": "Home Rain Gauge Kit",        "description": "Measure and track your household rainfall",            "coins": 150,  "icon": "🌧️", "category": "Eco"},
    {"id": "filter_cartridge","name": "Water Filter Cartridge",     "description": "3-month supply of activated carbon filter packs",     "coins": 500,  "icon": "💧", "category": "Utility"},
    {"id": "tshirt",          "name": "AquaWatch Eco T-Shirt",      "description": "100% organic cotton tee — Save Water, Save Life",      "coins": 600,  "icon": "👕", "category": "Merch"},
    {"id": "drip_kit",        "name": "Drip Irrigation Kit",        "description": "DIY drip kit for balcony/terrace garden (saves 60% water)", "coins": 450,  "icon": "🪴", "category": "Eco"},
    {"id": "smart_tap",       "name": "Smart Tap Aerator",          "description": "Reduces tap water flow by 40% without pressure loss",   "coins": 300,  "icon": "🚿", "category": "Utility"},
    {"id": "badge_legend",    "name": "Legend Badge (Profile)",     "description": "Exclusive animated Legend badge on your profile",       "coins": 1000, "icon": "🏅", "category": "Status"},
]


def _generate_coupon(name: str, discount: float) -> str:
    import hashlib, time
    raw = f"{name}-{discount}-{time.time()}"
    h = hashlib.md5(raw.encode()).hexdigest()[:8].upper()
    return f"AQUA-{h}"


def _deduct_coins(db: Session, citizen_name: str, coins: int) -> CitizenReward:
    citizen = db.query(CitizenReward).filter(CitizenReward.citizen_name == citizen_name).first()
    if not citizen:
        raise HTTPException(status_code=404, detail="Citizen not found. Submit a report first.")
    if citizen.total_aqua_coins < coins:
        raise HTTPException(status_code=400, detail=f"Insufficient coins. You have {citizen.total_aqua_coins}, need {coins}.")
    citizen.total_aqua_coins -= coins
    citizen.last_activity = datetime.utcnow()
    return citizen


@app.get("/community/redeem/catalog")
def get_reward_catalog():
    """Return the full rewards catalog."""
    return REWARDS_CATALOG


@app.post("/community/redeem/bill-discount")
def redeem_bill_discount(
    citizen_name: str = Body(...),
    coins: int = Body(...),
    db: Session = Depends(get_db),
):
    """Redeem AquaCoins for a water bill discount coupon. 100 coins = ₹10."""
    if coins < 100 or coins % 100 != 0:
        raise HTTPException(status_code=400, detail="Minimum 100 coins, in multiples of 100.")
    discount = (coins // 100) * 10
    citizen = _deduct_coins(db, citizen_name, coins)
    coupon = _generate_coupon(citizen_name, discount)
    redemption = Redemption(
        citizen_name=citizen_name,
        redemption_type="bill_discount",
        coins_spent=coins,
        coupon_code=coupon,
        discount_amount=discount,
    )
    db.add(redemption)
    db.commit()
    db.refresh(redemption)
    return {
        "success": True,
        "redemption_type": "bill_discount",
        "coupon_code": coupon,
        "discount_amount": discount,
        "coins_spent": coins,
        "remaining_coins": citizen.total_aqua_coins,
        "message": f"🎉 Coupon {coupon} gives you ₹{discount} off your next water bill!",
    }


@app.post("/community/redeem/reward")
def redeem_catalog_reward(
    citizen_name: str = Body(...),
    reward_id: str = Body(...),
    db: Session = Depends(get_db),
):
    """Redeem AquaCoins for a reward from the catalog."""
    reward = next((r for r in REWARDS_CATALOG if r["id"] == reward_id), None)
    if not reward:
        raise HTTPException(status_code=404, detail="Reward not found.")
    citizen = _deduct_coins(db, citizen_name, reward["coins"])
    redemption = Redemption(
        citizen_name=citizen_name,
        redemption_type="reward",
        coins_spent=reward["coins"],
        reward_name=reward["name"],
        reward_description=reward["description"],
    )
    db.add(redemption)
    db.commit()
    db.refresh(redemption)
    return {
        "success": True,
        "redemption_type": "reward",
        "reward": reward,
        "coins_spent": reward["coins"],
        "remaining_coins": citizen.total_aqua_coins,
        "message": f"🎁 {reward['name']} redeemed! It will be delivered within 7 days.",
    }


@app.post("/community/redeem/donate")
def redeem_donate_to_zone(
    citizen_name: str = Body(...),
    zone_id: int = Body(...),
    coins: int = Body(...),
    db: Session = Depends(get_db),
):
    """Donate AquaCoins to boost water priority for a needy zone. 50 coins = 5% boost."""
    if coins < 50 or coins % 50 != 0:
        raise HTTPException(status_code=400, detail="Minimum 50 coins, in multiples of 50.")
    zone = db.query(Zone).filter(Zone.id == zone_id).first()
    if not zone:
        raise HTTPException(status_code=404, detail="Zone not found.")
    boost_pct = (coins // 50) * 5
    citizen = _deduct_coins(db, citizen_name, coins)
    redemption = Redemption(
        citizen_name=citizen_name,
        redemption_type="donation",
        coins_spent=coins,
        donated_to_zone_id=zone_id,
        donated_to_zone_name=zone.name,
        priority_boost_pct=boost_pct,
    )
    db.add(redemption)
    db.commit()
    db.refresh(redemption)
    return {
        "success": True,
        "redemption_type": "donation",
        "zone_name": zone.name,
        "priority_boost_pct": boost_pct,
        "coins_spent": coins,
        "remaining_coins": citizen.total_aqua_coins,
        "message": f"💧 {zone.name} gets a {boost_pct}% redistribution priority boost! Thank you!",
    }


@app.get("/community/redeem/history/{citizen_name}")
def get_redemption_history(citizen_name: str, db: Session = Depends(get_db)):
    """Get all redemptions for a citizen."""
    redemptions = (
        db.query(Redemption)
        .filter(Redemption.citizen_name == citizen_name)
        .order_by(Redemption.created_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "type": r.redemption_type,
            "coins_spent": r.coins_spent,
            "coupon_code": r.coupon_code,
            "discount_amount": r.discount_amount,
            "reward_name": r.reward_name,
            "donated_to_zone": r.donated_to_zone_name,
            "priority_boost_pct": r.priority_boost_pct,
            "created_at": r.created_at.isoformat(),
        }
        for r in redemptions
    ]
