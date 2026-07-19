from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from solix.client import SolixClient

app = FastAPI()

client = SolixClient()


@app.get("/")
async def dashboard():
    return HTMLResponse("""
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Solix Control</title>

<style>

body{
    font-family:Arial;
    background:#101214;
    color:white;
    text-align:center;
    margin:0;
    padding:20px;
}

h1{
    color:#37d67a;
}

.card{
    background:#1d1f23;
    border-radius:18px;
    padding:18px;
    margin:12px;
    font-size:24px;
}

.value{
    font-size:42px;
    font-weight:bold;
}

.bar{
    width:100%;
    height:22px;
    background:#333;
    border-radius:15px;
    overflow:hidden;
}

.fill{
    height:22px;
    background:#37d67a;
    width:0%;
}

</style>

</head>

<body>

<h1>☀️ Solix Control</h1>

<div class="card">
PV Leistung
<div class="value" id="pv">--</div>
</div>

<div class="card">
Akku

<div class="value" id="battery">-- %</div>

<div class="bar">
<div class="fill" id="batterybar"></div>
</div>

</div>

<div class="card">
Akku Leistung
<div class="value" id="batterypower">--</div>
</div>

<div class="card">
Hausverbrauch
<div class="value" id="house">--</div>
</div>

<script>

async function update(){

const r=await fetch("/api/live");

const d=await r.json();

document.getElementById("pv").innerHTML=d.pv_total+" W";

document.getElementById("battery").innerHTML=d.battery_percent+" %";

document.getElementById("batterybar").style.width=d.battery_percent+"%";

document.getElementById("batterypower").innerHTML=d.battery_power+" W";

document.getElementById("house").innerHTML=d.home_load+" W";

}

update();

setInterval(update,5000);

</script>

</body>
</html>
""")


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
