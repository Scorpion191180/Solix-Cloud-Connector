let lastRefresh = null;
let refreshIntervalSeconds = 30;
let dashboardBusy = false;
let automationBusy = false;
let audiBusy = false;
let manualControlBusy = false;
let thresholdBusy = false;
let thresholdDirty = false;
let thresholdControlAvailable = false;
let activeStartThreshold = 30;

const automationReasons = {
    automation_disabled: "Die Ladeautomatik ist deaktiviert.",
    waiting_for_first_evaluation: "Die erste Prüfung läuft.",
    below_off_threshold: "Akku unter 10 %: Smart Plug wurde ausgeschaltet.",
    below_off_threshold_plug_already_off: "Akku unter 10 %: Smart Plug ist bereits ausgeschaltet.",
    cable_not_connected: "Ladestecker nicht verbunden: Smart Plug wurde sicher ausgeschaltet.",
    cable_not_connected_plug_already_off: "Ladestecker nicht verbunden: Smart Plug bleibt ausgeschaltet.",
    solix_soc_unknown: "Solix-Ladestand unbekannt: Smart Plug wurde sicher ausgeschaltet.",
    solix_soc_unknown_plug_already_off: "Solix-Ladestand unbekannt: Smart Plug bleibt ausgeschaltet.",
    manual_control: "Der Smart Plug wurde zuletzt manuell getestet.",
    start_threshold_updated: "Der neue Startwert gilt ab der nächsten Prüfung."
};

const automationDryRunReasons = {
    at_or_above_on_threshold: "Testbetrieb: Smart Plug würde jetzt eingeschaltet.",
    below_off_threshold: "Testbetrieb: Smart Plug würde jetzt ausgeschaltet.",
    cable_not_connected: "Testbetrieb: Smart Plug würde wegen des Ladesteckers ausgeschaltet.",
    solix_soc_unknown: "Testbetrieb: Smart Plug würde wegen unbekanntem Solix-Ladestand ausgeschaltet."
};

function getAutomationReason(data) {
    const start = data.on_threshold_percent ?? activeStartThreshold;
    const stop = data.off_threshold_percent ?? 10;

    if (data.audi_data_stale && String(data.reason || "").startsWith("cable_not_connected"))
        return "Audi-Daten sind veraltet: Der Smart Plug bleibt sicher ausgeschaltet. " +
            (data.audi_error || "Audi Connect wird erneut versucht.");

    if (data.reason === "at_or_above_on_threshold")
        return "Solix-Akku ab " + start + " % und Ladestecker verbunden: Smart Plug wurde eingeschaltet.";
    if (data.reason === "at_or_above_on_threshold_plug_already_on")
        return "Solix-Akku ab " + start + " %: Smart Plug ist bereits eingeschaltet.";
    if (data.reason === "within_hysteresis_band")
        return "Solix-Akku zwischen " + stop + " % und " + start + " %: aktueller Zustand bleibt bestehen.";

    return automationReasons[data.reason] || "Automatik wartet auf neue Daten.";
}

function refreshThresholdControls() {
    const slider = document.getElementById("startThreshold");
    const button = document.getElementById("saveStartThreshold");
    slider.disabled = !thresholdControlAvailable || thresholdBusy;
    button.disabled = !thresholdControlAvailable || thresholdBusy || !thresholdDirty;
}

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

    if (!lastRefresh) {
        document.getElementById("lastUpdate").innerText = "verbinde...";
        return;
    }

    const seconds =
        Math.max(0, Math.floor((new Date() - lastRefresh) / 1000));

    document.getElementById("lastUpdate").innerText =
        "Cloud vor " + seconds + " Sek.";

    document.getElementById("tickerCloudTime").innerText =
        lastRefresh.toLocaleTimeString("de-DE") + " · " + seconds + " Sek. alt";

    const delayed = seconds > refreshIntervalSeconds + 20;
    document.getElementById("liveState").innerText = delayed ? "VERZÖGERT" : "LIVE";
    document.querySelector(".status").classList.toggle("delayed", delayed);
}

