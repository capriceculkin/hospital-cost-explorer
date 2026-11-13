// story.js
// Builds the four chapters from one list of hospitals (/api/hospitals).
// Two settings are shared across the whole story: the state picked in the
// dock, and the sideline (unpaid care cutoff) set on the court. Changing
// either one redraws every chapter, so the story stays consistent.

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

const settings = { state: "", thr: 10, mode: "beds", pickedTomato: null, pickedState: null };
let ALL = [];          // every hospital as an object


// Ownership ----
// Type of Control codes from the cost report and the three groups they roll up to.

const CONTROL = {
  1: "Non-profit · church", 2: "Non-profit · other",
  3: "For-profit · individual", 4: "For-profit · corporation", 5: "For-profit · partnership", 6: "For-profit · other",
  7: "Gov · federal", 8: "Gov · city & county", 9: "Gov · county", 10: "Gov · state",
  11: "Gov · hospital district", 12: "Gov · city", 13: "Gov · other",
};
const groupOf = (c) => (c <= 2 ? "Non-profit" : c <= 6 ? "For-profit" : "Government");
const GROUP_CLASS = { "Non-profit": "np", "For-profit": "fp", "Government": "gov" };


// Formatting ----

function money(x, digits = 1) {
  if (x < 0) return "-" + money(-x, digits);
  const a = Math.abs(x);
  if (a >= 1e9) return "$" + (x / 1e9).toFixed(digits) + "B";
  if (a >= 1e6) return "$" + (x / 1e6).toFixed(digits) + "M";
  if (a >= 1e3) return "$" + Math.round(x / 1e3) + "K";
  return "$" + Math.round(x);
}
const commas = (x) => Math.round(x).toLocaleString("en-US");
const pct = (x, d = 0) => x.toFixed(d) + "%";
const titleCase = (s) => (s || "").toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());

function el(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

// small seeded random so tomatoes look the same every time they are drawn
function rng(seed) {
  let s = seed % 2147483647 || 1;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
function hash(str) { let h = 7; for (const ch of str) h = (h * 31 + ch.charCodeAt(0)) % 2147483647; return h; }

function countUp(node, to, fmt, ms = 900) {
  const start = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - start) / ms);
    node.textContent = fmt(to * (1 - Math.pow(1 - k, 3)));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}


// Measures (these mirror backend/analyses.py) ----

const inState = () => (settings.state ? ALL.filter((h) => h.state === settings.state) : ALL);
const finite = (x) => x !== null && Number.isFinite(x);

// average unpaid care per hospital by Type of Control; missing unpaid care counts as 0
function receiptLines(rows, mode) {
  const groups = {};
  for (const h of rows) {
    const u = h.uncomp ?? 0;
    let v;
    if (mode === "beds") v = h.beds ? u / h.beds : null;
    else if (mode === "revenue") v = h.revenue ? (u / h.revenue) * 100 : null;
    else v = u;
    if (!finite(v)) continue;
    (groups[h.control] ||= []).push(v);
  }
  return Object.entries(groups)
    .map(([c, vals]) => ({ control: +c, value: vals.reduce((a, b) => a + b, 0) / vals.length, n: vals.length }))
    .sort((a, b) => b.value - a.value);
}

// burden and margin for every hospital that has the numbers
function courtPoints(rows) {
  const out = [];
  for (const h of rows) {
    if (h.uncomp === null || h.revenue === null || h.net_income === null || !h.name) continue;
    const burden = (h.uncomp / h.revenue) * 100;
    const margin = (h.net_income / h.revenue) * 100;
    if (finite(burden) && finite(margin)) out.push({ ...h, burden, margin });
  }
  return out;
}
const isOut = (p) => p.burden > settings.thr && p.margin < 0;


// Chapter 1: the bill ----

