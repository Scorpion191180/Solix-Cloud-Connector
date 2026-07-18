from fastapi import FastAPI

app = FastAPI(title="Solix Cloud Connector")


@app.get("/")
async def root():
    return {"message": "Solix Cloud Connector läuft"}


@app.get("/health")
async def health():
    return {
        "status": "ok"
    }


@app.get("/api/status")
async def status():
    return {
        "online": True,
        "source": "demo",
        "battery": 0,
        "pv": 0,
        "grid": 0
    }
