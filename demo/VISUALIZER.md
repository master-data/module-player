# General visualizer review

## Windows system audio

The demo can drive the general visualizer from Windows audio, including Spotify,
without loading a module or initializing a playback engine.

1. Open the demo over HTTPS or localhost in Chrome or Edge on Windows.
2. Set **Visualizer source** to **System Audio** and select **Start capture**.
3. In the browser picker, select **Entire Screen**, enable **Share system audio**,
    and confirm sharing. The wording may vary with browser version.
4. Play music in the other application and select **Visualizer view**.
5. Select **Close visualizer** or press Escape to return to the player. Sharing
    stays active; select **Visualizer view** to reopen without another prompt.
6. Select **Stop capture** on the player, or stop sharing in the browser, to
    release the capture. Starting a module also exits System Audio mode.

Capture pauses any currently playing module. Returning to Module mode does not
automatically resume playback. Module scope settings do not affect system audio.
MEGABOOST is unavailable in System Audio mode because tracker and SID telemetry
cannot be reconstructed from the mixed output.

All analysis stays local: the demo does not record or upload audio or screen
contents, and never routes captured sound back to the speakers. The browser API
requires a video track and a fresh sharing prompt for every session; the demo
does not display or process the video. All tracks are stopped on cleanup.
System capture can include notifications and other applications, not just Spotify.

System audio availability depends on the browser, operating system, selected
sharing surface, and content restrictions. A successful screen share may contain
no audio; the demo reports that instead of falling back to the microphone.
Firefox/Safari and mobile are not supported targets for this capture mode.
There is no Spotify API integration or audio-driver installation requirement.

Run `node --test test/system-audio.test.js` for capture and integration checks.
Mocks cover capture lifecycle and source selection; actual Windows system audio
and protected-content behavior still need manual verification in the target browser.

## Scene review

Desktop and landscape are the visual design targets. Mobile portrait is not a
target and should not drive composition or visual compromises.

The general deck was reviewed as a 21-scene contact sheet, alongside its drawing
code. Selected original compositions have since been restored by request. Too many depended on
the same radial paths, sparse outlines, default hue rotation, or decorative
particles; changing scene names did not produce a strong enough visual change.

| Retired scene | Assessment and replacement direction |
| --- | --- |
| Orbit | Thin disconnected ellipses lacked a focal structure. Aperture uses segmented, spectrum-shaped rings. |
| Horizon | Sparse bands and a wireframe floor felt unfinished. Contours fills the frame with layered relief. |
| Lattice | Uniform grid density and weak hierarchy. Cascade makes magnitude and depth legible. |
| Aurora | Flat, separated ribbons lacked the density of fabric. Silk combines two stereo thread fields. |
| Vortex | Repeated circles overlapped the tunnel/orbit family. Aperture owns the radial composition. |
| Constellation | Sparse dots and connecting lines felt incidental. Removed. |
| Prism | Nested wire polygons did not read as facets. Prism now uses translucent alternating facets. |
| Helix | Original full-width DNA composition restored separately from Weave: opposing 2.35-turn strands and 26 connecting rungs. |
| Monolith | Original 19-column layout restored: tapered widths, central height profile, three-stop gradients and continuous floor reflections. No added sway or highlights. |
| Bloom | Another radial line pattern without a distinct surface. Removed. |
| Rainfall | Short random marks lacked compositional hierarchy. Removed. |
| Eclipse | A ring with minor ornament duplicated the radial family. Removed. |
| Ribbons | Too similar to aurora and wavegarden. Consolidated into Silk. |
| Tunnel | Concentric rectangles provided little surface variation. Removed. |
| Terrain | Original five overlapping filled wave surfaces restored by request, with downward-fading gradients and smoothed boundaries. |
| Pulsefield | Repeated circles read as a diagnostic grid. Cascade replaces it with a traveling spectral field. |
| Infinity | One small looping figure lacked full-frame presence. Weave expands the braided silhouette. |
| Kaleidoscope | Repeated strokes resembled the other radial effects. Removed. |
| Quasar | A small repeated-ray center left too much unused space. Diffraction uses crossing full-frame fans. |
| Wavegarden | Original ten-layer spacing, overlapping swell/cross motion and depth-based colors restored with thick smoothed paths. |
| Dreamweb | Uniform web lines lacked focus. Interference uses two offset contour centers. |

## Replacement deck

- Aperture: segmented mechanical rings with six spectrum sectors.
- Silk: flowing stereo thread fields with warm and cool layers.
- Contours: stacked topographic ridges and highlighted elevation lines.
- Diffraction: opposing curved line fans without a central ornament.
- Cascade: a moving spectral relief field with contrasting crest tips.
- Interference: overlapping contour waves from two moving centers.
- Weave: a stereo-reactive braided figure.
- Prism: shares SID Crystal's translucent four-point facets, fine luminous edges,
    colors and rotation. Bass, mids and highs replace SID voice energies; spectral
    bands control spread and reach, with smoothed PCM deforming the facets.
- Monolith: original gradient columns and floor reflections, driven by inertial audio.
- Wavegarden: original layered wave composition, with inertial audio and thick curves.
- Terrain: original five-layer filled wave landscape with full-height gradient fades,
  music-driven swells and outward-traveling light streaks. Streak count adapts to load;
  their deterministic projection is independent of the number of crossfade draws.
- Helix: original opposing stereo strands, 26 thin rungs, color progression and
    traveling phase. Broad curved strands use inertial PCM and bass-driven amplitude;
    beats add a smooth amplitude accent and strand sampling adapts to rendering load.

