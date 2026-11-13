// app.js
// Fetches each analysis from the Flask API and draws it with Plotly.js.
// The state picker in the masthead reloads everything; each section's own
// controls reload just that section.

const COLORS = { "Non-profit": "#127C78", "For-profit": "#C7841A", "Government": "#4C5BA8", "Other": "#9AA5B1" };
const ORDER = ["Non-profit", "For-profit", "Government"];
const INK = "#0E1F33", MUTED = "#6B7787", LINE = "#DCE1E7", RISK = "#C6403A";
const PLOT_CONFIG = { responsive: true, displayModeBar: false };

const state = { normalize_by: "beds", metric_type: "hit_share" };
const $ = (id) => document.getElementById(id);


// Formatting ----

function money(x) {
  if (x == null) return "–";
  const a = Math.abs(x);
  if (a >= 1e9) return "$" + (x / 1e9).toFixed(1) + "B";
  if (a >= 1e6) return "$" + (x / 1e6).toFixed(1) + "M";
  if (a >= 1e3) return "$" + (x / 1e3).toFixed(0) + "K";
  return "$" + x.toFixed(0);
}
const pct = (x, d = 1) => (x == null ? "–" : x.toFixed(d) + "%");
const int = (x) => (x == null ? "–" : Math.round(x).toLocaleString());

// shorten "Voluntary, Non Profit, Church" to "Non Profit, Church" for axis labels
const shortType = (t) => t.replace(/^Voluntary, /, "").replace(/^Proprietary, /, "For-profit, ").replace(/^Governmental, /, "Gov., ");

function layout(extra) {
  return Object.assign({
    font: { family: "Plex, system-ui, sans-serif", size: 13, color: INK },
    paper_bgcolor: "rgba(0,0,0,0)", plot_bgcolor: "rgba(0,0,0,0)",
    margin: { t: 10, r: 16, b: 48, l: 60 },
    hoverlabel: { font: { family: "Plex Mono, monospace", size: 12 }, bgcolor: "#fff", bordercolor: LINE },
    showlegend: false,
  }, extra);
}
const axis = (title, extra) => Object.assign({ title: { text: title, font: { size: 12, color: MUTED } },
  gridcolor: "#EEF1F4", zerolinecolor: LINE, linecolor: LINE, tickfont: { family: "Plex Mono, monospace", size: 11, color: MUTED } }, extra);

async function getJSON(path, params) {
  const q = new URLSearchParams(Object.fromEntries(Object.entries(params).filter(([, v]) => v !== "" && v != null)));
  const res = await fetch(path + "?" + q.toString());
  if (!res.ok) throw new Error(path + " returned " + res.status);
  return res.json();
}

// horizontal bar charts need room for long type names, less on a phone
function barLayout(el, xTitle, extra) {
  const narrow = el.clientWidth < 560;
  return layout(Object.assign({ margin: { t: 6, r: narrow ? 56 : 70, b: 44, l: narrow ? 128 : 190 },
    xaxis: axis(xTitle, { nticks: narrow ? 4 : 8 }),
    yaxis: axis("", { tickfont: { size: narrow ? 10.5 : 12, color: INK } }) }, extra));
}

function busy(el, on) { el.classList.toggle("loading", on); }
function showError(el, msg) { Plotly.purge(el); el.innerHTML = `<p class="empty">${msg}</p>`; }


// Summary tiles and ownership mix ----

async function loadSummary() {
  const s = await getJSON("/api/summary_stats", { state: $("state").value });
  $("k-hospitals").textContent = int(s.total_hospitals);
  $("k-beds").textContent = int(s.median_beds);
  $("k-uncomp").textContent = money(s.total_uncomp_care);
  $("k-hit").textContent = int(s.hospitals_with_hit);

  const total = ORDER.reduce((n, k) => n + (s.broad_ownership[k] || 0), 0);
  $("mixbar").innerHTML = ORDER.map((k) => {
    const n = s.broad_ownership[k] || 0;
    const share = total ? (100 * n) / total : 0;
    return `<div style="flex-basis:${share}%;background:${COLORS[k]}" title="${k}: ${n} hospitals">${share >= 8 ? Math.round(share) + "%" : ""}</div>`;
  }).join("");
}


// 01 Ownership vs uncompensated care ----

async function loadOwnership() {
  const el = $("chart-ownership");
  busy(el, true);
  try {
    const r = await getJSON("/api/ownership", { state: $("state").value, normalize_by: state.normalize_by });
    const rows = r.data.table.slice().reverse();          // largest at the top
    if (!rows.length) return showError(el, "No hospitals with this measure in this state.");
    const fmt = state.normalize_by === "revenue" ? (v) => pct(v, 2) : money;
    Plotly.react(el, [{
      type: "bar", orientation: "h",
      y: rows.map((d) => shortType(d["Control Group"])),
      x: rows.map((d) => d.metric),
      marker: { color: rows.map((d) => COLORS[d.Ownership]) },
      text: rows.map((d) => fmt(d.metric)), textposition: "outside", cliponaxis: false,
      textfont: { family: "Plex Mono, monospace", size: 11, color: INK },
      customdata: rows.map((d) => d.hospitals),
      hovertemplate: "%{y}<br>%{text} average<br>%{customdata} hospitals<extra></extra>",
    }], barLayout(el, r.data.metric_label), PLOT_CONFIG);
  } catch (e) { showError(el, "Could not load this analysis."); console.error(e); }
  busy(el, false);
}


