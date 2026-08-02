from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from audi.client import AudiClient
from solix.client import SolixClient

client = SolixClient()
audi_client = AudiClient()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await audi_client.close()


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
