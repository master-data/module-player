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
| Orbit | Thin disconnected ellipses lacked a focal structure. Aperture uses overlapping, waveform-shaped iris blades. |
| Horizon | Sparse bands and a wireframe floor felt unfinished. Contours fills the frame with layered relief. |
| Lattice | Uniform grid density and weak hierarchy. Cascade makes magnitude and depth legible. |
| Aurora | Flat, separated ribbons lacked the density of fabric. Silk combines two stereo thread fields. |
| Vortex | Repeated circles overlapped the tunnel/orbit family. Aperture owns the radial composition. |
| Constellation | Sparse dots and connecting lines felt incidental. Removed. |
| Prism | Nested wire polygons did not read as facets. Prism now uses translucent alternating facets. |
| Helix | Full-width opposing stereo PCM strands and 26 connecting rungs; the preset 2.35-turn sine has been removed. |
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
| Wavegarden | Ten layers of current stereo PCM with gentle whole-layer drift, depth-based colors and thick curved paths. |
| Dreamweb | Uniform web lines lacked focus. Interference uses two offset contour centers. |

## Replacement deck

- Aperture: two counter-rotating layers of twelve curved iris blades, with
    continuous teal and warm metallic gradients extending beyond the viewport.
    Bass and beat momentum open the center; mids and beats directly turn and
    twist the blades, independently of the slow background rotation. Shared
    stereo energy envelopes deform the inner rim and blade surfaces without
    cancelling when PCM polarity alternates. Signed PCM adds finer edge motion.
    Six level-gated spectral bands shape highlights, with treble lifting the rim.
    Adaptive detail reduces curve samples without removing blades or closing the
    opening. Reduced motion attenuates deformation. Drawing reads the shared
    inertial state without advancing it and preserves the starfield behind the iris.
- Silk: current stereo PCM fans into warm and cool thread fields, with gentle whole-thread drift.
- Contours: stacked topographic ridges and highlighted elevation lines.
- Diffraction: opposing curved line fans without a central ornament.
- Cascade: a moving spectral relief field with contrasting crest tips.
- Interference: overlapping contour waves from two moving centers.
- Weave: a stereo-reactive braided figure.
- Prism: shares SID Crystal's translucent four-point facets, fine luminous edges,
    colors and rotation. Bass, mids and highs replace SID voice energies; spectral
    bands control spread and reach, with smoothed PCM deforming the facets.
- Monolith: original gradient columns and floor reflections, driven by inertial audio.
- Wavegarden: ten layered stereo waveform traces with thick curves and inertial amplitude accents.
- Terrain: original five-layer filled wave landscape with full-height gradient fades,
  music-driven swells and outward-traveling light streaks. Streak count adapts to load;
  their deterministic projection is independent of the number of crossfade draws.
- Helix: original opposing stereo strands, 26 thin rungs, color progression and
    bass-driven amplitude. The strand ordinates come from current PCM; the second
    channel is mirrored vertically, with rungs joining the matching sample positions.
    Beats add a smooth amplitude accent and strand sampling adapts to rendering load.
    There is no generated sine carrier; silent PCM produces flat strands.

### Demoscene-inspired additions

Five original procedural compositions join the general deck (17 scenes total).
These reference classic raster and point-field techniques, not the artwork,
logos, music or exact choreography of a particular demo. Copper and Dot Vortex
use Canvas. Checker Tunnel, Raster Twist and Voxel Flight use locally vendored
Three.js shaders, composited into the existing Canvas scene transitions.

- Copper: nine overlapping metallic bars with continuous vertical gradients,
    illuminated centers and
    three flowing stereo ribbons. Bass and beats expand the bars; mids widen the
    wave motion and treble lifts the highlights.
