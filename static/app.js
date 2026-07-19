async function updateDashboard() {

    try {

        const response = await fetch("/api/live");
        const data = await response.json();

        document.getElementById("pv").textContent =
            `${data.pv_total ?? 0} W`;

        document.getElementById("battery").textContent =
            `${data.battery_percent ?? 0} %`;

        document.getElementById("battery-fill").style.width =
            `${data.battery_percent ?? 0}%`;

        document.getElementById("batteryPower").textContent =
            `${data.battery_power ?? 0} W`;

        document.getElementById("house").textContent =
            `${data.home_load ?? 0} W`;

        document.getElementById("grid").textContent =
            `${data.grid_power ?? 0} W`;

        document.getElementById("wifi").textContent =
            `${data.wifi_signal ?? 0} %`;

        document.getElementById("flowPV").textContent =
            `${data.pv_total ?? 0} W`;

        document.getElementById("flowBattery").textContent =
            `${data.battery_percent ?? 0} %`;

        document.getElementById("flowHouse").textContent =
            `${data.home_load ?? 0} W`;

        document.getElementById("flowGrid").textContent =
            `${data.grid_power ?? 0} W`;

        document.getElementById("pv1").textContent =
            `${data.pv1 ?? 0} W`;

        document.getElementById("pv2").textContent =
            `${data.pv2 ?? 0} W`;

        document.getElementById("pv3").textContent =
            `${data.pv3 ?? 0} W`;

        document.getElementById("pv4").textContent =
            `${data.pv4 ?? 0} W`;

    } catch (err) {

        console.error(err);

    }

}

updateDashboard();

setInterval(updateDashboard, 5000);
