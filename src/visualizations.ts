export function barkleyVisualizationHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#F1F3EF">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="mobile-web-app-capable" content="yes">
  <title>Barkley Marathons terrain - Earth Watch Visualizations</title>
  <meta name="description" content="An interactive reconstructed terrain visualization of a Barkley Marathons loop through Frozen Head State Park.">
  <link rel="canonical" href="https://earth.tkcgroup.co/visualizations">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:ital,wght@0,400;0,500;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@400;500;600&family=Libre+Baskerville:ital@0;1&display=swap" rel="stylesheet">
  <style>
    :root {
      --site-paper:#F1F3EF;
      --site-panel:#FBFCFA;
      --site-ink:#1E2A2C;
      --site-muted:#5C6A66;
      --site-hair:#D4DAD3;
      --paper:#EDE7D8;
      --paper-deep:#E0D7C1;
      --ink:#2B2721;
      --ink-soft:#6B6153;
      --contour:#A0703E;
      --oxblood:#8C1C1C;
      --woodland:#B9CDA0;
    }
    * { box-sizing:border-box; }
    html, body { margin:0; min-width:320px; }
    body {
      background:var(--site-paper);
      color:var(--site-ink);
      font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
      -webkit-font-smoothing:antialiased;
    }
    a { color:inherit; }
    button, input { font:inherit; }
    .site-shell {
      max-width:1320px;
      margin:0 auto;
      padding:16px 18px 28px;
    }
    .site-head {
      display:flex;
      align-items:flex-end;
      justify-content:space-between;
      gap:18px;
      padding-bottom:11px;
      border-bottom:2px solid var(--site-ink);
    }
    .site-brand {
      font:700 34px/0.92 "Barlow Condensed",sans-serif;
      text-transform:uppercase;
      letter-spacing:.02em;
      text-decoration:none;
    }
    .site-kicker {
      margin-bottom:4px;
      color:var(--site-muted);
      font:500 11px/1 "IBM Plex Mono",monospace;
      text-transform:uppercase;
      letter-spacing:.13em;
    }
    .earth-tabs {
      display:flex;
      align-items:center;
      gap:4px;
    }
    .earth-tabs a {
      min-height:38px;
      display:inline-flex;
      align-items:center;
      padding:0 13px;
      border:1px solid transparent;
      border-radius:4px;
      color:var(--site-muted);
      font:600 13px/1 "Barlow Condensed",sans-serif;
      letter-spacing:.07em;
      text-decoration:none;
      text-transform:uppercase;
    }
    .earth-tabs a:hover { border-color:var(--site-hair); background:var(--site-panel); }
    .earth-tabs a[aria-current="page"] {
      background:var(--site-ink);
      color:var(--site-paper);
    }
    .visualization {
      margin-top:14px;
      min-height:650px;
      background:
        radial-gradient(circle at 18% 12%,rgba(255,255,255,.55),transparent 55%),
        radial-gradient(circle at 82% 88%,rgba(120,100,70,.10),transparent 60%),
        var(--paper);
      border:1px solid var(--ink);
      color:var(--ink);
      display:flex;
      flex-direction:column;
      overflow:hidden;
    }
    .viz-head {
      min-height:60px;
      padding:10px 14px 8px;
      border-bottom:1px solid var(--ink);
      display:flex;
      justify-content:space-between;
      align-items:flex-end;
      gap:12px;
      flex-wrap:wrap;
    }
    .viz-title {
      font:700 clamp(20px,3.2vw,29px)/1 "Barlow Condensed",sans-serif;
      letter-spacing:.18em;
      text-transform:uppercase;
    }
    .viz-subtitle {
      color:var(--ink-soft);
      font:italic 400 11px/1.5 "Libre Baskerville",Georgia,serif;
      margin-top:3px;
    }
    .viz-sheet-note {
      color:var(--ink-soft);
      font:400 9px/1.5 "Barlow Condensed",sans-serif;
      letter-spacing:.12em;
      text-align:right;
      text-transform:uppercase;
    }
    .terrain-stage {
      position:relative;
      height:clamp(340px,56dvh,650px);
      min-height:340px;
      overflow:hidden;
      background:var(--paper);
    }
    #terrainMount,
    #terrainLabels {
      position:absolute;
      inset:0;
    }
    #terrainMount canvas {
      display:block;
      width:100%;
      height:100%;
      cursor:grab;
      touch-action:none;
    }
    #terrainMount canvas.dragging { cursor:grabbing; }
    #terrainLabels { overflow:hidden; pointer-events:none; }
    .terrain-label {
      position:absolute;
      top:0;
      left:0;
      text-align:center;
      white-space:nowrap;
      transition:opacity .2s;
      will-change:transform;
    }
    .terrain-label-name {
      color:var(--ink);
      font:700 9.5px/1.1 "Barlow Condensed",sans-serif;
      letter-spacing:.1em;
      text-shadow:0 0 4px var(--paper),0 0 8px var(--paper);
      text-transform:uppercase;
    }
    .terrain-label-elev {
      color:var(--ink-soft);
      font:400 9px/1.2 "IBM Plex Mono",monospace;
      text-shadow:0 0 4px var(--paper);
    }
    .terrain-label-stem {
      width:1px;
      height:9px;
      margin:1px auto 0;
      background:var(--ink);
    }
    .readout {
      position:absolute;
      top:10px;
      left:10px;
      z-index:3;
      max-width:min(590px,calc(100% - 20px));
      padding:8px 11px 9px;
      border:1px solid var(--ink);
      background:rgba(237,231,216,.92);
      backdrop-filter:blur(3px);
    }
    .readout-place {
      color:var(--oxblood);
      font:700 10px/1.2 "Barlow Condensed",sans-serif;
      letter-spacing:.16em;
      text-transform:uppercase;
    }
    .readout-stats {
      display:flex;
      gap:17px;
      margin-top:6px;
      flex-wrap:wrap;
    }
    .stat-label {
      color:var(--ink-soft);
      font:500 9px/1.1 "Barlow Condensed",sans-serif;
      letter-spacing:.14em;
      text-transform:uppercase;
      white-space:nowrap;
    }
    .stat-value {
      color:var(--ink);
      font:600 17px/1.25 "IBM Plex Mono",monospace;
      white-space:nowrap;
    }
    .stat-unit {
      margin-left:3px;
      color:var(--ink-soft);
      font:400 10px/1 "Barlow Condensed",sans-serif;
    }
    .loading {
      position:absolute;
      inset:0;
      z-index:4;
      display:grid;
      place-items:center;
      color:var(--ink-soft);
      background:var(--paper);
      font:500 11px/1 "Barlow Condensed",sans-serif;
      letter-spacing:.2em;
      text-transform:uppercase;
      transition:opacity .25s;
    }
    .loading.hidden { opacity:0; pointer-events:none; }
    .loading.error {
      padding:24px;
      color:var(--oxblood);
      opacity:1;
      text-align:center;
      letter-spacing:.08em;
    }
    .profile-strip {
      padding:8px 10px 4px;
      border-top:1px solid var(--ink);
      background:var(--paper-deep);
    }
    .profile-head {
      display:flex;
      justify-content:space-between;
      gap:12px;
      margin-bottom:4px;
      color:var(--ink-soft);
      font:500 8.5px/1 "Barlow Condensed",sans-serif;
      letter-spacing:.16em;
      text-transform:uppercase;
    }
    #profile {
      width:100%;
      height:118px;
      display:block;
      cursor:ew-resize;
      touch-action:none;
    }
    .profile-foot {
      display:flex;
      justify-content:space-between;
      gap:10px;
      padding:0 1px 2px;
      color:var(--ink-soft);
      font:400 8.5px/1.2 "IBM Plex Mono",monospace;
    }
    .book-note {
      font:italic 400 9px/1.2 "Libre Baskerville",Georgia,serif;
      text-align:center;
    }
    .viz-controls {
      display:flex;
      align-items:center;
      gap:8px;
      padding:8px 10px;
      border-top:1px solid var(--ink);
      flex-wrap:wrap;
    }
    .viz-button {
      min-height:34px;
      padding:7px 13px;
      border:1px solid var(--ink);
      background:transparent;
      color:var(--ink);
      cursor:pointer;
      font:600 10px/1 "Barlow Condensed",sans-serif;
      letter-spacing:.14em;
      text-transform:uppercase;
    }
    .viz-button.primary {
      padding-inline:16px;
      border-color:var(--oxblood);
      background:var(--oxblood);
      color:var(--paper);
    }
    .viz-button[aria-pressed="true"] {
      border-color:var(--ink);
      background:var(--ink);
      color:var(--paper);
    }
    .relief-control {
      display:flex;
      align-items:center;
      gap:7px;
      margin-left:auto;
      color:var(--ink-soft);
      font:500 9px/1 "Barlow Condensed",sans-serif;
      letter-spacing:.14em;
      text-transform:uppercase;
    }
    .relief-control input {
      width:104px;
      accent-color:var(--oxblood);
    }
    .viz-disclosure {
      display:flex;
      justify-content:space-between;
      gap:16px;
      padding:7px 10px 8px;
      border-top:1px solid rgba(43,39,33,.35);
      color:var(--ink-soft);
      font:400 9px/1.45 "IBM Plex Mono",monospace;
    }
    .viz-disclosure strong { color:var(--ink); font-weight:500; }
    @media (max-width:720px) {
      .site-shell { padding:12px 10px 22px; }
      .site-head { align-items:flex-start; flex-direction:column; gap:10px; }
      .site-brand { font-size:30px; }
      .earth-tabs { width:100%; }
      .earth-tabs a { flex:1; justify-content:center; }
      .visualization { margin-top:10px; min-height:0; }
      .viz-head { align-items:flex-start; }
      .viz-sheet-note { width:100%; text-align:left; }
      .terrain-stage { height:430px; min-height:430px; }
      .readout { top:8px; left:8px; max-width:calc(100% - 16px); }
      .readout-stats { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:8px; }
      .stat-value { font-size:14px; }
      .profile-head { align-items:flex-start; flex-direction:column; gap:4px; }
      #profile { height:104px; }
      .profile-foot .book-note { display:none; }
      .relief-control { width:100%; margin-left:0; justify-content:space-between; }
      .relief-control input { flex:1; max-width:190px; }
      .viz-disclosure { flex-direction:column; gap:4px; }
    }
    @media (max-width:410px) {
      .viz-title { font-size:19px; letter-spacing:.13em; }
      .terrain-stage { height:390px; min-height:390px; }
      .readout-stats { grid-template-columns:repeat(2,minmax(0,1fr)); }
      .terrain-label-name { font-size:8.5px; }
      .viz-button { flex:1; padding-inline:7px; }
    }
    @media (prefers-reduced-motion:reduce) {
      .terrain-label,
      .loading { transition:none; }
    }
  </style>
