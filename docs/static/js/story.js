// story.js
// Builds the four chapters from one list of hospitals (/api/hospitals).
// Two settings are shared across the whole story: the state picked in the
// dock, and the sideline (unpaid care cutoff) set on the court. Changing
// either one redraws every chapter, so the story stays consistent.

const NS = "http://www.w3.org/2000/svg";
const $ = (id) => document.getElementById(id);

const settings = { state: "", thr: 10, mode: "beds", pickedTomato: null, pickedState: null, openLine: null };
let ALL = [];          // every hospital as an object


// Ownership ----
// Type of Control codes from the cost report and the three groups they roll up to.

const CONTROL = {
  1: "Non-profit · church", 2: "Non-profit · other",
  3: "For-profit · individual", 4: "For-profit · corporation", 5: "For-profit · partnership", 6: "For-profit · other",
  7: "Gov · federal", 8: "Gov · city & county", 9: "Gov · county", 10: "Gov · state",
  11: "Gov · hospital district", 12: "Gov · city", 13: "Gov · other",
};
const GROUPS = ["Government", "Non-profit", "For-profit"];
const groupOf = (c) => (c <= 2 ? "Non-profit" : c <= 6 ? "For-profit" : "Government");
const GROUP_CLASS = { "Non-profit": "np", "For-profit": "fp", "Government": "gov" };
const GROUP_COLOR = { "Non-profit": "#2F5FC2", "For-profit": "#D99A1E", "Government": "#13224A" };


// Formatting ----

function money(x, digits = 1) {
  if (x < 0) return "-" + money(-x, digits);
  if (x >= 1e9) return "$" + (x / 1e9).toFixed(digits) + "B";
  if (x >= 1e6) return "$" + (x / 1e6).toFixed(digits) + "M";
  if (x >= 1e3) return "$" + Math.round(x / 1e3) + "K";
  return "$" + Math.round(x);
}
const commas = (x) => Math.round(x).toLocaleString("en-US");
const pct = (x, d = 0) => x.toFixed(d) + "%";
const titleCase = (s) => (s || "").toLowerCase().replace(/\b[a-z]/g, (m) => m.toUpperCase());
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

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

// one hospital's value on the receipt; missing unpaid care counts as 0
function lineValue(h, mode) {
  const u = h.uncomp ?? 0;
  if (mode === "beds") return h.beds ? u / h.beds : null;
  if (mode === "revenue") return h.revenue ? (u / h.revenue) * 100 : null;
  return u;
}

