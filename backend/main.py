from fastapi import FastAPI, Depends, HTTPException, Query
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

from database import engine, get_db, SessionLocal
from models import Base, Zone, Reading, Alert, RedistributionPlan
from anomaly import get_anomaly_explanation
from redistribution import suggest_redistribution, save_redistribution_plan
from predict import forecast_zone, compute_network_health

Base.metadata.create_all(bind=engine)

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