function drawBill(animateTotal) {
  const rows = inState();
  const total = rows.reduce((s, h) => s + (h.uncomp ?? 0), 0);
  const where = settings.state ? `hospitals in ${settings.state}` : "U.S. hospitals";
  document.querySelector(".bill .where").textContent = where;
  $("b-n").textContent = commas(rows.length);
  if (animateTotal) countUp($("b-total"), total, (v) => money(v)); else $("b-total").textContent = money(total);

  const lines = receiptLines(rows, settings.mode);
  const fmt = settings.mode === "revenue" ? (v) => pct(v, 2) : (v) => "$" + commas(v);
  const max = Math.max(...lines.map((l) => l.value), 1);
  const label = { beds: "average per bed", revenue: "% of patient revenue", none: "average per hospital" }[settings.mode];
  $("r-sub").innerHTML = `${commas(rows.length)} hospitals · FY2022<br>${label}, by owner`;
  $("r-total").textContent = money(total);
  $("r-lines").innerHTML = lines.map((l, i) => {
    const g = groupOf(l.control);
    return `<li class="${GROUP_CLASS[g]}" style="animation-delay:${i * 60}ms" title="${l.n} hospitals">
      <div class="row"><span>${CONTROL[l.control]}</span><i></i><b>${fmt(l.value)}</b></div>
      <div class="bar" style="width:${(100 * l.value) / max}%;animation-delay:${i * 60 + 120}ms"></div></li>`;
  }).join("");
  if (!document.querySelector(".r-legend")) {
    $("receipt").querySelector(".r-total").insertAdjacentHTML("beforebegin",
      `<div class="r-legend"><span><i style="background:#1E4632"></i>Gov</span><span><i style="background:#6E8F62"></i>Non-profit</span><span><i style="background:#B98B3E"></i>For-profit</span></div>`);
  }

  // one line that says what the receipt shows
  const top = lines[0];
  $("b-insight").textContent = top ? `Top of the bill: ${CONTROL[top.control].toLowerCase()} hospitals, at ${fmt(top.value)}.` : "";
}


// Chapter 2: the court ----
// x uses a square-root scale so the long tail of unpaid care fits;
// margins are clipped to -60% and +40% so a few extreme hospitals stay on court.

const X_MAX = 50, Y_TOP = 40, Y_BOT = -60;

