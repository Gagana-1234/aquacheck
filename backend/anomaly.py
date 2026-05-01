import math
from typing import Optional
from sqlalchemy.orm import Session
from models import Reading


def compute_z_score(value: float, mean: float, std: float) -> float:
    if std == 0:
        return 0.0
    return (value - mean) / std


def detect_anomaly(
    zone_id: int,
    current_value: float,
    prev_hour_value: Optional[float],
    recent_readings: list,
) -> dict:
    """
    Detect anomaly using:
    1. Z-score method: flag if > 2.5 std deviations from 30-day rolling mean
    2. Spike detection: flag if > 40% increase from previous hour

    Returns dict with is_anomaly, anomaly_score, anomaly_type, anomaly_reason
    """
    result = {
        "is_anomaly": False,
        "anomaly_score": 0.0,
        "anomaly_type": None,
        "anomaly_reason": None,
    }

    if not recent_readings:
        return result

    values = [r.consumption_value for r in recent_readings]
    mean = sum(values) / len(values)
    variance = sum((v - mean) ** 2 for v in values) / len(values)
    std = math.sqrt(variance)

    z_score = compute_z_score(current_value, mean, std)

    spike_detected = False
    spike_pct = 0.0
    if prev_hour_value and prev_hour_value > 0:
        spike_pct = (current_value - prev_hour_value) / prev_hour_value * 100
        spike_detected = spike_pct > 40.0

    z_anomaly = abs(z_score) > 2.5

    if not z_anomaly and not spike_detected:
        return result

    # Determine anomaly score
    score = min(100.0, abs(z_score) * 20)
    if spike_detected:
        score = max(score, min(100.0, spike_pct * 1.2))

    # Classify anomaly type and reason
    if z_score < -2.5:
        anomaly_type = "unusual_pattern"
        reason = (
            f"Consumption dropped to {current_value:.1f} L/hr, which is "
            f"{abs(z_score):.1f} standard deviations below the 30-day average of "
            f"{mean:.1f} L/hr. This may indicate a supply interruption, sensor "
            f"malfunction, or unexpectedly low demand."
        )
    elif spike_detected and z_score > 2.5:
        anomaly_type = "leak"
        reason = (
            f"Critical anomaly detected: consumption surged to {current_value:.1f} L/hr "
            f"— a {spike_pct:.0f}% increase from the previous hour ({prev_hour_value:.1f} L/hr) "
            f"and {z_score:.1f} standard deviations above the 30-day average of {mean:.1f} L/hr. "
            f"Strongly indicates a pipe burst or major leak."
        )
    elif spike_detected:
        anomaly_type = "leak"
        reason = (
            f"Sudden spike detected: consumption jumped {spike_pct:.0f}% from "
            f"{prev_hour_value:.1f} L/hr to {current_value:.1f} L/hr within one hour. "
            f"Possible pipe burst, valve failure, or unauthorized usage."
        )
    else:
        anomaly_type = "overconsumption"
        reason = (
            f"Overconsumption alert: current rate of {current_value:.1f} L/hr is "
            f"{z_score:.1f} standard deviations above the 30-day average of {mean:.1f} L/hr. "
            f"Likely causes include demand surge, industrial usage spike, or gradual leak."
        )

    result.update(
        {
            "is_anomaly": True,
            "anomaly_score": round(score, 1),
            "anomaly_type": anomaly_type,
            "anomaly_reason": reason,
        }
    )
    return result


def get_anomaly_explanation(reading) -> str:
    """Return stored explanation or generate a fallback."""
    if reading.anomaly_reason:
        return reading.anomaly_reason
    return (
        f"An anomaly with score {reading.anomaly_score:.0f}/100 was detected at "
        f"{reading.timestamp.strftime('%Y-%m-%d %H:%M')} UTC. "
        f"The consumption value of {reading.consumption_value:.1f} L/hr deviated "
        f"significantly from expected patterns for this zone."
    )
