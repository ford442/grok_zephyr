# Constellation growth timeline

Scrub **launch era** independently of SimClock (orbital pause/time-warp). Visibility is a **mask**, not a realloc: each sat has a `u32` Unix-day `activeFrom`; compute writes `sat_pos = 0` when `activeFrom > era_day`.

| Mode | Schedule |
| --- | --- |
| Procedural | 32-plane (32,768 sat) waves every 6 months from May 2019 → Jan 2028 |
| TLE | Line-1 epoch for real slots; Walker padding after the latest TLE epoch |

URL: `?era=2022-06`. HUD: `Active: N — Mon YYYY`. Capture overlay adds `Era:` when not at the full-constellation end.
