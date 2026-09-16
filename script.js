// Constants
const EARTH_RADIUS = 6371.0;
const RISK_THRESHOLD_KM = 10.0;
let riskChart = null;
let myGlobe = null;

// Global state for maneuver simulator
let currentSatellite = null;
let currentDebrisList = [];
let currentResults = [];
let currentTimeWindow = 12;
let currentStepSize = 10;

// Orbital Physics
class SpaceObject {
    constructor(id, type, altitude, inclination, period, raan = null, trueAnomaly = null) {
        this.id = id;
        this.type = type;
        this.altitude = altitude;
        this.radius = EARTH_RADIUS + altitude;
        this.inclination = inclination * (Math.PI / 180);
        this.period = period * 60.0;
        this.meanMotion = (2 * Math.PI) / this.period;
        this.raan = raan !== null ? raan * (Math.PI / 180) : Math.random() * 2 * Math.PI;
        this.trueAnomaly = trueAnomaly !== null ? trueAnomaly * (Math.PI / 180) : Math.random() * 2 * Math.PI;
    }

    positionAt(tSeconds) {
        let theta = this.trueAnomaly + this.meanMotion * tSeconds;
        let xOrb = this.radius * Math.cos(theta);
        let yOrb = this.radius * Math.sin(theta);
        let x = xOrb * Math.cos(this.raan) - yOrb * Math.cos(this.inclination) * Math.sin(this.raan);
        let y = xOrb * Math.sin(this.raan) + yOrb * Math.cos(this.inclination) * Math.cos(this.raan);
        let z = yOrb * Math.sin(this.inclination);
        return { x, y, z };
    }
}