async function updateDashboard() {

    if (dashboardBusy)
        return;

    dashboardBusy = true;

    try {

        const response =
            await fetch("/api/live", { cache: "no-store" });

        if (!response.ok)
            throw new Error("Solix API: HTTP " + response.status);

        const data =
            await response.json();

        const cloudTime = data.last_update ? new Date(data.last_update) : new Date();
        lastRefresh = Number.isNaN(cloudTime.getTime()) ? new Date() : cloudTime;
        refreshIntervalSeconds = data.refresh_interval_seconds || 30;

        document.getElementById("pv").innerText =
            data.pv_total + " W";

        document.getElementById("battery").innerText =
            data.battery_percent + " %";

        const capacitySuffix =
            data.battery_capacity_source === "configured" ? " (reale Kapazität)" : "";
        document.getElementById("batteryWh").innerText =
            data.battery_energy_wh.toLocaleString("de-DE") + " Wh / " +
            data.battery_capacity_wh.toLocaleString("de-DE") + " Wh" + capacitySuffix;

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

        document.getElementById("tickerBattery").innerText =
            data.battery_percent + " %";

        document.getElementById("tickerPV").innerText =
            data.pv_total + " W";

        document.getElementById("tickerHouse").innerText =
            data.home_load + " W";

        document.getElementById("tickerSource").innerText =
            data.solarbank_model === "AE103" ?
            "Solarbank 4 (AE103)" : "Solarbank " + (data.solarbank_model || "unbekannt");

        document.querySelector(".status").classList.remove("error");
        updateLastRefresh();

        setBatteryColor(data.battery_percent);

        setPVBar("pv1bar", data.pv1);
        setPVBar("pv2bar", data.pv2);
        setPVBar("pv3bar", data.pv3);
        setPVBar("pv4bar", data.pv4);

    }
    catch (e) {

        document.getElementById("liveState").innerText = "FEHLER";
        document.querySelector(".status").classList.add("error");
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
            data.audi_data_stale ? "Daten veraltet" :
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

        const manualAvailable = data.manual_control_available === true;
        thresholdControlAvailable = manualAvailable;
        document.getElementById("controlToken").disabled = !manualAvailable;
        document.getElementById("smartPlugOn").disabled = !manualAvailable;
        document.getElementById("smartPlugOff").disabled = !manualAvailable;
        if (!manualAvailable) {
            document.getElementById("manualControlStatus").innerText =
                "Manueller Test ist auf dem Server nicht freigeschaltet.";
            document.getElementById("thresholdStatus").innerText =
                "Der Regler ist auf dem Server nicht freigeschaltet.";
        }

        const serverThreshold = Number(data.on_threshold_percent ?? 30);
        activeStartThreshold = serverThreshold;
        document.getElementById("startRuleValue").innerText = serverThreshold + " %";
        if (!thresholdDirty && !thresholdBusy) {
            document.getElementById("startThreshold").value = serverThreshold;
            document.getElementById("startThresholdValue").innerText = serverThreshold + " %";
        }
        refreshThresholdControls();

        document.getElementById("automationReason").innerText =
            data.error ||
            (data.dry_run && automationDryRunReasons[data.reason]) ||
            getAutomationReason(data);

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

async function saveStartThreshold() {
    if (thresholdBusy || !thresholdDirty)
        return;

    const token = document.getElementById("controlToken").value.trim();
    const status = document.getElementById("thresholdStatus");
    const selected = Number(document.getElementById("startThreshold").value);

    if (!token) {
        status.innerText = "Bitte zuerst unten den Steuer-Code eingeben.";
        return;
    }

    if (!window.confirm(
        "Solix-Startwert auf " + selected + " % setzen? Die Automatik verwendet ihn ab der nächsten Prüfung."
    ))
        return;

    thresholdBusy = true;
    refreshThresholdControls();
    status.innerText = "Startwert wird gespeichert …";

    try {
        const response = await fetch("/api/automation/settings", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Control-Token": token
            },
            body: JSON.stringify({ on_threshold_percent: selected })
        });
        const data = await response.json();
        if (!response.ok)
            throw new Error(data.detail || "Startwert konnte nicht gespeichert werden");

        activeStartThreshold = data.on_threshold_percent;
        thresholdDirty = false;
        status.innerText = "Startwert " + activeStartThreshold + " % gespeichert – aktiv ab der nächsten Minutenprüfung.";
        await updateAutomation();
    }
    catch (e) {
        status.innerText = e.message;
    }
    finally {
        thresholdBusy = false;
        refreshThresholdControls();
    }
}

