# Twitch Drops Tracker

A Chrome extension to track your Twitch drops campaigns and progress, sorted by expiration date.

## Features

- **Campaign Tracking**: View all active Twitch drop campaigns sorted by expiration date
- **Progress Monitoring**: Track your watch time progress for each drop
- **Completion Status**: See which campaigns you've completed with checkmark badges
- **Expiration Alerts**: Campaigns are grouped by urgency (Expiring Today, This Week, Later)
- **Claimable Drops**: Quick access to drops that are ready to claim
- **Dark Theme**: Native dark theme matching Twitch's aesthetic

## Installation

### From Source (Developer Mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked" and select the extension folder
5. The extension icon will appear in your toolbar

### From Chrome Web Store

*Coming soon*

## Usage

1. **Log into Twitch** in your browser
2. Click the extension icon to open the popup
3. Click the **Refresh** button to fetch your current drops data
4. Use **Load All Drop Details** to scan all available campaigns (opens Twitch and auto-expands campaigns)

### Tabs

- **Campaigns**: All available drop campaigns, sorted by expiration date
- **My Progress**: Your active drops, claimable rewards, and recently claimed items

### Status Indicators

- 🔴 **Red border**: Expiring today
- 🟡 **Yellow border**: Expiring this week
- 🟢 **Green border**: Completed campaign
- **✓ Complete**: All drops claimed for this campaign
- **X/Y**: Progress indicator (X drops engaged out of Y total)

## How It Works

The extension uses Twitch's GraphQL API to fetch:
- Available drop campaigns
- Your inventory and progress
- Claimed drops history

For full campaign details, it intercepts network requests when you visit the Twitch drops page, capturing drop information as campaigns are expanded.

## Permissions

- `storage`: Store campaign and progress data locally
- `cookies`: Read Twitch authentication token
- `tabs`: Open Twitch pages for data loading
- `scripting`: Inject scripts to intercept campaign data
- `host_permissions` for `twitch.tv` and `gql.twitch.tv`

## Privacy

- All data is stored locally in your browser
- No data is sent to external servers
- Only communicates with Twitch's official API

## Development

### Project Structure

```
├── manifest.json          # Extension manifest
├── background.js          # Service worker for API calls
├── content-main.js        # Main world script for fetch interception
├── content-isolated.js    # Isolated world script for message passing
├── popup/
│   ├── popup.html         # Popup UI structure
│   ├── popup.css          # Popup styles
│   └── popup.js           # Popup logic and rendering
└── icons/                 # Extension icons
```

### Building

No build step required - the extension runs directly from source.

## License

MIT License

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
