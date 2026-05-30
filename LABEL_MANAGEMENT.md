# Label Management Guide

This guide explains how to set up and maintain GitHub labels for the Grok Zephyr project.

## Overview

The Grok Zephyr project uses a comprehensive set of labels to organize issues and pull requests. These labels were designed based on recommendations from the 2026 Grok-Build visual polish audit.

## Available Labels

See [docs/LABELS.md](../docs/LABELS.md) for a complete description of all available labels, their colors, and usage guidelines.

## Setting Up Labels

### Automatic Setup (Recommended)

The easiest way to set up all labels with the correct colors is to use the GitHub Actions workflow:

1. Go to your repository's Actions tab
2. Find the "Manage Labels" workflow
3. Click "Run workflow" → "Run workflow"
4. The workflow will automatically create/update all labels with the correct colors and descriptions

### Manual Setup

If you need to update labels manually, you can use the provided Python script:

```bash
# Set your GitHub token
export GITHUB_TOKEN=<your_personal_access_token>

# Run the update script
python3 scripts/update_labels.py
```

**Note:** Your personal access token must have `repo` and `admin:org_hook` scopes to manage labels.

## Label Configuration

The label configuration is stored in `scripts/label-config.json`. This file defines:
- Label name
- Color (hex format)
- Description

To add or modify labels, edit this file and then run the update script or the GitHub Actions workflow.

## Integration with GitHub Actions

The repository includes a GitHub Actions workflow (``.github/workflows/manage-labels.yml``) that can:
- Be manually triggered via `workflow_dispatch`
- Automatically run when the workflow file or label configuration changes

This ensures labels are always up-to-date and consistent across the repository.

## Troubleshooting

### Labels don't update when running the script

- Ensure your GITHUB_TOKEN has the correct scopes (`repo` and `admin:org_hook`)
- Check that the label name matches exactly (case-sensitive)
- Verify the API isn't being blocked (you may need VPN access)

### The GitHub Actions workflow fails

- Check the workflow logs in the Actions tab
- Ensure the workflow file is properly formatted
- Verify that the `scripts/update_labels.py` script is executable

## Contributing

When creating new issues or PRs, please use the appropriate labels to help organize the work. See the label descriptions in [docs/LABELS.md](../docs/LABELS.md) for guidance.
