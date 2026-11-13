# analyses.py
# The four analyses behind the dashboard. Each one filters the cost report,
# computes its measure with pandas, and returns plain rows that the page
# draws with Plotly.js. Returning data instead of finished figures keeps the
# API useful on its own (see tests/check_api.py).
#
#   1. ownership vs uncompensated care
#   2. financial health: uncompensated care burden vs net margin
#   3. health IT (HIT) capital investment
#   4. hospitals at risk: high burden and losing money

import numpy as np
import pandas as pd
from scipy import stats

from backend.queries import get_full_dataset, filter_by_state


# Helpers ----

def finite(df, cols):
    # drop rows where any of these columns is missing or infinite
    # (dividing by zero revenue or zero beds gives inf)
    out = df.copy()
    for c in cols:
        out[c] = pd.to_numeric(out[c], errors="coerce")
    return out.replace([np.inf, -np.inf], np.nan).dropna(subset=cols)


def records(df):
    # NaN is not valid JSON, so turn it into None
    return df.astype(object).where(pd.notna(df), None).to_dict("records")


# Analysis 1: ownership vs uncompensated care ----
# normalize_by: beds (dollars per bed), revenue (% of patient revenue) or none
# (total dollars). Missing uncompensated care counts as 0, as in the original.

def analysis_ownership_uncompensated_care(state_code=None, normalize_by="beds"):
    data = filter_by_state(get_full_dataset(), state_code).copy()
    data["Cost of Uncompensated Care"] = data["Cost of Uncompensated Care"].fillna(0)
    data["Number of Beds"] = data["Number of Beds"].replace(0, np.nan)
    data["Total Patient Revenue"] = data["Total Patient Revenue"].replace(0, np.nan)

    if normalize_by == "beds":
        data["metric"] = data["Cost of Uncompensated Care"] / data["Number of Beds"]
        label = "Uncompensated care per bed ($)"
    elif normalize_by == "revenue":
        data["metric"] = data["Cost of Uncompensated Care"] / data["Total Patient Revenue"] * 100
        label = "Uncompensated care (% of patient revenue)"
    else:
        data["metric"] = data["Cost of Uncompensated Care"]
        label = "Total uncompensated care ($)"

    summary = (
        finite(data, ["metric"])
        .groupby(["Control Group", "Ownership"], as_index=False)
        .agg(metric=("metric", "mean"), hospitals=("metric", "size"))
        .sort_values("metric", ascending=False)
    )
    return {"metric_label": label, "table": records(summary)}


# Analysis 2: financial health ----
# Each hospital's uncompensated care as a % of patient revenue (burden)
# against its net income as a % of patient revenue (margin).

def scatter_points(state_code=None, min_beds=0):
    data = filter_by_state(get_full_dataset(), state_code)
    if min_beds > 0:
        data = data[data["Number of Beds"] >= min_beds]
    data = data.copy()
    data["burden"] = data["Cost of Uncompensated Care"] / data["Total Patient Revenue"] * 100
    data["margin"] = data["Net Income"] / data["Total Patient Revenue"] * 100
    return finite(data, ["burden", "margin"]).dropna(subset=["Hospital Name"])


def analysis_financial_scatter(state_code=None, min_beds=0):
    pts = scatter_points(state_code, min_beds)
    cols = ["Hospital Name", "City", "State Code", "Number of Beds", "Ownership", "burden", "margin"]
    return {
        "points": records(pts[cols].rename(columns={"Hospital Name": "name", "City": "city",
                                                    "State Code": "state", "Number of Beds": "beds",
                                                    "Ownership": "ownership"})),
        "stats": {
            "total_hospitals": int(len(pts)),
            "avg_uncomp_burden": float(pts["burden"].mean()) if len(pts) else None,
            "median_uncomp_burden": float(pts["burden"].median()) if len(pts) else None,
            "avg_margin": float(pts["margin"].mean()) if len(pts) else None,
            "share_negative_margin": float((pts["margin"] < 0).mean()) if len(pts) else None,
        },
    }


# Analysis 3: HIT capital investment ----
# Only hospitals that report HIT designated assets (Worksheet A-7) are kept.
# metric_type: hit_share, hit_per_bed, hit_vs_assets, or state_comparison
# (top 15 states, which ignores the state filter).

