# GitHub Labels for Grok Zephyr

This document describes the GitHub labels used for organizing issues and pull requests in the Grok Zephyr project. These labels were recommended in the 2026 Grok-Build visual polish audit.

## Label Categories

### Core Visual/Rendering
- **visual-upgrade** (🟣 Deep Purple) - Visual upgrade or enhancement to the user interface and visuals
- **rendering** (🔵 Blue) - WebGPU rendering and graphics improvements
- **high-impact** (🔴 Red) - High-impact changes with significant visual effect

### Areas
- **camera** (🟪 Indigo) - Camera control and view modes
- **ui** (🔹 Cyan) - User interface and UI components
- **ux-polish** (🟩 Emerald) - UX improvements and polish
- **wow-feature** (🟧 Amber) - Impressive new feature or capability
- **performance** (🌸 Pink) - Performance optimization and improvements
- **accessibility** (🟦 Teal) - Accessibility improvements and compliance

### Priority
- **P0** (🔴 Bright Red) - Critical priority - very important
- **P1** (🟠 Orange) - High priority
- **P2** (🟨 Yellow) - Medium priority

### Other
- **good-first-issue** (🟣 Purple) - Good for newcomers to the project
- **meta** (⚫ Gray) - Meta discussion or project organization
- **roadmap** (⚫ Gray) - Roadmap planning and future direction
- **enhancement** (🟩 Green) - Improvement or new feature request

## Usage

### For Project Maintainers

To update all labels with their correct colors and descriptions, run:

```bash
export GITHUB_TOKEN=<your_github_token>
python3 scripts/update_labels.py
```

### For Contributors

When creating issues or pull requests, please use the appropriate labels to:
- **Categorize the type of work** (visual-upgrade, rendering, enhancement, etc.)
- **Indicate priority** (P0, P1, P2)
- **Mark the area** (camera, ui, ux-polish, performance, accessibility, etc.)
- **Show impact** (high-impact, wow-feature)
- **Signal approachability** (good-first-issue for new contributors)

## Examples

- A fix for camera movement controls: `camera`, `ux-polish`, `P1`
- A new UI element for satellite selection: `ui`, `visual-upgrade`, `P0`
- A performance optimization for rendering: `rendering`, `performance`, `high-impact`
- A new feature for satellite tracking: `wow-feature`, `enhancement`, `P1`

## Color Scheme

The colors are carefully chosen to provide visual distinction:
- **Warm colors** (Red, Orange, Yellow) for priority and impact
- **Cool colors** (Blue, Cyan, Teal) for areas and features
- **Purple/Violet** for visual improvements
- **Gray** for meta/organizational items

This color scheme helps team members quickly identify the nature of an issue or PR at a glance.
