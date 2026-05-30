# Label Management Scripts

This directory contains scripts and configuration for managing GitHub labels in the Grok Zephyr project.

## Files

- **update_labels.py** - Update labels using curl (works in most environments)
- **update_labels_requests.py** - Update labels using Python requests library (more reliable)
- **label-config.json** - Configuration file defining all labels and their properties

## Quick Start

### Using GitHub Actions (Recommended)

1. Go to the repository's Actions tab
2. Select "Manage Labels" workflow
3. Click "Run workflow"
4. The workflow will update all labels automatically

### Using the Script Manually

```bash
# Set your GitHub token
export GITHUB_TOKEN=your_personal_access_token

# Run the update script
python3 scripts/update_labels_requests.py
```

**Note:** Your personal access token needs `repo` and `admin:org_hook` scopes.

## Label Categories

The labels are organized into the following categories:

- **Core Visual/Rendering**: visual-upgrade, rendering, high-impact
- **Areas**: camera, ui, ux-polish, wow-feature, performance, accessibility
- **Priority**: P0, P1, P2
- **Other**: good-first-issue, meta, roadmap

For detailed descriptions and color values, see [docs/LABELS.md](../docs/LABELS.md)

## Configuration

To modify labels, edit `label-config.json` with the desired label name, color (hex), and description. Then either:
1. Push changes (GitHub Actions will auto-update)
2. Run the update script manually

## Environment Variables

- `GITHUB_TOKEN` - Required for manual script execution (personal access token)

When using GitHub Actions, `GITHUB_TOKEN` is provided automatically.
