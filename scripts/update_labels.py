#!/usr/bin/env python3
"""
Script to update GitHub labels for the Grok Zephyr project.
This script updates labels with appropriate colors and descriptions for visual & polish work.

Usage (from repository root):
  export GITHUB_TOKEN=<your_token>
  python3 scripts/update_labels.py
"""

import os
import sys
import json
import subprocess

# GitHub API settings
OWNER = "ford442"
REPO = "grok_zephyr"
BASE_URL = f"https://api.github.com/repos/{OWNER}/{REPO}/labels"
UNKNOWN_HTTP_CODE = "000"

# Label definitions with colors and descriptions
LABELS = {
    # Core Visual/Rendering
    "visual-upgrade": {
        "color": "7c3aed",  # deep purple
        "description": "Visual upgrade or enhancement"
    },
    "rendering": {
        "color": "0ea5e9",  # blue
        "description": "WebGPU rendering and graphics improvements"
    },
    "high-impact": {
        "color": "dc2626",  # red
        "description": "High-impact changes with significant visual effect"
    },
    
    # Areas
    "camera": {
        "color": "8b5cf6",  # indigo
        "description": "Camera control and view modes"
    },
    "ui": {
        "color": "06b6d4",  # cyan
        "description": "User interface and UI components"
    },
    "ux-polish": {
        "color": "10b981",  # emerald
        "description": "UX improvements and polish"
    },
    "wow-feature": {
        "color": "f59e0b",  # amber
        "description": "Impressive new feature or capability"
    },
    "performance": {
        "color": "ec4899",  # pink
        "description": "Performance optimization and improvements"
    },
    "accessibility": {
        "color": "14b8a6",  # teal
        "description": "Accessibility improvements and compliance"
    },
    
    # Priority
    "P0": {
        "color": "dc2626",  # bright red
        "description": "Critical priority - very important"
    },
    "P1": {
        "color": "ea580c",  # orange
        "description": "High priority"
    },
    "P2": {
        "color": "eab308",  # yellow
        "description": "Medium priority"
    },
    
    # Other
    "good-first-issue": {
        "color": "7c3aed",  # purple
        "description": "Good for newcomers to the project"
    },
    "meta": {
        "color": "6b7280",  # gray
        "description": "Meta discussion or project organization"
    },
    "roadmap": {
        "color": "6b7280",  # gray
        "description": "Roadmap planning and future direction"
    },
    "enhancement": {
        "color": "10b981",  # green
        "description": "Improvement or new feature request"
    },
}

def update_label(token, label_name, color, description):
    """Update a label using curl."""
    headers = [
        f"Authorization: token {token}",
        "Accept: application/vnd.github.v3+json",
        "Content-Type: application/json"
    ]
    
    data = {
        "color": color,
        "description": description
    }
    
    cmd = ["curl", "-s", "-w", "\n%{http_code}", "-X", "PATCH", f"{BASE_URL}/{label_name}"]
    for header in headers:
        cmd.extend(["-H", header])
    cmd.extend(["-d", json.dumps(data)])
    
    print(f"Updating label: {label_name:20} | Color: {color:6} | Desc: {description[:40]}")
    
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    # Split output and status code
    lines = result.stdout.strip().rsplit('\n', 1)
    http_code = lines[-1] if len(lines) > 1 else UNKNOWN_HTTP_CODE
    response_text = lines[0] if len(lines) > 1 else result.stdout
    
    try:
        if http_code in ["200", "201"]:
            print(f"  ✓ Updated (HTTP {http_code})")
            return True
        else:
            response = json.loads(response_text) if response_text else {}
            print(f"  ✗ Failed (HTTP {http_code}): {response.get('message', 'Unknown error')}")
            return False
    except json.JSONDecodeError:
        if response_text:
            print(f"  ✗ Failed (HTTP {http_code}): {response_text[:100]}")
        else:
            print(f"  ✗ Failed (HTTP {http_code}): No response")
        return False

def main():
    """Main function to update all labels."""
    token = os.environ.get("GITHUB_TOKEN")
    
    if not token:
        print("Error: GITHUB_TOKEN environment variable not set")
        print("Usage: export GITHUB_TOKEN=<your_token> && python3 scripts/update_labels.py")
        return 1
    
    print(f"Updating GitHub labels for {OWNER}/{REPO}")
    print(f"Total labels to update: {len(LABELS)}\n")
    
    success_count = 0
    failure_count = 0
    
    for label_name, config in LABELS.items():
        if update_label(token, label_name, config["color"], config["description"]):
            success_count += 1
        else:
            failure_count += 1
    
    print(f"\nResults:")
    print(f"  Successfully updated: {success_count}")
    print(f"  Failed: {failure_count}")
    
    return 0 if failure_count == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
