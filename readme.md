# 💧 AquaWatch — Water Systems Monitoring & Anomaly Detection Platform
 
A full-stack, mission-control-style dashboard for real-time water distribution monitoring, anomaly detection, and automated redistribution planning.
 
**Live Demo:** [aquacheck-wg0y.onrender.com](https://aquacheck-wg0y.onrender.com)
> ⚠️ Hosted on Render's free tier — the server sleeps after inactivity, so the first request may take 20–30 seconds to wake up. Please wait a moment on first load.
 
**GitHub:** [github.com/Gagana-1234/aquacheck](https://github.com/Gagana-1234/aquacheck)
 
## Tech Stack
 
| Layer    | Technology                                |
| -------- | ------------------------------------------ |
| Frontend | HTML5, CSS3, Vanilla JS (ES6+), Chart.js  |
| Backend  | Python 3.10+, FastAPI, SQLAlchemy ORM     |
| Database | SQLite (`water_systems.db`)               |
| Fonts    | Rajdhani (headings), IBM Plex Mono (data) |
 
## Setup Instructions
 
### 1. Install Backend Dependencies
```
cd backend
pip install -r requirements.txt
```
 
### 2. Seed the Database
```
cd backend
python seed.py
```
This creates `water_systems.db` with:
- 10 distribution zones
- ~7,200 hourly readings over 30 days
- 10 pre-injected anomalies
- 8 active alerts + 2 resolved
- 2 historical redistribution plan entries
### 3. Start the Backend
```
cd backend
uvicorn main:app --reload
```
API will be live at: **http://localhost:8000**
Interactive docs: **http://localhost:8000/docs**
 
### 4. Open the Frontend
```
cd frontend
python -m http.server 3000
```
Then open **http://localhost:3000** in your browser.
> Alternatively, open `frontend/index.html` directly in Chrome (CORS is configured for all origins).
 
## Pages
 
| Page              | File                  | Description                                |
| ----------------- | --------------------- | -------------------------------------------- |
| Dashboard         | `index.html`          | Live overview, zone map, alerts, 24h chart |
| Zone Monitor      | `zones.html`          | Sortable table, 7-day trend charts          |
| Anomaly Detection | `anomalies.html`      | Score bars, explain AI, resolve/flag        |
| Redistribution    | `redistribution.html` | Surplus/deficit matching, flow arrows       |
| Reports           | `reports.html`        | Date-range analytics, CSV export            |
 
## API Endpoints
 
| Method | Endpoint                      | Description                   |
| ------ | ------------------------------ | ------------------------------ |
| GET    | `/zones`                      | All zones with latest reading |
| GET    | `/zones/{id}/readings?days=7` | Time-series readings          |
| GET    | `/anomalies`                  | All flagged anomalies         |
| GET    | `/anomalies/{id}/explain`     | Plain-English explanation     |
| POST   | `/anomalies/{id}/resolve`     | Mark resolved                 |
| GET    | `/redistribution/suggest`     | Generate transfer plan        |
| POST   | `/redistribution/accept`      | Save accepted plan            |
| GET    | `/redistribution/history`     | Past plans                    |
| GET    | `/dashboard/stats`            | Dashboard aggregate stats     |
| GET    | `/reports?from=&to=`          | Date-range summary            |
| GET    | `/alerts`                     | All alerts                    |
 
## Anomaly Detection Logic
 
1. **Z-Score**: Flag if reading deviates > 2.5σ from 30-day rolling mean
2. **Spike Detection**: Flag if > 40% increase from previous hour reading
3. **Scoring**: `anomaly_score = min(100, abs(z_score) × 20)`
4. **Classification**: `leak` / `overconsumption` / `unusual_pattern`
## Redistribution Algorithm
 
- **Surplus**: `current_consumption < baseline × 0.7`
- **Deficit**: `current_consumption > baseline × 1.3`
- Greedy matching: surplus zones fill deficit zones up to available capacity
## File Structure
 
```
/backend
  main.py           FastAPI app + all API routes
  models.py         SQLAlchemy ORM models
  database.py       DB engine and session
  seed.py           Database seed script
  anomaly.py        Detection logic
  redistribution.py Planner algorithm
  requirements.txt
 
/frontend
  index.html        Dashboard
  zones.html        Zone Monitor
  anomalies.html    Anomaly Detection
  redistribution.html  Redistribution Planner
  reports.html      Reports & Analytics
  css/style.css     Global design system
  js/api.js         Fetch wrapper + UI helpers
  js/charts.js      Chart.js config helpers
  js/dashboard.js
  js/zones.js
  js/anomalies.js
  js/redistribution.js
  js/reports.js
```
 