function drawCourt() {
  const svg = $("court");
  const W = svg.clientWidth || 1200, H = svg.clientHeight || 620;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  const L = 8, R = W - 8, T = 8, B = H - 8;
  const X = (b) => L + (R - L) * Math.sqrt(Math.max(0, Math.min(b, X_MAX)) / X_MAX);
  const Y = (m) => T + (B - T) * (Y_TOP - Math.max(Y_BOT, Math.min(Y_TOP, m))) / (Y_TOP - Y_BOT);

  const pts = courtPoints(inState());
  const out = pts.filter(isOut);
  $("court-n").textContent = commas(pts.length);
  $("out-n").textContent = commas(out.length);
  $("c-out").textContent = commas(courtPoints(ALL).filter((p) => p.burden > 10 && p.margin < 0).length);

  const sx = X(settings.thr), sy = Y(0);
  el("rect", { x: sx, y: sy, width: R - sx, height: B - sy, fill: "#234C9F" }, svg);           // the out zone

  // big word in the empty upper right, sized to fit
  const size = Math.max(28, Math.min(64, (R - sx) * 0.16));
  const word = el("text", { x: R - 12, y: T + size, class: "out-word", "text-anchor": "end", style: `font-size:${size}px` }, svg);
  word.textContent = `${commas(out.length)} OUT`;

  const g = el("g", {}, svg);
  for (const p of pts) if (!isOut(p)) el("circle", { cx: X(p.burden), cy: Y(p.margin), r: 2.8, class: "dot" }, g);

  // the lines: break-even and the sideline
  el("line", { x1: L, x2: R, y1: sy, y2: sy, stroke: "#F2EFD2", "stroke-width": 10 }, svg);
  el("line", { x1: sx, x2: sx, y1: T, y2: B, stroke: "#F2EFD2", "stroke-width": 10 }, svg);
  const lab1 = el("text", { x: L + 4, y: sy - 14, class: "lbl" }, svg); lab1.textContent = "↑ MAKING MONEY";
  const lab2 = el("text", { x: L + 4, y: sy + 28, class: "lbl" }, svg); lab2.textContent = "↓ LOSING MONEY";
  const lab3 = el("text", { x: R - 12, y: T + size + 30, class: "lbl", "text-anchor": "end" }, svg);
  lab3.textContent = W < 700 ? `SIDELINE ${settings.thr}% →` : `SIDELINE: ${settings.thr}% OF REVENUE IN UNPAID CARE`;

  // the out hospitals as tennis balls
  const tip = $("court-tip");
  for (const p of out) {
    const cx = X(p.burden), cy = Y(p.margin);
    const ball = el("g", { class: "ball", tabindex: 0 }, svg);
    el("ellipse", { cx: cx + 5, cy: cy + 9, rx: 10, ry: 4.5, fill: "#0b1f55", opacity: .35 }, ball);
    el("circle", { cx, cy, r: 9.5, class: "b" }, ball);
    el("path", { d: `M${cx - 7},${cy - 5} q7,6 14,0`, stroke: "#F7F9E2", "stroke-width": 1.6, fill: "none" }, ball);
    const show = () => {
      tip.hidden = false;
      tip.innerHTML = `<b>${titleCase(p.name)}</b>${titleCase(p.city)}, ${p.state} · ${groupOf(p.control)}<br>${pct(p.burden, 1)} of revenue in unpaid care<br>${pct(p.margin, 1)} margin${p.margin < Y_BOT ? " (off the court)" : ""}`;
      const box = svg.getBoundingClientRect();
      const left = Math.min(cx + 18, box.width - 300);
      tip.style.left = left + "px"; tip.style.top = Math.max(0, cy - 30) + "px";
    };
    ball.addEventListener("mouseenter", show); ball.addEventListener("focus", show);
    ball.addEventListener("mouseleave", () => (tip.hidden = true)); ball.addEventListener("blur", () => (tip.hidden = true));
    ball.addEventListener("click", () => { settings.pickedTomato = p.name; drawRed(); $("ch3").scrollIntoView(); });
  }

  // drag the sideline directly on the court
  const handle = el("rect", { x: sx - 14, y: T, width: 28, height: B - T, fill: "transparent", class: "handle" }, svg);
  handle.addEventListener("pointerdown", (e) => {
    handle.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const box = svg.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (ev.clientX - box.left - L) / (R - L)));
      setThreshold(Math.round(Math.max(5, Math.min(25, frac * frac * X_MAX))));
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", () => handle.removeEventListener("pointermove", move), { once: true });
  });
}

function setThreshold(v) {
  if (v === settings.thr) return;
  settings.thr = v;
  $("thr").value = v;
  $("thr-label").textContent = v + "%";
  document.querySelectorAll(".thr-echo").forEach((n) => (n.textContent = v + "%"));
  drawCourt(); drawRed();
}


// Chapter 3: in the red ----
// One hand-drawn tomato per out-of-bounds hospital, in three baskets by owner.

