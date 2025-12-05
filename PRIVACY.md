# Privacy Policy for Twitch Drops Tracker

**Last updated:** December 5, 2025

## Overview

Twitch Drops Tracker is a browser extension that helps you track your Twitch drops campaigns and progress. Your privacy is important to us, and this extension is designed with privacy in mind.

## Data Collection

**We do not collect any personal data.**

This extension:
- Does NOT collect personally identifiable information
- Does NOT track your browsing activity
- Does NOT send any data to external servers
- Does NOT use analytics or tracking services
- Does NOT sell or share any user data

## Data Storage

All data is stored **locally** on your device using Chrome's `chrome.storage.local` API. This includes:
- Cached campaign information
- Your drop progress data
- Your inventory data

This data never leaves your browser and is only used to display your drops information within the extension popup.

## Twitch API Communication

The extension communicates **only** with official Twitch APIs (`twitch.tv` and `gql.twitch.tv`) to fetch your drops and campaign data. This is done using your existing Twitch login session and is necessary for the extension to function.

No data from these requests is transmitted anywhere other than between your browser and Twitch's servers.

## Permissions

The extension requires certain permissions to function:
- **Storage:** To save campaign and progress data locally
- **Cookies:** To read your Twitch authentication for API requests
- **Tabs:** To open Twitch pages when requested
- **Scripting:** To capture drop details from Twitch pages
- **Host permissions (twitch.tv):** To communicate with Twitch's API

These permissions are used solely for the extension's core functionality and not for data collection.

## Third Parties

This extension does not share any data with third parties. There are no ads, analytics, or external services integrated into this extension.

## Changes to This Policy

If we make changes to this privacy policy, we will update the "Last updated" date above.

## Contact

If you have questions about this privacy policy, please open an issue on our GitHub repository:
https://github.com/j-ding/twitch-drop-tracker/issues

## Open Source

This extension is open source. You can review the complete source code at:
https://github.com/j-ding/twitch-drop-tracker
