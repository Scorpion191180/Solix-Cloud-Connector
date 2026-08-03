(function () {
    "use strict";

    const canvas = document.getElementById("houseCanvas");
    if (!canvas)
        return;

    const context = canvas.getContext("2d");
    if (!context)
        return;

    const inspectorIcon = document.getElementById("houseInspectorIcon");
    const inspectorLabel = document.getElementById("houseInspectorLabel");
    const inspectorValue = document.getElementById("houseInspectorValue");
    const inspectorDetail = document.getElementById("houseInspectorDetail");
    const liveBadge = document.getElementById("houseLiveBadge");
    const resetButton = document.getElementById("houseReset");
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const state = {
        width: 1,
        height: 1,
        ratio: 1,
        yaw: -0.58,
        selected: "battery",
        data: window.solixDashboardState || {
            solix: {},
            automation: {},
            audi: {}
        },
        hotspots: [],
        pointerId: null,
        pointerStartX: 0,
        lastPointerX: 0,
        pointerMoved: false,
        dash: 0,
        lastFrame: 0
    };

    const palette = {
        pv: "#facc15",
        battery: "#38bdf8",
        grid: "#a78bfa",
        home: "#60a5fa",
        load: "#fb923c",
        charging: "#22c55e",
        inactive: "#526178",
        text: "#f8fafc",
        sub: "#94a3b8"
    };

    function numberValue(value) {
        if (value == null || typeof value === "boolean")
            return null;
        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function formatPower(watts) {
        const value = numberValue(watts);
        if (value == null)
            return "--";
        if (Math.abs(value) >= 1000)
            return (value / 1000).toLocaleString("de-DE", {
                minimumFractionDigits: 1,
                maximumFractionDigits: 2
            }) + " kW";
        return Math.round(value).toLocaleString("de-DE") + " W";
    }

    function roundRect(x, y, width, height, radius) {
        const r = Math.min(radius, width / 2, height / 2);
        context.beginPath();
        context.moveTo(x + r, y);
        context.lineTo(x + width - r, y);
        context.quadraticCurveTo(x + width, y, x + width, y + r);
        context.lineTo(x + width, y + height - r);
        context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
        context.lineTo(x + r, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - r);
        context.lineTo(x, y + r);
        context.quadraticCurveTo(x, y, x + r, y);
        context.closePath();
    }

    function project(point) {
        const cos = Math.cos(state.yaw);
        const sin = Math.sin(state.yaw);
        const horizontal = point[0] * cos - point[1] * sin;
        const depth = point[0] * sin + point[1] * cos;
        const scale = Math.min(state.width / 9.8, state.height / 5.5);
        return {
            x: state.width * 0.49 + horizontal * scale,
            y: state.height * 0.70 + depth * scale * 0.42 - point[2] * scale,
            depth
        };
    }

    function faceDepth(points) {
        return points.reduce((sum, point) => sum + project(point).depth, 0) / points.length;
    }

    function drawFace(points, fill, stroke) {
        const projected = points.map(project);
        context.beginPath();
        context.moveTo(projected[0].x, projected[0].y);
        for (let index = 1; index < projected.length; index += 1)
            context.lineTo(projected[index].x, projected[index].y);
        context.closePath();
        context.fillStyle = fill;
        context.fill();
        context.strokeStyle = stroke || "rgba(148,163,184,.28)";
        context.lineWidth = 1;
        context.stroke();
    }

    function cuboidFaces(cx, cy, width, depth, bottom, height, fills) {
        const left = cx - width / 2;
        const right = cx + width / 2;
        const front = cy - depth / 2;
        const back = cy + depth / 2;
        const top = bottom + height;
        const vertices = [
            [left, front, bottom], [right, front, bottom],
            [right, back, bottom], [left, back, bottom],
            [left, front, top], [right, front, top],
            [right, back, top], [left, back, top]
        ];
        return [
            { points: [vertices[0], vertices[1], vertices[5], vertices[4]], fill: fills[0] },
            { points: [vertices[1], vertices[2], vertices[6], vertices[5]], fill: fills[1] },
            { points: [vertices[2], vertices[3], vertices[7], vertices[6]], fill: fills[0] },
            { points: [vertices[3], vertices[0], vertices[4], vertices[7]], fill: fills[1] },
            { points: [vertices[4], vertices[5], vertices[6], vertices[7]], fill: fills[2] }
        ];
    }

    function drawFaces(faces) {
        faces
            .map((face) => ({ ...face, depth: faceDepth(face.points) }))
            .sort((a, b) => a.depth - b.depth)
            .forEach((face) => drawFace(face.points, face.fill, face.stroke));
    }

    function componentData() {
        const solix = state.data.solix || {};
        const automation = state.data.automation || {};
        const audi = state.data.audi || {};
        const smartPlug = automation.smartplug || {};
        const pv = numberValue(solix.pv_total);
        const batterySoc = numberValue(solix.battery_percent) ??
            numberValue(automation.solix_battery_percent);
        const batteryCharge = numberValue(solix.battery_charge_power) ?? 0;
        const batteryDischarge = numberValue(solix.battery_discharge_power) ??
            Math.max(0, -(numberValue(solix.battery_power) ?? 0));
        const output = numberValue(solix.system_output_power) ?? numberValue(solix.home_load);
        const home = numberValue(solix.home_load);
        const grid = numberValue(solix.grid_power);
        const plugPower = numberValue(smartPlug.power_w);
        const audiPowerKw = numberValue(audi.charging_power_kw);
        const audiPower = plugPower ?? (audiPowerKw == null ? null : audiPowerKw * 1000);
        const charging = plugPower != null ? plugPower >= 20 : audi.charging === true;

        return {
            pv: {
                id: "pv", label: "DACH-PV", icon: "☀️", value: formatPower(pv),
                detail: "PV1–PV4 liefern zusammen " + formatPower(pv) + ".",
                point: [-0.2, -0.15, 3.18], color: palette.pv, active: pv != null && pv >= 5
            },
            battery: {
                id: "battery", label: "SOLARBANK 4", icon: "🔋",
                value: batterySoc == null ? "--" : Math.round(batterySoc) + " %",
                detail: "PV-Eingang " + formatPower(pv) + " · " + (
                    batteryCharge >= 5 ? "Akku lädt mit " + formatPower(batteryCharge) + "." :
                    batteryDischarge >= 5 ? "Akku liefert " + formatPower(batteryDischarge) + "." :
                    "Akku ist im Bereitschaftsmodus."
                ),
                point: [-1.78, -1.36, 0.9], color: palette.battery,
                active: batteryCharge >= 5 || batteryDischarge >= 5
            },
            grid: {
                id: "grid", label: "STROMNETZ", icon: "🌐",
                value: formatPower(grid == null ? null : Math.abs(grid)),
                detail: grid == null ? "Netzwert nicht verfügbar." :
                    grid > 5 ? "Aktueller Netzbezug." :
                    grid < -5 ? "Aktuelle Netzeinspeisung." : "Aktuell kein Netzfluss.",
                point: [-4.25, 0.45, 1.45], color: palette.grid,
                active: grid != null && Math.abs(grid) >= 5
            },
            audi: {
                id: "audi", label: "AUDI Q3", icon: "🚙",
                value: audi.battery_percent == null ? "--" : audi.battery_percent + " %",
                detail: charging ? "Lädt in der Garage mit " + formatPower(audiPower) + "." :
                    audi.plug_connected === true ? "Ladestecker verbunden · wartet." :
                    audi.plug_connected === false ? "Ladestecker ist getrennt." : "Audi-Status wird geprüft.",
                point: [3.45, -0.02, 0.65], color: palette.charging, active: charging
            },
            flows: { pv, output, grid, plugPower: audiPower, charging }
        };
    }

    function drawBackground() {
        const gradient = context.createLinearGradient(0, 0, 0, state.height);
        gradient.addColorStop(0, "#101b32");
        gradient.addColorStop(0.58, "#0c1629");
        gradient.addColorStop(1, "#09101d");
        context.fillStyle = gradient;
        context.fillRect(0, 0, state.width, state.height);

        const glow = context.createRadialGradient(
            state.width * 0.72, state.height * 0.22, 0,
            state.width * 0.72, state.height * 0.22, state.width * 0.55
        );
        glow.addColorStop(0, "rgba(45,212,191,.13)");
        glow.addColorStop(1, "rgba(45,212,191,0)");
        context.fillStyle = glow;
        context.fillRect(0, 0, state.width, state.height);
    }

    function drawGround() {
        const ground = [
            [-4.8, -2.0, 0], [4.9, -2.0, 0],
            [4.9, 2.0, 0], [-4.8, 2.0, 0]
        ];
        drawFace(ground, "rgba(24,58,53,.86)", "rgba(94,234,212,.15)");

        drawFace(
            [[1.45, -2.0, 0.015], [4.9, -2.0, 0.015], [4.15, -1.2, 0.015], [1.48, -1.2, 0.015]],
            "rgba(72,86,103,.82)", "rgba(148,163,184,.22)"
        );
        drawFace(
            [[0.58, -2.0, 0.02], [1.22, -2.0, 0.02], [1.22, -1.28, 0.02], [0.58, -1.28, 0.02]],
            "rgba(96,104,112,.55)", "rgba(148,163,184,.18)"
        );

        context.save();
        context.strokeStyle = "rgba(94,234,212,.08)";
        context.lineWidth = 1;
        for (let x = -4; x <= 4; x += 1) {
            const start = project([x, -1.9, 0.01]);
            const end = project([x, 1.9, 0.01]);
            context.beginPath();
            context.moveTo(start.x, start.y);
            context.lineTo(end.x, end.y);
            context.stroke();
        }
        context.restore();
    }

    function drawWorldLine(points, color, width, alpha) {
        const projected = points.map(project);
        context.save();
        context.strokeStyle = color;
        context.globalAlpha = alpha == null ? 1 : alpha;
        context.lineWidth = width || 1;
        context.lineCap = "round";
        context.lineJoin = "round";
        context.beginPath();
        context.moveTo(projected[0].x, projected[0].y);
        for (let index = 1; index < projected.length; index += 1)
            context.lineTo(projected[index].x, projected[index].y);
        context.stroke();
        context.restore();
    }

    function mixPoint(start, end, amount) {
        return [
            start[0] + (end[0] - start[0]) * amount,
            start[1] + (end[1] - start[1]) * amount,
            start[2] + (end[2] - start[2]) * amount
        ];
    }

    function drawPanelGrid(points) {
        [0.33, 0.66].forEach((amount) => {
            drawWorldLine(
                [mixPoint(points[0], points[1], amount), mixPoint(points[3], points[2], amount)],
                "rgba(186,230,253,.42)", 0.7
            );
        });
        drawWorldLine(
            [mixPoint(points[0], points[3], 0.5), mixPoint(points[1], points[2], 0.5)],
            "rgba(186,230,253,.42)", 0.7
        );
    }

    function drawAudiQ3() {
        const bodyFaces = cuboidFaces(
            3.08, -0.02, 1.92, 0.88, 0.13, 0.43,
            ["rgba(36,123,165,.98)", "rgba(28,94,132,.98)", "rgba(91,181,214,.98)"]
        );
        const cabinFront = [
            [2.48, -0.37, 0.54], [3.63, -0.37, 0.54],
            [3.39, -0.33, 0.88], [2.72, -0.33, 0.91]
        ];
        const cabinBack = cabinFront.map((point) => [point[0], -point[1], point[2]]);
        const cabinFaces = [
            { points: cabinFront, fill: "rgba(26,55,72,.98)", stroke: "rgba(148,220,244,.55)" },
            { points: cabinBack, fill: "rgba(21,45,62,.98)", stroke: "rgba(148,220,244,.42)" },
            {
                points: [cabinFront[3], cabinFront[2], cabinBack[2], cabinBack[3]],
                fill: "rgba(50,118,148,.98)", stroke: "rgba(148,220,244,.5)"
            },
            {
                points: [cabinFront[2], cabinFront[1], cabinBack[1], cabinBack[2]],
                fill: "rgba(28,63,80,.98)", stroke: "rgba(148,220,244,.48)"
            },
            {
                points: [cabinFront[0], cabinFront[3], cabinBack[3], cabinBack[0]],
                fill: "rgba(25,55,72,.98)", stroke: "rgba(148,220,244,.4)"
            }
        ];
        drawFaces([...bodyFaces, ...cabinFaces]);

        const wheelPoints = [
            [2.48, -0.47, 0.22], [3.66, -0.47, 0.22],
            [2.48, 0.47, 0.22], [3.66, 0.47, 0.22]
        ];
        wheelPoints
            .map((point) => ({ ...project(point), depth: project(point).depth }))
            .sort((a, b) => a.depth - b.depth)
            .forEach((wheel) => {
                context.save();
                context.fillStyle = "#080b11";
                context.beginPath();
                context.arc(wheel.x, wheel.y, state.width < 520 ? 4.2 : 5.2, 0, Math.PI * 2);
                context.fill();
                context.fillStyle = "#94a3b8";
                context.beginPath();
                context.arc(wheel.x, wheel.y, state.width < 520 ? 1.7 : 2.1, 0, Math.PI * 2);
                context.fill();
                context.restore();
            });

        [[4.04, -0.3, 0.44], [4.04, 0.3, 0.44]].forEach((point) => {
            const light = project(point);
            context.save();
            context.fillStyle = "#dbeafe";
            context.shadowColor = "#bfdbfe";
            context.shadowBlur = 7;
            context.beginPath();
            context.arc(light.x, light.y, 2.2, 0, Math.PI * 2);
            context.fill();
            context.restore();
        });
    }

    function drawHouseAndGarage() {
        const wallFaces = cuboidFaces(
            -0.35, 0, 3.8, 2.6, 0, 2.05,
            ["rgba(158,178,196,.91)", "rgba(112,136,157,.9)", "rgba(189,207,220,.9)"]
        );
        const garageFaces = cuboidFaces(
            2.75, 0, 2.55, 2.45, 0, 1.45,
            ["rgba(128,149,168,.88)", "rgba(91,113,135,.9)", "rgba(157,177,193,.9)"]
        );
        // Die Vorderseite bleibt als offenes Garagentor frei, damit der Q3
        // und die sauber am Boden hereingeführte Ladeleitung sichtbar sind.
        garageFaces.shift();
        drawFaces([...wallFaces, ...garageFaces]);

        const roof = [
            {
                points: [[-2.25, -1.3, 2.05], [1.55, -1.3, 2.05], [1.55, 0, 2.95], [-2.25, 0, 2.95]],
                fill: "rgba(33,43,57,.98)"
            },
            {
                points: [[-2.25, 0, 2.95], [1.55, 0, 2.95], [1.55, 1.3, 2.05], [-2.25, 1.3, 2.05]],
                fill: "rgba(24,34,48,.98)"
            }
        ];
        drawFaces(roof);

        [-1.05, -0.79, -0.53, -0.27].forEach((y) => {
            const z = 2.95 + y * (0.9 / 1.3) + 0.01;
            drawWorldLine(
                [[-2.22, y, z], [1.52, y, z]],
                "rgba(148,163,184,.2)", 0.75
            );
        });

        const facadeY = -1.307;
        const windows = [
            [[-1.55, facadeY, 0.7], [-0.78, facadeY, 0.7], [-0.78, facadeY, 1.42], [-1.55, facadeY, 1.42]],
            [[-0.45, facadeY, 0.82], [0.28, facadeY, 0.82], [0.28, facadeY, 1.47], [-0.45, facadeY, 1.47]]
        ];
        windows.forEach((windowFace) => {
            drawFace(windowFace, "rgba(96,165,250,.46)", "rgba(219,234,254,.78)");
            drawWorldLine(
                [mixPoint(windowFace[0], windowFace[1], 0.5), mixPoint(windowFace[3], windowFace[2], 0.5)],
                "rgba(219,234,254,.65)", 0.8
            );
            drawWorldLine(
                [mixPoint(windowFace[0], windowFace[3], 0.5), mixPoint(windowFace[1], windowFace[2], 0.5)],
                "rgba(219,234,254,.65)", 0.8
            );
        });
        drawFace(
            [[0.78, facadeY, 0], [1.32, facadeY, 0], [1.32, facadeY, 1.55], [0.78, facadeY, 1.55]],
            "rgba(30,41,59,.96)", "rgba(203,213,225,.62)"
        );

        drawWorldLine(
            [[1.48, -1.225, 0], [4.02, -1.225, 0], [4.02, -1.225, 1.43], [1.48, -1.225, 1.43], [1.48, -1.225, 0]],
            "rgba(203,213,225,.72)", 2
        );

        const panels = [];
        for (let row = 0; row < 2; row += 1) {
            for (let column = 0; column < 2; column += 1) {
                const x1 = -1.8 + column * 1.55;
                const x2 = x1 + 1.25;
                const y1 = -1.12 + row * 0.48;
                const y2 = y1 + 0.38;
                const roofZ = (y) => 2.95 + y * (0.9 / 1.3) + 0.025;
                panels.push({
                    points: [
                        [x1, y1, roofZ(y1)], [x2, y1, roofZ(y1)],
                        [x2, y2, roofZ(y2)], [x1, y2, roofZ(y2)]
                    ],
                    fill: "rgba(30,98,145,.96)",
                    stroke: "rgba(125,211,252,.75)"
                });
            }
        }
        drawFaces(panels);
        panels.forEach((panel) => drawPanelGrid(panel.points));

        for (let level = 0; level < 3; level += 1) {
            drawFaces(cuboidFaces(
                -1.78, -1.40, 0.56, 0.42, 0.06 + level * 0.31, 0.28,
                ["rgba(35,101,133,.97)", "rgba(24,76,106,.97)", "rgba(79,190,221,.92)"]
            ));
        }
        const batteryLight = project([-1.78, -1.62, 0.86]);
        context.save();
        context.fillStyle = "#5eead4";
        context.shadowColor = "#2dd4bf";
        context.shadowBlur = 8;
        context.beginPath();
        context.arc(batteryLight.x, batteryLight.y, 2.2, 0, Math.PI * 2);
        context.fill();
        context.restore();

        drawAudiQ3();

        const garageLabel = project([2.75, 1.23, 1.25]);
        context.fillStyle = "rgba(226,232,240,.72)";
        context.font = "800 9px system-ui";
        context.textAlign = "center";
        context.fillText("GARAGE", garageLabel.x, garageLabel.y);
    }

    function drawGridPole() {
        const bottom = project([-4.22, 0.45, 0]);
        const top = project([-4.22, 0.45, 1.68]);
        context.save();
        context.strokeStyle = "rgba(167,139,250,.78)";
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(bottom.x, bottom.y);
        context.lineTo(top.x, top.y);
        context.stroke();
        const left = project([-4.22, 0.12, 1.4]);
        const right = project([-4.22, 0.78, 1.4]);
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(left.x, left.y);
        context.lineTo(right.x, right.y);
        context.stroke();
        context.restore();
    }

    function drawArrow(from, to, color) {
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        context.save();
        context.translate(to.x, to.y);
        context.rotate(angle);
        context.fillStyle = color;
        context.beginPath();
        context.moveTo(0, 0);
        context.lineTo(-8, -4.5);
        context.lineTo(-8, 4.5);
        context.closePath();
        context.fill();
        context.restore();
    }

    function drawFlow(points, color, active, reverse) {
        const projected = points.map(project);
        const displayColor = active ? color : palette.inactive;
        const ordered = reverse ? [...projected].reverse() : projected;

        context.save();
        context.lineCap = "round";
        context.lineJoin = "round";
        context.strokeStyle = "rgba(5,12,24,.72)";
        context.lineWidth = active ? 7 : 5;
        context.beginPath();
        context.moveTo(ordered[0].x, ordered[0].y);
        for (let index = 1; index < ordered.length; index += 1)
            context.lineTo(ordered[index].x, ordered[index].y);
        context.stroke();

        context.strokeStyle = displayColor;
        context.lineWidth = active ? 3 : 2;
        context.globalAlpha = active ? 1 : 0.45;
        context.setLineDash(active ? [8, 7] : [4, 7]);
        context.lineDashOffset = active ? -state.dash : 0;
        context.beginPath();
        context.moveTo(ordered[0].x, ordered[0].y);
        for (let index = 1; index < ordered.length; index += 1)
            context.lineTo(ordered[index].x, ordered[index].y);
        context.stroke();
        context.setLineDash([]);
        if (active)
            drawArrow(ordered[ordered.length - 2], ordered[ordered.length - 1], displayColor);
        context.restore();
    }

    function drawPowerFlows(components) {
        const flows = components.flows;
        drawFlow(
            [
                [-0.2, -0.75, 2.47],
                [-1.86, -1.18, 2.13],
                [-1.92, -1.36, 1.05],
                [-1.78, -1.40, 0.88]
            ],
            palette.pv, flows.pv != null && flows.pv >= 5, false
        );
        drawFlow(
            [
                [-4.22, 0.45, 0.18],
                [-3.05, -1.55, 0.06],
                [-2.18, -1.55, 0.06],
                [-1.78, -1.40, 0.72]
            ],
            palette.grid, flows.grid != null && Math.abs(flows.grid) >= 5, flows.grid < 0
        );
        drawFlow(
            [
                [-1.78, -1.40, 0.72],
                [-1.78, -1.46, 0.27],
                [1.52, -1.46, 0.27],
                [2.02, -1.27, 0.30],
                [2.62, -0.92, 0.30],
                [3.25, -0.42, 0.38]
            ],
            palette.charging, flows.charging && flows.output != null && flows.output >= 5, false
        );
    }

    function drawBadge(component) {
        const point = project(component.point);
        const compact = state.width < 520;
        const width = compact ? 86 : 106;
        const height = compact ? 41 : 45;
        const anchors = compact ? {
            pv: [0.46, 0.10],
            grid: [0.15, 0.34],
            battery: [0.18, 0.72],
            audi: [0.78, 0.72]
        } : {
            pv: [0.46, 0.10],
            grid: [0.10, 0.38],
            battery: [0.20, 0.76],
            audi: [0.80, 0.76]
        };
        const anchor = anchors[component.id] || [0.5, 0.5];
        const centerX = anchor[0] * state.width;
        const centerY = anchor[1] * state.height;
        const x = Math.max(4, Math.min(state.width - width - 4, centerX - width / 2));
        const y = Math.max(5, Math.min(state.height - height - 48, centerY - height / 2));
        const selected = state.selected === component.id;

        context.save();
        context.strokeStyle = component.active ? component.color + "88" : "rgba(100,116,139,.34)";
        context.lineWidth = 1;
        context.setLineDash([3, 4]);
        context.beginPath();
        context.moveTo(point.x, point.y);
        context.lineTo(x + width / 2, y + height / 2);
        context.stroke();
        context.setLineDash([]);
        if (selected) {
            context.shadowColor = component.color;
            context.shadowBlur = 12;
        }
        roundRect(x, y, width, height, 11);
        context.fillStyle = component.active ? "rgba(15,31,43,.92)" : "rgba(15,23,42,.86)";
        context.fill();
        context.shadowBlur = 0;
        context.strokeStyle = selected ? component.color :
            component.active ? component.color + "aa" : "rgba(100,116,139,.6)";
        context.lineWidth = selected ? 2 : 1;
        context.stroke();

        context.textAlign = "left";
        context.textBaseline = "middle";
        context.font = compact ? "12px system-ui" : "14px system-ui";
        context.fillStyle = palette.text;
        context.fillText(component.icon, x + 8, y + height / 2);
        context.font = "800 " + (compact ? 8 : 9) + "px system-ui";
        context.fillStyle = palette.sub;
        context.fillText(component.label, x + (compact ? 26 : 30), y + (compact ? 13 : 15));
        context.font = "900 " + (compact ? 11 : 13) + "px system-ui";
        context.fillStyle = palette.text;
        context.fillText(component.value, x + (compact ? 26 : 30), y + (compact ? 28 : 32));
        context.restore();

        state.hotspots.push({ id: component.id, x: x + width / 2, y: y + height / 2, radius: Math.max(width, height) * 0.58 });
    }

    function updateInspector(components) {
        const component = components[state.selected] || components.battery;
        inspectorIcon.textContent = component.icon;
        inspectorLabel.textContent = component.label;
        inspectorValue.textContent = component.value;
        inspectorDetail.textContent = component.detail;

        const battery = components.battery.value;
        liveBadge.textContent = battery === "--" ? "Live wird verbunden" : "LIVE · Solix " + battery;
    }

    function draw() {
        context.setTransform(state.ratio, 0, 0, state.ratio, 0, 0);
        context.clearRect(0, 0, state.width, state.height);
        drawBackground();
        drawGround();
        drawGridPole();
        drawHouseAndGarage();

        const components = componentData();
        drawPowerFlows(components);
        state.hotspots = [];
        ["grid", "pv", "battery", "audi"]
            .forEach((id) => drawBadge(components[id]));
        updateInspector(components);
    }

    function resize() {
        const rect = canvas.getBoundingClientRect();
        state.width = Math.max(1, rect.width);
        state.height = Math.max(1, rect.height);
        state.ratio = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(state.width * state.ratio);
        canvas.height = Math.round(state.height * state.ratio);
        draw();
    }

    function selectAt(clientX, clientY) {
        const rect = canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        let nearest = null;
        let distance = Infinity;
        state.hotspots.forEach((hotspot) => {
            const candidateDistance = Math.hypot(x - hotspot.x, y - hotspot.y);
            if (candidateDistance <= hotspot.radius && candidateDistance < distance) {
                nearest = hotspot;
                distance = candidateDistance;
            }
        });
        if (nearest) {
            state.selected = nearest.id;
            draw();
        }
    }

    canvas.addEventListener("pointerdown", (event) => {
        state.pointerId = event.pointerId;
        state.pointerStartX = event.clientX;
        state.lastPointerX = event.clientX;
        state.pointerMoved = false;
        canvas.setPointerCapture(event.pointerId);
    });

    canvas.addEventListener("pointermove", (event) => {
        if (state.pointerId !== event.pointerId)
            return;
        const delta = event.clientX - state.lastPointerX;
        if (Math.abs(event.clientX - state.pointerStartX) > 5)
            state.pointerMoved = true;
        state.yaw += delta * 0.009;
        state.lastPointerX = event.clientX;
        draw();
    });

    function finishPointer(event) {
        if (state.pointerId !== event.pointerId)
            return;
        if (!state.pointerMoved)
            selectAt(event.clientX, event.clientY);
        if (canvas.hasPointerCapture(event.pointerId))
            canvas.releasePointerCapture(event.pointerId);
        state.pointerId = null;
    }

    canvas.addEventListener("pointerup", finishPointer);
    canvas.addEventListener("pointercancel", (event) => {
        if (state.pointerId === event.pointerId)
            state.pointerId = null;
    });

    canvas.addEventListener("keydown", (event) => {
        if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
            return;
        event.preventDefault();
        state.yaw += event.key === "ArrowLeft" ? -0.12 : 0.12;
        draw();
    });

    resetButton.addEventListener("click", () => {
        state.yaw = -0.58;
        state.selected = "battery";
        draw();
    });

    window.addEventListener("solix-dashboard-data", (event) => {
        state.data = event.detail || state.data;
        draw();
    });

    if (window.ResizeObserver) {
        const observer = new ResizeObserver(resize);
        observer.observe(canvas);
    }
    else {
        window.addEventListener("resize", resize);
    }

    function animate(time) {
        if (time - state.lastFrame >= 33) {
            if (!reduceMotion)
                state.dash = (state.dash + 1.15) % 30;
            draw();
            state.lastFrame = time;
        }
        window.requestAnimationFrame(animate);
    }

    resize();
    window.requestAnimationFrame(animate);
}());