</head>
<body>
  <div class="site-shell">
    <header class="site-head">
      <div>
        <div class="site-kicker">Official monitoring + field visualizations</div>
        <a class="site-brand" href="/">Earth Watch</a>
      </div>
      <nav class="earth-tabs" aria-label="Earth Watch views">
        <a href="/">Live conditions</a>
        <a href="/visualizations" aria-current="page">Visualizations</a>
      </nav>
    </header>

    <main class="visualization" id="barkleyVisualization">
      <header class="viz-head">
        <div>
          <div class="viz-title">Frozen Head Quadrangle</div>
          <div class="viz-subtitle">Morgan County, Tennessee - the Barkley loop, reconstructed</div>
        </div>
        <div class="viz-sheet-note">
          Contour interval 100 ft<br>
          Vertical exaggeration <span id="reliefHeader">x2.5</span>
        </div>
      </header>

      <section class="terrain-stage" aria-label="Interactive reconstructed 3D terrain">
        <div id="terrainMount"></div>
        <div id="terrainLabels" aria-hidden="true"></div>
        <div class="readout" aria-live="polite">
          <div class="readout-place" id="currentPlace">Yellow Gate</div>
          <div class="readout-stats">
            <div><div class="stat-label">Elevation</div><div class="stat-value"><span id="currentElevation">1,350</span><span class="stat-unit">ft</span></div></div>
            <div><div class="stat-label">Distance</div><div class="stat-value"><span id="currentDistance">0.0</span><span class="stat-unit">mi</span></div></div>
            <div><div class="stat-label">Grade</div><div class="stat-value"><span id="currentGrade">+0</span><span class="stat-unit">%</span></div></div>
            <div><div class="stat-label">Gain</div><div class="stat-value"><span id="currentGain">0</span><span class="stat-unit">ft</span></div></div>
          </div>
        </div>
        <div class="loading" id="terrainStatus">Plotting contours...</div>
      </section>

      <section class="profile-strip" aria-label="Elevation profile">
        <div class="profile-head">
          <span>Profile - drag to scrub</span>
          <span><span id="loopGain">0</span> ft gain - <span id="fiveLoopGain">0</span> ft over five loops</span>
        </div>
        <svg id="profile" viewBox="0 0 1000 132" preserveAspectRatio="none" role="img" aria-label="Elevation profile for the reconstructed loop">
          <defs><clipPath id="doneClip"><rect id="doneRect" x="0" y="0" width="0" height="132"></rect></clipPath></defs>
          <g id="profileGrid"></g>
          <path id="profileArea" fill="#B9CDA0" opacity=".5"></path>
          <g clip-path="url(#doneClip)"><path id="profileDoneArea" fill="#8C1C1C" opacity=".2"></path></g>
          <path id="profileLine" fill="none" stroke="#A0703E" stroke-width="1.2"></path>
          <g clip-path="url(#doneClip)"><path id="profileDoneLine" fill="none" stroke="#8C1C1C" stroke-width="2.2"></path></g>
          <g id="profileBooks"></g>
          <line id="profileCursor" x1="0" y1="0" x2="0" y2="132" stroke="#8C1C1C" stroke-width="1.4"></line>
        </svg>
        <div class="profile-foot">
          <span>0 mi</span>
          <span class="book-note">Book marker - page torn to match bib number</span>
          <span>26.2 mi</span>
        </div>
      </section>

      <section class="viz-controls" aria-label="Visualization controls">
        <button class="viz-button primary" id="playButton" type="button">Run the loop</button>
        <button class="viz-button" id="resetButton" type="button">Yellow Gate</button>
        <button class="viz-button" id="cameraButton" type="button" aria-pressed="false">Free look</button>
        <label class="relief-control" for="reliefRange">
          <span>Relief <span id="reliefValue">x2.5</span></span>
          <input id="reliefRange" type="range" min="1" max="4" step=".1" value="2.5">
        </label>
      </section>

      <footer class="viz-disclosure">
        <span><strong>Interpretive reconstruction.</strong> The course is unpublished and GPS use is prohibited; the connecting route is approximate.</span>
        <span>Named landmarks and published elevations provide context only. This view is not an official course map and is not used by the alert engine.</span>
      </footer>
    </main>
  </div>

  <script id="terrainVertexShader" type="x-shader/x-vertex">
    attribute float aElev;
    varying float vElev;
    varying vec3 vNrm;
    void main() {
      vElev = aElev;
      vNrm = normalize(normalMatrix * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  </script>
  <script id="terrainFragmentShader" type="x-shader/x-fragment">
    precision highp float;
    varying float vElev;
    varying vec3 vNrm;
    void main() {
      vec3 low = vec3(0.694, 0.780, 0.588);
      vec3 mid = vec3(0.859, 0.796, 0.627);
      vec3 high = vec3(0.945, 0.918, 0.839);
      float t = clamp((vElev - 1050.0) / 2350.0, 0.0, 1.0);
      vec3 col = t < 0.5 ? mix(low, mid, t * 2.0) : mix(mid, high, (t - 0.5) * 2.0);
      vec3 n = normalize(vNrm);
      float d = max(dot(n, normalize(vec3(-0.55, 0.78, 0.32))), 0.0);
      col *= 0.60 + 0.44 * d;
      float e = vElev / 100.0;
      float g = abs(fract(e - 0.5) - 0.5) / max(fwidth(e), 0.00001);
      float minorLine = 1.0 - min(g, 1.0);
      float e5 = vElev / 500.0;
      float g5 = abs(fract(e5 - 0.5) - 0.5) / max(fwidth(e5), 0.00001);
      float indexLine = 1.0 - min(g5, 1.0);
      col = mix(col, vec3(0.627, 0.439, 0.243), minorLine * 0.42);
      col = mix(col, vec3(0.486, 0.322, 0.153), indexLine * 0.80);
      gl_FragColor = vec4(col, 1.0);
    }
  </script>
  <script type="module">
    import * as THREE from "/assets/three-0.180.0/three.module.js";

    const PAPER = "#EDE7D8";
    const INK = "#2B2721";
    const INK_SOFT = "#6B6153";
    const OXBLOOD = "#8C1C1C";
    const MAP_HALF = 1.15;
    const UNITS_PER_FT = 1 / 13774;
    const SAMPLES = 640;
    const TOTAL_MI = 26.2;
    const TUBULAR = 620;
    const RADIAL = 6;
    const WAYPOINTS = [
      [0.0,1350,0.35,0.85,"Yellow Gate",true,true],
      [0.6,1620,0.28,0.72,"Cumberland Trail",false,false],
      [2.2,3000,0.1,0.45,"Bird Mountain",true,true],
      [3.0,2500,0.02,0.3,"Switchbacks",false,false],
      [3.6,1700,0.05,0.12,"Phillips Creek",false,false],
      [4.5,2600,0.18,-0.02,"Jury Ridge",true,false],
      [5.1,2150,0.3,-0.12,"Saddle",false,false],
      [6.0,3100,0.42,-0.25,"Bald Knob",true,true],
      [6.6,2700,0.52,-0.36,"Son of a Bitch Ditch",false,false],
      [7.2,2900,0.62,-0.48,"Garden Spot",true,true],
      [7.9,2350,0.52,-0.62,"Stallion Saddle",false,false],
      [8.7,2800,0.38,-0.7,"Stallion Mountain",false,false],
      [9.6,1950,0.2,-0.78,"Raw Dog Falls",false,false],
      [10.4,2700,0.02,-0.72,"Fyke's Peak",true,true],
      [11.3,1500,-0.16,-0.62,"Pighead Creek",false,false],
      [12.1,1100,-0.34,-0.5,"New River",true,true],
      [13.3,2300,-0.52,-0.34,"Testicle Spectacle",false,true],
      [13.9,1950,-0.62,-0.22,"Danger Dave's",false,false],
      [14.5,2350,-0.7,-0.1,"Meth Lab Hill",false,false],
      [15.4,1600,-0.82,0.06,"Brushy Mountain Prison",true,true],
      [16.5,3324,-0.55,0.16,"Rat Jaw - Fire Tower",true,true],
      [17.2,2600,-0.42,0.26,"Hiram's Vertical Smile",false,false],
      [17.9,1750,-0.32,0.36,"Zip Line",false,false],
      [18.7,2450,-0.42,0.48,"Little Hell",false,false],
      [19.4,2050,-0.3,0.56,"Bobcat Rock",false,false],
      [20.6,2900,-0.14,0.46,"Indian Knob",true,true],
      [21.4,2300,-0.04,0.56,"The Bad Thing",false,false],
      [23.0,3100,0.1,0.62,"Big Hell - Chimney Top",true,true],
      [24.3,2100,0.22,0.74,"Quitter's Road",false,false],
      [26.2,1350,0.35,0.85,"Yellow Gate",false,false]
    ];

    const state = {
      progress:0,
      playing:false,
      follow:false,
      exagg:2.5,
      dragging:false,
      scrub:false,
      cameraAdjusted:false,
      lastX:0,
      lastY:0,
      pinchDistance:0
    };
    const mount = document.getElementById("terrainMount");
    const labelsMount = document.getElementById("terrainLabels");
    const status = document.getElementById("terrainStatus");
    const playButton = document.getElementById("playButton");
    const cameraButton = document.getElementById("cameraButton");
    const reliefRange = document.getElementById("reliefRange");
    const profileSvg = document.getElementById("profile");

    function makeNoise(seed) {
      const p = new Uint8Array(512);
      let s = seed;
      function rnd() {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
      }
      const perm = Array.from({length:256},function(_,i){ return i; });
      for (let i=255;i>0;i--) {
        const j = Math.floor(rnd() * (i + 1));
        const temp = perm[i];
        perm[i] = perm[j];
        perm[j] = temp;
      }
      for (let i=0;i<512;i++) p[i] = perm[i & 255];
      function fade(t) { return t*t*t*(t*(t*6-15)+10); }
      function lerp(a,b,t) { return a+(b-a)*t; }
      function grad(h,x,y) {
        const u = h & 1 ? x : y;
        const v = h & 2 ? x : y;
        return (h & 4 ? -u : u) + (h & 8 ? -v : v);
      }
      return function(x,y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;
        x -= Math.floor(x);
        y -= Math.floor(y);
        const u = fade(x);
        const v = fade(y);
        const A = p[X] + Y;
        const B = p[X + 1] + Y;
        return lerp(
          lerp(grad(p[A],x,y),grad(p[B],x-1,y),u),
          lerp(grad(p[A+1],x,y-1),grad(p[B+1],x-1,y-1),u),
          v
        );
      };
    }

    const planCurve = new THREE.CatmullRomCurve3(
      WAYPOINTS.map(function(w){ return new THREE.Vector3(w[2],0,w[3]); }),
      true,
      "catmullrom",
      0.4
    );
    const routeNoise = makeNoise(20260325);
    const routePoints = [];
    let planLength = 0;
    for (let i=0;i<=SAMPLES;i++) {
      const t = i / SAMPLES;
      const point = planCurve.getPoint(t % 1);
      const mile = t * TOTAL_MI;
      let k = 0;
      while (k < WAYPOINTS.length - 2 && WAYPOINTS[k + 1][0] < mile) k++;
      const a = WAYPOINTS[k];
      const b = WAYPOINTS[k + 1];
      const local = Math.min(1,Math.max(0,(mile-a[0])/(b[0]-a[0])));
      const smooth = local*local*(3-2*local);
      let elev = a[1] + (b[1]-a[1])*smooth;
      elev += routeNoise(mile*3.1,11.7)*55 + routeNoise(mile*9.3,4.2)*22;
      routePoints.push({x:point.x,z:point.z,elev:elev,mile:mile,t:t});
      if (i > 0) {
        const previous = routePoints[i-1];
        planLength += Math.hypot(point.x-previous.x,point.z-previous.z);
      }
    }
    const gainAt = new Float32Array(routePoints.length);
    let routeGain = 0;
    let routeLoss = 0;
    for (let i=1;i<routePoints.length;i++) {
      const delta = routePoints[i].elev-routePoints[i-1].elev;
      if (delta > 0) routeGain += delta;
      else routeLoss -= delta;
      gainAt[i] = routeGain;
    }
    routeGain = Math.round(routeGain);
    routeLoss = Math.round(routeLoss);
    const elevations = routePoints.map(function(p){ return p.elev; });
    const minElevation = Math.min.apply(null,elevations);
    const maxElevation = Math.max.apply(null,elevations);

    function sampleAt(t) {
      const value = Math.min(.999999,Math.max(0,t))*SAMPLES;
      const i = Math.floor(value);
      const fraction = value-i;
      const a = routePoints[i];
      const b = routePoints[Math.min(SAMPLES,i+1)];
      return {
        x:a.x+(b.x-a.x)*fraction,
        z:a.z+(b.z-a.z)*fraction,
        elev:a.elev+(b.elev-a.elev)*fraction,
        mile:a.mile+(b.mile-a.mile)*fraction
      };
    }
    function gradeAt(t) {
      const width = .006;
      const a = sampleAt(Math.max(0,t-width));
      const b = sampleAt(Math.min(1,t+width));
      return ((b.elev-a.elev)/Math.max(1,(b.mile-a.mile)*5280))*100;
    }
    function nearestWaypoint(mile) {
      let best = WAYPOINTS[0];
      let distance = Infinity;
      WAYPOINTS.forEach(function(w) {
        const nextDistance = Math.abs(w[0]-mile);
        if (nextDistance < distance) {
          distance = nextDistance;
          best = w;
        }
      });
      return best;
    }
    function formatInteger(value) {
      return Math.round(value).toLocaleString("en-US");
    }

    const terrainNoise = makeNoise(778811);
    const terrainN = 161;
    const terrainHeights = new Float32Array(terrainN*terrainN);
    const routeReference = routePoints.filter(function(_,i){ return i%3===0; });
    function fbm(x,y) {
      let value=0,amplitude=1,frequency=1;
      for (let octave=0;octave<5;octave++) {
        value += amplitude*terrainNoise(x*frequency,y*frequency);
        frequency *= 2.07;
        amplitude *= .5;
      }
      return value;
    }
    function ridged(x,y) {
      let value=0,amplitude=1,frequency=1;
      for (let octave=0;octave<4;octave++) {
        value += amplitude*(1-Math.abs(terrainNoise(x*frequency,y*frequency)));
        frequency *= 2.13;
        amplitude *= .5;
      }
      return value/1.9;
    }
    for (let j=0;j<terrainN;j++) {
      const z = -MAP_HALF+(2*MAP_HALF*j)/(terrainN-1);
      for (let i=0;i<terrainN;i++) {
        const x = -MAP_HALF+(2*MAP_HALF*i)/(terrainN-1);
        let weightSum=0,elevationSum=0,distanceMin=Infinity;
        for (let k=0;k<routeReference.length;k++) {
          const dx=x-routeReference[k].x;
          const dz=z-routeReference[k].z;
          const distanceSquared=dx*dx+dz*dz;
          if (distanceSquared<distanceMin) distanceMin=distanceSquared;
          const weight=1/(distanceSquared*distanceSquared+.000001);
          weightSum+=weight;
          elevationSum+=weight*routeReference[k].elev;
        }
        const interpolated=elevationSum/weightSum;
        const distance=Math.sqrt(distanceMin);
        const influence=Math.exp(-(distance*distance)/.012);
        const regional=1750+ridged(x*3.4,z*3.4)*1150+fbm(x*2.1,z*2.1)*260;
        let height=interpolated*influence+regional*(1-influence);
        height+=fbm(x*7.5,z*7.5)*105*(1-influence*.72);
        terrainHeights[j*terrainN+i]=height;
      }
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45,1,.01,60);
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:"high-performance"});
    } catch (error) {
      status.textContent = "WebGL is unavailable in this browser. The elevation profile remains usable.";
      status.classList.add("error");
      throw error;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setClearColor(new THREE.Color(PAPER),1);
    renderer.domElement.setAttribute("role","img");
    renderer.domElement.setAttribute("aria-label","Interactive 3D reconstructed terrain of a Barkley Marathons loop");
    mount.appendChild(renderer.domElement);

    const world = new THREE.Group();
    world.scale.y = state.exagg;
    scene.add(world);

    const positions = new Float32Array(terrainN*terrainN*3);
    const elevationAttribute = new Float32Array(terrainN*terrainN);
    for (let j=0;j<terrainN;j++) {
      for (let i=0;i<terrainN;i++) {
        const index=j*terrainN+i;
        positions[index*3]=-MAP_HALF+(2*MAP_HALF*i)/(terrainN-1);
        positions[index*3+1]=terrainHeights[index]*UNITS_PER_FT;
        positions[index*3+2]=-MAP_HALF+(2*MAP_HALF*j)/(terrainN-1);
        elevationAttribute[index]=terrainHeights[index];
      }
    }
    const terrainIndices=[];
    for (let j=0;j<terrainN-1;j++) {
      for (let i=0;i<terrainN-1;i++) {
        const a=j*terrainN+i;
        const b=a+1;
        const c=a+terrainN;
        const d=c+1;
        terrainIndices.push(a,c,b,b,c,d);
      }
    }
    const terrainGeometry=new THREE.BufferGeometry();
    terrainGeometry.setAttribute("position",new THREE.BufferAttribute(positions,3));
    terrainGeometry.setAttribute("aElev",new THREE.BufferAttribute(elevationAttribute,1));
    terrainGeometry.setIndex(terrainIndices);
    terrainGeometry.computeVertexNormals();
    const terrainMaterial=new THREE.ShaderMaterial({
      vertexShader:document.getElementById("terrainVertexShader").textContent,
      fragmentShader:document.getElementById("terrainFragmentShader").textContent
    });
    world.add(new THREE.Mesh(terrainGeometry,terrainMaterial));

    const routeVectors=routePoints.map(function(p){
      return new THREE.Vector3(p.x,p.elev*UNITS_PER_FT+.006,p.z);
    });
    const routeCurve=new THREE.CatmullRomCurve3(routeVectors,true,"catmullrom",.2);
    const ghostGeometry=new THREE.TubeGeometry(routeCurve,TUBULAR,.0042,RADIAL,true);
    world.add(new THREE.Mesh(
      ghostGeometry,
      new THREE.MeshBasicMaterial({color:new THREE.Color("#B99A88")})
    ));
    const runGeometry=new THREE.TubeGeometry(routeCurve,TUBULAR,.0062,RADIAL,true);
    runGeometry.setDrawRange(0,0);
    world.add(new THREE.Mesh(
      runGeometry,
      new THREE.MeshBasicMaterial({color:new THREE.Color(OXBLOOD)})
    ));

    const bookGroup=new THREE.Group();
    WAYPOINTS.forEach(function(w) {
      if (!w[5]) return;
      const y=w[1]*UNITS_PER_FT;
      const staff=new THREE.Mesh(
        new THREE.CylinderGeometry(.0016,.0016,.035,5),
        new THREE.MeshBasicMaterial({color:new THREE.Color(INK)})
      );
      staff.position.set(w[2],y+.0175,w[3]);
      const edge=new THREE.Mesh(
        new THREE.PlaneGeometry(.03,.023),
        new THREE.MeshBasicMaterial({color:new THREE.Color(INK),side:THREE.DoubleSide})
      );
      edge.position.set(w[2]+.013,y+.032,w[3]);
      const flag=new THREE.Mesh(
        new THREE.PlaneGeometry(.026,.019),
        new THREE.MeshBasicMaterial({color:new THREE.Color("#FBF7EC"),side:THREE.DoubleSide})
      );
      flag.position.set(w[2]+.013,y+.032,w[3]-.0003);
      bookGroup.add(staff,edge,flag);
    });
    world.add(bookGroup);

    const marker=new THREE.Group();
    const markerHead=new THREE.Mesh(
      new THREE.ConeGeometry(.016,.032,3),
      new THREE.MeshBasicMaterial({color:new THREE.Color(OXBLOOD)})
    );
    markerHead.position.y=.03;
    markerHead.rotation.y=Math.PI/6;
    const markerStem=new THREE.Mesh(
      new THREE.CylinderGeometry(.0012,.0012,.03,4),
      new THREE.MeshBasicMaterial({color:new THREE.Color(OXBLOOD)})
    );
    markerStem.position.y=.015;
    marker.add(markerHead,markerStem);
    world.add(marker);

    const neatlineGeometry=new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-MAP_HALF,0,-MAP_HALF),
      new THREE.Vector3(MAP_HALF,0,-MAP_HALF),
      new THREE.Vector3(MAP_HALF,0,MAP_HALF),
      new THREE.Vector3(-MAP_HALF,0,MAP_HALF),
      new THREE.Vector3(-MAP_HALF,0,-MAP_HALF)
    ]);
    const neatline=new THREE.Line(
      neatlineGeometry,
      new THREE.LineBasicMaterial({color:new THREE.Color(INK_SOFT)})
    );
    neatline.position.y=1000*UNITS_PER_FT;
    world.add(neatline);

    const majorWaypoints=WAYPOINTS.filter(function(w){ return w[6]; });
    const labelNodes=majorWaypoints.map(function(w) {
      const label=document.createElement("div");
      label.className="terrain-label";
      const name=document.createElement("div");
      name.className="terrain-label-name";
      name.textContent=w[4];
      const elevation=document.createElement("div");
      elevation.className="terrain-label-elev";
      elevation.textContent=formatInteger(w[1])+" ft";
      const stem=document.createElement("div");
      stem.className="terrain-label-stem";
      label.append(name,elevation,stem);
      labelsMount.appendChild(label);
      return label;
    });

    const target=new THREE.Vector3(0,2100*UNITS_PER_FT*state.exagg,0);
    const spherical={r:4.3,theta:.62,phi:.35};
    function applyFreeCamera() {
      camera.position.set(
        target.x+spherical.r*Math.sin(spherical.phi)*Math.sin(spherical.theta),
        target.y+spherical.r*Math.cos(spherical.phi),
        target.z+spherical.r*Math.sin(spherical.phi)*Math.cos(spherical.theta)
      );
      camera.lookAt(target);
    }
    applyFreeCamera();

    const profileLow=Math.floor(minElevation/500)*500;
    const profileHigh=Math.ceil(maxElevation/500)*500;
    const profileHeight=132;
    function profileY(elevation) {
      return (1-(elevation-profileLow)/(profileHigh-profileLow))*(profileHeight-16)+8;
    }
    const profileArea="M 0 "+profileHeight+" "+routePoints.map(function(p){
      return "L "+((p.mile/TOTAL_MI)*1000).toFixed(2)+" "+profileY(p.elev).toFixed(2);
    }).join(" ")+" L 1000 "+profileHeight+" Z";
    const profileLine="M "+routePoints.map(function(p){
      return ((p.mile/TOTAL_MI)*1000).toFixed(2)+" "+profileY(p.elev).toFixed(2);
    }).join(" L ");
    document.getElementById("profileArea").setAttribute("d",profileArea);
    document.getElementById("profileDoneArea").setAttribute("d",profileArea);
    document.getElementById("profileLine").setAttribute("d",profileLine);
    document.getElementById("profileDoneLine").setAttribute("d",profileLine);
    document.getElementById("loopGain").textContent=formatInteger(routeGain);
    document.getElementById("fiveLoopGain").textContent=formatInteger(routeGain*5);
    const svgNamespace="http://www.w3.org/2000/svg";
    const gridGroup=document.getElementById("profileGrid");
    for (let elevation=profileLow;elevation<=profileHigh;elevation+=500) {
      const y=profileY(elevation);
      const line=document.createElementNS(svgNamespace,"line");
      line.setAttribute("x1","0");
      line.setAttribute("y1",String(y));
      line.setAttribute("x2","1000");
      line.setAttribute("y2",String(y));
      line.setAttribute("stroke","#A0703E");
      line.setAttribute("stroke-width",".5");
      line.setAttribute("opacity",".35");
      const text=document.createElementNS(svgNamespace,"text");
      text.setAttribute("x","3");
      text.setAttribute("y",String(y-2));
      text.setAttribute("fill",INK_SOFT);
      text.setAttribute("font-family","IBM Plex Mono, monospace");
      text.setAttribute("font-size","8");
      text.textContent=String(elevation);
      gridGroup.append(line,text);
    }
    const booksGroup=document.getElementById("profileBooks");
    WAYPOINTS.filter(function(w){ return w[5]&&w[0]>0; }).forEach(function(w) {
      const x=(w[0]/TOTAL_MI)*1000;
      const y=profileY(w[1]);
      const rect=document.createElementNS(svgNamespace,"rect");
      rect.setAttribute("x",String(x-2.5));
      rect.setAttribute("y",String(y-9));
      rect.setAttribute("width","5");
      rect.setAttribute("height","6");
      rect.setAttribute("fill",PAPER);
      rect.setAttribute("stroke",INK);
      rect.setAttribute("stroke-width",".7");
      const line=document.createElementNS(svgNamespace,"line");
      line.setAttribute("x1",String(x));
      line.setAttribute("y1",String(y-3));
      line.setAttribute("x2",String(x));
      line.setAttribute("y2",String(y));
      line.setAttribute("stroke",INK);
      line.setAttribute("stroke-width",".7");
      booksGroup.append(rect,line);
    });

    function setFollow(value) {
      state.follow=value;
      cameraButton.setAttribute("aria-pressed",String(value));
      cameraButton.textContent=value?"Chase camera":"Free look";
    }
    function setPlaying(value) {
      state.playing=value;
      playButton.textContent=value?"Pause":state.progress>=.999?"Run again":"Run the loop";
      playButton.classList.toggle("primary",!value);
      playButton.setAttribute("aria-pressed",String(value));
    }
    function updateReadout() {
      const current=sampleAt(state.progress);
      const nearest=nearestWaypoint(current.mile);
      const grade=gradeAt(state.progress);
      const index=Math.min(SAMPLES,Math.floor(state.progress*SAMPLES));
      document.getElementById("currentPlace").textContent=nearest[4];
      document.getElementById("currentElevation").textContent=formatInteger(current.elev);
      document.getElementById("currentDistance").textContent=current.mile.toFixed(1);
      document.getElementById("currentGrade").textContent=(grade>=0?"+":"")+grade.toFixed(0);
      document.getElementById("currentGain").textContent=formatInteger(gainAt[index]);
      document.getElementById("doneRect").setAttribute("width",String(state.progress*1000));
      document.getElementById("profileCursor").setAttribute("x1",String(state.progress*1000));
      document.getElementById("profileCursor").setAttribute("x2",String(state.progress*1000));
      playButton.textContent=state.playing?"Pause":state.progress>=.999?"Run again":"Run the loop";
    }
    function setProgress(value) {
      state.progress=Math.min(1,Math.max(0,value));
      updateReadout();
    }
    playButton.addEventListener("click",function() {
      if (state.progress>=.999) setProgress(0);
      setPlaying(!state.playing);
      setFollow(true);
    });
    document.getElementById("resetButton").addEventListener("click",function() {
      setPlaying(false);
      setProgress(0);
    });
    cameraButton.addEventListener("click",function(){ setFollow(!state.follow); });
    reliefRange.addEventListener("input",function() {
      state.exagg=Number(reliefRange.value);
      world.scale.y=state.exagg;
      document.getElementById("reliefValue").textContent="x"+state.exagg.toFixed(1);
      document.getElementById("reliefHeader").textContent="x"+state.exagg.toFixed(1);
    });

    function scrubTo(clientX) {
      const bounds=profileSvg.getBoundingClientRect();
      setProgress((clientX-bounds.left)/bounds.width);
    }
    profileSvg.addEventListener("pointerdown",function(event) {
      state.scrub=true;
      setPlaying(false);
      setFollow(false);
      scrubTo(event.clientX);
      profileSvg.setPointerCapture(event.pointerId);
    });
    profileSvg.addEventListener("pointermove",function(event) {
      if (state.scrub) scrubTo(event.clientX);
    });
    function endScrub(event) {
      state.scrub=false;
      if (profileSvg.hasPointerCapture(event.pointerId)) profileSvg.releasePointerCapture(event.pointerId);
    }
    profileSvg.addEventListener("pointerup",endScrub);
    profileSvg.addEventListener("pointercancel",endScrub);

    const activePointers=new Map();
    renderer.domElement.addEventListener("pointerdown",function(event) {
      state.cameraAdjusted=true;
      activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      state.dragging=true;
      state.lastX=event.clientX;
      state.lastY=event.clientY;
      renderer.domElement.classList.add("dragging");
      renderer.domElement.setPointerCapture(event.pointerId);
      if (activePointers.size>1) {
        const points=Array.from(activePointers.values());
        state.pinchDistance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
      } else if (state.follow) {
        setFollow(false);
      }
    });
    renderer.domElement.addEventListener("pointermove",function(event) {
      if (!activePointers.has(event.pointerId)) return;
      activePointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
      if (activePointers.size>1) {
        const points=Array.from(activePointers.values());
        const distance=Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y);
        if (state.pinchDistance) spherical.r=Math.min(6.5,Math.max(.55,spherical.r*(state.pinchDistance/distance)));
        state.pinchDistance=distance;
        return;
      }
      spherical.theta-=(event.clientX-state.lastX)*.005;
      spherical.phi=Math.min(1.48,Math.max(.08,spherical.phi-(event.clientY-state.lastY)*.005));
      state.lastX=event.clientX;
      state.lastY=event.clientY;
    });
    function releasePointer(event) {
      activePointers.delete(event.pointerId);
      if (renderer.domElement.hasPointerCapture(event.pointerId)) renderer.domElement.releasePointerCapture(event.pointerId);
      if (!activePointers.size) {
        state.dragging=false;
        state.pinchDistance=0;
        renderer.domElement.classList.remove("dragging");
      }
    }
    renderer.domElement.addEventListener("pointerup",releasePointer);
    renderer.domElement.addEventListener("pointercancel",releasePointer);
    renderer.domElement.addEventListener("wheel",function(event) {
      event.preventDefault();
      state.cameraAdjusted=true;
      setFollow(false);
      spherical.r=Math.min(6.5,Math.max(.55,spherical.r*(1+event.deltaY*.0012)));
    },{passive:false});

    function resize() {
      const width=mount.clientWidth;
      const height=mount.clientHeight;
      if (!width||!height) return;
      if (!state.cameraAdjusted) spherical.r=width/height<1.2?5.2:4.3;
      renderer.setSize(width,height,false);
      camera.aspect=width/height;
      camera.updateProjectionMatrix();
    }
    const resizeObserver=new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const projected=new THREE.Vector3();
    const chasePosition=new THREE.Vector3();
    const chaseLook=new THREE.Vector3();
    let previousTime=performance.now();
    let followInitialized=false;
    let frameCount=0;
    function animate(now) {
      requestAnimationFrame(animate);
      const delta=Math.min(.05,(now-previousTime)/1000);
      previousTime=now;
      if (state.playing) {
        const next=state.progress+delta*.045;
        if (next>=1) {
          setProgress(1);
          setPlaying(false);
        } else {
          setProgress(next);
        }
      }
      const current=sampleAt(state.progress);
      marker.position.set(current.x,current.elev*UNITS_PER_FT,current.z);
      marker.scale.set(1,1/world.scale.y,1);
      runGeometry.setDrawRange(0,Math.floor(state.progress*TUBULAR)*RADIAL*6);
      if (state.follow) {
        const back=sampleAt(Math.max(0,state.progress-.012));
        const ahead=sampleAt(Math.min(1,state.progress+.02));
        chasePosition.set(
          back.x+(back.x-current.x)*3.2,
          back.elev*UNITS_PER_FT*world.scale.y+.16,
          back.z+(back.z-current.z)*3.2
        );
        chaseLook.set(ahead.x,ahead.elev*UNITS_PER_FT*world.scale.y,ahead.z);
        if (!followInitialized) {
          camera.position.copy(chasePosition);
          followInitialized=true;
        }
        camera.position.lerp(chasePosition,.06);
        target.lerp(chaseLook,.08);
        camera.lookAt(target);
      } else {
        followInitialized=false;
        target.y+=(2100*UNITS_PER_FT*world.scale.y-target.y)*.06;
        target.x+=(0-target.x)*.06;
        target.z+=(0-target.z)*.06;
        applyFreeCamera();
      }
      majorWaypoints.forEach(function(w,index) {
        const node=labelNodes[index];
        projected.set(w[2],w[1]*UNITS_PER_FT*world.scale.y,w[3]).project(camera);
        const hidden=projected.z>1||projected.z<-1||projected.x<-1.2||projected.x>1.2||projected.y<-1.2||projected.y>1.2;
        const x=(projected.x*.5+.5)*renderer.domElement.clientWidth;
        const y=(-projected.y*.5+.5)*renderer.domElement.clientHeight;
        node.style.transform="translate(-50%,-100%) translate("+x+"px,"+(y-10)+"px)";
        node.style.opacity=hidden?"0":"1";
      });
      renderer.render(scene,camera);
      frameCount++;
      if (frameCount===2) {
        status.classList.add("hidden");
        document.getElementById("barkleyVisualization").dataset.ready="true";
      }
    }
    updateReadout();
    requestAnimationFrame(animate);
  </script>
  <script>
    window.setTimeout(function() {
      var root=document.getElementById("barkleyVisualization");
      var status=document.getElementById("terrainStatus");
      if (root&&root.dataset.ready!=="true"&&status) {
        status.textContent="The 3D terrain could not start. Reload the page or use a WebGL-capable browser.";
        status.classList.add("error");
      }
    },8000);
  </script>
</body>
</html>`;
}