function tomatoShape(parent, cx, cy, r, seed) {
  const rand = rng(seed);
  const g = el("g", { class: "tomato" }, parent);
  // lumpy outline
  const n = 14, pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rr = r * (0.88 + rand() * 0.2) * (1 + 0.06 * Math.cos(a * 2));
    pts.push([cx + Math.cos(a) * rr * 1.08, cy + Math.sin(a) * rr * 0.94]);
  }
  let d = `M${(pts[0][0] + pts[n - 1][0]) / 2},${(pts[0][1] + pts[n - 1][1]) / 2}`;
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n];
    d += ` Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${((p[0] + q[0]) / 2).toFixed(1)},${((p[1] + q[1]) / 2).toFixed(1)}`;
  }
  el("path", { d, fill: "#C8322A", class: "skin", filter: "url(#rough)" }, g);
  // crayon scribble inside
  for (let k = 0; k < Math.max(3, r / 5); k++) {
    const y0 = cy - r * 0.6 + rand() * r * 1.2, x0 = cx - r * 0.7;
    el("path", { d: `M${x0},${y0} q${r * 0.4},${-r * 0.3 * rand()} ${r * 0.75},${r * 0.1} t${r * 0.7},${-r * 0.1}`,
      stroke: rand() > 0.5 ? "#A8231D" : "#DC5145", "stroke-width": 1.4, fill: "none", opacity: 0.8 }, g);
  }
  // leaves and stem
  for (let k = 0; k < 4; k++) {
    const a = -Math.PI / 2 + (k - 1.5) * 0.7 + (rand() - 0.5) * 0.3;
    el("path", { d: `M${cx},${cy - r * 0.8} q${Math.cos(a) * r * 0.3},${Math.sin(a) * r * 0.1} ${Math.cos(a) * r * 0.55},${Math.sin(a) * r * 0.35 + r * 0.15}`,
      stroke: "#2E5A2A", "stroke-width": Math.max(2, r / 7), "stroke-linecap": "round", fill: "none" }, g);
  }
  el("path", { d: `M${cx},${cy - r * 0.8} q${r * 0.08},${-r * 0.3} ${-r * 0.05},${-r * 0.5}`, stroke: "#2E5A2A", "stroke-width": Math.max(2, r / 8), fill: "none", "stroke-linecap": "round" }, g);
  return g;
}

function drawRed() {
  const out = courtPoints(inState()).filter(isOut);
  $("red-n").textContent = commas(out.length);
  const box = $("baskets");
  box.innerHTML = "";
  if (!out.length) {
    box.innerHTML = `<p class="empty-red">No hospitals in the red here at a ${settings.thr}% sideline. Move the line on the court to look again.</p>`;
    $("red-card").hidden = true;
    return;
  }
  const maxBeds = Math.max(...out.map((p) => p.beds || 10));
  for (const group of ["Government", "Non-profit", "For-profit"]) {
    const items = out.filter((p) => groupOf(p.control) === group).sort((a, b) => (b.beds || 0) - (a.beds || 0));
    const div = document.createElement("div");
    div.className = "basket";
    div.innerHTML = `<h3>${group}<span>${items.length}</span></h3>`;
    box.appendChild(div);
    if (!items.length) continue;
    // simple row packing: radius from beds, wrap when a row fills up
    const width = div.clientWidth || 300, gap = 8;
    const radius = (p) => 16 + 36 * Math.sqrt((p.beds || 10) / maxBeds);
    let x = 0, y = 0, rowH = 0;
    const placed = items.map((p) => {
      const r = radius(p);
      if (x + 2 * r > width) { x = 0; y += rowH + gap; rowH = 0; }
      const spot = { p, r, cx: x + r, cy: y + r + 10 };
      x += 2 * r + gap; rowH = Math.max(rowH, 2 * r + 10);
      return spot;
    });
    const svg = el("svg", { viewBox: `0 0 ${width} ${y + rowH + 10}`, height: y + rowH + 10 }, div);
    for (const s of placed) {
      const t = tomatoShape(svg, s.cx, s.cy, s.r, hash(s.p.name));
      t.setAttribute("tabindex", 0);
      el("title", {}, t).textContent = titleCase(s.p.name);
      if (settings.pickedTomato === s.p.name) t.classList.add("picked");
      const pick = () => { settings.pickedTomato = s.p.name; showTomato(s.p); document.querySelectorAll(".tomato.picked").forEach((n) => n.classList.remove("picked")); t.classList.add("picked"); };
      t.addEventListener("click", pick);
      t.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(); } });
    }
  }
  const picked = out.find((p) => p.name === settings.pickedTomato) || out.slice().sort((a, b) => b.burden - a.burden)[0];
  showTomato(picked);
}

function showTomato(p) {
  const c = $("red-card");
  c.hidden = false;
  const lost = p.net_income;
  c.innerHTML = `<h4>${titleCase(p.name)}</h4><p>${titleCase(p.city)}, ${p.state} · ${CONTROL[p.control]} · ${p.beds ? commas(p.beds) + " beds" : "beds not reported"}</p>
    <dl><div><dt>Unpaid care</dt><dd>${pct(p.burden, 1)}</dd></div><div><dt>Margin</dt><dd>${pct(p.margin, 1)}</dd></div>
    <div><dt>Unpaid care, $</dt><dd>${money(p.uncomp)}</dd></div><div><dt>Net loss</dt><dd>${money(lost)}</dd></div></dl>`;
}