function calculateDistance(pos1, pos2) {
    let dx = pos1.x - pos2.x;
    let dy = pos1.y - pos2.y;
    let dz = pos1.z - pos2.z;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function formatTime(totalSeconds) {
    let hours = Math.floor(totalSeconds / 3600);
    let minutes = Math.floor((totalSeconds % 3600) / 60);
    let seconds = totalSeconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Data Sources
function generateMockData(numDebris) {
    let satellite = new SpaceObject("SAT-CARTOSAT-3", "Satellite", 509.0, 97.5, 94.0, 45.0, 0.0);
    let debrisList = [];
    for (let i = 0; i < numDebris; i++) {
        let alt = 490.0 + Math.random() * 30.0;
        let inc = 90.0 + Math.random() * 10.0;
        let period = 90.0 + (alt / 500.0) * 4.0;
        let idString = "DEB-2026-" + i.toString().padStart(3, '0');
        debrisList.push(new SpaceObject(idString, "Debris", alt, inc, period));
    }
    return { satellite, debrisList };
}

function parseCSVData(csvText) {
    const lines = csvText.trim().split('\n');
    const headers = lines[0].toLowerCase().split(',').map(h => h.trim());
    const idIdx = headers.indexOf('id');
    const typeIdx = headers.indexOf('type');
    const altIdx = headers.indexOf('altitude');
    const incIdx = headers.indexOf('inclination');
    const perIdx = headers.indexOf('period');
    const raanIdx = headers.indexOf('raan');
    const taIdx = headers.indexOf('true_anomaly');

    if (altIdx === -1 || incIdx === -1 || perIdx === -1) {
        alert('CSV must have columns: id, type, altitude, inclination, period\nOptional: raan, true_anomaly');
        return null;
    }

    let satellite = null;
    let debrisList = [];

    for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const cols = lines[i].split(',').map(c => c.trim());
        const id = idIdx !== -1 ? cols[idIdx] : `OBJ-${i}`;
        const type = typeIdx !== -1 ? cols[typeIdx].toUpperCase() : 'DEBRIS';
        const altitude = parseFloat(cols[altIdx]);
        const inclination = parseFloat(cols[incIdx]);
        const period = parseFloat(cols[perIdx]);
        const raan = raanIdx !== -1 ? parseFloat(cols[raanIdx]) : null;
        const trueAnomaly = taIdx !== -1 ? parseFloat(cols[taIdx]) : null;

        if (isNaN(altitude) || isNaN(inclination) || isNaN(period)) continue;
        const obj = new SpaceObject(id, type, altitude, inclination, period, raan, trueAnomaly);
        if (type === 'SATELLITE' && !satellite) {
            satellite = obj;
        } else {
            debrisList.push(obj);
        }
    }

    if (!satellite && debrisList.length > 0) {
        satellite = debrisList.shift();
        satellite.id = "TARGET-" + satellite.id;
    }

    return { satellite, debrisList };
}

async function fetchLiveCelesTrakData() {
    const targetUrl = 'https://celestrak.org/NORAD/elements/gp.php?GROUP=iridium-33-debris&FORMAT=tle';
    try {
        let response = await fetch(targetUrl).catch(() => null);
        if (!response || !response.ok) {
            const proxyUrl = 'https://api.allorigins.win/raw?url=';
            response = await fetch(proxyUrl + encodeURIComponent(targetUrl));
        }
        if (!response.ok) throw new Error("Failed to fetch");
        const text = await response.text();
        if (text.trim().length === 0) throw new Error("Empty response");
        return parseTLEs(text);
    } catch (error) {
        console.error("Error fetching live TLEs:", error);
        return null;
    }
}

function parseTLEs(tleText) {
    const lines = tleText.trim().split('\n');
    let objects = [];
    const mu = 398600.4418;
    for (let i = 0; i < lines.length; i += 3) {
        if (i + 2 >= lines.length) break;
        const name = lines[i].trim();
        const line2 = lines[i+2];
        try {
            const inclination = parseFloat(line2.substring(8, 16).trim());
            const meanMotionRevsPerDay = parseFloat(line2.substring(52, 63).trim());
            if (isNaN(inclination) || isNaN(meanMotionRevsPerDay)) continue;
            const periodSeconds = 86400.0 / meanMotionRevsPerDay;
            const a = Math.pow(mu * Math.pow(periodSeconds / (2 * Math.PI), 2), 1/3);
            const altitude = a - EARTH_RADIUS;
            objects.push(new SpaceObject(name, "LiveDebris", altitude, inclination, periodSeconds / 60.0));
        } catch(e) {}
    }
    return objects;
}

// ─── ORBIT TRAIL GENERATION ────────────────────────────────────────────────────
function getOrbitPath(obj, steps = 80) {
    const points = [];
    const periodSec = obj.period;
    for (let i = 0; i <= steps; i++) {
        const t = (i / steps) * periodSec;
        const pos = obj.positionAt(t);
        const r = Math.sqrt(pos.x*pos.x + pos.y*pos.y + pos.z*pos.z);
        points.push([
            Math.asin(pos.z / r) * (180 / Math.PI),
            Math.atan2(pos.y, pos.x) * (180 / Math.PI),
            0.04
        ]);
    }
    return points;
}

// ─── GLOBE INIT ────────────────────────────────────────────────────────────────
function initGlobe() {
    myGlobe = Globe()
      (document.getElementById('globe-viz'))
      .globeImageUrl('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg')
      .backgroundColor('#020408')
      .pointOfView({ altitude: 2.5 });

    myGlobe.controls().autoRotate = true;
    myGlobe.controls().autoRotateSpeed = 0.5;
    myGlobe.controls().enableZoom = true;
}

// ─── ANIMATION ────────────────────────────────────────────────────────────────
let animationId = null;
let simTime = 0;
let lastTimestamp = null;
let timeMultiplier = 500;

function buildPointData(satellite, debrisList, results, t) {
    let gData = debrisList.map(deb => {
        let pos = deb.positionAt(t);
        let r = Math.sqrt(pos.x*pos.x + pos.y*pos.y + pos.z*pos.z);
        let res = results.find(rr => rr.debrisId === deb.id);
        return {
            lat: Math.asin(pos.z / r) * (180/Math.PI),
            lng: Math.atan2(pos.y, pos.x) * (180/Math.PI),
            alt: 0.04,
            size: 0.25,
            color: res && res.riskLevel === 'HIGH' ? 'rgba(255, 68, 68, 0.95)' : 'rgba(0, 255, 204, 0.7)',
            label: deb.id,
            data: res,
            isSat: false
        };
    });

    let satPos = satellite.positionAt(t);
    let satR = Math.sqrt(satPos.x*satPos.x + satPos.y*satPos.y + satPos.z*satPos.z);
    gData.push({
        lat: Math.asin(satPos.z / satR) * (180/Math.PI),
        lng: Math.atan2(satPos.y, satPos.x) * (180/Math.PI),
        alt: 0.07,
        size: 0.5,
        color: '#ffffff',
        label: satellite.id,
        data: null,
        isSat: true,
        satRef: satellite
    });

    return gData;
}

function startAnimation(satellite, debrisList, results) {
    if (animationId) cancelAnimationFrame(animationId);
    simTime = 0;
    lastTimestamp = null;

    // ── Build orbit trail paths ──
    const highRiskDebris = debrisList.filter(deb => {
        const r = results.find(rr => rr.debrisId === deb.id);
        return r && r.riskLevel === 'HIGH';
    });

    // Only show satellite trail + high-risk debris trails (performance)
    const paths = [
        {
            points: getOrbitPath(satellite),
            color: () => 'rgba(255, 255, 255, 0.6)',
            strokeWidth: 1.5,
            isDash: false
        },
        ...highRiskDebris.map(deb => ({
            points: getOrbitPath(deb),
            color: () => 'rgba(255, 68, 68, 0.5)',
            strokeWidth: 0.8,
            isDash: true
        }))
    ];

    myGlobe
      .pathsData(paths)
      .pathPoints('points')
      .pathPointLat(p => p[0])
      .pathPointLng(p => p[1])
      .pathPointAlt(p => p[2])
      .pathColor('color')
      .pathStroke('strokeWidth')
      .pathDashLength(0.05)
      .pathDashGap(0.03);

    // ── Click handler ──
    myGlobe.onPointClick(point => {
        if (point.isSat) {
            showSatelliteInfo(point.satRef);
        } else if (point.data) {
            showDebrisAnalysis(point.data);
        }
    });

    function animate(timestamp) {
        if (!lastTimestamp) lastTimestamp = timestamp;
        const deltaReal = (timestamp - lastTimestamp) / 1000;
        lastTimestamp = timestamp;
        simTime += deltaReal * timeMultiplier;

        const gData = buildPointData(satellite, debrisList, results, simTime);
        myGlobe.pointsData(gData)
          .pointAltitude('alt')
          .pointColor('color')
          .pointRadius('size');

        animationId = requestAnimationFrame(animate);
    }

    animationId = requestAnimationFrame(animate);
}

// ─── INFO PANELS ──────────────────────────────────────────────────────────────
function showSatelliteInfo(sat) {
    const alertBox = document.getElementById('alert-box');
    alertBox.className = "panel alert-panel safe";
    alertBox.innerHTML = `
        <div class="alert-title">🛰️ TARGET SATELLITE</div>
        <div class="alert-desc" style="font-size: 13px; line-height: 1.7; margin-top: 5px;">
            <strong>ID:</strong> ${sat.id}<br>
            <strong>Altitude:</strong> ${sat.altitude.toFixed(1)} km<br>
            <strong>Inclination:</strong> ${(sat.inclination * 180/Math.PI).toFixed(2)}°<br>
            <strong>Period:</strong> ${(sat.period / 60).toFixed(1)} min
        </div>
    `;
}

function showDebrisAnalysis(res) {
    const alertBox = document.getElementById('alert-box');
    let riskClass = res.riskLevel === "HIGH" ? "panel alert-panel danger" : "panel alert-panel safe";
    const icon = res.riskLevel === "HIGH" ? "⚠️" : "✅";
    alertBox.className = riskClass;
    alertBox.innerHTML = `
        <div class="alert-title">${icon} ${res.debrisId}</div>
        <div class="alert-desc" style="font-size: 13px; line-height: 1.7; margin-top: 5px;">
            <strong>Min Distance:</strong> ${res.closestApproach} km<br>
            <strong>Time to Approach:</strong> ${res.timeToApproach}<br>
            <strong>Risk:</strong> <span style="font-weight:bold; color: ${res.riskLevel === 'HIGH' ? '#ff4444' : '#00ffcc'};">${res.riskLevel}</span>
        </div>
    `;
}

// ─── CHART ────────────────────────────────────────────────────────────────────
function renderChart(results) {
    const ctx = document.getElementById('riskChart').getContext('2d');
    if (riskChart) riskChart.destroy();

    const labels = results.map(r => r.debrisId);
    const dataPoints = results.map(r => parseFloat(r.closestApproach));
    const colors = results.map(r => r.riskLevel === 'HIGH' ? '#ff4444' : '#00ffcc');

    Chart.defaults.color = '#7b8ea8';
    Chart.defaults.font.family = "'Rajdhani', sans-serif";

    riskChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Closest Approach (km)',
                    data: dataPoints,
                    backgroundColor: colors,
                    borderColor: colors,
                    pointBackgroundColor: colors,
                    pointBorderColor: colors,
                    pointRadius: 3,
                    showLine: false,
                },
                {
                    label: 'Threshold (10km)',
                    data: Array(results.length).fill(10.0),
                    borderColor: '#ff4444',
                    borderWidth: 1,
                    borderDash: [5, 5],
                    pointRadius: 0,
                    fill: false
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(80, 120, 200, 0.1)' } },
                x: { grid: { display: false }, ticks: { display: false } }
            },
            plugins: { legend: { display: false } }
        }
    });
}