- Checker Tunnel: a continuous raymarched curved surface with derivative-filtered
    charcoal checker tiles, muted teal/red illumination and a dark distance fade.
    There are no recycled polygon rings or visible geometry insertion planes.
    The camera follows the tunnel tangent with gentle audio-driven expansion.
    Twist modulation is bounded rather than multiplied by world depth. Angular
    filtering avoids the atan wrap; only converged rays shade the wall, with
    pixel-aware tolerance and extra iteration headroom for grazing rays.
    Seamless procedural wall textures blend with inertial audio: bass introduces
    cloudy satin variation, mids blend flowing mineral veins, and treble adds
    fine crosshatch etching. Cylindrical mapping has no angular wrap seam;
    distant fine detail filters away rather than shimmering. Silence restores
    the subdued base checker material without an independent texture switch.
- Raster Twist: one continuous, rounded four-sided GPU surface, retaining the
    original twister's torsion without separately culled raster slices. Smooth
    teal/copper metal, softbox reflections and angle-dependent color give it
    depth without scanline grain. The signed, inertial stereo waveform forms the
    bar's centerline: left bends sideways and right displaces depth from bottom
    to top. A reused 64-point stereo buffer and cubic interpolation keep bends
    continuous; bounded gain prevents clipping. Mono feeds both axes, silence
    straightens the centerline, and drawing never advances the shared PCM state.
    Bass and beats widen the body; mids increase
    torsion and treble lifts highlights. Proper surface intersections replace
    face visibility toggles. Rounded ends remain inside the viewport, and
    transparent surroundings preserve the persistent starfield behind it.
- Dot Vortex: a full-height polar point field with three-lobed traveling waves.
    Bass and beats expand its radius, mids wind its arms, and highs deform the
    silhouette. This foreground effect is separate from the persistent stars.
