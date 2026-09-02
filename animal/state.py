"""Small, process-safe persistent store for shared animal-care values."""

from __future__ import annotations

from datetime import datetime, timedelta
import json
import os
from pathlib import Path
import threading
import time
from typing import Any
from uuid import uuid4
from zoneinfo import ZoneInfo


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
    # Der Hund trinkt kontinuierlich; das Futter wird dagegen unten zu zwei
    # festen Mahlzeiten pro Tag abgezogen.
    "dog_water": 78.0,
}
RESOURCE_KEYS = (*RESOURCE_DAILY_USE_PERCENT, "dog_food")
HOUSE_TIMEZONE = ZoneInfo("Europe/Berlin")
DOG_MEAL_PERCENT = 45.0
MOTION_LEASE_SECONDS = 6.0
MAX_MOTION_ANIMALS = 56


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
            "dog_food": 100.0,
            "dog_water": 100.0,
            "dog_last_meal_key": None,
            "dog_hungry": False,
            "droppings": [],
            "motion": {
                "leader_id": None,
                "leader_until": 0.0,
                "sampled_at": 0.0,
                "revision": 0,
                "animals": [],
            },
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
            state["dog_last_meal_key"] = (
                str(state.get("dog_last_meal_key") or "") or None
            )
            state["dog_hungry"] = bool(state.get("dog_hungry", False))
            motion = state.get("motion")
            if not isinstance(motion, dict):
                motion = defaults["motion"]
            animals = motion.get("animals")
            state["motion"] = {
                "leader_id": str(motion.get("leader_id") or "") or None,
                "leader_until": float(motion.get("leader_until") or 0),
                "sampled_at": float(motion.get("sampled_at") or 0),
                "revision": int(motion.get("revision") or 0),
                "animals": animals[-MAX_MOTION_ANIMALS:]
                if isinstance(animals, list) else [],
            }
            return state
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            return defaults

    def _apply_elapsed_use(self, now: float) -> bool:
        elapsed = max(0.0, min(now - float(self._state["updated_at"]), 7 * 86400))
        changed = False
        if elapsed >= 0.5:
            changed = True
            for key in RESOURCE_DAILY_USE_PERCENT:
                use = elapsed * RESOURCE_DAILY_USE_PERCENT[key] / 86400.0
                self._state[key] = max(0.0, float(self._state[key]) - use)
            self._state["updated_at"] = now
        return self._apply_dog_meal(now) or changed

    @staticmethod
    def _dog_meal_key(now: float) -> str:
        """Return the latest scheduled dog meal in local house time."""
        local = datetime.fromtimestamp(now, HOUSE_TIMEZONE)
        if local.hour >= 18:
            slot_date, slot = local.date(), "evening"
        elif local.hour >= 7:
            slot_date, slot = local.date(), "morning"
        else:
            slot_date, slot = (local - timedelta(days=1)).date(), "evening"
        return f"{slot_date.isoformat()}-{slot}"

    def _apply_dog_meal(self, now: float) -> bool:
        """Serve breakfast and dinner once; an empty bowl keeps hunger active."""
        meal_key = self._dog_meal_key(now)
        if self._state.get("dog_last_meal_key") == meal_key:
            return False
        food = float(self._state.get("dog_food", 0))
        if food + 1e-6 < DOG_MEAL_PERCENT:
            changed = self._state.get("dog_hungry") is not True
            self._state["dog_hungry"] = True
            return changed
        self._state["dog_food"] = max(0.0, food - DOG_MEAL_PERCENT)
        self._state["dog_last_meal_key"] = meal_key
        self._state["dog_hungry"] = False
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
        now = time.time()
        motion = self._state.get("motion", {})
        leader_active = bool(
            motion.get("leader_id")
            and float(motion.get("leader_until") or 0) > now
        )
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
            "dog_food": round(self._state["dog_food"], 2),
            "dog_water": round(self._state["dog_water"], 2),
            "dog_hungry": bool(self._state.get("dog_hungry", False)),
            "dog_last_meal_key": self._state.get("dog_last_meal_key"),
            "resources": {
                key: round(self._state[key], 2) for key in RESOURCE_KEYS
            },
            "droppings": list(self._state["droppings"]),
            "motion": {
                "leader_active": leader_active,
                "sampled_at": float(motion.get("sampled_at") or 0),
                "revision": int(motion.get("revision") or 0),
                "animals": list(motion.get("animals") or []),
            },
            "server_time": now,
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
                if resource == "dog_food":
                    # War eine Mahlzeit mangels Futter ausgefallen, frisst der
                    # Hund direkt nach dem Auffüllen und beendet das Hungerbellen.
                    self._apply_dog_meal(time.time())
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

    def update_motion(
        self,
        client_id: str,
        animals: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Accept one browser as short-lived motion leader for all devices."""
        with self._lock:
            now = time.time()
            self._apply_elapsed_use(now)
            motion = self._state.setdefault("motion", self._defaults()["motion"])
            current_leader = str(motion.get("leader_id") or "")
            leader_alive = bool(
                current_leader and float(motion.get("leader_until") or 0) > now
            )
            accepted = not leader_alive or current_leader == client_id
            if accepted:
                clean_animals: list[dict[str, Any]] = []
                for item in animals[:MAX_MOTION_ANIMALS]:
                    if not isinstance(item, dict):
                        continue
                    identifier = str(item.get("id") or "")[:64]
                    if not identifier:
                        continue
                    clean_animals.append({
                        "id": identifier,
                        "x": round(float(item.get("x", 0)), 4),
                        "y": round(float(item.get("y", 0)), 4),
                        "z": round(float(item.get("z", 0)), 4),
                        "yaw": round(float(item.get("yaw", 0)), 5),
                        "vx": round(float(item.get("vx", 0)), 4),
                        "vy": round(float(item.get("vy", 0)), 4),
                        "vz": round(float(item.get("vz", 0)), 4),
                        "visible": bool(item.get("visible", True)),
                        "state": str(item.get("state") or "")[:48],
                        "animation": str(item.get("animation") or "")[:64],
                        "target_x": round(float(item.get("target_x", item.get("x", 0))), 4),
                        "target_y": round(float(item.get("target_y", item.get("y", 0))), 4),
                        "target_z": round(float(item.get("target_z", item.get("z", 0))), 4),
                        "state_remaining": round(max(0.0, min(
                            180.0, float(item.get("state_remaining", 0))
                        )), 3),
                    })
                motion.update({
                    "leader_id": client_id,
                    "leader_until": now + MOTION_LEASE_SECONDS,
                    "sampled_at": now,
                    "revision": int(motion.get("revision") or 0) + 1,
                    "animals": clean_animals,
                })
            payload = self._payload()
            payload["motion_write_accepted"] = accepted
            return payload
