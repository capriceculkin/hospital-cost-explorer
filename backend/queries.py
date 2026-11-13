# queries.py
# Loads the cleaned 2022 CMS Hospital Provider Cost Report once and hands out
# copies of it. Also adds readable ownership labels, since the file only has
# the numeric Type of Control code.

import os
import pandas as pd

DATA_PATH = os.path.join(
    os.path.dirname(os.path.dirname(__file__)),
    "data",
    "HospitalProviderCostReport_DataFrame_clean.csv",
)

finaldf = pd.read_csv(DATA_PATH)


# Ownership labels ----
# Type of Control codes from the cost report (Worksheet S-2), plus the three
# broad groups they roll up to.

type_of_control_map = {
    1: "Voluntary, Non Profit, Church",
    2: "Voluntary, Non Profit, Other",
    3: "Proprietary, Individual",
    4: "Proprietary, Corporation",
    5: "Proprietary, Partnership",
    6: "Proprietary, Other",
    7: "Governmental, Federal",
    8: "Governmental, City & County",
    9: "Governmental, County",
    10: "Governmental, State",
    11: "Governmental, Hospital District",
    12: "Governmental, City",
    13: "Governmental, Other",
}


def broad_ownership(code):
    if code in (1, 2):
        return "Non-profit"
    if code in (3, 4, 5, 6):
        return "For-profit"
    if 7 <= code <= 13:
        return "Government"
    return "Other"


def get_full_dataset():
    data = finaldf.copy()
    data["Control Group"] = data["Type of Control"].map(type_of_control_map).fillna("Other")
    data["Ownership"] = data["Type of Control"].map(broad_ownership)
    return data


def get_states():
    return sorted(finaldf["State Code"].dropna().unique().tolist())


def filter_by_state(data, state_code):
    if state_code and state_code != "all":
        return data[data["State Code"] == state_code].copy()
    return data