- Voxel Flight retains its scene name but is a continuous alpine flyover,
    inspired by Elevated's mountain-flight aesthetic rather than literal cubes.
    Three.js renders a raymarched heightfield with no grid snapping, block faces
    or tiled edges. A cached seamless 512-square half-float height map supplies
    broad mountain masses with five noise octaves and subtractive gullies for
    broken ridgelines. Other GPU scenes retain their original texture.
    Layered mineral shading exposes rock on steep faces, with green lowlands
    and snow restricted to flatter high summits instead of covering the hills.
    Continuous surface normals control longer directional shadows and cool
    skylight on shaded slopes. Distant ranges fade into matching sky fog over a
    240-unit view distance; pixel-aware intersection tolerance and refinement
    prevent grazing rays from exposing sky through the terrain.
    Audio colors the rock itself: bass spreads deep teal mineral fields, mids
    reveal rose-colored seams, and treble adds restrained champagne strata.
    World-space elevation and mineral patterns anchor these colors to the
    mountains. Three separate color currents advance once per audio-motion
    update, with speeds driven by smoothed band energy, six-band spectral
    balance and beat momentum. Changing sound changes speed without jumping
    the current positions; crossfade draws only read that shared state.
    Spectral balance also reshapes the color distribution even at constant
    overall volume. Band response remains sensitive above 0.7, and coverage
    approaches its limit smoothly instead of clipping to a fixed mix. Pigments
    preserve the base rock's luminance before sunlight, shadows and fog;
    summit snow largely keeps its natural color. Luminous cyan wavefronts
    sweep across the mountain surfaces with bass, rose elevation contours
    travel with mids, and treble lights fine gold mineral seams. This separate
    bounded radiance layer follows the shared currents and beat momentum,
    retains directional shadow modulation, and fades into the terrain fog.
    Fine strata and wavefronts are derivative-filtered and fade with distance.
    Shared smoothed audio drives coverage,
    with natural rock restored in silence and currents stopped without audio.
    Reduced motion slows the currents to 20%. This adds no full-screen flash,
    separate beat detector or additional camera motion.
    The perspective camera circles one fixed beacon along a varying-radius
    route, with climbs, descents and curvature-driven banking capped below
    18 degrees. Gentle independent yaw (2.6 degrees) and roll (2 degrees) add
    slow panning and rotation even in silence. The gaze eases around the beacon.
    A separate 128-square clearance map is built once from the mountain terrain:
    a conservative neighborhood maximum followed by smoothing keeps the camera
    above peaks without following every small ridge. Convex cubic B-spline sampling
    avoids velocity changes at texture-cell boundaries. A slow 16-unit altitude
    cycle adds sweeping ascents and descents; bounded pitch looks ahead into both
    the terrain and that cycle. Flight uses elapsed time rather than the music's
    accelerated animation clock, so beats cannot jerk the camera speed. Reduced
    motion slows that clock. Clearance includes maximum ridge and waveform relief.
    Audio adds a separate critically damped camera response (3.5 radians/second),
    integrated once per frame in shared motion rather than during drawing.
    Bass and mids add up to 5.5 units of lift; stereo energy balance adds up to
    2.5 units of lateral sway, slight yaw and banking. Midrange adds a slow roll,
    and treble subtly changes pitch and field of view. Added banking stays below
    five degrees. Clearance is sampled at the displaced camera position; audio
    lift is upward only. Mono remains centered, polarity does not affect steering,
    and missing audio eases back to the base flight. Reduced motion scales this
    response to 20%. The strobe envelope does not drive camera jolts.
    Signed, inertial stereo PCM adds two continuous crossing spatial waves,
    sharing Raster Twist's 64-point buffer. Silence removes waveform relief and
    mono feeds both directions. A separate critically damped shape envelope
    drives the actual heightfield: bass lifts mountain masses and sends broad
    swells across the ground, mids deepen gullies and fold valleys, beats add
    a terrain surge, and treble strengthens the finer PCM relief. Shape controls
    update once per frame at 12 radians/second (20 for beat momentum), rather
    than during rendering. Reduced motion uses 5 radians/second and 20% strength.
    Maximum uplift remains within the cached 93.2-unit mountain envelope;
    additional valley and swell deformation is subtractive, and positive PCM
    relief remains within the existing flight margin. Silence smoothly returns
    the mountains to their resting shape. This is an original procedural
    landscape, not a recreation of the intro's code or assets. The Canvas Terrain
    fallback remains available when WebGL is unavailable.
    Exactly one world-anchored beacon stands at the center of the flight route.
    Its base follows the deformed elevation so it stays attached to the ground.
    Its red-orange lamp casts a rotating volumetric cone. View-ray integration
    stops at nearer terrain or the tower, and samples toward the lamp reject
    light blocked by the landscape. No repeated or respawning towers remain.
    Its pulse uses the Strobe overlay's exact normalized opacity: immediate
    peak, then the same 160 ms quadratic decay, with no independent beat clock.
    With Strobe off or reduced motion enabled, the lamp and beam retain a dim
    steady light without pulsing. Only GPU Voxel Flight contains this beacon.

All five share inertial audio and reduced-motion timing. Canvas geometry adapts
under load; drawing does not advance state, so outgoing and incoming crossfade
layers remain synchronized. Terrain remains the opening scene, and the SID
register-driven scene deck is unchanged.

All three GPU programs compile when the visualizer opens, before animation timing
begins. The height map is generated once per renderer; frames are rendered live,
not played from a prerecorded animation. The GPU canvas uses the same native
pixel dimensions as the visible canvas, without adaptive resolution reduction.
Closing retains GPU resources for reopening; disposing the visualizer releases
materials, geometry, terrain, mountain and flight-clearance textures, and WebGL context. Missing/lost WebGL falls back to
the original Canvas checker/twister effects and a variant of the existing Terrain scene.

Cascade scales its normalized spectral contribution by the audio level, so
low-frequency background noise cannot hold the left-hand bars up during silence.
The bars settle to their baseline while the decorative tile motion continues.

