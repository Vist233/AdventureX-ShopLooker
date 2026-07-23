#!/usr/bin/env python3
"""Build the public-only Pages artifact for 店判.

The working directory includes research and analysis code.  This script copies
only assets that are intended to be publicly reachable into dist/.
"""

from __future__ import annotations

import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DIST = ROOT / "dist"
PUBLIC_FILES = ("index.html", "styles.css", "decision-engine.js", "app.js")
PUBLIC_DATA = ("corpus_analysis.json",)


def main() -> None:
    if DIST.exists():
        shutil.rmtree(DIST)
    (DIST / "data").mkdir(parents=True)

    for filename in PUBLIC_FILES:
        shutil.copy2(ROOT / filename, DIST / filename)
    for filename in PUBLIC_DATA:
        shutil.copy2(ROOT / "data" / filename, DIST / "data" / filename)

    (DIST / "_headers").write_text(
        """/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: SAMEORIGIN
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(self)
  Cache-Control: public, max-age=300
""",
        encoding="utf-8",
    )
    print(f"Built public artifact: {DIST}")


if __name__ == "__main__":
    main()
