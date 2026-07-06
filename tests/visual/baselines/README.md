# Baseline frames for WebGL2 visual regression tests.
#
# Regenerate after intentional rendering changes:
#   npm run test:visual:update
#
# `horizon-720km` — flagship establishing shot (limb on lower third, warm grade).
# Rebaseline after Horizon polish camera framing / limb-bloom separation changes.
#
# `god-view` — hero pose (53° shell edge-on), zoom-dependent bloom, God LOD tiers.
# Rebaseline after God View cinematography / shell-readability changes.
#
# `fleet-pov` — first-person sat #0 ride, near-field LOD, cockpit HUD.
# Rebaseline after Fleet POV clarity / motion-stretch changes.
#
# Each scene has a PNG golden frame and a JSON sidecar with luminance / diff bands.
