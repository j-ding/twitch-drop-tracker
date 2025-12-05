/**
 * Twitch Drops Tracker - Main World Content Script
 * Runs in page context to intercept fetch requests
 */
(function() {
  'use strict';

  // ==========================================================================
  // Configuration
  // ==========================================================================
  const CONFIG = {
    GRAPHQL_URL: 'gql.twitch.tv',
    NOTIFICATION_ID: 'twitch-drops-notification',
    PAGE_LOAD_DELAY: 2000,
    EXPAND_CLICK_DELAY: 200,
    SCROLL_DELAY: 400,
    SCROLL_AMOUNT: 800,
    MAX_ITERATIONS: 100,
    HEADER_HEIGHT: 60,
    SIDEBAR_WIDTH: 80
  };

  // ==========================================================================
  // Logger (production: minimal logging)
  // ==========================================================================
  const log = {
    info: (...args) => console.log('[TwitchDrops]', ...args),
    error: (...args) => console.error('[TwitchDrops]', ...args)
  };

  // ==========================================================================
  // State Management
  // ==========================================================================
  const state = {
    get campaigns() { return window.__twitchDropsCampaigns || []; },
    set campaigns(val) { window.__twitchDropsCampaigns = val; },
    get details() { return window.__twitchDropDetails || {}; },
    set details(val) { window.__twitchDropDetails = val; },
    get claimedDrops() { return window.__twitchClaimedDrops || []; },
    set claimedDrops(val) { window.__twitchClaimedDrops = val; }
  };

  // Initialize state
  window.__twitchDropsCampaigns = window.__twitchDropsCampaigns || [];
  window.__twitchDropDetails = window.__twitchDropDetails || {};
  window.__twitchClaimedDrops = window.__twitchClaimedDrops || [];

  // ==========================================================================
  // Event Dispatching
  // ==========================================================================
  function dispatchCampaigns() {
    const merged = state.campaigns.map(campaign => ({
      ...campaign,
      timeBasedDrops: state.details[campaign.id] || campaign.timeBasedDrops
    }));

    if (merged.length > 0) {
      window.dispatchEvent(new CustomEvent('twitch-drops-campaigns', {
        detail: { campaigns: merged }
      }));
    }
  }

  function dispatchClaimedDrops() {
    if (state.claimedDrops.length > 0) {
      window.dispatchEvent(new CustomEvent('twitch-drops-claimed', {
        detail: { claimedDrops: state.claimedDrops }
      }));
    }
  }

  // ==========================================================================
  // Data Extraction Utilities
  // ==========================================================================
  const extractors = {
    /**
     * Extract campaigns list from GraphQL response
     */
    campaignsList(data) {
      const sources = Array.isArray(data) ? data : [data];
      for (const item of sources) {
        const campaigns = item?.data?.currentUser?.dropCampaigns ||
                         item?.data?.user?.dropCampaigns ||
                         item?.data?.dropCampaigns;
        if (campaigns?.length > 0) return campaigns;
      }
      return null;
    },

    /**
     * Extract single campaign details (when expanded)
     */
    campaignDetails(data) {
      const sources = Array.isArray(data) ? data : [data];
      for (const item of sources) {
        const campaign = item?.data?.dropCampaign || item?.data?.user?.dropCampaign;
        if (campaign?.id && campaign?.timeBasedDrops) return campaign;
      }
      return null;
    },

    /**
     * Extract claimed drops from inventory response
     */
    claimedDrops(data) {
      const drops = [];
      const seen = new Set();

      const extract = (obj) => {
        if (!obj || typeof obj !== 'object') return;

        // Game event drops (claimed section)
        if (Array.isArray(obj.gameEventDrops)) {
          for (const drop of obj.gameEventDrops) {
            if (seen.has(drop.id)) continue;
            seen.add(drop.id);
            drops.push({
              id: drop.id,
              name: drop.name,
              imageUrl: drop.imageURL,
              game: drop.game?.displayName || drop.game?.name || '',
              lastAwardedAt: drop.lastAwardedAt,
              totalCount: drop.totalCount,
              type: 'gameEventDrop'
            });
          }
        }

        // Time-based drops from campaigns in progress
        if (Array.isArray(obj.dropCampaignsInProgress)) {
          for (const campaign of obj.dropCampaignsInProgress) {
            for (const drop of campaign.timeBasedDrops || []) {
              if (!drop.self?.isClaimed || seen.has(drop.id)) continue;
              seen.add(drop.id);
              drops.push({
                id: drop.id,
                name: drop.benefitEdges?.[0]?.benefit?.name || drop.name,
                imageUrl: drop.benefitEdges?.[0]?.benefit?.imageAssetURL || '',
                game: campaign.game?.displayName || campaign.name,
                campaignId: campaign.id,
                type: 'timeBasedDrop'
              });
            }
          }
        }

        // Recurse into nested objects (limited depth)
        if (Array.isArray(obj)) {
          obj.forEach(extract);
        } else {
          Object.values(obj).forEach(val => {
            if (val && typeof val === 'object') extract(val);
          });
        }
      };

      extract(data);
      return drops;
    },

    /**
     * Search for timeBasedDrops in nested response
     */
    searchDropsInResponse(obj, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > 6) return;

      if (obj.timeBasedDrops?.length > 0 && obj.id) {
        state.details = { ...state.details, [obj.id]: obj.timeBasedDrops };
        dispatchCampaigns();
      }

      const items = Array.isArray(obj) ? obj : Object.values(obj);
      items.forEach(val => {
        if (val && typeof val === 'object') {
          this.searchDropsInResponse(val, depth + 1);
        }
      });
    }
  };

  // ==========================================================================
  // Fetch Interceptor
  // ==========================================================================
  const originalFetch = window.fetch;

  window.fetch = async function(...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = args[0]?.url || args[0];
      if (typeof url === 'string' && url.includes(CONFIG.GRAPHQL_URL)) {
        const clone = response.clone();
        clone.json().then(data => {
          // Extract campaigns list
          const campaigns = extractors.campaignsList(data);
          if (campaigns) {
            state.campaigns = campaigns;
            dispatchCampaigns();
          }

          // Extract campaign details
          const details = extractors.campaignDetails(data);
          if (details) {
            state.details = { ...state.details, [details.id]: details.timeBasedDrops };
            dispatchCampaigns();
          }

          // Search for drops in response
          extractors.searchDropsInResponse(data);

          // Extract claimed drops
          const claimed = extractors.claimedDrops(data);
          if (claimed.length > 0) {
            const existingIds = new Set(state.claimedDrops.map(d => d.id));
            const newDrops = claimed.filter(d => !existingIds.has(d.id));
            if (newDrops.length > 0) {
              state.claimedDrops = [...state.claimedDrops, ...newDrops];
              dispatchClaimedDrops();
            }
          }
        }).catch(() => {});
      }
    } catch (e) {
      // Silently ignore errors
    }

    return response;
  };

  // ==========================================================================
  // UI Notifications
  // ==========================================================================
  const notification = {
    show(message, isError = false, persistent = false) {
      this.remove();
      const div = document.createElement('div');
      div.id = CONFIG.NOTIFICATION_ID;
      div.style.cssText = `
        position: fixed; top: 20px; right: 20px;
        padding: 16px 24px; background: ${isError ? '#f44336' : '#9147ff'};
        color: white; border-radius: 8px; font-size: 14px;
        font-family: -apple-system, BlinkMacSystemFont, sans-serif;
        z-index: 999999; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        max-width: 300px;
      `;
      div.textContent = message;
      document.body.appendChild(div);
      if (!persistent) setTimeout(() => this.remove(), 5000);
    },

    update(message) {
      const el = document.getElementById(CONFIG.NOTIFICATION_ID);
      if (el) el.textContent = message;
    },

    remove() {
      document.getElementById(CONFIG.NOTIFICATION_ID)?.remove();
    }
  };

  // ==========================================================================
  // Campaign Expansion Logic
  // ==========================================================================
  const campaignExpander = {
    /**
     * Check if button is a valid campaign expand button
     */
    isValidButton(btn) {
      if (!btn.offsetParent) return false;

      const rect = btn.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
      const absoluteTop = rect.top + scrollTop;

      // Skip header, sidebar, and profile area buttons
      if (absoluteTop < CONFIG.HEADER_HEIGHT) return false;
      if (rect.left < CONFIG.SIDEBAR_WIDTH) return false;
      if (rect.left > window.innerWidth - CONFIG.SIDEBAR_WIDTH) return false;

      // Must have SVG chevron icon
      return !!btn.querySelector('svg');
    },

    /**
     * Get stable button identifier
     */
    getButtonId(btn, allButtons) {
      const parent = btn.closest('[class*="Layout"]') || btn.parentElement;
      return parent?.getAttribute('data-test-selector') ||
             btn.getAttribute('aria-controls') ||
             `btn_${Array.from(allButtons).indexOf(btn)}`;
    },

    /**
     * Check if campaign is expired
     */
    isExpired(campaignId) {
      const campaign = state.campaigns.find(c => c.id === campaignId);
      return campaign && new Date(campaign.endAt) < new Date();
    },

    /**
     * Expand all campaigns sequentially
     */
    async expandAll() {
      notification.show('Loading drop details...', false, true);
      await this.delay(CONFIG.PAGE_LOAD_DELAY);

      let totalExpanded = 0;
      const clickedButtons = new Set();

      for (let i = 0; i < CONFIG.MAX_ITERATIONS; i++) {
        const allButtons = document.querySelectorAll('button[aria-expanded="false"]');
        const validButtons = Array.from(allButtons).filter(b => this.isValidButton(b));

        let expandedThisRound = 0;
        let hitExpired = false;

        for (const btn of validButtons) {
          const btnId = this.getButtonId(btn, allButtons);
          if (clickedButtons.has(btnId)) continue;

          // Scroll into view and click
          btn.scrollIntoView({ behavior: 'instant', block: 'center' });
          await this.delay(100);
          btn.click();
          clickedButtons.add(btnId);
          totalExpanded++;
          expandedThisRound++;

          await this.delay(CONFIG.EXPAND_CLICK_DELAY);

          // Check for expired campaign
          const lastDetailId = Object.keys(state.details).pop();
          if (lastDetailId && this.isExpired(lastDetailId)) {
            hitExpired = true;
            break;
          }

          // Update progress
          if (totalExpanded % 5 === 0) {
            notification.update(`Loading... ${Object.keys(state.details).length} campaigns`);
          }
        }

        if (hitExpired) break;

        // Scroll to find more buttons
        if (expandedThisRound === 0) {
          window.scrollBy(0, CONFIG.SCROLL_AMOUNT);
          await this.delay(CONFIG.SCROLL_DELAY);

          const newButtons = document.querySelectorAll('button[aria-expanded="false"]');
          const hasNew = Array.from(newButtons)
            .filter(b => this.isValidButton(b))
            .some(b => !clickedButtons.has(this.getButtonId(b, newButtons)));

          if (!hasNew) break;
        }
      }

      this.finalize(totalExpanded);
    },

    /**
     * Finalize expansion process
     */
    finalize(totalExpanded) {
      dispatchCampaigns();
      window.history.replaceState({}, '', window.location.pathname);
      window.scrollTo(0, 0);

      const count = Math.max(state.campaigns.length, Object.keys(state.details).length);
      if (count === 0) {
        notification.show('No campaigns found. Make sure you\'re on the Twitch Drops page.', true);
      } else {
        notification.show(`Done! Loaded ${count} campaigns. You can close this tab.`);
      }

      log.info(`Expanded ${totalExpanded} campaigns, captured ${count} total`);
    },

    delay: ms => new Promise(resolve => setTimeout(resolve, ms))
  };

  // ==========================================================================
  // Initialization
  // ==========================================================================
  function checkForExpandRequest() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('loadAllDrops') === 'true') {
      campaignExpander.expandAll();
    }
  }

  // Initialize on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(checkForExpandRequest, 1500);
    });
  } else {
    setTimeout(checkForExpandRequest, 1500);
  }
})();