// 02 Burden vs bottom line ----

function quantile(sorted, q) { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] : 0; }

async function loadScatter() {
  const el = $("chart-scatter");
  busy(el, true);
  try {
    const r = await getJSON("/api/scatter", { state: $("state").value, min_beds: $("min-beds").value });
    const pts = r.data.points, st = r.data.stats;
    $("s-n").textContent = int(st.total_hospitals);
    $("s-burden").textContent = pct(st.median_uncomp_burden);
    $("s-margin").textContent = pct(st.avg_margin);
    $("s-neg").textContent = st.share_negative_margin == null ? "–" : pct(100 * st.share_negative_margin, 0);
    if (!pts.length) return showError(el, "No hospitals match. Try a smaller minimum bed count.");

    // clip the view to the middle 98% so a few extreme hospitals do not flatten it
    const xs = pts.map((p) => p.burden).sort((a, b) => a - b);
    const ys = pts.map((p) => p.margin).sort((a, b) => a - b);
    const xr = [Math.min(0, quantile(xs, 0.01)), quantile(xs, 0.99) * 1.05];
    const yr = [quantile(ys, 0.01) * 1.1, quantile(ys, 0.99) * 1.1];

    const traces = ORDER.map((k) => {
      const g = pts.filter((p) => p.ownership === k);
      return { type: "scattergl", mode: "markers", name: k, x: g.map((p) => p.burden), y: g.map((p) => p.margin),
        marker: { color: COLORS[k], size: 7, opacity: 0.7, line: { width: 0.5, color: "#fff" } },
        customdata: g.map((p) => [p.name, p.city, p.state, p.beds == null ? "?" : Math.round(p.beds)]),
        hovertemplate: "<b>%{customdata[0]}</b><br>%{customdata[1]}, %{customdata[2]} · %{customdata[3]} beds<br>burden %{x:.1f}% · margin %{y:.1f}%<extra></extra>" };
    });
    Plotly.react(el, traces, layout({
      showlegend: true, legend: { orientation: "h", y: 1.06, x: 0, font: { size: 12 } },
      margin: { t: 30, r: 16, b: 50, l: 60 },
      xaxis: axis("Uncompensated care, % of patient revenue", { range: xr, ticksuffix: "%" }),
      yaxis: axis("Net income, % of patient revenue", { range: yr, ticksuffix: "%" }),
      shapes: [
        { type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0, line: { color: INK, width: 1 } },
        { type: "line", yref: "paper", y0: 0, y1: 1, x0: st.median_uncomp_burden, x1: st.median_uncomp_burden, line: { color: MUTED, width: 1, dash: "dot" } },
      ],
      annotations: [{ xref: "x", yref: "paper", x: st.median_uncomp_burden, y: 0, text: " median", showarrow: false,
        xanchor: "left", yanchor: "bottom", font: { size: 11, color: MUTED, family: "Plex Mono, monospace" } }],
    }), PLOT_CONFIG);
  } catch (e) { showError(el, "Could not load this analysis."); console.error(e); }
  busy(el, false);
}


// 03 Health IT capital ----

