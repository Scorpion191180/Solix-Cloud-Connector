from contextlib import asynccontextmanager
import hmac
import os

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

from animal.state import AnimalStateStore
from audi.client import AudiClient
from automation.controller import ChargingAutomation
from solix.client import SolixClient
from weather.client import WeatherClient

client = SolixClient()
audi_client = AudiClient()
charging_automation = ChargingAutomation(client, audi_client)
weather_client = WeatherClient()
animal_state = AnimalStateStore()


class ManualSmartPlugCommand(BaseModel):
    enabled: bool


class AutomationSettingsUpdate(BaseModel):
    on_threshold_percent: int = Field(ge=20, le=90)
    off_threshold_percent: int = Field(ge=0, le=89)


class AnimalActionCommand(BaseModel):
    action: str
    resource: str | None = None


class AnimalDroppingCommand(BaseModel):
    kind: str
    x: float = Field(ge=-50, le=50)
    z: float = Field(ge=-50, le=50)


def _manual_control_configured() -> bool:
    enabled = os.getenv("SMARTPLUG_MANUAL_CONTROL", "false").strip().lower()
    token = os.getenv("SMARTPLUG_CONTROL_TOKEN", "").strip()
    return enabled in {"1", "true", "yes", "on"} and bool(token)


def _authorize_manual_control(provided_token: str | None) -> None:
    expected_token = os.getenv("SMARTPLUG_CONTROL_TOKEN", "").strip()
    if not _manual_control_configured():
        raise HTTPException(
            status_code=503,
            detail="Manuelle Smart-Plug-Steuerung ist nicht eingerichtet",
        )
    if not provided_token or not hmac.compare_digest(
        provided_token.encode("utf-8"), expected_token.encode("utf-8")
    ):
        raise HTTPException(status_code=401, detail="Steuer-Code ist nicht korrekt")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    await audi_client.start()
    await client.start_telemetry()
    await charging_automation.start()
    yield
    await charging_automation.stop()
    await audi_client.close()
    await client.close()
    await weather_client.close()


app = FastAPI(lifespan=lifespan)

# Templates und statische Dateien
templates = Jinja2Templates(directory="templates")
app.mount("/static", StaticFiles(directory="static"), name="static")


@app.get("/", response_class=HTMLResponse)
async def dashboard(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html"
    )


@app.get("/api/status")
async def status():
    data = await client.get_status()
    return {
        "site_count": len(data["sites"]),
        "device_count": len(data["devices"]),
        "sites": list(data["sites"].keys()),
        "devices": list(data["devices"].keys()),
    }


@app.get("/api/site")
async def site():
    return await client.get_site()


@app.get("/api/device")
async def device():
    return await client.get_devices()


@app.get("/api/live")
async def live():
    return await client.get_live()


@app.get("/api/audi")
async def audi():
    """Return optional read-only Audi Connect data from the protected cache."""
    return await audi_client.get_live()


@app.get("/api/weather")
async def weather():
    """Return cached live weather for the configured house coordinates."""
    return await weather_client.get_live()


@app.get("/api/animals")
async def animals():
    """Return the shared care state used by every browser and device."""
    return animal_state.get()


@app.post("/api/animals/action")
async def animal_action(command: AnimalActionCommand):
    """Refill food/water or clean the shared virtual property."""
    try:
        return animal_state.action(command.action, command.resource)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@app.post("/api/animals/droppings")
async def animal_dropping(command: AnimalDroppingCommand):
    """Add one simulated dropping to the shared property state."""
    return animal_state.add_dropping(command.kind, command.x, command.z)


@app.get("/api/automation")
async def automation():
    """Return the safe public status of the background charging controller."""
    status = charging_automation.status()
    status["manual_control_available"] = _manual_control_configured()
    return status


@app.post("/api/smartplug/manual")
async def manual_smartplug(
    command: ManualSmartPlugCommand,
    x_control_token: str | None = Header(default=None),
):
    """Run an authenticated manual test without disabling automation dry-run."""
    _authorize_manual_control(x_control_token)

    if command.enabled:
        audi_data = await audi_client.get_live()
        if (
            audi_data.get("available") is not True
            or audi_data.get("plug_connected") is not True
        ):
            raise HTTPException(
                status_code=409,
                detail="Einschalten ist nur bei verbundenem Audi-Ladestecker möglich",
            )
        audi_battery_percent = audi_data.get("battery_percent")
        if (
            not isinstance(audi_battery_percent, bool)
            and isinstance(audi_battery_percent, (int, float))
            and audi_battery_percent >= 100
        ):
            raise HTTPException(
                status_code=409,
                detail="Einschalten ist bei 100 % Audi-Ladestand gesperrt",
            )
        if (
            audi_data.get("presence_configured") is True
            and audi_data.get("at_home") is not True
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Einschalten ist nur möglich, wenn der Audi sicher am Haus erkannt wird"
                ),
            )

        solix_data = await client.get_live()
        battery_percent = solix_data.get("battery_percent")
        if (
            solix_data.get("stale") is True
            or isinstance(battery_percent, bool)
            or not isinstance(battery_percent, (int, float))
            or battery_percent < 10
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "Einschalten ist bei veralteten Solix-Daten gesperrt"
                    if solix_data.get("stale") is True
                    else "Einschalten ist unter 10 % Solix-Ladestand gesperrt"
                ),
            )

    try:
        result = await client.set_smartplug_power(command.enabled)
    except Exception as exc:
        charging_automation.record_manual_error(exc)
        raise HTTPException(
            status_code=503,
            detail="Smart Plug konnte nicht geschaltet werden; Details stehen im Render-Log",
        ) from exc

    charging_automation.record_manual_result(result, command.enabled)
    return {
        "ok": True,
        "requested_state": command.enabled,
        "smartplug": result,
    }


@app.post("/api/automation/settings")
async def update_automation_settings(
    settings: AutomationSettingsUpdate,
    x_control_token: str | None = Header(default=None),
):
    """Change both protected hysteresis limits without switching now."""
    _authorize_manual_control(x_control_token)
    try:
        status = await charging_automation.set_thresholds(
            settings.on_threshold_percent,
            settings.off_threshold_percent,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "ok": True,
        "on_threshold_percent": status["on_threshold_percent"],
        "off_threshold_percent": status["off_threshold_percent"],
        "applies_on_next_evaluation": True,
    }
