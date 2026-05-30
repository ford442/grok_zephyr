#!/usr/bin/env python3
"""
Script to verify the current state of GitHub labels.
Shows which labels have been updated with the correct colors and descriptions.

Usage (from repository root):
  export GITHUB_TOKEN=<your_token>
  python3 scripts/verify_labels.py
"""

import os
import sys
import json
import requests

# GitHub API settings
OWNER = "ford442"
REPO = "grok_zephyr"
BASE_URL = f"https://api.github.com/repos/{OWNER}/{REPO}/labels"

# Expected label definitions
EXPECTED_LABELS = {
    "visual-upgrade": {"color": "7c3aed", "description": "Visual upgrade or enhancement"},
    "rendering": {"color": "0ea5e9", "description": "WebGPU rendering and graphics improvements"},
    "high-impact": {"color": "dc2626", "description": "High-impact changes with significant visual effect"},
    "camera": {"color": "8b5cf6", "description": "Camera control and view modes"},
    "ui": {"color": "06b6d4", "description": "User interface and UI components"},
    "ux-polish": {"color": "10b981", "description": "UX improvements and polish"},
    "wow-feature": {"color": "f59e0b", "description": "Impressive new feature or capability"},
    "performance": {"color": "ec4899", "description": "Performance optimization and improvements"},
    "accessibility": {"color": "14b8a6", "description": "Accessibility improvements and compliance"},
    "P0": {"color": "dc2626", "description": "Critical priority - very important"},
    "P1": {"color": "ea580c", "description": "High priority"},
    "P2": {"color": "eab308", "description": "Medium priority"},
    "good-first-issue": {"color": "7c3aed", "description": "Good for newcomers to the project"},
    "meta": {"color": "6b7280", "description": "Meta discussion or project organization"},
    "roadmap": {"color": "6b7280", "description": "Roadmap planning and future direction"},
    "enhancement": {"color": "10b981", "description": "Improvement or new feature request"},
}

def verify_labels(token):
    """Verify the current state of labels."""
    headers = {
        "Authorization": f"token {token}",
        "Accept": "application/vnd.github.v3+json",
    }
    
    try:
        response = requests.get(BASE_URL, headers=headers)
        if response.status_code != 200:
            print(f"Error fetching labels: HTTP {response.status_code}")
            print(response.text)
            return False
    except requests.RequestException as e:
        print(f"Error connecting to GitHub API: {str(e)}")
        return False
    
    labels = response.json()
    current_labels = {label["name"]: label for label in labels}
    
    print(f"Verifying labels for {OWNER}/{REPO}\n")
    print(f"{'Label':<20} {'Status':<15} {'Current Color':<15} {'Expected Color':<15}")
    print("-" * 65)
    
    updated_count = 0
    needs_update_count = 0
    missing_count = 0
    
    for label_name, expected in EXPECTED_LABELS.items():
        if label_name not in current_labels:
            print(f"{label_name:<20} {'MISSING':<15}")
            missing_count += 1
        else:
            current = current_labels[label_name]
            color_match = current["color"] == expected["color"]
            desc_match = current["description"] == expected["description"]
            
            if color_match and desc_match:
                status = "✓ OK"
                updated_count += 1
            else:
                status = "✗ NEEDS UPDATE"
                needs_update_count += 1
            
            print(f"{label_name:<20} {status:<15} {current['color']:<15} {expected['color']:<15}")
    
    print(f"\n{'Summary:':<20}")
    print(f"  Updated: {updated_count}")
    print(f"  Need update: {needs_update_count}")
    print(f"  Missing: {missing_count}")
    print(f"  Total: {updated_count + needs_update_count + missing_count}")
    
    if needs_update_count + missing_count > 0:
        print(f"\nTo update labels, run: python3 scripts/update_labels_requests.py")
    else:
        print(f"\n✓ All labels are correctly configured!")
    
    return needs_update_count + missing_count == 0

def main():
    """Main function."""
    token = os.environ.get("GITHUB_TOKEN")
    
    if not token:
        print("Error: GITHUB_TOKEN environment variable not set")
        print("Usage: export GITHUB_TOKEN=<your_token> && python3 scripts/verify_labels.py")
        return 1
    
    success = verify_labels(token)
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(main())
