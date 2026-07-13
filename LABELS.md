# Repository Labels

This document describes the high-quality labels created for visual & polish work in the grok_zephyr project.

## Label Categories

### Core Visual/Rendering

These labels are for core visual and rendering system work.

- **`visual-upgrade`** (#6A0DAD) - Core visual/rendering enhancement or upgrade
- **`rendering`** (#0366D6) - Related to rendering engine, graphics, or visual output
- **`high-impact`** (#D73A49) - High-impact visual or feature work

### Areas

Labels that indicate the area or system affected by the issue or PR.

- **`camera`** (#1F6FEB) - Related to camera control or camera systems
- **`ui`** (#0052CC) - User interface improvements or changes
- **`ux-polish`** (#A2AAAD) - UX polish, refinement, or quality-of-life improvements
- **`wow-feature`** (#F5A623) - Exciting, high-value feature work
- **`performance`** (#28A745) - Performance optimization or efficiency improvements
- **`accessibility`** (#6F42C1) - Accessibility improvements or features

### Priority

Labels indicating the priority of the work.

- **`P0`** (#FF0000) - Critical, very important work
- **`P1`** (#FFA500) - Important work
- **`P2`** (#CCCCCC) - Nice to have improvements

### Other

Additional labels for project organization.

- **`good-first-issue`** (#7057FF) - Good issue for first-time contributors
- **`meta`** (#3F51B5) - Meta issue or discussion
- **`roadmap`** (#3F51B5) - Related to project roadmap or planning
- **`enhancement`** (#A2AAAD) - Enhancement or improvement to existing features

## Managing Labels

### Creating or Updating Labels

To create or update all labels in the repository, use the `manage-labels.js` script:

```bash
GITHUB_TOKEN=your_token node scripts/manage-labels.js create
```

The script will:

- Create any missing labels
- Update existing labels with the correct colors and descriptions
- Report the status of each operation

### Listing Current Labels

To see all labels currently in the repository:

```bash
GITHUB_TOKEN=your_token node scripts/manage-labels.js list
```

### Deleting a Label

To delete a specific label:

```bash
GITHUB_TOKEN=your_token node scripts/manage-labels.js delete <label-name>
```

### GitHub Token

You'll need a GitHub personal access token with `repo` scope to manage labels. Create one at:
https://github.com/settings/tokens/new

Select the following scopes:

- `repo` (Full control of private repositories)

Then set the token as an environment variable:

```bash
export GITHUB_TOKEN=your_token_here
```

## Label Usage Guidelines

### Visual & Rendering Work

- Use `visual-upgrade` for visual system improvements
- Use `rendering` when working directly with rendering logic
- Use `high-impact` for visually impressive or high-value features

### Feature Areas

- Apply the appropriate area label (`camera`, `ui`, `ux-polish`, `wow-feature`, etc.) to indicate the system being modified
- Multiple area labels can be applied to a single issue or PR

### Performance

- Use `performance` for all performance-related work
- Can be combined with area labels

### Priority

- Apply exactly one priority label (P0, P1, or P2) to indicate work importance
- P0 = Critical (blocking other work)
- P1 = Important (should be done soon)
- P2 = Nice to have (can be deferred)

### Good First Issue

- Use `good-first-issue` to mark issues suitable for new contributors
- Include clear instructions and context in the issue

### Meta & Roadmap

- Use `meta` for discussions about project process, labels, or structure
- Use `roadmap` for issues related to long-term planning

## Label Configuration

All label definitions are stored in `scripts/labels.json`:

```json
{
  "labels": [
    {
      "name": "label-name",
      "color": "RRGGBB",
      "description": "Label description"
    }
  ]
}
```

This file serves as the source of truth for label definitions. The `manage-labels.js` script reads this file and syncs labels with the GitHub repository.

## Workflow Integration

The label management script can be integrated into CI/CD workflows. For example, in a GitHub Actions workflow:

```yaml
- name: Sync Labels
  run: |
    npm install
    GITHUB_TOKEN=${{ secrets.GITHUB_TOKEN }} node scripts/manage-labels.js create
```

## Color Rationale

Colors were chosen to provide good visual distinction and follow GitHub conventions:

- **Deep Purple** (#6A0DAD) - Visual upgrades stand out distinctly
- **Blue** (#0366D6) - Technical/rendering focus
- **Red** (#D73A49) - High-impact/urgent work gets attention
- **Gold/Orange** (#F5A623) - "Wow features" are exciting
- **Green** (#28A745) - Performance is positive
- **Purple** (#6F42C1) - Accessibility is important
- **Bright Red** (#FF0000) - P0 priority is critical
- **Orange** (#FFA500) - P1 priority is important
- **Gray** (#CCCCCC) - P2 priority is deferred/lower priority
