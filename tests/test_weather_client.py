import unittest
from datetime import datetime, timezone

from weather.client import celestial_snapshot


class CelestialSnapshotTests(unittest.TestCase):
    latitude = 48.46991
    longitude = 8.44543

    def test_summer_sun_is_high_and_southerly_near_noon(self):
        snapshot = celestial_snapshot(
            self.latitude,
            self.longitude,
            datetime(2026, 6, 21, 12, 0, tzinfo=timezone.utc),
        )

        self.assertGreater(snapshot["sun"]["elevation_deg"], 55)
        self.assertLess(snapshot["sun"]["elevation_deg"], 70)
        self.assertGreater(snapshot["sun"]["azimuth_deg"], 175)
        self.assertLess(snapshot["sun"]["azimuth_deg"], 230)
        self.assertEqual(snapshot["orientation"]["panel_azimuth_deg"], 157.5)
        self.assertEqual(snapshot["orientation"]["panel_direction"], "Süd-Südost")

    def test_sun_is_below_horizon_at_local_midnight(self):
        snapshot = celestial_snapshot(
            self.latitude,
            self.longitude,
            datetime(2026, 6, 21, 22, 0, tzinfo=timezone.utc),
        )

        self.assertLess(snapshot["sun"]["elevation_deg"], 0)

    def test_moon_phase_and_motion_are_bounded(self):
        snapshot = celestial_snapshot(
            self.latitude,
            self.longitude,
            datetime(2026, 8, 12, 20, 0, tzinfo=timezone.utc),
        )
        moon = snapshot["moon"]

        self.assertGreaterEqual(moon["phase_fraction"], 0)
        self.assertLess(moon["phase_fraction"], 1)
        self.assertGreaterEqual(moon["illumination_percent"], 0)
        self.assertLessEqual(moon["illumination_percent"], 100)
        self.assertIn("phase_name", moon)
        self.assertLess(abs(moon["azimuth_rate_deg_per_minute"]), 2)
        self.assertLess(abs(moon["elevation_rate_deg_per_minute"]), 2)


if __name__ == "__main__":
    unittest.main()