async function updateAudi() {

    if (audiBusy)
        return;

    audiBusy = true;

    try {
        const response = await fetch("/api/audi", { cache: "no-store" });
        if (!response.ok)
            throw new Error("Audi API: HTTP " + response.status);

        const data = await response.json();
        if (!data.available)
            throw new Error(data.error || "Audi-Daten sind nicht verfügbar");

        const battery = data.battery_percent == null ? "--" : data.battery_percent + " %";
        if (data.stale) {
            const staleBattery = battery + " (veraltet)";
            document.getElementById("audiBattery").innerText = staleBattery;
            document.getElementById("tickerAudiBattery").innerText = battery + "*";
            const lastUpdate = data.last_update ?
                new Date(data.last_update).toLocaleString("de-DE") : "unbekannt";
            document.getElementById("audiRange").innerText =
                "Letzter Audi-Stand: " + lastUpdate + " · " +
                (data.error || "Aktualisierung wird erneut versucht");
            return;
        }
        document.getElementById("audiBattery").innerText = battery;
        document.getElementById("tickerAudiBattery").innerText = battery;
        document.getElementById("audiRange").innerText =
            data.electric_range_km == null ? "Reichweite unbekannt" :
            data.electric_range_km + " km elektrisch";
    }
    catch (e) {
        document.getElementById("audiBattery").innerText = "nicht verfügbar";
        document.getElementById("tickerAudiBattery").innerText = "--";
        document.getElementById("audiRange").innerText = "Audi-Verbindung prüfen";
        console.log(e);
    }
    finally {
        audiBusy = false;
    }
}

async function setManualSmartPlug(enabled) {

    if (manualControlBusy)
        return;

    const token = document.getElementById("controlToken").value.trim();
    const status = document.getElementById("manualControlStatus");
    if (!token) {
        status.innerText = "Bitte zuerst den Test-Code eingeben.";
        return;
    }

    const action = enabled ? "einschalten" : "ausschalten";
    if (!window.confirm("Smart Plug jetzt wirklich " + action + "?"))
        return;

    manualControlBusy = true;
    document.getElementById("smartPlugOn").disabled = true;
    document.getElementById("smartPlugOff").disabled = true;
    status.innerText = "Befehl wird gesendet …";

    try {
        const response = await fetch("/api/smartplug/manual", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Control-Token": token
            },
            body: JSON.stringify({ enabled })
        });
        const data = await response.json();
        if (!response.ok)
            throw new Error(data.detail || "Smart Plug konnte nicht geschaltet werden");

        document.getElementById("smartPlug").innerText =
            enabled ? "Eingeschaltet" : "Ausgeschaltet";
        status.innerText = enabled ?
            "Smart Plug wurde manuell eingeschaltet." :
            "Smart Plug wurde manuell ausgeschaltet.";
        await updateAutomation();
    }
    catch (e) {
        status.innerText = e.message;
    }
    finally {
        manualControlBusy = false;
        document.getElementById("smartPlugOn").disabled = false;
        document.getElementById("smartPlugOff").disabled = false;
    }
}

updateDashboard();
updateAutomation();
updateAudi();

document.getElementById("smartPlugOn").addEventListener("click", () => setManualSmartPlug(true));
document.getElementById("smartPlugOff").addEventListener("click", () => setManualSmartPlug(false));
document.getElementById("startThreshold").addEventListener("input", (event) => {
    const selected = Number(event.target.value);
    document.getElementById("startThresholdValue").innerText = selected + " %";
    thresholdDirty = selected !== activeStartThreshold;
    refreshThresholdControls();
});
document.getElementById("saveStartThreshold").addEventListener("click", saveStartThreshold);

setInterval(updateDashboard, 5000);

setInterval(updateAutomation, 30000);

setInterval(updateAudi, 30000);

setInterval(updateLastRefresh, 1000);