def analysis_hit_capital(state_code=None, metric_type="hit_share"):
    data = get_full_dataset()
    if metric_type != "state_comparison":
        data = filter_by_state(data, state_code)
    data = data.copy()

    hit = "Health Information Technology Designated Assets"
    data[hit] = data[hit].fillna(0)
    data["Total Fixed Assets"] = data["Total Fixed Assets"].replace(0, np.nan)
    data["Number of Beds"] = data["Number of Beds"].replace(0, np.nan)
    data = data[data[hit] > 0]

    if metric_type == "hit_share":
        data["value"] = data[hit] / data["Total Fixed Assets"] * 100
        summary = (finite(data, ["value"])
                   .groupby(["Control Group", "Ownership"], as_index=False)
                   .agg(value=("value", "mean"), hospitals=("value", "size"))
                   .sort_values("value", ascending=False))
        return {"kind": "bar", "metric_label": "HIT as % of fixed assets",
                "table": records(summary), "total_hospitals": int(summary["hospitals"].sum())}

    if metric_type == "hit_per_bed":
        data["value"] = data[hit] / data["Number of Beds"]
        summary = (finite(data, ["value"])
                   .groupby(["Control Group", "Ownership"], as_index=False)
                   .agg(value=("value", "mean"), hospitals=("value", "size"))
                   .sort_values("value", ascending=False))
        return {"kind": "bar", "metric_label": "HIT investment per bed ($)",
                "table": records(summary), "total_hospitals": int(summary["hospitals"].sum())}

    if metric_type == "hit_vs_assets":
        data["hit_m"] = data[hit] / 1e6
        data["assets_m"] = data["Total Fixed Assets"] / 1e6
        pts = finite(data, ["hit_m", "assets_m"]).dropna(subset=["Hospital Name"])
        trend = None
        if len(pts) > 2:
            fit = stats.linregress(pts["assets_m"], pts["hit_m"])   # straight-line fit
            trend = {"slope": fit.slope, "intercept": fit.intercept, "r": fit.rvalue,
                     "x": [pts["assets_m"].min(), pts["assets_m"].max()]}
        cols = ["Hospital Name", "State Code", "Number of Beds", "Ownership", "hit_m", "assets_m"]
        return {"kind": "scatter",
                "points": records(pts[cols].rename(columns={"Hospital Name": "name", "State Code": "state",
                                                            "Number of Beds": "beds", "Ownership": "ownership"})),
                "trend": trend, "total_hospitals": int(len(pts))}

    # state_comparison
    data["value"] = data[hit] / data["Total Fixed Assets"] * 100
    by_state = (finite(data, ["value"])
                .groupby("State Code", as_index=False)
                .agg(value=("value", "mean"), total_hit=(hit, "sum"), hospitals=("value", "size"))
                .nlargest(15, "value"))
    return {"kind": "states", "metric_label": "HIT as % of fixed assets",
            "table": records(by_state), "total_hospitals": int(by_state["hospitals"].sum())}


# Analysis 4: hospitals at risk ----
# A hospital is at risk when its burden is above the threshold and its margin
# is below zero: it gives a lot of uncompensated care and is losing money.

def analysis_at_risk(state_code=None, threshold=10, min_beds=0):
    pts = scatter_points(state_code, min_beds)
    risky = pts[(pts["burden"] > threshold) & (pts["margin"] < 0)].sort_values("burden", ascending=False)
    cols = ["Hospital Name", "City", "State Code", "Ownership", "Number of Beds", "burden", "margin"]
    return {
        "threshold": threshold,
        "total_hospitals": int(len(pts)),
        "at_risk": int(len(risky)),
        "share": float(len(risky) / len(pts)) if len(pts) else None,
        "by_ownership": {k: int(v) for k, v in risky["Ownership"].value_counts().items()},
        "hospitals": records(risky[cols].rename(columns={"Hospital Name": "name", "City": "city",
                                                         "State Code": "state", "Ownership": "ownership",
                                                         "Number of Beds": "beds"})),
    }


# Summary for the header ----

def summary_stats(state_code=None):
    data = filter_by_state(get_full_dataset(), state_code)
    hit = data["Health Information Technology Designated Assets"]
    return {
        "total_hospitals": int(len(data)),
        "avg_beds": float(data["Number of Beds"].mean()),
        "median_beds": float(data["Number of Beds"].median()),
        "avg_uncomp_care": float(data["Cost of Uncompensated Care"].mean()),
        "total_uncomp_care": float(data["Cost of Uncompensated Care"].sum()),
        "hospitals_with_hit": int((hit > 0).sum()),
        "ownership_distribution": {k: int(v) for k, v in data["Control Group"].value_counts().items()},
        "broad_ownership": {k: int(v) for k, v in data["Ownership"].value_counts().items()},
        "missing_data": {
            "revenue": int(data["Total Patient Revenue"].isna().sum()),
            "beds": int(data["Number of Beds"].isna().sum()),
            "hit": int((hit.fillna(0) == 0).sum()),
        },
    }
