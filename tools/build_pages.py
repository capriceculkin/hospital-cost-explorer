# build_pages.py
# Builds a static copy of the site in docs/ so it can run on GitHub Pages,
# with no Flask server. The page is the same; the only difference is that the
# hospital data ships as a file (docs/static/data/hospitals.js) instead of
# coming from /api/hospitals.
#
# Run from the repo root: python tools/build_pages.py
# Then on GitHub: Settings > Pages > deploy from the main branch, /docs folder.

import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import app
from backend.queries import get_hospital_rows

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs")


# Page ----
# Render the Flask template once, then make every /static/ path relative so it
# works under capriceculkin.github.io/hospital-cost-explorer/.

html = app.test_client().get("/").data.decode()
html = html.replace('"/static/', '"static/')
html = html.replace(
    '<script src="static/js/story.js"></script>',
    '<script src="static/data/hospitals.js"></script>\n  <script src="static/js/story.js"></script>',
)
# there is no API on Pages, so point people at the repo for the data instead
html = html.replace(
    "The data is also available as JSON at <code>/api/hospitals</code>.",
    'The data and code are on <a href="https://github.com/capriceculkin/hospital-cost-explorer" target="_blank" rel="noopener">GitHub</a>.',
)


# Files ----

dest_static = os.path.join(OUT, "static")
if os.path.exists(dest_static):
    shutil.rmtree(dest_static)                                   # rebuilt every time
shutil.copytree(os.path.join(ROOT, "static"), dest_static)
os.makedirs(os.path.join(dest_static, "data"), exist_ok=True)

with open(os.path.join(dest_static, "data", "hospitals.js"), "w") as f:
    f.write("window.HOSPITALS = " + json.dumps(get_hospital_rows(), separators=(",", ":")) + ";\n")

with open(os.path.join(OUT, "index.html"), "w") as f:
    f.write(html)

open(os.path.join(OUT, ".nojekyll"), "w").close()                 # serve files as they are

print("Built docs/index.html and docs/static/")
