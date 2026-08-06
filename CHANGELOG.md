# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.4] - 2026-08-06

### Added

- Added per-profile widget inset controls for enabled state, opacity, and width,
  with a choice between the selected theme color and a retained custom color.
- Added six keyboard-accessible dashboard tabs for Setup, Layout, Idle, Colors,
  Type and Motion, and Behavior. The desktop page remains fixed while the
  selected settings pane scrolls independently, and narrow viewports retain a
  single-column responsive presentation.
- Added reusable React dashboard atoms, molecules, and organisms for controls,
  section shells, Google Font configuration, and the live preview.
- Added reusable Preact widget atoms, molecules, and organisms for overflow
  text, status presentation, the visualizer, and viewport scaling.
- Added Sass as a development dependency and introduced Atomic Design SCSS
  folders for dashboard and widget abstracts, base rules, atoms, molecules,
  organisms, layouts, and utilities.
- Added shallow SCSS nesting for component-owned descendants, states, and
  pseudo-elements while keeping reusable selectors independent.
- Added automated capture assertions for dashboard tab behavior, supported
  animation choices, layout geometry, panel padding, vertical alignment,
  progress shadows and outlines, hidden-cover bounds, Chromagic sequencing,
  and reduced-motion behavior.

### Changed

- Replaced the former source CSS entry files with SCSS entry points compiled by
  Vite. Shared bundled font declarations now live in the common client styles
  area.
- Reorganized dashboard and widget presentation code according to Atomic Design
  without adding a runtime UI or CSS framework.
- Made Chromagic use Panel Cascade as its single palette transition. On a real
  palette change, metadata and progress surfaces now reveal the new colors in a
  short sequence while text, visualizer, progress fill, and track colors blend
  to their new values.
- Reduced general widget entrance and exit choices to None and Fade. Existing
  Grow, Shrink, Swing, Tilt, and Slide configuration values migrate to Fade so
  older profile files remain valid.
- Aligned Compact cover, metadata, playback time, visualizer, and progress
  geometry. The progress track now receives the same configurable outline and
  widget shadow treatment as the Compact panels.
- Aligned Boxy playback time typography with its title typography.
- Standardized Portrait panel and progress-track insets.
- Kept Minimal elements vertically centered inside the available source area.
- Increased the recommended Compact OBS browser-source height from 200 px to
  240 px to preserve transparent safety space for shadows and transitions.
- Updated English and German dashboard copy for the new tabs, fixed Chromagic
  transition, and simplified visibility animation choices.
- Updated README architecture, dashboard, animation, source-dimension, and
  project-structure documentation.
- Regenerated all affected README screenshots and animated examples using
  neutral demonstration metadata.

### Fixed

- Gave the Compact progress bar the same configurable outline and drop shadow
  treatment as its neighboring boxes. Its unfilled area now uses the same panel
  surface and opacity as those boxes, while the accent fill extends directly to
  the outline without an additional inner frame.
- Prevented changing the Chromagic transition setting from replaying a stale
  palette animation; the fixed cascade starts only for an actual palette
  change.
- Prevented Compact content from appearing vertically offset inside metadata
  and playback panels.
- Restored the custom color control dimensions and interaction styling during
  the SCSS migration.
- Preserved widget bounds when the cover is hidden across all layouts.

### Compatibility

- Existing profiles without explicit inset settings inherit the former inset
  state from their outline setting, preserving their previous presentation.
- Existing JSON configuration remains supported. Deprecated animation values
  are normalized during validation and migration rather than discarded.
- Chromagic transition values previously persisted in profile configuration are
  ignored and removed by schema parsing because Panel Cascade is now fixed.
- Spotify artwork and official attribution assets remain unmodified and retain
  their required rendered sizing and opacity.

### Verification

- TypeScript checks pass for browser and server code.
- The Vite dashboard and widget production builds complete successfully.
- All 15 focused unit tests pass.
- The local lifecycle smoke test passes for startup, API access, dashboard,
  widget, WebSocket snapshot, configuration writes, and graceful shutdown.
- Automated README asset capture passes its dashboard, layout, Chromagic,
  reduced-motion, and geometry assertions.

## [1.0.3] - 2026-08-04

### Added

- Added cover-derived Chromagic palettes and configurable widget surface
  opacity, outline, and shadow controls.

## [1.0.2] - 2026-08-04

### Fixed

- Improved playback progress stability and released the corresponding widget
  updates.

## [1.0.1] - 2026-08-04

### Fixed

- Prevented the offline status from flashing while an OBS browser source starts
  or reconnects.

## [1.0.0] - 2026-08-03

### Added

- Initial public release of the local Spotify now-playing widget, dashboard,
  OBS bootstrap source, profile support, and Streamer.bot lifecycle commands.
