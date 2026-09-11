"""Pure decision logic for near-full Solarbank surplus output."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class ExportDecision:
    """One idempotent output decision.

    ``target_w`` is ``None`` when the existing setting must be left untouched.
    """

    target_w: int | None
    reason: str

    def as_dict(self) -> dict[str, int | str | None]:
        return asdict(self)


def decide_export_output(
    *,
    enabled: bool,
    battery_percent: int | float | None,
    pv_power_w: int | float | None,
    current_output_w: int | float | None,
    start_soc: int = 98,
    stop_soc: int = 95,
    output_w: int = 450,
    start_pv_w: int = 450,
    stop_pv_w: int = 250,
) -> ExportDecision:
    """Choose 0 W or the configured output with SOC/PV hysteresis."""
    if not enabled:
        return ExportDecision(None, "automation_disabled")

    active = current_output_w is not None and current_output_w > 0
    if battery_percent is None or pv_power_w is None:
        return ExportDecision(
            0 if active else None,
            "solix_telemetry_unknown",
        )

    if active and battery_percent <= stop_soc:
        return ExportDecision(0, "battery_at_or_below_stop_soc")

    if active and pv_power_w < stop_pv_w:
        return ExportDecision(0, "pv_below_stop_threshold")

    if battery_percent >= start_soc and pv_power_w >= start_pv_w:
        if current_output_w == output_w:
            return ExportDecision(None, "surplus_output_already_active")
        return ExportDecision(output_w, "battery_nearly_full_and_pv_available")

    if active:
        return ExportDecision(None, "within_hysteresis_band")

    return ExportDecision(None, "waiting_for_start_conditions")
