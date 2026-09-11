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
    audi_charge_priority: bool = False,
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

    if battery_percent is None:
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

    # A connected Audi that still needs energy always wins over exporting to
    # the public grid. As soon as it is full or disconnected, the normal
    # Solarbank export policy is allowed to take over again.
    if audi_charge_priority:
        return ExportDecision(
            0 if current_output_w != 0 else None,
            "audi_charging_has_priority",
            False,
        )

    if pv_power_w is None and battery_percent < start_soc:
        return ExportDecision(
            0 if cycle_active and current_output_w != 0 else None,
            "solix_telemetry_unknown",
            cycle_active,
        )

    just_started = not cycle_active and battery_percent >= start_soc
    active = cycle_active or just_started
    if not active:
        return ExportDecision(None, "waiting_for_start_soc", False)

    # A full Solarbank can curtail its PV inputs and consequently report 0 W,
    # even though sunlight is still available. Keeping the manual output at
    # the configured ceiling opens that path again. As soon as Anker reports
    # a positive PV value, the output follows the measured input as before.
    pv_hidden_by_full_bank = (
        battery_percent >= start_soc
        and (pv_power_w is None or pv_power_w <= 0)
    )
    if pv_hidden_by_full_bank:
        target_w = max_output_w
        action_reason = "full_bank_export_released"
    else:
        # Whole watts are required by the Anker setting. Flooring guarantees
        # that a visible PV value is never exceeded.
        target_w = min(max_output_w, max(0, int(pv_power_w or 0)))
        action_reason = (
            "export_cycle_started" if just_started else "pv_output_adjusted"
        )
    if current_output_w == target_w:
        return ExportDecision(
            None,
            (
                "full_bank_export_already_released"
                if pv_hidden_by_full_bank
                else "pv_output_already_matched"
            ),
            True,
        )

    return ExportDecision(
        target_w,
        action_reason,
        True,
    )
