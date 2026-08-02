"""Pure decision logic for the Audi/Solix charging automation."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass(frozen=True)
class AutomationDecision:
    """Result of one policy evaluation.

    ``desired_state`` is ``None`` when the current plug state must be kept.
    This makes the gap between the stop and selected start value a real
    hysteresis band.
    """

    desired_state: bool | None
    reason: str

    def as_dict(self) -> dict[str, bool | str | None]:
        return asdict(self)


def decide_smartplug_state(
    *,
    enabled: bool,
    cable_connected: bool | None,
    battery_percent: int | float | None,
    current_state: bool | None,
    on_threshold: int = 30,
    off_threshold: int = 10,
) -> AutomationDecision:
    """Decide whether the charging smart plug should change state.

    Safety rules deliberately win over the SOC hysteresis: charging is never
    permitted with a disconnected/unknown cable or missing Solix SOC data.
    """

    if not enabled:
        return AutomationDecision(None, "automation_disabled")

    if cable_connected is not True:
        if current_state is False:
            return AutomationDecision(None, "cable_not_connected_plug_already_off")
        return AutomationDecision(False, "cable_not_connected")

    if battery_percent is None:
        if current_state is False:
            return AutomationDecision(None, "solix_soc_unknown_plug_already_off")
        return AutomationDecision(False, "solix_soc_unknown")

    if battery_percent >= on_threshold:
        if current_state is True:
            return AutomationDecision(
                None, "at_or_above_on_threshold_plug_already_on"
            )
        return AutomationDecision(True, "at_or_above_on_threshold")

    if battery_percent < off_threshold:
        if current_state is False:
            return AutomationDecision(None, "below_off_threshold_plug_already_off")
        return AutomationDecision(False, "below_off_threshold")

    return AutomationDecision(None, "within_hysteresis_band")