// ─── EXPORT REPORT ────────────────────────────────────────────────────────────
function exportCSV() {
    if (currentResults.length === 0) return;

    let csvContent = "DEBRIS_ID,CLOSEST_APPROACH_KM,TIME_TO_APPROACH,RISK_LEVEL\n";
    currentResults.forEach(r => {
        csvContent += `${r.debrisId},${r.closestApproach},${r.timeToApproach},${r.riskLevel}\n`;
    });

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `orbital_sentinel_report_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// ─── MANEUVER SIMULATOR ───────────────────────────────────────────────────────
function runManeuver() {
    if (!currentSatellite || currentDebrisList.length === 0) return;

    const deltaAlt = parseFloat(document.getElementById('maneuver-delta').value) || 0;
    const resultDiv = document.getElementById('maneuver-result');

    // Create a new satellite with adjusted altitude
    const newAlt = Math.max(200, currentSatellite.altitude + deltaAlt);
    const newPeriod = 2 * Math.PI * Math.sqrt(Math.pow(EARTH_RADIUS + newAlt, 3) / 398600.4418) / 60;
    const adjSat = new SpaceObject(
        currentSatellite.id,
        currentSatellite.type,
        newAlt,
        currentSatellite.inclination * (180/Math.PI),
        newPeriod,
        currentSatellite.raan * (180/Math.PI),
        currentSatellite.trueAnomaly * (180/Math.PI)
    );

    const totalSteps = Math.floor((currentTimeWindow * 3600) / currentStepSize);
    let newHighRisk = 0;
    let oldHighRisk = currentResults.filter(r => r.riskLevel === 'HIGH').length;

    for (let debris of currentDebrisList) {
        let minDist = Infinity;
        for (let step = 0; step < totalSteps; step++) {
            let t = step * currentStepSize;
            let dist = calculateDistance(adjSat.positionAt(t), debris.positionAt(t));
            if (dist < minDist) minDist = dist;
        }
        if (minDist < RISK_THRESHOLD_KM) newHighRisk++;
    }

    const improved = newHighRisk < oldHighRisk;
    const color = improved ? '#00ffcc' : (newHighRisk > oldHighRisk ? '#ff4444' : '#ffffff');
    const arrow = improved ? '↓' : (newHighRisk > oldHighRisk ? '↑' : '→');

    resultDiv.innerHTML = `
        <div style="font-size:12px; margin-top:8px; padding:8px; background:rgba(0,0,0,0.3); border-radius:6px; line-height:1.6;">
            <strong>New Altitude:</strong> ${newAlt.toFixed(1)} km<br>
            <strong>HIGH Risk:</strong> ${oldHighRisk} ${arrow} <span style="color:${color}; font-weight:bold;">${newHighRisk}</span><br>
            <strong>Outcome:</strong> <span style="color:${color};">${improved ? 'RISK REDUCED ✓' : (newHighRisk > oldHighRisk ? 'RISK INCREASED ✗' : 'NO CHANGE')}</span>
        </div>
    `;
}

function runAutoEvade() {
    if (!currentSatellite || currentDebrisList.length === 0) return;

    const resultDiv = document.getElementById('maneuver-result');
    const originalHighRisk = currentResults.filter(r => r.riskLevel === 'HIGH').length;

    if (originalHighRisk === 0) {
        resultDiv.innerHTML = `<div style="font-size:12px; color:#00ffcc; margin-top:8px; padding:8px; background:rgba(0,255,204,0.1); border-radius:6px;">Orbit is already safe. No maneuver required.</div>`;
        return;
    }

    resultDiv.innerHTML = `<div style="font-size:12px; color:#ffcc00; margin-top:8px; padding:8px; background:rgba(255,204,0,0.1); border-radius:6px;">🤖 AI Calculating optimal evasion...</div>`;

    setTimeout(() => {
        const totalSteps = Math.floor((currentTimeWindow * 3600) / currentStepSize);
        
        // Helper to test a delta quickly (exits early if ANY high risk is found)
        const testDelta = (deltaAlt) => {
            const newAlt = Math.max(200, currentSatellite.altitude + deltaAlt);
            const newPeriod = 2 * Math.PI * Math.sqrt(Math.pow(EARTH_RADIUS + newAlt, 3) / 398600.4418) / 60;
            const adjSat = new SpaceObject(
                currentSatellite.id, currentSatellite.type, newAlt,
                currentSatellite.inclination * (180/Math.PI), newPeriod,
                currentSatellite.raan * (180/Math.PI), currentSatellite.trueAnomaly * (180/Math.PI)
            );

            for (let debris of currentDebrisList) {
                let minDist = Infinity;
                for (let step = 0; step < totalSteps; step++) {
                    let t = step * currentStepSize;
                    let dist = calculateDistance(adjSat.positionAt(t), debris.positionAt(t));
                    if (dist < minDist) minDist = dist;
                }
                if (minDist < RISK_THRESHOLD_KM) return false; // Not safe
            }
            return true; // 100% safe
        };

        let optimalDelta = null;
        // Search expanding outward: +1, -1, +2, -2 up to 100km
        for (let d = 1; d <= 100; d++) {
            if (testDelta(d)) { optimalDelta = d; break; }
            if (testDelta(-d)) { optimalDelta = -d; break; }
        }

        if (optimalDelta !== null) {
            document.getElementById('maneuver-delta').value = optimalDelta;
            resultDiv.innerHTML = `
                <div style="font-size:12px; margin-top:8px; padding:8px; background:rgba(0, 255, 204, 0.1); border: 1px solid #00ffcc; border-radius:6px; line-height:1.6;">
                    <strong style="color:#00ffcc;">🤖 AI SOLUTION FOUND</strong><br>
                    <strong>Recommended Burn:</strong> ${optimalDelta > 0 ? '+' : ''}${optimalDelta} km<br>
                    <strong>New Altitude:</strong> ${(currentSatellite.altitude + optimalDelta).toFixed(1)} km<br>
                    <strong>Status:</strong> <span style="color:#00ffcc;">0 Collision Risks ✓</span>
                </div>
            `;
        } else {
            resultDiv.innerHTML = `
                <div style="font-size:12px; margin-top:8px; padding:8px; background:rgba(255, 68, 68, 0.1); border: 1px solid #ff4444; border-radius:6px; line-height:1.6;">
                    <strong style="color:#ff4444;">🤖 AI SOLVER FAILED</strong><br>
                    No safe altitude found within ±100km. Major orbital change required!
                </div>
            `;
        }
    }, 50);
}

// ─── MAIN SIMULATION ──────────────────────────────────────────────────────────
function runSimulation() {
    const btn = document.getElementById('run-btn');
    btn.innerText = "INITIALIZING...";
    btn.disabled = true;

    const source = document.getElementById('data-source').value;
    currentTimeWindow = parseFloat(document.getElementById('time-window').value);
    currentStepSize = parseInt(document.getElementById('step-size').value);

    let satellite, debrisList;

    const doSimulate = () => {
        setTimeout(() => {
            const totalSteps = Math.floor((currentTimeWindow * 3600) / currentStepSize);
            let results = [];
            let highRiskCount = 0;

            for (let debris of debrisList) {
                let minDist = Infinity;
                let minTimeSec = 0;
                for (let step = 0; step < totalSteps; step++) {
                    let t = step * currentStepSize;
                    let dist = calculateDistance(satellite.positionAt(t), debris.positionAt(t));
                    if (dist < minDist) { minDist = dist; minTimeSec = t; }
                }
                let riskLevel = minDist < RISK_THRESHOLD_KM ? "HIGH" : "LOW";
                if (riskLevel === "HIGH") highRiskCount++;
                results.push({
                    targetId: satellite.id,
                    debrisId: debris.id,
                    closestApproach: minDist.toFixed(3),
                    timeToApproach: formatTime(minTimeSec),
                    riskLevel: riskLevel
                });
            }

            results.sort((a, b) => parseFloat(a.closestApproach) - parseFloat(b.closestApproach));

            // Save globally for maneuver sim + export
            currentSatellite = satellite;
            currentDebrisList = debrisList;
            currentResults = results;

            // Update stats
            document.getElementById('target-id').innerText = satellite.id;
            document.getElementById('metric-debris').innerText = debrisList.length;
            const riskMetric = document.getElementById('metric-high-risk');
            riskMetric.innerText = highRiskCount;
            riskMetric.style.color = highRiskCount > 0 ? "#ff4444" : "#ffffff";

            // Update alert
            const alertBox = document.getElementById('alert-box');
            if (highRiskCount > 0) {
                alertBox.className = "panel alert-panel danger";
                alertBox.innerHTML = `<div class="alert-title">⚠️ COLLISION ALERT</div>
                                      <div class="alert-desc">${highRiskCount} close approaches detected within ${currentTimeWindow}h window.<br><small style="color:#aaa;">Click a red dot to inspect.</small></div>`;
            } else {
                alertBox.className = "panel alert-panel safe";
                alertBox.innerHTML = `<div class="alert-title">✅ ALL CLEAR</div>
                                      <div class="alert-desc">No threats in ${currentTimeWindow}h window. Click any object to inspect.</div>`;
            }

            // Update risk table
            const tbody = document.getElementById('table-body');
            tbody.innerHTML = "";
            results.forEach(res => {
                let tr = document.createElement('tr');
                let riskClass = res.riskLevel === "HIGH" ? "risk-high" : "risk-low";
                tr.innerHTML = `
                    <td>${res.debrisId}</td>
                    <td>${res.closestApproach}</td>
                    <td>${res.timeToApproach}</td>
                    <td class="${riskClass}">${res.riskLevel}</td>
                `;
                tbody.appendChild(tr);
            });

            renderChart(results);
            startAnimation(satellite, debrisList, results);

            // Reset maneuver panel
            document.getElementById('maneuver-result').innerHTML = '';
            document.getElementById('maneuver-delta').value = 0;

            btn.innerText = "EXECUTE PROPAGATION";
            btn.disabled = false;
        }, 50);
    };

    if (source === 'live') {
        fetchLiveCelesTrakData().then(liveDebris => {
            if (liveDebris && liveDebris.length > 0) {
                satellite = liveDebris[0];
                satellite.id = "TARGET (IRIDIUM 33 DEB)";
                debrisList = liveDebris.slice(1);
            } else {
                console.warn("Live fetch failed, using mock data fallback.");
                const mock = generateMockData(200);
                satellite = mock.satellite;
                debrisList = mock.debrisList;
            }
            doSimulate();
        });
    } else if (source === 'csv') {
        const fileInput = document.getElementById('csv-file');
        if (!fileInput.files || fileInput.files.length === 0) {
            alert('Please select a CSV file first.');
            btn.innerText = "EXECUTE PROPAGATION";
            btn.disabled = false;
            return;
        }
        fileInput.files[0].text().then(csvText => {
            const parsed = parseCSVData(csvText);
            if (!parsed) {
                btn.innerText = "EXECUTE PROPAGATION";
                btn.disabled = false;
                return;
            }
            satellite = parsed.satellite;
            debrisList = parsed.debrisList;
            doSimulate();
        });
    } else {
        const mock = generateMockData(parseInt(document.getElementById('num-debris').value));
        satellite = mock.satellite;
        debrisList = mock.debrisList;
        doSimulate();
    }
}

// ─── STARTUP ──────────────────────────────────────────────────────────────────
window.onload = () => {
    initGlobe();

    // Speed slider
    const speedSlider = document.getElementById('speed-slider');
    if (speedSlider) {
        speedSlider.addEventListener('input', function() {
            timeMultiplier = parseInt(this.value);
            document.getElementById('speed-label').innerText = `${this.value}x`;
        });
    }

    // Animated header coordinate
    setInterval(() => {
        let lat = (Math.random() * 180 - 90).toFixed(4);
        let lon = (Math.random() * 360 - 180).toFixed(4);
        document.getElementById('hdr-coord').innerText = `${lat}, ${lon}`;
    }, 2000);
};
