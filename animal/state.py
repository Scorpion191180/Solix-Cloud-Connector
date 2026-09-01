"""Small, process-safe persistent store for shared animal-care values."""

from __future__ import annotations

import json
import os
from pathlib import Path
import threading
import time
from typing import Any
from uuid import uuid4


# Jede reale Station besitzt ihren eigenen persistenten Vorrat. Die leicht
# unterschiedlichen Tagesverbräuche bilden die individuellen Fress- und
# Trinkmengen der Tiere ab und verhindern, dass alle Anzeigen synchron fallen.
RESOURCE_DAILY_USE_PERCENT = {
    "hay_horse": 82.0,
    "hay_camel_pool": 94.0,
    "hay_camel_pergola": 76.0,
    "water_horse": 91.0,
    "water_camel_pool": 96.0,
    "water_camel_pergola": 84.0,
}
RESOURCE_KEYS = tuple(RESOURCE_DAILY_USE_PERCENT)


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
            "hay_camel_pool": 100.0,
            "hay_camel_pergola": 100.0,
            "water_horse": 100.0,
            "water_camel_pool": 100.0,
            "water_camel_pergola": 100.0,
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
            # Bestehende Render-Installationen hatten je Tiergruppe nur einen
            # Sammelwert. Beim ersten Start nach dem Update wird er verlustfrei
            # auf beide physische Kamelstationen übernommen.
            if "hay_camels" in stored:
                stored.setdefault("hay_camel_pool", stored["hay_camels"])
                stored.setdefault("hay_camel_pergola", stored["hay_camels"])
            if "water_camels" in stored:
                stored.setdefault("water_camel_pool", stored["water_camels"])
                stored.setdefault("water_camel_pergola", stored["water_camels"])
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
        for key in RESOURCE_KEYS:
            use = elapsed * RESOURCE_DAILY_USE_PERCENT[key] / 86400.0
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
        hay_camels = round((
            self._state["hay_camel_pool"] + self._state["hay_camel_pergola"]
        ) / 2, 2)
        water_camels = round((
            self._state["water_camel_pool"] + self._state["water_camel_pergola"]
        ) / 2, 2)
        hay = round((self._state["hay_horse"] + hay_camels) / 2, 1)
        water = round((self._state["water_horse"] + water_camels) / 2, 1)
        return {
            "available": True,
            "hay_percent": hay,
            "water_percent": water,
            "hay_horse": round(self._state["hay_horse"], 2),
            # Die Sammelfelder bleiben für ältere Browser-Versionen erhalten.
            "hay_camels": hay_camels,
            "hay_camel_pool": round(self._state["hay_camel_pool"], 2),
            "hay_camel_pergola": round(self._state["hay_camel_pergola"], 2),
            "water_horse": round(self._state["water_horse"], 2),
            "water_camels": water_camels,
            "water_camel_pool": round(self._state["water_camel_pool"], 2),
            "water_camel_pergola": round(self._state["water_camel_pergola"], 2),
            "resources": {
                key: round(self._state[key], 2) for key in RESOURCE_KEYS
            },
            "droppings": list(self._state["droppings"]),
            "updated_at": self._state["updated_at"],
            "revision": self._state["revision"],
        }

    def get(self) -> dict[str, Any]:
        with self._lock:
            if self._apply_elapsed_use(time.time()):
                self._save()
            return self._payload()

    def action(self, action: str, resource: str | None = None) -> dict[str, Any]:
        with self._lock:
            self._apply_elapsed_use(time.time())
            if action == "refill_hay":
                for key in RESOURCE_KEYS:
                    if key.startswith("hay_"):
                        self._state[key] = 100.0
            elif action == "refill_water":
                for key in RESOURCE_KEYS:
                    if key.startswith("water_"):
                        self._state[key] = 100.0
            elif action == "refill_resource":
                if resource not in RESOURCE_KEYS:
                    raise ValueError("Unbekannte Futter- oder Wasserstelle")
                self._state[resource] = 100.0
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
