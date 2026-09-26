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
maximum hold. Crossfades retain each scene's seed. Geometry and backing resolution
adapt to available headroom; animation still runs on every requestAnimationFrame
callback. There is no FPS cap. Reduced motion slows time and reduces geometry.
Canvas dimension changes are queued and applied immediately before painting;
quality updates and resize notifications never clear a completed visible frame.

General scenes share a critically damped waveform and spectrum state, updated
once per frame before either crossfade layer is drawn. Its exact spring step
preserves velocity and has the same response at different refresh rates. Raw
audio remains untouched for analysis and telemetry. Spatially filtered waveform
samples feed rounded quadratic paths; strokes retain a broad CSS-pixel minimum
even when backing resolution drops. Fewer overlapping traces keep those heavier
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