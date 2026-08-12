"""Small, process-safe persistent store for shared animal-care values."""

from __future__ import annotations

import json
import os
from pathlib import Path
import threading
import time
from typing import Any
from uuid import uuid4


DAILY_USE_PERCENT = 88.0
RESOURCE_KEYS = ("hay_horse", "hay_camels", "water_horse", "water_camels")


class AnimalStateStore:
    """Keep hay, water and droppings equal across all connected browsers."""

    def __init__(self, path: str | Path | None = None) -> None:
        self.path = Path(path or os.getenv(
            "ANIMAL_STATE_FILE", "/tmp/solix-animal-state.json"
        ))
        self._lock = threading.RLock()
        self._state = self._load()

    @staticmethod
    def _defaults() -> dict[str, Any]:
        return {
            "hay_horse": 100.0,
            "hay_camels": 100.0,
            "water_horse": 100.0,
            "water_camels": 100.0,
            "droppings": [],
            "updated_at": time.time(),
            "revision": 1,
        }

    def _load(self) -> dict[str, Any]:
        defaults = self._defaults()
        try:
            stored = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(stored, dict):
                return defaults
            state = {**defaults, **stored}
            for key in RESOURCE_KEYS:
                state[key] = max(0.0, min(100.0, float(state.get(key, 100))))
            state["droppings"] = (
                state.get("droppings", [])[-360:]
                if isinstance(state.get("droppings"), list)
                else []
            )
            state["updated_at"] = float(state.get("updated_at") or time.time())
            state["revision"] = int(state.get("revision") or 1)
            return state
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return defaults

    def _apply_elapsed_use(self, now: float) -> bool:
        elapsed = max(0.0, min(now - float(self._state["updated_at"]), 7 * 86400))
        if elapsed < 0.5:
            return False
        use = elapsed * DAILY_USE_PERCENT / 86400.0
        for key in RESOURCE_KEYS:
            self._state[key] = max(0.0, float(self._state[key]) - use)
        self._state["updated_at"] = now
        return True

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(self.path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(self._state, ensure_ascii=False, separators=(",", ":")),
            encoding="utf-8",
        )
        temporary.replace(self.path)

    def _payload(self) -> dict[str, Any]:
        hay = round((self._state["hay_horse"] + self._state["hay_camels"]) / 2, 1)
        water = round((self._state["water_horse"] + self._state["water_camels"]) / 2, 1)
        return {
            "available": True,
            "hay_percent": hay,
            "water_percent": water,
            "hay_horse": round(self._state["hay_horse"], 2),
            "hay_camels": round(self._state["hay_camels"], 2),
            "water_horse": round(self._state["water_horse"], 2),
            "water_camels": round(self._state["water_camels"], 2),
            "droppings": list(self._state["droppings"]),
            "updated_at": self._state["updated_at"],
            "revision": self._state["revision"],
        }

    def get(self) -> dict[str, Any]:
        with self._lock:
            if self._apply_elapsed_use(time.time()):
                self._save()
            return self._payload()

    def action(self, action: str) -> dict[str, Any]:
        with self._lock:
            self._apply_elapsed_use(time.time())
            if action == "refill_hay":
                self._state["hay_horse"] = 100.0
                self._state["hay_camels"] = 100.0
            elif action == "refill_water":
                self._state["water_horse"] = 100.0
                self._state["water_camels"] = 100.0
            elif action == "clean":
                self._state["droppings"] = []
            else:
                raise ValueError("Unbekannte Tierpflege-Aktion")
            self._state["revision"] += 1
            self._state["updated_at"] = time.time()
            self._save()
            return self._payload()

    def add_dropping(self, kind: str, x: float, z: float) -> dict[str, Any]:
        with self._lock:
            self._apply_elapsed_use(time.time())
            self._state["droppings"].append({
                "id": uuid4().hex,
                "kind": "Pferd" if kind == "Pferd" else "Kamel",
                "x": round(float(x), 3),
                "z": round(float(z), 3),
                "created_at": time.time(),
            })
            self._state["droppings"] = self._state["droppings"][-360:]
            self._state["revision"] += 1
            self._state["updated_at"] = time.time()
            self._save()
            return self._payload()
