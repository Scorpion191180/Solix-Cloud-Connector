let lastRefresh = new Date();

function setBatteryColor(percent) {

    const battery = document.getElementById("battery-fill");

    if (percent < 20) {
        battery.style.background = "linear-gradient(90deg,#ef4444,#dc2626)";
    }
    else if (percent < 60) {
        battery.style.background = "linear-gradient(90deg,#facc15,#f59e0b)";
    }
    else {
        battery.style.background = "linear-gradient(90deg,#22c55e,#16a34a)";
    }

    battery.style.width = percent + "%";
}

function setPVBar(id, watt) {

    const maxPower = 500;

    let percent = (watt / maxPower) * 100;

    if (percent > 100)
        percent = 100;

    document.getElementById(id).style.width = percent + "%";
}

function updateLastRefresh() {

    const seconds =
        Math.floor((new Date() - lastRefresh) / 1000);

    document.getElementById("lastUpdate").innerText =
        "vor " + seconds + " Sek.";
}

async function updateDashboard() {

    try {

        const response =
            await fetch("/api/live");

        const data =
            await response.json();

        lastRefresh = new Date();

        document.getElementById("pv").innerText =
            data.pv_total + " W";

        document.getElementById("battery").innerText =
            data.battery_percent + " %";

        document.getElementById("batteryWh").innerText =
            data.battery_energy_wh + " Wh";

        document.getElementById("batteryPower").innerText =
            data.battery_power + " W";

        document.getElementById("house").innerText =
            data.home_load + " W";

        document.getElementById("grid").innerText =
            data.grid_power + " W";

        document.getElementById("wifi").innerText =
            data.wifi_signal + " %";

        document.getElementById("flowPV").innerText =
            data.pv_total + " W";

        document.getElementById("flowBattery").innerText =
            data.battery_percent + " %";

        document.getElementById("flowHouse").innerText =
            data.home_load + " W";

        document.getElementById("flowGrid").innerText =
            data.grid_power + " W";

        document.getElementById("pv1").innerText =
            data.pv1 + " W";

        document.getElementById("pv2").innerText =
            data.pv2 + " W";

        document.getElementById("pv3").innerText =
            data.pv3 + " W";

        document.getElementById("pv4").innerText =
            data.pv4 + " W";

        setBatteryColor(data.battery_percent);

        setPVBar("pv1bar", data.pv1);
        setPVBar("pv2bar", data.pv2);
        setPVBar("pv3bar", data.pv3);
        setPVBar("pv4bar", data.pv4);

    }
    catch (e) {

        console.log(e);

    }

}

updateDashboard();

setInterval(updateDashboard, 5000);

setInterval(updateLastRefresh, 1000);
