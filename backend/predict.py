"""
predict.py — Predictive analytics for AquaWatch
- Simple linear regression for 6-hour consumption forecast
- Network health scoring (composite 0-100 score)
"""
import math
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from models import Zone, Reading, Alert


def linear_regression(x_vals: list, y_vals: list):
    """Return (slope, intercept) for simple linear regression."""
    n = len(x_vals)
    if n < 2:
        return 0.0, (y_vals[0] if y_vals else 0.0)
    sum_x = sum(x_vals)
    sum_y = sum(y_vals)
    sum_xy = sum(x * y for x, y in zip(x_vals, y_vals))
    sum_xx = sum(x * x for x in x_vals)
    denom = n * sum_xx - sum_x ** 2
    if denom == 0:
        return 0.0, sum_y / n
    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n
    return slope, intercept


def forecast_zone(zone_id: int, db: Session, hours_ahead: int = 6) -> dict:
    """
    Forecast consumption for a zone using last 48 hourly readings.
    Returns predicted values for next `hours_ahead` hours.
    """
    since = datetime.utcnow() - timedelta(hours=48)
    readings = (
        db.query(Reading)
        .filter(Reading.zone_id == zone_id, Reading.timestamp >= since)
        .order_by(Reading.timestamp.asc())
        .all()
    )

    if len(readings) < 4:
        return {"zone_id": zone_id, "forecast": [], "trend": "insufficient_data"}

    x = list(range(len(readings)))
    y = [r.consumption_value for r in readings]

    slope, intercept = linear_regression(x, y)

    n = len(readings)
    forecast_points = []
    last_ts = readings[-1].timestamp
    for i in range(1, hours_ahead + 1):
        pred_val = intercept + slope * (n - 1 + i)
        pred_val = max(0, pred_val)
        forecast_ts = last_ts + timedelta(hours=i)
        forecast_points.append({
            "hour": i,
            "timestamp": forecast_ts.isoformat(),
            "predicted_value": round(pred_val, 2),
        })

    # Trend classification
    if slope > 2:
        trend = "rising_fast"
    elif slope > 0.5:
        trend = "rising"
    elif slope < -2:
        trend = "falling_fast"
    elif slope < -0.5:
        trend = "falling"
    else:
        trend = "stable"

    return {
        "zone_id": zone_id,
        "slope": round(slope, 4),
        "trend": trend,
        "forecast": forecast_points,
    }


def compute_network_health(db: Session) -> dict:
    """
    Compute a composite network health score (0-100).
    Factors:
    - Zone status (Normal=good, Anomaly=moderate, Critical=bad)
    - Anomaly rate in last 24h
    - Average deviation from baselines
    - Unresolved alerts count
    """
    zones = db.query(Zone).all()
    total_zones = len(zones)

    if total_zones == 0:
        return {"score": 0, "grade": "F", "factors": {}}

    # Factor 1: Zone status score (0-100)
    status_points = 0
    for zone in zones:
        if zone.status == "Normal":
            status_points += 100
        elif zone.status == "Anomaly":
            status_points += 50
        else:  # Critical
            status_points += 0
    zone_health = status_points / total_zones  # 0-100

    # Factor 2: Anomaly rate (last 24h)
    since_24h = datetime.utcnow() - timedelta(hours=24)
    total_readings_24h = db.query(Reading).filter(Reading.timestamp >= since_24h).count()
    anomaly_readings_24h = db.query(Reading).filter(
        Reading.is_anomaly == True,
        Reading.timestamp >= since_24h
    ).count()
    anomaly_rate = (anomaly_readings_24h / total_readings_24h * 100) if total_readings_24h > 0 else 0
    anomaly_health = max(0, 100 - anomaly_rate * 5)  # 2% rate = 90 health

    # Factor 3: Average deviation score
    total_dev = 0.0
    for zone in zones:
        if zone.baseline_consumption > 0:
            dev = abs(zone.current_consumption - zone.baseline_consumption) / zone.baseline_consumption * 100
            total_dev += dev
    avg_dev = total_dev / total_zones
    deviation_health = max(0, 100 - avg_dev * 2)  # 10% avg dev = 80 health

    # Factor 4: Unresolved alerts penalty
    from models import Alert
    unresolved = db.query(Alert).filter(Alert.resolved == False).count()
    critical_unresolved = db.query(Alert).filter(Alert.resolved == False, Alert.severity == "Critical").count()
    alert_health = max(0, 100 - unresolved * 5 - critical_unresolved * 10)

    # Weighted composite score
    weights = {"zone": 0.35, "anomaly": 0.25, "deviation": 0.25, "alert": 0.15}
    score = (
        zone_health * weights["zone"] +
        anomaly_health * weights["anomaly"] +
        deviation_health * weights["deviation"] +
        alert_health * weights["alert"]
    )
    score = round(score, 1)

    # Letter grade
    if score >= 90:
        grade = "A"
    elif score >= 80:
        grade = "B"
    elif score >= 70:
        grade = "C"
    elif score >= 60:
        grade = "D"
    else:
        grade = "F"

    # Risk assessment
    critical_zones = [z for z in zones if z.status == "Critical"]
    risk_level = "High" if critical_zones or score < 60 else "Medium" if score < 80 else "Low"

    return {
        "score": score,
        "grade": grade,
        "risk_level": risk_level,
        "factors": {
            "zone_health": round(zone_health, 1),
            "anomaly_health": round(anomaly_health, 1),
            "deviation_health": round(deviation_health, 1),
            "alert_health": round(alert_health, 1),
        },
        "stats": {
            "total_zones": total_zones,
            "critical_zones": len(critical_zones),
            "anomaly_rate_24h": round(anomaly_rate, 2),
            "avg_deviation_pct": round(avg_dev, 1),
            "unresolved_alerts": unresolved,
        },
        "computed_at": datetime.utcnow().isoformat(),
    }
