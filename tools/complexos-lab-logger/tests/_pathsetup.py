"""Path bootstrap so `python -m unittest discover -s .../tests` finds the package."""

from __future__ import annotations

import sys
from pathlib import Path

_PKG_ROOT = Path(__file__).resolve().parents[1]
_root = str(_PKG_ROOT)
if _root not in sys.path:
    sys.path.insert(0, _root)
