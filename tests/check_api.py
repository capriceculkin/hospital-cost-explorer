# check_api.py
# Calls every API endpoint and checks the answers, without starting a server
# (it uses Flask's test client). Also recounts the at-risk hospitals straight
# from the CSV as a second, independent check.
#
# Run from the repo root: python tests/check_api.py

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app
from backend.queries import DATA_PATH

client = app.test_client()


def get(path, **params):
    r = client.get(path, query_string=params)
    assert r.status_code == 200, f"{path} returned {r.status_code}"
    return r.get_json()


# Every endpoint answers ----

assert get("/api/analyses")["analyses"], "no analyses listed"
states = get("/api/states")["states"]
print(f"states and territories: {len(states)}")

summary = get("/api/summary_stats")
print(f"hospitals: {summary['total_hospitals']:,}, with HIT assets: {summary['hospitals_with_hit']}")

own = get("/api/ownership", state="CA", normalize_by="beds")["data"]
print(f"ownership, CA per bed: {len(own['table'])} ownership types")

scatter = get("/api/scatter", state="NY", min_beds=100)["data"]
print(f"scatter, NY 100+ beds: {scatter['stats']['total_hospitals']} hospitals")

for metric in ["hit_share", "hit_per_bed", "hit_vs_assets", "state_comparison"]:
    hit = get("/api/hit_capital", metric_type=metric)["data"]
    print(f"hit_capital {metric}: {hit['total_hospitals']} hospitals")


# Second check: at-risk counts recomputed by hand ----

raw = pd.read_csv(DATA_PATH)
burden = raw["Cost of Uncompensated Care"] / raw["Total Patient Revenue"] * 100
margin = raw["Net Income"] / raw["Total Patient Revenue"] * 100
usable = np.isfinite(burden) & np.isfinite(margin)

for threshold in (5, 10, 20):
    by_hand = int(((burden > threshold) & (margin < 0) & usable).sum())
    from_api = get("/api/risk", threshold=threshold)["data"]["at_risk"]
    assert by_hand == from_api, f"threshold {threshold}: API {from_api}, by hand {by_hand}"
    print(f"at risk above {threshold}% burden: {from_api} (matches a count straight from the CSV)")

print("All checks passed")