// Chapter 4: 441 ----

function drawSky(animate) {
  const withHit = (h) => (h.hit ?? 0) > 0;
  const lit = ALL.filter(withHit).length;
  if (animate) countUp($("hit-n"), lit, (v) => commas(v) + "."); else $("hit-n").textContent = commas(lit) + ".";
  $("hit-of").textContent = commas(ALL.length);
  $("c-hit").textContent = commas(lit);

  const byState = {};
  for (const h of ALL) (byState[h.state] ||= []).push(h);
  const wrap = $("states");
  wrap.innerHTML = "";
  for (const st of Object.keys(byState).sort()) {
    const rows = byState[st];
    const cols = 14, cell = 6.4;
    const div = document.createElement("div");
    div.className = "st" + (settings.pickedState === st ? " on" : "");
    div.innerHTML = `<span>${st}</span>`;
    const svg = el("svg", { width: cols * cell, height: Math.ceil(rows.length / cols) * cell }, div);
    rows.forEach((h, i) => el("circle", { cx: (i % cols) * cell + 3.2, cy: Math.floor(i / cols) * cell + 3.2, r: withHit(h) ? 2.7 : 1.9, class: withHit(h) ? "lit" : "" }, svg));
    div.addEventListener("click", () => { settings.pickedState = settings.pickedState === st ? null : st; drawSky(false); });
    wrap.appendChild(div);
  }
  wrap.classList.toggle("focus", !!settings.pickedState);

  // what the picked state looks like
  const st = settings.pickedState;
  const rows = st ? byState[st] : ALL;
  const hitRows = rows.filter(withHit);
  const shares = hitRows.map((h) => (h.fixed_assets ? (h.hit / h.fixed_assets) * 100 : null)).filter(finite).sort((a, b) => a - b);
  const median = shares.length ? (shares.length % 2 ? shares[(shares.length - 1) / 2] : (shares[shares.length / 2 - 1] + shares[shares.length / 2]) / 2) : null;
  $("state-card").innerHTML = `${st ? `<b>${st}</b> &nbsp;` : "<b>All states</b> &nbsp;"}${commas(hitRows.length)} of ${commas(rows.length)} hospitals report health IT assets` +
    (median !== null ? ` · for the median one, IT is ${pct(median, 1)} of fixed assets` : "");
}


// Close ----

function drawClose() {
  $("c-total").textContent = money(ALL.reduce((s, h) => s + (h.uncomp ?? 0), 0));
}


// Wiring ----

function drawAll(first) { drawBill(first); drawCourt(); drawRed(); drawSky(first); drawClose(); }

async function start() {
  const data = window.HOSPITALS || (await (await fetch("/api/hospitals")).json());
  ALL = data.rows.map((r) => Object.fromEntries(data.fields.map((f, i) => [f, r[i]])));
  drawAll(true);

  document.querySelectorAll(".pills button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".pills button").forEach((x) => x.classList.toggle("on", x === b));
    settings.mode = b.dataset.mode; drawBill(false);
  }));
  $("thr").addEventListener("input", (e) => setThreshold(+e.target.value));
  $("state").addEventListener("change", (e) => {
    settings.state = e.target.value; settings.pickedTomato = null;
    settings.pickedState = e.target.value || null;
    drawBill(true); drawCourt(); drawRed(); drawSky(false);
  });
  let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { drawCourt(); drawRed(); }, 150); });

  // light up the dock dot for the chapter on screen
  const dots = [...document.querySelectorAll(".dots a")];
  const io = new IntersectionObserver((entries) => entries.forEach((e) => {
    if (e.isIntersecting) dots.forEach((d, i) => d.classList.toggle("on", i === +e.target.dataset.ch - 1));
  }), { threshold: 0.45 });
  document.querySelectorAll(".ch").forEach((s) => io.observe(s));
}

start();