Non-SID playback opens on Terrain. XMP telemetry includes the current scene name
to distinguish the filled landscape from Wavegarden's separate line-wave effect.
Scenes use a nonrepeating shuffled deck, musical transition cues and a bounded
maximum hold. Effects crossfade over 0.8-1.2 seconds with smooth, balanced opacity;
reduced motion lengthens the fade. Crossfades retain each scene's seed.
A persistent 360-star circular field runs behind both the general visualizer and
MEGABOOST. Stars orbit the screen center with depth-dependent speeds, using the
same radius scale on both axes for circular motion. The field extends beyond
the viewport diagonal, including in silence, so the screen clips the outer
orbits instead of showing a circular boundary.
Translucent points use 16-47% opacity and respect parent alpha, keeping the field
behind the main geometry rather than competing with it. Energy drives
rotation speed and brightness, bass gently expands the orbits,
treble enlarges the stars, and smoothed beat accents brighten and expand the field.
Stars render as clean points without trails and advance once per frame, independently of effect seeds and
transitions. The field is drawn once beneath
both crossfade layers, slows with reduced motion, and freezes with paused SID
playback. Closing and reopening the view retains its star positions.
Geometry adapts to available
headroom, but the canvas always uses its full displayed size times the device
pixel ratio, without a pixel-budget cap or quality-based downscaling. Fullscreen,
window and display-density changes update that resolution before painting.
Native resolution can increase GPU and memory costs on large or high-DPI displays.
Animation still runs on every requestAnimationFrame
callback. There is no FPS cap. Reduced motion slows time and reduces geometry.
Canvas dimension changes are queued and applied immediately before painting;
quality updates and resize notifications never clear a completed visible frame.

Interference and Weave use closed quadratic splines with matching endpoints
and tangents across the wraparound. Their final audio sample need not equal the
first; the closing curve blends those control points without a gap or straight
closing segment. Other effects retain their intentionally open paths.

The fullscreen Strobe checkbox defaults to off and toggles immediately without
a confirmation prompt. Explicit changes are saved in local storage under
`module-player.immersive-strobe` and restored on reload and when opening the view.
Unavailable storage falls back to an in-memory preference for the page session.
Detected beats trigger an immediate 28% overlay peak on the same rendered frame,
followed by a 160 ms quadratic fade-out, with no fade-in delay. Strobe uses a
separate bass attack detector, bypassing the scene director's tempo-based beat gap.
System audio supplies dedicated 30-180 Hz analysis: each channel passes through
a 30 Hz high-pass and two 180 Hz low-pass filters, without connecting to the
audible output. Bass history uses a sample-rate-scaled power-of-two window of at
least 20 ms (1024 samples at 48 kHz). Energy is the strongest RMS of four short
blocks within that history (256 samples each at 48 kHz), so pre-hit silence does
not dilute the attack while retained history reduces bass-cycle ripple. The stronger
channel is used so opposite stereo phases cannot cancel. Filters and analysis
windows have inherent response time; there is no additional trigger queue.
Module sources without dedicated bass analysis use the existing low-band estimate,
requiring it to exceed midrange by 35% and exceed treble. This fallback is less
frequency-selective than the system-audio filters.
Only bass rise contributes to attack strength, with a gate of .045 plus 3 times
its recent average. Bass must exceed .12 and rise by more than 18% of its previous
level. Overall volume and midrange rises cannot trigger on their own. After a
hit, bass must fall below 70% of its peak before another attack can fire, avoiding
multiple flashes within one hit without a timed cooldown. This is bass selection,
not instrument classification: a bass-note attack can also trigger it.
Cached audio revisions do not
retrigger it, and source changes reset its history. Timing and maximum resolvable
hit rate still depend on fresh audio data and browser frame scheduling, so this
is not sample-accurate detection. There
is no free-running flash during silence and no flashing
while SID playback is paused. Strobe is available in both Visualizer and
MEGABOOST, including system-audio visualization. Its control follows the close
button's inactivity timeout even while active, reappearing on pointer movement,
pointer down or keyboard activity. Keyboard focus keeps it visible; mouse focus
does not prevent auto-hide. Closing the view disables strobe without clearing
the saved choice. Reduced-motion preferences disable strobe, including changes
made during playback, without overwriting the preference. Turning reduced motion
off does not resume strobe until the view is reopened or the toggle is enabled.
Rapid flashing can trigger photosensitive seizures; the overlay opacity is not
a guarantee of photosensitivity safety.

General scenes share a critically damped waveform and spectrum state, updated
once per frame before either crossfade layer is drawn. Its exact spring step
preserves velocity and has the same response at different refresh rates. Raw
audio remains untouched for analysis and telemetry. Spatially filtered waveform
samples feed rounded quadratic paths; strokes retain a broad CSS-pixel minimum
across display pixel densities. Fewer overlapping traces keep those heavier
curves readable.

Waveform and envelope attacks are tuned separately: envelopes reach over 80%
of a step within 100 ms while waveforms retain more inertia. Detected beats
inject a continuous momentum pulse into each scene's geometry, with stronger
accents on strong beats and returns from a drop. Energy also drives scene speed.
Waveform displacement uses bounded visual gain; playback audio is unchanged.
Reduced motion retains slower attacks and attenuated beat impulses.

Terrain uses stereo energy contours rectified before temporal smoothing, avoiding
phase cancellation of signed PCM. Bass and beats lift the layers, mids and stereo
energy shape the ridges, spectral bands shift each layer's swell, and highs add
smaller ripples. It retains five filled surfaces, with reduced-motion attenuation.

Run `node --test test/general-visualizer.test.js test/sid-megaboost.test.js` for
scene geometry, audio response, transition and adaptive-rendering checks.