async function loadHit() {
  const el = $("chart-hit");
  busy(el, true);
  try {
    const r = await getJSON("/api/hit_capital", { state: $("state").value, metric_type: state.metric_type });
    const d = r.data;
    $("h-n").textContent = int(d.total_hospitals);

    if (d.kind === "bar") {
      const rows = d.table.slice().reverse();
      if (!rows.length) return showError(el, "No hospital in this state reports HIT assets.");
      const fmt = state.metric_type === "hit_share" ? (v) => pct(v, 2) : money;
      Plotly.react(el, [{ type: "bar", orientation: "h", y: rows.map((x) => shortType(x["Control Group"])), x: rows.map((x) => x.value),
        marker: { color: rows.map((x) => COLORS[x.Ownership]) },
        text: rows.map((x) => fmt(x.value)), textposition: "outside", cliponaxis: false,
        textfont: { family: "Plex Mono, monospace", size: 11 },
        customdata: rows.map((x) => x.hospitals), hovertemplate: "%{y}<br>%{text}<br>%{customdata} hospitals<extra></extra>" }],
        barLayout(el, d.metric_label), PLOT_CONFIG);

    } else if (d.kind === "scatter") {
      if (!d.points.length) return showError(el, "No hospital in this state reports HIT assets.");
      const traces = ORDER.map((k) => {
        const g = d.points.filter((p) => p.ownership === k);
        return { type: "scatter", mode: "markers", name: k, x: g.map((p) => p.assets_m), y: g.map((p) => p.hit_m),
          marker: { color: COLORS[k], size: 8, opacity: 0.75, line: { width: 0.5, color: "#fff" } },
          customdata: g.map((p) => [p.name, p.state]),
          hovertemplate: "<b>%{customdata[0]}</b> (%{customdata[1]})<br>fixed assets $%{x:.1f}M<br>HIT $%{y:.2f}M<extra></extra>" };
      });
      if (d.trend) {
        // the fit is a straight line in dollars; sample it along the range so it draws right on log axes
        const lo = Math.max(d.trend.x[0], 0.01), hi = d.trend.x[1];
        const xs = Array.from({ length: 60 }, (_, i) => lo * Math.pow(hi / lo, i / 59));
        const line = xs.map((v) => [v, d.trend.slope * v + d.trend.intercept]).filter(([, y]) => y > 0);
        traces.push({ type: "scatter", mode: "lines", name: `straight-line fit, r = ${d.trend.r.toFixed(2)}`,
          x: line.map((p) => p[0]), y: line.map((p) => p[1]),
          line: { color: INK, width: 1.5, dash: "dash" }, hoverinfo: "skip" });
      }
      Plotly.react(el, traces, layout({ showlegend: true, legend: { orientation: "h", y: 1.08, x: 0, font: { size: 12 } },
        margin: { t: 30, r: 16, b: 50, l: 60 },
        xaxis: axis("Total fixed assets ($ millions, log)", { type: "log" }),
        yaxis: axis("HIT assets ($ millions, log)", { type: "log" }) }), PLOT_CONFIG);

    } else {
      const rows = d.table;
      Plotly.react(el, [{ type: "bar", x: rows.map((x) => x["State Code"]), y: rows.map((x) => x.value),
        marker: { color: rows.map((_, i) => (i < 3 ? "#127C78" : "#7FB9B5")) },
        customdata: rows.map((x) => [x.hospitals, money(x.total_hit)]),
        hovertemplate: "%{x}: %{y:.2f}% of fixed assets<br>%{customdata[0]} hospitals · %{customdata[1]} HIT<extra></extra>" }],
        layout({ xaxis: axis("", { tickfont: { family: "Plex Mono, monospace", size: 12, color: INK } }),
          yaxis: axis("HIT as % of fixed assets (average hospital)", { ticksuffix: "%" }) }), PLOT_CONFIG);
    }
  } catch (e) { showError(el, "Could not load this analysis."); console.error(e); }
  busy(el, false);
}


// 04 Hospitals in the squeeze ----

async function loadRisk() {
  const box = $("risk");
  busy(box, true);
  try {
    const r = await getJSON("/api/risk", { state: $("state").value, threshold: $("threshold").value });
    const d = r.data;
    $("r-count").textContent = int(d.at_risk);
    $("r-of").textContent = `of ${int(d.total_hospitals)} hospitals (${d.share == null ? "–" : pct(100 * d.share)}) carry more than ${d.threshold}% burden and lost money`;

    const max = Math.max(1, ...ORDER.map((k) => d.by_ownership[k] || 0));
    $("r-mix").innerHTML = ORDER.map((k) => {
      const n = d.by_ownership[k] || 0;
      return `<div><span>${k}</span><span class="bar"><i style="width:${(100 * n) / max}%;background:${COLORS[k]}"></i></span><b>${n}</b></div>`;
    }).join("");

    $("r-list").innerHTML = d.hospitals.length
      ? d.hospitals.map((h) => `<li><span class="h">${h.name}<small>${h.city}, ${h.state} · ${h.ownership}</small></span>
          <span class="v">${pct(h.burden)}</span><span class="v neg">${pct(h.margin)}</span></li>`).join("")
      : `<li class="empty">No hospitals above this cutoff here. Try lowering it.</li>`;
  } catch (e) { $("r-list").innerHTML = `<li class="empty">Could not load this analysis.</li>`; console.error(e); }
  busy(box, false);
}


// Controls ----

function loadAll() { loadSummary(); loadOwnership(); loadScatter(); loadHit(); loadRisk(); }

document.querySelectorAll(".seg").forEach((seg) => {
  seg.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    state[seg.dataset.target] = b.dataset.value;
    seg.dataset.target === "normalize_by" ? loadOwnership() : loadHit();
  });
});

$("state").addEventListener("change", loadAll);

let bedsTimer;
$("min-beds").addEventListener("input", () => { clearTimeout(bedsTimer); bedsTimer = setTimeout(loadScatter, 300); });

let riskTimer;
$("threshold").addEventListener("input", (e) => {
  $("r-thr").textContent = e.target.value + "%";
  clearTimeout(riskTimer); riskTimer = setTimeout(loadRisk, 150);
});

window.addEventListener("load", loadAll);