// average by Type of Control, largest first
function receiptLines(rows, mode) {
  const groups = {};
  for (const h of rows) {
    const v = lineValue(h, mode);
    if (!finite(v)) continue;
    (groups[h.control] ||= []).push({ h, v });
  }
  return Object.entries(groups)
    .map(([c, items]) => ({ control: +c, items, value: items.reduce((a, b) => a + b.v, 0) / items.length, n: items.length }))
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

const fmtLine = (v) => (settings.mode === "revenue" ? pct(v, 2) : "$" + commas(v));

function drawBill(animateTotal) {
  const rows = inState();
  const total = rows.reduce((s, h) => s + (h.uncomp ?? 0), 0);
  document.querySelector(".bill .where").textContent = settings.state ? `hospitals in ${settings.state}` : "U.S. hospitals";
  $("b-n").textContent = commas(rows.length);
  if (animateTotal) countUp($("b-total"), total, (v) => money(v)); else $("b-total").textContent = money(total);

  const lines = receiptLines(rows, settings.mode);
  const max = Math.max(...lines.map((l) => l.value), 1);
  const label = { beds: "average per bed", revenue: "% of patient revenue", none: "average per hospital" }[settings.mode];
  $("r-sub").innerHTML = `${commas(rows.length)} hospitals · FY2022<br>${label}, by owner`;
  $("r-total").textContent = money(total);

  const list = $("r-lines");
  list.innerHTML = "";
  lines.forEach((l, i) => {
    const li = document.createElement("li");
    li.className = GROUP_CLASS[groupOf(l.control)] + (settings.openLine === l.control ? " open" : "");
    li.style.animationDelay = i * 55 + "ms";
    li.innerHTML = `<button class="line" aria-expanded="${settings.openLine === l.control}">
        <div class="row"><span>${CONTROL[l.control]}</span><i></i><b>${fmtLine(l.value)}</b><em>›</em></div>
        <div class="bar" style="width:${(100 * l.value) / max}%;animation-delay:${i * 55 + 120}ms"></div></button>`;
    if (settings.openLine === l.control) li.appendChild(lineDetail(l, total));
    li.querySelector("button").addEventListener("click", () => {
      settings.openLine = settings.openLine === l.control ? null : l.control;
      drawBill(false);
    });
    list.appendChild(li);
  });
  drawReceiptBack(rows, total);
}

// what opens under a receipt line: how many hospitals, their share of the bill, the top three
function lineDetail(l, total) {
  const div = document.createElement("div");
  div.className = "more";
  const dollars = l.items.reduce((s, x) => s + (x.h.uncomp ?? 0), 0);
  const top = l.items.slice().sort((a, b) => b.v - a.v).slice(0, 3);
  div.innerHTML = `<p>${commas(l.n)} hospitals · ${money(dollars)} of the bill (${pct(total ? (100 * dollars) / total : 0, 1)})</p>` +
    top.map((x) => `<p>↳ ${esc(titleCase(x.h.name))}, ${x.h.state}: ${fmtLine(x.v)}</p>`).join("");
  return div;
}

function drawReceiptBack(rows, total) {
  $("r-back").innerHTML = GROUPS.map((g) => {
    const mine = rows.filter((h) => groupOf(h.control) === g);
    const dollars = mine.reduce((s, h) => s + (h.uncomp ?? 0), 0);
    return `<div class="grp" style="color:${GROUP_COLOR[g]}"><h4><span>${g}</span><span>${pct(total ? (100 * dollars) / total : 0)}</span></h4>
      <p style="color:#13224A">${commas(mine.length)} hospitals (${pct(rows.length ? (100 * mine.length) / rows.length : 0)} of them) gave ${money(dollars)} of unpaid care</p></div>`;
  }).join("");
}

// the receipt leans toward the pointer
function wireReceipt() {
  const stage = $("receipt-stage"), card = $("receipt-card");
  stage.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--ry", (((e.clientX - r.left) / r.width - 0.5) * 14).toFixed(1) + "deg");
    card.style.setProperty("--rx", ((0.5 - (e.clientY - r.top) / r.height) * 10).toFixed(1) + "deg");
  });
  stage.addEventListener("pointerleave", () => { card.style.setProperty("--rx", "0deg"); card.style.setProperty("--ry", "0deg"); });
  $("flip-btn").addEventListener("click", () => {
    const on = card.classList.toggle("flipped");
    $("flip-btn").setAttribute("aria-pressed", on);
    card.querySelector(".front").setAttribute("aria-hidden", on);
    card.querySelector(".back").setAttribute("aria-hidden", !on);
  });
}


// Chapter 2: the court ----
// x uses a square-root scale so the long tail of unpaid care fits;
// margins are clipped to -60% and +40% so a few extreme hospitals stay on court.

const X_MAX = 50, Y_TOP = 40, Y_BOT = -60;
let pinned = null;

function labelText(svg, x, y, text, anchor = "start") {
  const t = el("text", { x, y, class: "lbl", "text-anchor": anchor }, svg);
  t.textContent = text;
  const b = t.getBBox();
  const bg = el("rect", { x: b.x - 6, y: b.y - 3, width: b.width + 12, height: b.height + 6, rx: 4, class: "lbl-bg" });
  svg.insertBefore(bg, t);
  return t;
}

