# Orbital Sentinel 🛰️

**Space Debris Collision Risk Estimator**
*Developed for the ISRO PS09 Hackathon Challenge*

Orbital Sentinel is a fast, approximate browser-based tool designed for satellite operators to flag close approaches between a target satellite and known debris objects. It uses simplified Keplerian orbital propagation to calculate distances over a defined time window without requiring heavy backend perturbation-modeling infrastructure.

## ✨ Key Features
- **3D Orbital Visualizer:** Real-time Globe.gl rendering of Earth, target satellite, and debris fields with glowing orbital trails for high-risk objects.
- **AI Evasion Autopilot:** A built-in solver that automatically calculates the optimal Delta-V (altitude adjustment) required to reach zero high-risk conjunctions.
- **Live Telemetry Integration:** Directly fetches and parses live TLE data from CelesTrak (Iridium-33 debris group).
- **Custom CSV Upload:** Upload your own target and debris dataset for custom scenario testing.
- **Conjunction Risk Table & Export:** Real-time sorting of closest approaches with a 1-click CSV export for reporting.

## 🚀 Setup & Installation
Because Orbital Sentinel is built entirely with client-side web technologies (HTML/CSS/JS) for maximum speed and portability, there is no complex backend to configure.

1. **Clone the repository:**
   ```bash
   git clone https://github.com/spoorthikumbha/orbital-sentinel.git
   cd orbital-sentinel
   ```
2. **Run the app:**
   Simply double-click `index.html` to open it in any modern web browser (Chrome/Edge/Firefox recommended).
   *(Alternatively, you can serve it via a local web server like VS Code Live Server or `python3 -m http.server`).*

## 🧠 Explainable Logic (Math Engine)
The core physics engine (`script.js`) strips away complex perturbations (like J2/SGP4) to prioritize speed:
1. **Inputs:** Altitude (km), Inclination (deg), Period (min).
2. **Propagation:** Calculates Mean Motion and True Anomaly over time `t`.
3. **3D Conversion:** Maps the 2D orbital plane into 3D ECI coordinates using Inclination and RAAN.
4. **Distance:** Computes the Cartesian distance `Math.sqrt(dx^2 + dy^2 + dz^2)` at every time step to find the absolute minimum approach distance.

## 🌐 Live Deployment
This project is fully deployed and accessible at: **[Insert Vercel/Netlify Link Here]**
