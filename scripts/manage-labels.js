#!/usr/bin/env node

/**
 * Script to create or update labels in a GitHub repository
 * 
 * Usage:
 *   node scripts/manage-labels.js create
 *   node scripts/manage-labels.js delete <label-name>
 *   node scripts/manage-labels.js list
 * 
 * Requires environment variable: GITHUB_TOKEN
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const OWNER = "ford442";
const REPO = "grok_zephyr";
const GITHUB_API = "https://api.github.com";

// Read labels from labels.json
function readLabels() {
  const labelsPath = path.join(__dirname, "labels.json");
  const content = fs.readFileSync(labelsPath, "utf-8");
  return JSON.parse(content).labels;
}

// Get authentication header
function getAuthHeader() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("Error: GITHUB_TOKEN environment variable not set");
    process.exit(1);
  }
  return {
    "Authorization": `token ${token}`,
    "Accept": "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };
}

// Create or update a label
async function createOrUpdateLabel(label) {
  const headers = getAuthHeader();
  const url = `${GITHUB_API}/repos/${OWNER}/${REPO}/labels/${encodeURIComponent(label.name)}`;
  
  try {
    // First, try to get the existing label
    const getResponse = await fetch(url, { headers });
    const isExisting = getResponse.ok;
    
    if (isExisting) {
      // Update existing label
      console.log(`Updating label: ${label.name}`);
      const response = await fetch(url, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          new_name: label.name,
          color: label.color,
          description: label.description,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error(`Failed to update label ${label.name}:`, error);
        return false;
      }
    } else {
      // Create new label
      console.log(`Creating label: ${label.name}`);
      const response = await fetch(`${GITHUB_API}/repos/${OWNER}/${REPO}/labels`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          name: label.name,
          color: label.color,
          description: label.description,
        }),
      });
      
      if (!response.ok) {
        const error = await response.json();
        console.error(`Failed to create label ${label.name}:`, error);
        return false;
      }
    }
    
    console.log(`✓ Label "${label.name}" synced successfully`);
    return true;
  } catch (error) {
    console.error(`Error processing label ${label.name}:`, error);
    return false;
  }
}

// Delete a label
async function deleteLabel(labelName) {
  const headers = getAuthHeader();
  const url = `${GITHUB_API}/repos/${OWNER}/${REPO}/labels/${encodeURIComponent(labelName)}`;
  
  try {
    console.log(`Deleting label: ${labelName}`);
    const response = await fetch(url, {
      method: "DELETE",
      headers,
    });
    
    if (!response.ok && response.status !== 404) {
      const error = await response.json();
      console.error(`Failed to delete label ${labelName}:`, error);
      return false;
    }
    
    console.log(`✓ Label "${labelName}" deleted successfully`);
    return true;
  } catch (error) {
    console.error(`Error deleting label ${labelName}:`, error);
    return false;
  }
}

// List all labels in the repository
async function listLabels() {
  const headers = getAuthHeader();
  const url = `${GITHUB_API}/repos/${OWNER}/${REPO}/labels`;
  
  try {
    console.log(`\nFetching labels from ${OWNER}/${REPO}...\n`);
    const response = await fetch(url, { headers });
    
    if (!response.ok) {
      const error = await response.json();
      console.error("Failed to fetch labels:", error);
      return false;
    }
    
    const labels = await response.json();
    
    if (labels.length === 0) {
      console.log("No labels found in the repository.");
      return true;
    }
    
    console.log(`Found ${labels.length} label(s):\n`);
    labels.forEach((label) => {
      console.log(`  • ${label.name.padEnd(20)} (#${label.color}) - ${label.description || "(no description)"}`);
    });
    console.log("");
    
    return true;
  } catch (error) {
    console.error("Error fetching labels:", error);
    return false;
  }
}

// Main function
async function main() {
  const command = process.argv[2];
  
  switch (command) {
    case "create":
      console.log("Creating/updating labels...\n");
      const labels = readLabels();
      let successCount = 0;
      
      for (const label of labels) {
        if (await createOrUpdateLabel(label)) {
          successCount++;
        }
      }
      
      console.log(`\n${successCount}/${labels.length} labels synced successfully`);
      process.exit(successCount === labels.length ? 0 : 1);
      break;
      
    case "delete":
      const labelName = process.argv[3];
      if (!labelName) {
        console.error("Error: Please provide a label name to delete");
        console.error("Usage: node manage-labels.js delete <label-name>");
        process.exit(1);
      }
      const deleted = await deleteLabel(labelName);
      process.exit(deleted ? 0 : 1);
      break;
      
    case "list":
      const listed = await listLabels();
      process.exit(listed ? 0 : 1);
      break;
      
    default:
      console.log(`Usage:
  node scripts/manage-labels.js create    - Create or update all labels
  node scripts/manage-labels.js delete <name> - Delete a label
  node scripts/manage-labels.js list      - List all labels in repository

Environment variables:
  GITHUB_TOKEN - GitHub personal access token (required)
      `);
      process.exit(0);
  }
}

main();