function drawCourt() {
  const svg = $("court");
  const W = svg.clientWidth || 1200, H = svg.clientHeight || 600;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.innerHTML = "";
  const L = 8, R = W - 8, T = 8, B = H - 8;
  const X = (b) => L + (R - L) * Math.sqrt(Math.max(0, Math.min(b, X_MAX)) / X_MAX);
  const Y = (m) => T + (B - T) * (Y_TOP - Math.max(Y_BOT, Math.min(Y_TOP, m))) / (Y_TOP - Y_BOT);

  const pts = courtPoints(inState());
  const out = pts.filter(isOut);
  $("court-n").textContent = commas(pts.length);
  $("out-n").textContent = commas(out.length);

  const sx = X(settings.thr), sy = Y(0);
  el("rect", { x: sx, y: sy, width: R - sx, height: B - sy, fill: "#244C9E" }, svg);          // the out zone

  const g = el("g", {}, svg);
  for (const p of pts) if (!isOut(p)) el("circle", { cx: X(p.burden), cy: Y(p.margin), r: 2.8, class: "dot" }, g);

  // the lines: break-even and the sideline
  el("line", { x1: L, x2: R, y1: sy, y2: sy, stroke: "#F5EEDC", "stroke-width": 10 }, svg);
  el("line", { x1: sx, x2: sx, y1: T, y2: B, stroke: "#F5EEDC", "stroke-width": 10 }, svg);

  // the count, tilted like a line call, in the open space above break-even
  const size = Math.max(28, Math.min(68, (R - sx) * 0.16));
  const word = el("text", { x: R - 12, y: T + size + 6, class: "out-word", "text-anchor": "end", "font-size": size,
    transform: `rotate(-5 ${R - 12} ${T + size})` }, svg);
  word.textContent = `${commas(out.length)} OUT`;
  labelText(svg, R - 12, T + size + 58, W < 700 ? `SIDELINE ${settings.thr}% →` : `SIDELINE: ${settings.thr}% OF REVENUE IN UNPAID CARE`, "end");
  labelText(svg, L + 10, sy - 18, "↑ MAKING MONEY");
  labelText(svg, L + 10, sy + 32, "↓ LOSING MONEY");

  // drag the sideline directly on the court (drawn under the balls so balls by the line can still be tapped)
  const handle = el("rect", { x: sx - 16, y: T, width: 32, height: B - T, fill: "transparent", class: "handle" }, svg);
  handle.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    // listen on the window: the court redraws while you drag, which replaces this handle
    const move = (ev) => {
      const box = $("court").getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (ev.clientX - box.left - L) / (R - L)));
      setThreshold(Math.round(Math.max(5, Math.min(25, frac * frac * X_MAX))));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
  });

  // the out hospitals as tennis balls
  for (const p of out) {
    const cx = X(p.burden), cy = Y(p.margin);
    const ball = el("g", { class: "ball" + (pinned === p.name ? " pinned" : ""), tabindex: 0, role: "button", "aria-label": titleCase(p.name) }, svg);
    el("ellipse", { cx: cx + 5, cy: cy + 9, rx: 10, ry: 4.5, fill: "#0b1f55", opacity: .35 }, ball);
    const spin = el("g", { class: "spin" }, ball);
    el("circle", { cx, cy, r: 9.5, fill: "#D8E24C" }, spin);
    el("path", { d: `M${cx - 7},${cy - 5} q7,6 14,0 M${cx - 7},${cy + 5} q7,-6 14,0`, stroke: "#F7F9E2", "stroke-width": 1.4, fill: "none" }, spin);
    ball.addEventListener("mouseenter", () => { if (!pinned) showTip(p, cx, cy, false); });
    ball.addEventListener("mouseleave", () => { if (!pinned) $("court-tip").hidden = true; });
    const pin = (e) => { e.stopPropagation(); pinned = p.name; drawCourt(); showTip(p, cx, cy, true); };
    ball.addEventListener("click", pin);
    ball.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pin(e); } });
  }

}

function showTip(p, cx, cy, isPinned) {
  const tip = $("court-tip"), box = $("court").getBoundingClientRect();
  const g = groupOf(p.control);
  tip.hidden = false;
  tip.innerHTML = `<b>${esc(titleCase(p.name))}</b><span class="chip" style="background:${GROUP_COLOR[g]}">${g}</span><br>${esc(titleCase(p.city))}, ${p.state}<br>
    ${pct(p.burden, 1)} of revenue in unpaid care<br>${pct(p.margin, 1)} margin${p.margin < Y_BOT ? " (below the court)" : ""}` +
    (isPinned ? `<br><button type="button" id="see-red">See it in the red ↓</button>` : "");
  // place the card beside the ball, never on top of it: right, then left, then below or above
  tip.style.pointerEvents = isPinned ? "auto" : "none";        // a hover card can't block the tap
  const w = Math.min(280, Math.max(190, box.width * 0.56));
  tip.style.width = w + "px";
  const h = tip.offsetHeight || 150;                             // measure after the width is set
  let left, top;
  if (cx + 18 + w <= box.width) { left = cx + 18; top = Math.max(0, Math.min(cy - 30, box.height - h)); }
  else if (cx - 18 - w >= 0) { left = cx - 18 - w; top = Math.max(0, Math.min(cy - 30, box.height - h)); }
  else {
    left = Math.max(0, Math.min(cx - w / 2, box.width - w));
    if (cy + 20 + h <= box.height) top = cy + 20;
    else if (cy - 20 - h >= 0) top = cy - 20 - h;
    else top = box.height + 8;                                   // no room anywhere: hang it just under the court
  }
  tip.style.left = left + "px";
  tip.style.top = top + "px";
  if (isPinned) $("see-red").addEventListener("click", () => { settings.pickedTomato = p.name; location.hash = "red"; });
}

