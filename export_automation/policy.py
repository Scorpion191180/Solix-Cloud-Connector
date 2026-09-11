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
    cycle_active: bool

    def as_dict(self) -> dict[str, int | str | None]:
        return asdict(self)


def decide_export_output(
    *,
    enabled: bool,
    battery_percent: int | float | None,
    pv_power_w: int | float | None,
    current_output_w: int | float | None,
    cycle_active: bool = False,
    start_soc: int = 98,
    stop_soc: int = 90,
    max_output_w: int = 450,
) -> ExportDecision:
    """Track available PV after the start SOC until the lower stop SOC.

    The active cycle is an explicit latch instead of being inferred from the
    current output.  That matters when PV temporarily reaches 0 W: the cycle
    must resume tracking PV without waiting for the battery to reach 98 % a
    second time.
    """
    if not enabled:
        return ExportDecision(None, "automation_disabled", False)

    if battery_percent is None or pv_power_w is None:
        return ExportDecision(
            0 if cycle_active and current_output_w != 0 else None,
            "solix_telemetry_unknown",
            cycle_active,
        )

    if cycle_active and battery_percent <= stop_soc:
        return ExportDecision(
            0 if current_output_w != 0 else None,
            "battery_at_or_below_stop_soc",
            False,
        )

    just_started = not cycle_active and battery_percent >= start_soc
    active = cycle_active or just_started
    if not active:
        return ExportDecision(None, "waiting_for_start_soc", False)

    # Whole watts are required by the Anker setting. Flooring guarantees that
    # the requested output never exceeds the measured PV input.
    target_w = min(max_output_w, max(0, int(pv_power_w)))
    if current_output_w == target_w:
        return ExportDecision(
            None,
            "pv_output_already_matched",
            True,
        )

    return ExportDecision(
        target_w,
        "export_cycle_started" if just_started else "pv_output_adjusted",
        True,
    )