Non-SID playback opens on Terrain. XMP telemetry includes the current scene name
to distinguish the filled landscape from Wavegarden's separate line-wave effect.
Both scene decks use a nonrepeating shuffle. Most effects have a 20-second minimum
hold; Voxel Flight has a featured 60-second minimum. Musical transition cues cannot
shorten those holds. After the minimum, section, phrase, tone and strong-beat cues
can select the next scene; two seconds later any beat can do so. The guaranteed
transition is at 24 seconds for other effects and 64 seconds for Voxel Flight,
even in silence.
Reduced motion slows this scene clock to 40%; paused SID playback freezes it.
Effects crossfade over 0.8-1.2 seconds with smooth, balanced opacity;
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
System audio supplies dedicated 35-110 Hz analysis: each channel passes through
a 35 Hz high-pass and two 110 Hz low-pass filters, without connecting to the
audible output. Bass history uses a sample-rate-scaled power-of-two window of at
least 20 ms (1024 samples at 48 kHz). Energy is the strongest RMS of four short
blocks within that history (256 samples each at 48 kHz), so pre-hit silence does
not dilute the attack while retained history reduces bass-cycle ripple. The stronger
channel is used so opposite stereo phases cannot cancel. Filters and analysis
windows have inherent response time; there is no additional trigger queue.
Matched unfiltered analysers retain the same history and quarter-block RMS measure.
Bass and full-band measurements remain unclipped, preserving attacks above unity.
A bass amplitude ratio of at least 75% still qualifies. In a busier mix, a ratio
of at least 25% qualifies only when the new bass rise is at least 75% of the new
full-band rise, each measured above its own 80 ms baseline. This lets steady
vocals or synths coexist with a distinct kick without rejecting that kick simply
because the total mix is louder. These are amplitude ratios, not frequency-bin
energy percentages; weak low-pass leakage from non-bass attacks is still rejected.
Module sources without dedicated bass analysis use the unboosted low-band estimate,
requiring it to exceed midrange by 35% and exceed treble. This fallback is less
frequency-selective than the system-audio filters. The visualizer's nonlinear
gain no longer promotes quiet module PCM into strobe attacks.
Attacks are measured against an exponential local bass baseline with an 80 ms
time constant, updated from elapsed time between fresh signal reads. Bass must
exceed .22, be rising, and exceed this baseline by both .10 and 25% of the
baseline. This replaces the single-frame rise gate that missed beats at high
refresh rates. The baseline is not a wait period: a qualifying attack flashes
on the same frame. After a hit, bass must shed 35% of its peak excursion above
the pre-attack baseline and fall below the current baseline before rearming.
This rejects ringing tails without demanding
near-silence between beats on a continuing bass bed. There is no timed cooldown
or predicted/free-running beat clock. This is bass-onset detection, not instrument
classification: a bass-note attack can also trigger it.
Tests cover 90/128/174 BPM over background bass and a steady full-band mix,
including bass above unity, at 30/60/144/240 Hz. Offline
Web Audio checks detected four of four strong 40/60/80/120 Hz pulses, with no
duplicates, and rejected weak pulses and tested 180/440 Hz attacks at all four
rates, both alone and over a steady 700 Hz background (96 cases).
Synthetic onset latency was at most 33 ms, excluding live capture latency.
This does not guarantee every kick in a mixed song. The filter cutoffs are not brick walls:
strong transients outside the nominal band may still qualify.
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

Helix, Wavegarden and Silk instead read a separate 256-point signed PCM snapshot,
copied once per frame into reused stereo buffers. No temporal averaging is applied
to these trace samples, so changing waveform phase cannot cancel the signal before
it is drawn. Mono is duplicated, missing input clears the traces, and both crossfade
layers read the same snapshot without touching source buffers. Quadratic paths still
round the spatial samples. These three scenes retain inertial amplitude and layout
motion, but no generated spatial sine waves replace the waveform's shape.

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