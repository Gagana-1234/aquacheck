from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, ForeignKey, Text, LargeBinary
from sqlalchemy.orm import relationship
from datetime import datetime
from database import Base


class Zone(Base):
    __tablename__ = "zones"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, nullable=False)
    region = Column(String, nullable=False)
    baseline_consumption = Column(Float, nullable=False)  # litres/hour
    current_consumption = Column(Float, nullable=False, default=0.0)
    status = Column(String, default="Normal")  # Normal, Anomaly, Critical

    readings = relationship("Reading", back_populates="zone", cascade="all, delete-orphan")
    alerts = relationship("Alert", back_populates="zone", cascade="all, delete-orphan")
    redistribution_from = relationship("RedistributionPlan", foreign_keys="RedistributionPlan.from_zone_id", back_populates="from_zone")
    redistribution_to = relationship("RedistributionPlan", foreign_keys="RedistributionPlan.to_zone_id", back_populates="to_zone")


class Reading(Base):
    __tablename__ = "readings"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=False)
    timestamp = Column(DateTime, default=datetime.utcnow, nullable=False)
    consumption_value = Column(Float, nullable=False)
    is_anomaly = Column(Boolean, default=False)
    anomaly_score = Column(Float, default=0.0)
    anomaly_type = Column(String, nullable=True)  # leak, overconsumption, unusual_pattern
    anomaly_reason = Column(Text, nullable=True)

    zone = relationship("Zone", back_populates="readings")


class RedistributionPlan(Base):
    __tablename__ = "redistribution_plans"

    id = Column(Integer, primary_key=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    from_zone_id = Column(Integer, ForeignKey("zones.id"), nullable=False)
    to_zone_id = Column(Integer, ForeignKey("zones.id"), nullable=False)
    amount_litres = Column(Float, nullable=False)
    status = Column(String, default="Pending")  # Pending, Accepted, Rejected

    from_zone = relationship("Zone", foreign_keys=[from_zone_id], back_populates="redistribution_from")
    to_zone = relationship("Zone", foreign_keys=[to_zone_id], back_populates="redistribution_to")


class Alert(Base):
    __tablename__ = "alerts"

    id = Column(Integer, primary_key=True, index=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=False)
    severity = Column(String, nullable=False)  # Critical, Warning, Info
    message = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    resolved = Column(Boolean, default=False)

    zone = relationship("Zone", back_populates="alerts")


class CommunityReport(Base):
    __tablename__ = "community_reports"

    id = Column(Integer, primary_key=True, index=True)
    reporter_name = Column(String, nullable=False)
    reporter_email = Column(String, nullable=True)
    zone_id = Column(Integer, ForeignKey("zones.id"), nullable=True)
    report_type = Column(String, nullable=False)  # pipe_leak, unauthorized_discharge, water_wastage, other
    severity = Column(String, default="Medium")   # Low, Medium, High, Critical
    description = Column(Text, nullable=True)
    location_text = Column(String, nullable=True)
    image_data = Column(Text, nullable=True)       # base64 encoded image
    image_filename = Column(String, nullable=True)
    status = Column(String, default="Pending")     # Pending, Verified, Rewarded, Rejected
    aqua_coins_awarded = Column(Integer, default=0)
    ai_confidence = Column(Float, default=0.0)     # Simulated AI confidence score
    submitted_at = Column(DateTime, default=datetime.utcnow)
    verified_at = Column(DateTime, nullable=True)

    zone = relationship("Zone", foreign_keys=[zone_id])


class CitizenReward(Base):
    __tablename__ = "citizen_rewards"

    id = Column(Integer, primary_key=True, index=True)
    citizen_name = Column(String, nullable=False)
    citizen_email = Column(String, nullable=True)
    total_aqua_coins = Column(Integer, default=0)
    total_reports = Column(Integer, default=0)
    verified_reports = Column(Integer, default=0)
    tier = Column(String, default="Bronze")        # Bronze, Silver, Gold, Platinum, Legend
    joined_at = Column(DateTime, default=datetime.utcnow)
    last_activity = Column(DateTime, default=datetime.utcnow)
