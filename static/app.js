let lastRefresh = new Date();
let dashboardBusy = false;
let automationBusy = false;

const automationReasons = {
    automation_disabled: "Die Ladeautomatik ist deaktiviert.",
    waiting_for_first_evaluation: "Die erste Prüfung läuft.",
    above_on_threshold: "Akku über 30 % und Ladestecker verbunden: Smart Plug wurde eingeschaltet.",
    above_on_threshold_plug_already_on: "Akku über 30 %: Smart Plug ist bereits eingeschaltet.",
    below_off_threshold: "Akku unter 10 %: Smart Plug wurde ausgeschaltet.",
    below_off_threshold_plug_already_off: "Akku unter 10 %: Smart Plug ist bereits ausgeschaltet.",
    within_hysteresis_band: "Akku zwischen 10 % und 30 %: aktueller Zustand bleibt bestehen.",
    cable_not_connected: "Ladestecker nicht verbunden: Smart Plug wurde sicher ausgeschaltet.",
    cable_not_connected_plug_already_off: "Ladestecker nicht verbunden: Smart Plug bleibt ausgeschaltet.",
    solix_soc_unknown: "Solix-Ladestand unbekannt: Smart Plug wurde sicher ausgeschaltet.",
    solix_soc_unknown_plug_already_off: "Solix-Ladestand unbekannt: Smart Plug bleibt ausgeschaltet."
};

const automationDryRunReasons = {
    above_on_threshold: "Testbetrieb: Smart Plug würde jetzt eingeschaltet.",
    below_off_threshold: "Testbetrieb: Smart Plug würde jetzt ausgeschaltet.",
    cable_not_connected: "Testbetrieb: Smart Plug würde wegen des Ladesteckers ausgeschaltet.",
    solix_soc_unknown: "Testbetrieb: Smart Plug würde wegen unbekanntem Solix-Ladestand ausgeschaltet."
};

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

    if (dashboardBusy)
        return;

    dashboardBusy = true;

    try {

        const response =
            await fetch("/api/live");

        if (!response.ok)
            throw new Error("Solix API: HTTP " + response.status);

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
    finally {

        dashboardBusy = false;

    }

}

async function updateAutomation() {

    if (automationBusy)
        return;

    automationBusy = true;

    try {

        const response = await fetch("/api/automation");

        if (!response.ok)
            throw new Error("Automation API: HTTP " + response.status);

        const data = await response.json();
        const badge = document.getElementById("automationStatus");

        badge.className = "automation-badge";
        if (data.error) {
            badge.classList.add("error");
            badge.innerText = "Fehler";
        }
        else if (data.enabled && data.running && data.dry_run) {
            badge.classList.add("pending");
            badge.innerText = "Testbetrieb";
        }
        else if (data.enabled && data.running) {
            badge.classList.add("active");
            badge.innerText = "Aktiv";
        }
        else {
            badge.classList.add("inactive");
            badge.innerText = "Inaktiv";
        }

        document.getElementById("audiPlug").innerText =
            data.audi_plug_connected === true ? "Verbunden" :
            data.audi_plug_connected === false ? "Getrennt" : "Unbekannt";

        document.getElementById("automationSoc").innerText =
            data.solix_battery_percent == null ? "--" :
            data.solix_battery_percent + " %";

        const smartPlug = data.smartplug || {};
        document.getElementById("smartPlug").innerText =
            smartPlug.state === true ? "Eingeschaltet" :
            smartPlug.state === false ? "Ausgeschaltet" :
            smartPlug.available ? "Bereit" : "Nicht gefunden";

        document.getElementById("automationReason").innerText =
            data.error ||
            (data.dry_run && automationDryRunReasons[data.reason]) ||
            automationReasons[data.reason] ||
            "Automatik wartet auf neue Daten.";

    }
    catch (e) {

        const badge = document.getElementById("automationStatus");
        badge.className = "automation-badge error";
        badge.innerText = "Fehler";
        document.getElementById("automationReason").innerText =
            "Automatikstatus konnte nicht geladen werden.";
        console.log(e);

    }
    finally {

        automationBusy = false;

    }

}

updateDashboard();
updateAutomation();

setInterval(updateDashboard, 15000);

setInterval(updateAutomation, 30000);

setInterval(updateLastRefresh, 1000);
