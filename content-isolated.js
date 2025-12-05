/**
 * Twitch Drops Tracker - Isolated World Content Script
 * Bridges communication between main world and background script
 */

// =============================================================================
// State
// =============================================================================
let lastDropCount = 0;

// =============================================================================
// Campaign Data Transformation
// =============================================================================
function transformCampaigns(rawCampaigns) {
  return rawCampaigns
    .filter(c => c.status === 'ACTIVE')
    .map(campaign => ({
      id: campaign.id,
      game: campaign.game?.displayName || campaign.name,
      publisher: campaign.owner?.name || '',
      imageUrl: campaign.game?.boxArtURL?.replace('{width}', '80').replace('{height}', '107') || '',
      startDate: campaign.startAt,
      endDate: campaign.endAt,
      detailsURL: campaign.detailsURL,
      accountLinkURL: campaign.accountLinkURL,
      isConnected: campaign.self?.isAccountConnected || false,
      drops: (campaign.timeBasedDrops || []).map(drop => ({
        id: drop.id,
        name: drop.benefitEdges?.[0]?.benefit?.name || drop.name,
        imageUrl: drop.benefitEdges?.[0]?.benefit?.imageAssetURL || '',
        requiredMinutes: drop.requiredMinutesWatched,
        startAt: drop.startAt,
        endAt: drop.endAt,
        progressMinutes: drop.self?.currentMinutesWatched || 0,
        status: drop.self?.isClaimed ? 'claimed' :
                (drop.self?.currentMinutesWatched >= drop.requiredMinutesWatched) ? 'claimable' :
                (drop.self?.currentMinutesWatched > 0 || drop.self?.hasPreconditionsMet) ? 'in_progress' :
                'locked'
      }))
    }));
}

// =============================================================================
// Event Listeners - Main World Communication
// =============================================================================
window.addEventListener('twitch-drops-campaigns', (event) => {
  const campaigns = event.detail?.campaigns;
  if (!campaigns?.length) return;

  const transformed = transformCampaigns(campaigns);
  const dropCount = transformed.reduce((sum, c) => sum + (c.drops?.length || 0), 0);

  // Only send if we have new data
  if (dropCount >= lastDropCount) {
    lastDropCount = dropCount;
    chrome.runtime.sendMessage({
      action: 'campaignsIntercepted',
      campaigns: transformed
    }).catch(() => {});
  }
});

window.addEventListener('twitch-drops-claimed', (event) => {
  const claimedDrops = event.detail?.claimedDrops;
  if (!claimedDrops?.length) return;

  chrome.runtime.sendMessage({
    action: 'claimedDropsIntercepted',
    claimedDrops
  }).catch(() => {});
});

// =============================================================================
// Background Script Communication
// =============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'extractCampaigns') {
    extractCampaignsFromPage()
      .then(campaigns => sendResponse({ success: true, campaigns }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
});

async function extractCampaignsFromPage() {
  await new Promise(resolve => setTimeout(resolve, 500));

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.textContent = `
      (function() {
        const campaigns = window.__twitchDropsCampaigns || [];
        const dropDetails = window.__twitchDropDetails || {};
        const merged = campaigns.map(c => dropDetails[c.id] ? { ...c, timeBasedDrops: dropDetails[c.id] } : c);
        window.postMessage({ type: 'TWITCH_DROPS_DATA', campaigns: merged }, '*');
      })();
    `;

    const handler = (event) => {
      if (event.data?.type === 'TWITCH_DROPS_DATA') {
        window.removeEventListener('message', handler);
        resolve(event.data.campaigns?.length ? transformCampaigns(event.data.campaigns) : []);
      }
    };

    window.addEventListener('message', handler);
    document.documentElement.appendChild(script);
    script.remove();

    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve([]);
    }, 1000);
  });
}
