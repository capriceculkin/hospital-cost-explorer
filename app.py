# app.py
# Flask app for the Hospital Cost Explorer. Serves the dashboard page and a
# small JSON API over the 2022 CMS Hospital Provider Cost Report.
#
# Run: python app.py, then open http://127.0.0.1:5000

from flask import Flask, render_template, request, jsonify

from backend.queries import get_states
from backend.analyses import (
    analysis_ownership_uncompensated_care,
    analysis_financial_scatter,
    analysis_hit_capital,
    analysis_at_risk,
    summary_stats,
)

app = Flask(__name__, template_folder="templates", static_folder="static")


# Reading query parameters ----

def state_arg():
    state = request.args.get("state") or None
    return None if state == "all" else state


def int_arg(name, default, lo, hi):
    # keep numeric inputs inside a sensible range instead of erroring
    try:
        value = int(request.args.get(name, default))
    except (TypeError, ValueError):
        value = default
    return max(lo, min(hi, value))


# Page ----

@app.route("/")
def home():
    return render_template("index.html", states=get_states())


# API ----

@app.route("/api/analyses")
def list_analyses():
    return jsonify({"analyses": [
        {"id": "ownership", "name": "Ownership vs uncompensated care",
         "parameters": {"state": "optional", "normalize_by": ["beds", "revenue", "none"]}},
        {"id": "scatter", "name": "Financial health",
         "parameters": {"state": "optional", "min_beds": "integer, default 0"}},
        {"id": "hit_capital", "name": "HIT capital investment",
         "parameters": {"state": "optional",
                        "metric_type": ["hit_share", "hit_per_bed", "hit_vs_assets", "state_comparison"]}},
        {"id": "risk", "name": "Hospitals at risk",
         "parameters": {"state": "optional", "threshold": "integer 5 to 25, default 10"}},
    ]})


@app.route("/api/states")
def api_states():
    return jsonify({"states": get_states()})


@app.route("/api/summary_stats")
def api_summary_stats():
    return jsonify(summary_stats(state_arg()))


@app.route("/api/ownership")
def api_ownership():
    normalize_by = request.args.get("normalize_by", "beds")
    if normalize_by not in ("beds", "revenue", "none"):
        normalize_by = "beds"
    return jsonify({"analysis": "ownership",
                    "parameters": {"state": state_arg(), "normalize_by": normalize_by},
                    "data": analysis_ownership_uncompensated_care(state_arg(), normalize_by)})


@app.route("/api/scatter")
def api_scatter():
    min_beds = int_arg("min_beds", 0, 0, 5000)
    return jsonify({"analysis": "scatter",
                    "parameters": {"state": state_arg(), "min_beds": min_beds},
                    "data": analysis_financial_scatter(state_arg(), min_beds)})


@app.route("/api/hit_capital")
def api_hit_capital():
    metric_type = request.args.get("metric_type", "hit_share")
    if metric_type not in ("hit_share", "hit_per_bed", "hit_vs_assets", "state_comparison"):
        metric_type = "hit_share"
    return jsonify({"analysis": "hit_capital",
                    "parameters": {"state": state_arg(), "metric_type": metric_type},
                    "data": analysis_hit_capital(state_arg(), metric_type)})


@app.route("/api/risk")
def api_risk():
    threshold = int_arg("threshold", 10, 5, 25)
    return jsonify({"analysis": "risk",
                    "parameters": {"state": state_arg(), "threshold": threshold},
                    "data": analysis_at_risk(state_arg(), threshold)})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
