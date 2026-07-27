# Ground stations

The Ground Station panel activates station-aware visibility, Ground View placement, and pass prediction. Latitude is geodetic WGS-84 degrees, longitude is east-positive and normalized to `[-180, 180)`, altitude is metres above the ellipsoid, while renderer world/ECI coordinates are kilometres. The station rotates from ECF into ECI using simulated UTC (`SimClock.simUtcMs`).

Location access is requested only after **Use My Location** is clicked. The app makes one `getCurrentPosition` request and never watches location. A geolocation station is session-only; **Save Custom** is the explicit action that writes it to the versioned local-storage record. Denial, timeout, and unavailable responses leave the active station unchanged.

Both WebGPU and WebGL2 evaluate elevation on the GPU for every rendered satellite. WebGPU stores visibility in bit 8 of `sat_pos.w`, leaving the low byte as the color index. WebGL2 performs the same dot-product test in its satellite vertex shader. Selection remains gold and takes precedence over the cyan station-visible tint.

Pass prediction always uses Vallado WASM (or satellite.js fallback) for real TLE entries, independent of display realism. Procedural/padded entries use the shared closed-form Keplerian position and are labelled **Approximate**. The search samples at 30 seconds, refines crossings to one second, includes an already-active pass, and stops after five passes or seven simulated days. Work yields cooperatively and stale runs are aborted after station or selection changes.

Performance verification: warm the high-quality 1,048,576-satellite view, enable an active station, and use the performance dashboard on timestamp-query-capable hardware. Compare the orbital compute timing and total frame time against the inactive run; the target remains 16.67 ms at 60 FPS. Use `?renderer=webgl&sats=1048576` for visible parity checks.