function setThreshold(v) {
  if (v === settings.thr) return;
  settings.thr = v;
  $("thr").value = v;
  $("thr-label").textContent = v + "%";
  document.querySelectorAll(".thr-echo").forEach((n) => (n.textContent = v + "%"));
  pinned = null; $("court-tip").hidden = true;
  drawCourt(); drawRed();
}


// Chapter 3: in the red ----
// One hand-drawn tomato per out-of-bounds hospital, in three baskets by owner.

function tomatoShape(parent, cx, cy, r, seed) {
  const rand = rng(seed);
  const g = el("g", { class: "tomato" }, parent);
  const n = 14, pts = [];
  for (let i = 0; i < n; i++) {          // lumpy outline
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
  for (let k = 0; k < Math.max(3, r / 5); k++) {          // crayon scribble
    const y0 = cy - r * 0.6 + rand() * r * 1.2, x0 = cx - r * 0.7;
    el("path", { d: `M${x0},${y0} q${r * 0.4},${-r * 0.3 * rand()} ${r * 0.75},${r * 0.1} t${r * 0.7},${-r * 0.1}`,
      stroke: rand() > 0.5 ? "#A82720" : "#DC5145", "stroke-width": 1.4, fill: "none", opacity: 0.8 }, g);
  }
  for (let k = 0; k < 4; k++) {          // leaves and stem
    const a = -Math.PI / 2 + (k - 1.5) * 0.7 + (rand() - 0.5) * 0.3;
    el("path", { d: `M${cx},${cy - r * 0.8} q${Math.cos(a) * r * 0.3},${Math.sin(a) * r * 0.1} ${Math.cos(a) * r * 0.55},${Math.sin(a) * r * 0.35 + r * 0.15}`,
      stroke: "#3E6B3A", "stroke-width": Math.max(2, r / 7), "stroke-linecap": "round", fill: "none" }, g);
  }
  el("path", { d: `M${cx},${cy - r * 0.8} q${r * 0.08},${-r * 0.3} ${-r * 0.05},${-r * 0.5}`, stroke: "#3E6B3A", "stroke-width": Math.max(2, r / 8), fill: "none", "stroke-linecap": "round" }, g);
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
  for (const group of GROUPS) {
    const items = out.filter((p) => groupOf(p.control) === group).sort((a, b) => (b.beds || 0) - (a.beds || 0));
    const div = document.createElement("div");
    div.className = "basket";
    div.innerHTML = `<h3><span style="color:${GROUP_COLOR[group]}"><i style="background:${GROUP_COLOR[group]}"></i>${group}</span><span>${items.length}</span></h3>`;
    box.appendChild(div);
    if (!items.length) continue;
    // pack in rows: radius from beds, wrap when a row fills up
    const width = div.clientWidth || 300, gap = 8;
    const radius = (p) => Math.min(width / 2 - 4, 16 + 36 * Math.sqrt((p.beds || 10) / maxBeds));
    let x = 0, y = 0, rowH = 0;
    const placed = items.map((p) => {
      const r = radius(p);
      if (x > 0 && x + 2 * r > width) { x = 0; y += rowH + gap; rowH = 0; }
      const spot = { p, r, cx: x + r, cy: y + r + 12 };
      x += 2 * r + gap; rowH = Math.max(rowH, 2 * r + 12);
      return spot;
    });
    const svg = el("svg", { viewBox: `0 0 ${width} ${y + rowH + 12}`, height: y + rowH + 12 }, div);
    for (const s of placed) {
      const t = tomatoShape(svg, s.cx, s.cy, s.r, hash(s.p.name));
      t.setAttribute("tabindex", 0); t.setAttribute("role", "button"); t.setAttribute("aria-label", titleCase(s.p.name));
      el("title", {}, t).textContent = titleCase(s.p.name);
      if (settings.pickedTomato === s.p.name) t.classList.add("picked");
      const pick = () => {
        settings.pickedTomato = s.p.name;
        document.querySelectorAll(".tomato.picked").forEach((n) => n.classList.remove("picked"));
        t.classList.add("picked"); showTomato(s.p);
      };
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
  c.classList.remove("flip"); void c.offsetWidth; c.classList.add("flip");   // replay the flip
  c.innerHTML = `<h4>${esc(titleCase(p.name))}</h4><p>${esc(titleCase(p.city))}, ${p.state} · ${CONTROL[p.control]} · ${p.beds ? commas(p.beds) + " beds" : "beds not reported"}</p>
    <dl><div><dt>Unpaid care</dt><dd>${pct(p.burden, 1)}</dd></div><div><dt>Margin</dt><dd>${pct(p.margin, 1)}</dd></div>
    <div><dt>Unpaid care, $</dt><dd>${money(p.uncomp)}</dd></div><div><dt>Net loss</dt><dd>${money(p.net_income)}</dd></div></dl>`;
}


// Chapter 4: 441 ----

const withHit = (h) => (h.hit ?? 0) > 0;

function median(xs) {
  if (!xs.length) return null;
  const s = xs.slice().sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function drawSky(animate) {
  const lit = ALL.filter(withHit).length;
  if (animate) countUp($("hit-n"), lit, (v) => commas(v) + "."); else $("hit-n").textContent = commas(lit) + ".";
  $("hit-of").textContent = commas(ALL.length);

  // build the tiles once; picking a state only flips tiles, so the flip animates
  if (!$("states").children.length) {
    const byState = {};
    for (const h of ALL) (byState[h.state] ||= []).push(h);
    for (const st of Object.keys(byState).sort()) {
      const rows = byState[st], nLit = rows.filter(withHit).length;
      const cols = 14, cell = 6.4;
      const btn = document.createElement("button");
      btn.className = "st"; btn.dataset.state = st;
      btn.setAttribute("aria-label", `${st}: ${nLit} of ${rows.length} hospitals report health IT assets`);
      const inner = document.createElement("div"); inner.className = "inner";
      const front = document.createElement("div"); front.className = "side f";
      front.innerHTML = `<span class="code">${st}</span>`;
      const svg = el("svg", { width: cols * cell, height: Math.max(cell, Math.ceil(rows.length / cols) * cell) }, front);
      rows.forEach((h, i) => el("circle", { cx: (i % cols) * cell + 3.2, cy: Math.floor(i / cols) * cell + 3.2, r: withHit(h) ? 2.7 : 1.9, class: withHit(h) ? "lit" : "" }, svg));
      const back = document.createElement("div"); back.className = "side b";
      back.innerHTML = `<b>${nLit}</b>of ${rows.length}<br>${st}`;
      inner.append(front, back); btn.appendChild(inner);
      btn.addEventListener("click", () => pickState(settings.pickedState === st ? null : st));
      $("states").appendChild(btn);
    }
  }
  pickState(settings.pickedState);
}

function pickState(st) {
  settings.pickedState = st;
  document.querySelectorAll(".st").forEach((b) => {
    const on = b.dataset.state === st;
    b.classList.toggle("flipped", on); b.setAttribute("aria-pressed", on);
  });
  $("states").classList.toggle("focus", !!st);

  // the line under the grid and the list you can open
  const rows = st ? ALL.filter((h) => h.state === st) : ALL;
  const hitRows = rows.filter(withHit);
  const shares = hitRows.map((h) => (h.fixed_assets ? (h.hit / h.fixed_assets) * 100 : null)).filter(finite);
  const med = median(shares);
  $("state-card").innerHTML = `<b>${st || "All states"}</b> &nbsp;${commas(hitRows.length)} of ${commas(rows.length)} hospitals report health IT assets` +
    (med !== null ? `<br>for the middle one, IT is ${pct(med, 1)} of its fixed assets` : "");
  $("state-list-label").textContent = st ? `See the ${hitRows.length} in ${st}` : `See all ${hitRows.length}`;
  $("state-hospitals").innerHTML = hitRows.slice().sort((a, b) => b.hit - a.hit)
    .map((h) => `<li>${esc(titleCase(h.name))}, ${h.state}: ${money(h.hit)}</li>`).join("");
}


// Tabs ----
// One story shows at a time. The address bar keeps the open tab (#court),
// so the back button and shared links land on the right story.

const TABS = ["start", "bill", "court", "red", "hit"];
let current = null;

function showTab(name) {
  if (!TABS.includes(name)) name = "start";
  if (name === current) return;
  current = name;
  document.querySelectorAll(".pane > .ch").forEach((s) => (s.hidden = s.dataset.tab !== name));
  document.querySelectorAll("#q-list a").forEach((a) => {
    const on = a.dataset.tab === name;
    a.classList.toggle("on", on);
    if (on) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  // charts measure their own width, so draw them once their tab is visible
  if (name === "court") drawCourt();
  if (name === "red") drawRed();
  const sec = $("tab-" + name);
  sec.querySelectorAll(".tilt-in").forEach((n) => { n.classList.remove("in"); void n.offsetWidth; n.classList.add("in"); });
  $("pane").scrollTo({ top: 0 }); window.scrollTo({ top: 0 });
  document.body.classList.remove("menu-open"); $("q-toggle").setAttribute("aria-expanded", "false");
}


// Wiring ----

async function start() {
  const data = window.HOSPITALS || (await (await fetch("/api/hospitals")).json());
  ALL = data.rows.map((r) => Object.fromEntries(data.fields.map((f, i) => [f, r[i]])));
  $("s-n").textContent = commas(ALL.length);
  drawBill(true); drawSky(true);
  wireReceipt();
  showTab(location.hash.slice(1));
  window.addEventListener("hashchange", () => showTab(location.hash.slice(1)));

  document.querySelectorAll(".pills button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".pills button").forEach((x) => x.classList.toggle("on", x === b));
    settings.mode = b.dataset.mode; settings.openLine = null; drawBill(false);
  }));
  $("thr").addEventListener("input", (e) => setThreshold(+e.target.value));
  $("state").addEventListener("change", (e) => {
    $("rail-state").textContent = e.target.value || "All";
    settings.state = e.target.value; settings.pickedTomato = null; settings.openLine = null;
    settings.pickedState = e.target.value || null; pinned = null; $("court-tip").hidden = true;
    drawBill(true); drawSky(false);
    if (current === "court") drawCourt();
    if (current === "red") drawRed();
  });
  document.addEventListener("click", (e) => {             // tap anywhere else to unpin
    if (pinned && !e.target.closest(".tip")) { pinned = null; $("court-tip").hidden = true; drawCourt(); }
  });
  // the list closes to a slim rail; it closes itself when a story opens
  const setNav = (open) => {
    document.body.classList.toggle("nav-closed", !open);
    $("q-close").setAttribute("aria-expanded", open);
    $("q-close").title = open ? "Close the question list" : "Open the question list";
    $("q-close").querySelector(".q-close-label").textContent = open ? "Close" : "Questions";
    $("q-close").querySelector(".sr").textContent = open ? "Close the question list" : "Open the question list";
    setTimeout(() => { if (current === "court") drawCourt(); if (current === "red") drawRed(); }, 380);  // redraw at the new width
  };
  $("q-close").addEventListener("click", () => setNav(document.body.classList.contains("nav-closed")));
  $("rail-state").addEventListener("click", () => { setNav(true); setTimeout(() => $("state").focus(), 360); });
  window.addEventListener("hashchange", () => setNav((location.hash.slice(1) || "start") === "start"));
  setNav((location.hash.slice(1) || "start") === "start");

  $("q-toggle").addEventListener("click", () => {           // the question list folds up on phones
    const open = document.body.classList.toggle("menu-open");
    $("q-toggle").setAttribute("aria-expanded", open);
  });
  let t; window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => {
    if (current === "court") drawCourt();
    if (current === "red") drawRed();
  }, 150); });
}

start();
