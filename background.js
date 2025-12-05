/**
 * Twitch Drops Tracker - Background Service Worker
 * Handles data fetching, storage, and message routing
 */

// =============================================================================
// Configuration
// =============================================================================
const CONFIG = {
  TWITCH_GQL_URL: 'https://gql.twitch.tv/gql',
  CLIENT_ID: 'kimne78kx3ncx6brgo4mv6wki5h1ko',
  BOX_ART_SIZE: { width: 80, height: 107 }
};

// =============================================================================
// Logger (production: minimal logging)
// =============================================================================
const log = {
  info: (...args) => console.log('[TwitchDrops]', ...args),
  error: (...args) => console.error('[TwitchDrops]', ...args)
};

// =============================================================================
// Storage Utilities
// =============================================================================
const storage = {
  async get(keys) {
    return chrome.storage.local.get(keys);
  },

  async set(data) {
    return chrome.storage.local.set(data);
  },

  async getCompletionData() {
    const data = await this.get(['completedCampaigns', 'completedGames']);
    return {
      completedCampaigns: data.completedCampaigns || {},
      completedGames: data.completedGames || {}
    };
  }
};

// =============================================================================
// Twitch API
// =============================================================================
const twitchAPI = {
  async getAuthToken() {
    try {
      const cookie = await chrome.cookies.get({
        url: 'https://www.twitch.tv',
        name: 'auth-token'
      });
      return cookie?.value || null;
    } catch (error) {
      log.error('Failed to get auth token:', error.message);
      return null;
    }
  },

  async graphqlRequest(authToken, query, variables = {}) {
    const response = await fetch(CONFIG.TWITCH_GQL_URL, {
      method: 'POST',
      headers: {
        'Client-ID': CONFIG.CLIENT_ID,
        'Authorization': `OAuth ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.errors) {
      throw new Error(data.errors[0]?.message || 'GraphQL error');
    }

    return data;
  },

  formatBoxArtUrl(url) {
    if (!url) return '';
    return url
      .replace('{width}', CONFIG.BOX_ART_SIZE.width)
      .replace('{height}', CONFIG.BOX_ART_SIZE.height);
  }
};

// =============================================================================
// Data Fetching
// =============================================================================
const dataFetcher = {
  async fetchInventory(authToken) {
    const query = `
      query Inventory {
        currentUser {
          inventory {
            dropCampaignsInProgress {
              id
              name
              owner { id name }
              game { id displayName boxArtURL }
              status startAt endAt
              timeBasedDrops {
                id name requiredMinutesWatched
                self { currentMinutesWatched dropInstanceID isClaimed hasPreconditionsMet }
                benefitEdges { benefit { id name imageAssetURL } }
              }
            }
            gameEventDrops {
              id name imageURL isConnected
              game { displayName }
              lastAwardedAt totalCount
            }
          }
        }
      }
    `;

    const data = await twitchAPI.graphqlRequest(authToken, query);
    const inventory = data.data?.currentUser?.inventory || {};

    return this.parseInventory(inventory);
  },

  parseInventory(inventory) {
    const result = {
      inProgress: [],
      claimable: [],
      claimed: [],
      campaignsRaw: inventory.dropCampaignsInProgress || [],
      gameEventDrops: inventory.gameEventDrops || []
    };

    for (const campaign of result.campaignsRaw) {
      const gameInfo = {
        game: campaign.game?.displayName || campaign.name,
        imageUrl: twitchAPI.formatBoxArtUrl(campaign.game?.boxArtURL),
        campaignId: campaign.id,
        endDate: campaign.endAt
      };

      for (const drop of campaign.timeBasedDrops || []) {
        const self = drop.self;
        if (!self) continue;

        const dropInfo = {
          ...gameInfo,
          dropId: drop.id,
          name: drop.benefitEdges?.[0]?.benefit?.name || drop.name,
          dropImageUrl: drop.benefitEdges?.[0]?.benefit?.imageAssetURL || '',
          requiredMinutes: drop.requiredMinutesWatched,
          progressMinutes: self.currentMinutesWatched || 0,
          hasPreconditionsMet: self.hasPreconditionsMet
        };

        if (self.isClaimed) {
          dropInfo.status = 'claimed';
          result.claimed.push(dropInfo);
        } else if (self.currentMinutesWatched >= drop.requiredMinutesWatched) {
          dropInfo.status = 'claimable';
          result.claimable.push(dropInfo);
        } else if (self.currentMinutesWatched > 0 || self.hasPreconditionsMet) {
          dropInfo.status = 'in_progress';
          result.inProgress.push(dropInfo);
        }
      }
    }

    return result;
  },

  async fetchCampaigns(authToken) {
    // Try cached/intercepted campaigns first
    const cached = await this.getCachedCampaigns();
    if (cached?.length > 0) return cached;

    // Fall back to GraphQL
    const query = `
      query DropCampaignDetails {
        dropCampaigns(status: ACTIVE) {
          id name status startAt endAt detailsURL accountLinkURL
          owner { id name }
          game { id displayName boxArtURL }
          self { isAccountConnected }
          timeBasedDrops {
            id name startAt endAt requiredMinutesWatched
            benefitEdges { benefit { id name imageAssetURL } }
          }
        }
      }
    `;

    try {
      const data = await twitchAPI.graphqlRequest(authToken, query);
      const campaigns = data.data?.dropCampaigns || [];

      return campaigns
        .filter(c => c.status === 'ACTIVE')
        .map(c => ({
          id: c.id,
          game: c.game?.displayName || c.name,
          publisher: c.owner?.name || '',
          imageUrl: twitchAPI.formatBoxArtUrl(c.game?.boxArtURL),
          startDate: c.startAt,
          endDate: c.endAt,
          detailsURL: c.detailsURL,
          accountLinkURL: c.accountLinkURL,
          isConnected: c.self?.isAccountConnected || false,
          drops: (c.timeBasedDrops || []).map(d => ({
            id: d.id,
            name: d.benefitEdges?.[0]?.benefit?.name || d.name,
            imageUrl: d.benefitEdges?.[0]?.benefit?.imageAssetURL || '',
            requiredMinutes: d.requiredMinutesWatched,
            startAt: d.startAt,
            endAt: d.endAt,
            progressMinutes: 0,
            status: 'locked'
          }))
        }));
    } catch (error) {
      log.error('Failed to fetch campaigns:', error.message);
      return [];
    }
  },

  async getCachedCampaigns() {
    const { campaigns } = await storage.get(['campaigns']);
    return campaigns?.length > 2 ? campaigns : null;
  }
};

// =============================================================================
// Campaign Merging
// =============================================================================
const campaignMerger = {
  merge(campaigns, inventory, completedCampaigns, completedGames) {
    // Build progress map
    const progressMap = new Map();
    [...inventory.inProgress, ...inventory.claimable, ...inventory.claimed].forEach(d => {
      progressMap.set(d.dropId, { progressMinutes: d.progressMinutes, status: d.status });
    });

    // Build claimed drops map with dates
    const claimedDropsMap = this.buildClaimedDropsMap(completedGames, inventory.gameEventDrops);

    // Build from inventory if no campaigns
    if (campaigns.length === 0 && inventory.campaignsRaw?.length > 0) {
      return this.buildFromInventory(inventory, progressMap, claimedDropsMap, completedCampaigns);
    }

    // Merge progress into campaigns
    return campaigns.map(campaign => {
      const completedInfo = completedCampaigns[campaign.id];

      const drops = campaign.drops.map(drop => {
        const progress = progressMap.get(drop.id);
        // Check if drop was claimed within this campaign's date range
        const claimedByName = this.isDropClaimedForCampaign(
          drop.name, claimedDropsMap, campaign.startDate, campaign.endDate
        );

        if (progress) {
          return { ...drop, ...progress };
        } else if (claimedByName) {
          return { ...drop, status: 'claimed', claimedByNameMatch: true };
        }
        return drop;
      });

      const isCompleted = this.checkCompletion(drops, completedInfo);

      return {
        ...campaign,
        drops,
        isCompleted,
        completedDropCount: drops.filter(d => d.status === 'claimed').length
      };
    });
  },

  buildClaimedDropsMap(completedGames, gameEventDrops) {
    // Map of drop name -> array of claim dates
    const claimedDrops = new Map();

    const addDrop = (name, claimedAt) => {
      if (!name) return;
      const key = name.toLowerCase().trim();
      if (!claimedDrops.has(key)) {
        claimedDrops.set(key, []);
      }
      if (claimedAt) {
        claimedDrops.get(key).push(new Date(claimedAt));
      }
    };

    // From storage
    Object.values(completedGames).forEach(g => {
      g.claimedDrops?.forEach(d => {
        addDrop(d.name, d.claimedAt);
      });
    });

    // From inventory
    gameEventDrops?.forEach(d => {
      addDrop(d.name, d.lastAwardedAt);
    });

    return claimedDrops;
  },

  isDropClaimedForCampaign(dropName, claimedDropsMap, campaignStartDate, campaignEndDate) {
    if (!dropName) return false;
    const key = dropName.toLowerCase().trim();
    const claimDates = claimedDropsMap.get(key);
    if (!claimDates || claimDates.length === 0) return false;

    const campaignStart = new Date(campaignStartDate);
    const campaignEnd = new Date(campaignEndDate);

    // Check if any claim date falls within the campaign's date range
    return claimDates.some(claimDate => {
      return claimDate >= campaignStart && claimDate <= campaignEnd;
    });
  },

  buildFromInventory(inventory, progressMap, claimedDropsMap, completedCampaigns) {
    return inventory.campaignsRaw.map(campaign => {
      const gameName = campaign.game?.displayName || campaign.name;
      const completedInfo = completedCampaigns[campaign.id];

      const drops = (campaign.timeBasedDrops || []).map(drop => {
        const progress = progressMap.get(drop.id) || { progressMinutes: 0, status: 'locked' };
        const dropName = drop.benefitEdges?.[0]?.benefit?.name || drop.name;
        // Check if drop was claimed within this campaign's date range
        const claimedByName = this.isDropClaimedForCampaign(
          dropName, claimedDropsMap, campaign.startAt, campaign.endAt
        );

        return {
          id: drop.id,
          name: dropName,
          imageUrl: drop.benefitEdges?.[0]?.benefit?.imageAssetURL || '',
          requiredMinutes: drop.requiredMinutesWatched,
          progressMinutes: claimedByName ? drop.requiredMinutesWatched : progress.progressMinutes,
          status: claimedByName ? 'claimed' : progress.status,
          claimedByNameMatch: claimedByName
        };
      });

      const isCompleted = this.checkCompletion(drops, completedInfo);

      return {
        id: campaign.id,
        game: gameName,
        publisher: campaign.owner?.name || '',
        imageUrl: twitchAPI.formatBoxArtUrl(campaign.game?.boxArtURL),
        startDate: campaign.startAt,
        endDate: campaign.endAt,
        isCompleted,
        completedDropCount: drops.filter(d => d.status === 'claimed').length,
        drops
      };
    });
  },

  checkCompletion(drops, completedInfo) {
    if (completedInfo) return true;
    if (drops.length > 0 && drops.every(d => d.status === 'claimed')) return true;
    if (drops.some(d => d.claimedByNameMatch)) return true;
    return false;
  }
};

// =============================================================================
// Claimed Drops Handler
// =============================================================================
const claimedDropsHandler = {
  async process(drops) {
    const { claimedDropsHistory, completedCampaigns, completedGames } =
      await storage.get(['claimedDropsHistory', 'completedCampaigns', 'completedGames']);

    const history = claimedDropsHistory || [];
    const campaigns = completedCampaigns || {};
    const games = completedGames || {};

    // Add new drops to history
    const existingIds = new Set(history.map(d => d.id));
    const newDrops = drops.filter(d => !existingIds.has(d.id));
    const updatedHistory = newDrops.length > 0 ? [...history, ...newDrops] : history;

    // Process all drops for tracking
    for (const drop of drops) {
      // Track by campaign ID
      if (drop.campaignId) {
        if (!campaigns[drop.campaignId]) {
          campaigns[drop.campaignId] = { game: drop.game, claimedDrops: [] };
        }
        const exists = campaigns[drop.campaignId].claimedDrops.some(
          d => d.id === drop.id || d.name === drop.name
        );
        if (!exists) {
          campaigns[drop.campaignId].claimedDrops.push({
            id: drop.id,
            name: drop.name,
            claimedAt: new Date().toISOString()
          });
        }
      }

      // Track by game name
      if (drop.game) {
        const gameName = drop.game.toLowerCase().trim();
        if (!games[gameName]) {
          games[gameName] = { game: drop.game, claimedDrops: [] };
        }
        const exists = games[gameName].claimedDrops.some(
          d => d.id === drop.id || d.name === drop.name
        );
        if (!exists) {
          games[gameName].claimedDrops.push({
            id: drop.id,
            name: drop.name,
            claimedAt: drop.lastAwardedAt || new Date().toISOString()
          });
        }
      }
    }

    await storage.set({
      claimedDropsHistory: updatedHistory,
      completedCampaigns: campaigns,
      completedGames: games
    });
  }
};

// =============================================================================
// Main Data Fetching
// =============================================================================
async function fetchAllData() {
  const authToken = await twitchAPI.getAuthToken();
  if (!authToken) {
    throw new Error('Not logged into Twitch. Please log in and try again.');
  }

  const [inventory, campaigns] = await Promise.all([
    dataFetcher.fetchInventory(authToken),
    dataFetcher.fetchCampaigns(authToken)
  ]);

  const { completedCampaigns, completedGames } = await storage.getCompletionData();
  const mergedCampaigns = campaignMerger.merge(campaigns, inventory, completedCampaigns, completedGames);

  const data = {
    campaigns: mergedCampaigns,
    inventory,
    lastUpdated: new Date().toISOString()
  };

  await storage.set(data);
  return data;
}

// =============================================================================
// Message Handlers
// =============================================================================
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'fetchData':
      fetchAllData()
        .then(data => sendResponse({ success: true, ...data }))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true;

    case 'campaignsIntercepted':
      if (request.campaigns?.length > 0) {
        storage.getCompletionData().then(async ({ completedCampaigns, completedGames }) => {
          const { inventory } = await storage.get(['inventory']);
          const inv = inventory || { inProgress: [], claimable: [], claimed: [], gameEventDrops: [] };
          const merged = campaignMerger.merge(request.campaigns, inv, completedCampaigns, completedGames);
          await storage.set({ campaigns: merged, lastUpdated: new Date().toISOString() });
        });
      }
      sendResponse({ success: true });
      return false;

    case 'claimedDropsIntercepted':
      if (request.claimedDrops?.length > 0) {
        claimedDropsHandler.process(request.claimedDrops);
      }
      sendResponse({ success: true });
      return false;

    default:
      return false;
  }
});

log.info('Service worker initialized');
