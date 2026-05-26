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
    PAGE_LOAD_DELAY: 500,
    EXPAND_CLICK_DELAY: 30,
    SCROLL_DELAY: 70,
    SCROLL_AMOUNT: 800,
    MAX_ITERATIONS: 100,
    HEADER_HEIGHT: 60,
    SIDEBAR_WIDTH: 80,
    // API response tracking
    API_RESPONSE_TIMEOUT: 2000,  // Max wait per button if a GQL request is pending
    API_SETTLE_TIME: 100,        // Wait after last response before moving on
    API_CACHE_HIT_WAIT: 120      // If no GQL request fires within this many ms, assume cache hit and move on
  };

  // ==========================================================================
  // Localization (notification messages only)
  // ==========================================================================
  const LOCALE_FALLBACK = {
    notif_keep_focused: '⚠️ Keep this tab focused! Loading drops...',
    notif_games_selected: '({count} games selected)',
    notif_tab_lost: '⚠️ Tab lost focus! Click here to continue loading.',
    notif_loading_details: 'Loading drop details...',
    notif_loading_count: 'Loading... {count} campaigns',
    notif_loading_skip: ', {skipped} skipped',
    notif_no_campaigns: 'No campaigns found. Page may not have loaded properly. Try again.',
    notif_all_skipped: 'Skipped {count} filtered games. No selected games had drop details to load.',
    notif_no_details: 'Found {count} campaigns, {expanded} buttons clicked, but no drop details captured. Try again.',
    notif_done: 'Done! Loaded {drops} drops from {campaigns} campaigns{skip}. Closing in 3s...',
    notif_done_skip: ' ({filtered} filtered)',
    bubble_keep_focused: 'Keep This Tab Focused!',
    bubble_keep_focused_sub: 'Switching away may interrupt the drop scan.',
  };

  function tNotif(key, vars = {}) {
    let raw;
    try {
      const attr = document.documentElement.getAttribute('data-twitch-drops-locale');
      const strings = attr ? JSON.parse(attr) : {};
      raw = strings[key] || LOCALE_FALLBACK[key] || key;
    } catch {
      raw = LOCALE_FALLBACK[key] || key;
    }
    let s = raw;
    for (const [k, v] of Object.entries(vars)) {
      s = s.split(`{${k}}`).join(String(v));
    }
    return s;
  }

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
    set claimedDrops(val) { window.__twitchClaimedDrops = val; },
    // Track last API response time for smart waiting
    lastApiResponse: 0,
    pendingRequests: 0
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
     * Now handles complex campaigns with drops spread across multiple structures
     */
    campaignDetails(data) {
      const sources = Array.isArray(data) ? data : [data];
      for (const item of sources) {
        const campaign = item?.data?.dropCampaign || item?.data?.user?.dropCampaign;
        if (campaign?.id) {
          // Collect ALL timeBasedDrops from the campaign, including nested ones
          const allDrops = this.collectAllDrops(campaign);
          if (allDrops.length > 0) {
            return { ...campaign, timeBasedDrops: allDrops };
          }
        }
      }
      return null;
    },

    /**
     * Recursively collect ALL timeBasedDrops from a campaign object
     * Handles complex structures where drops are nested in channels, days, etc.
     */
    collectAllDrops(obj, depth = 0, seenIds = new Set()) {
      const drops = [];
      if (!obj || typeof obj !== 'object' || depth > 10) return drops;

      // Direct timeBasedDrops array
      if (Array.isArray(obj.timeBasedDrops)) {
        for (const drop of obj.timeBasedDrops) {
          if (drop?.id && !seenIds.has(drop.id)) {
            seenIds.add(drop.id);
            drops.push(drop);
          }
        }
      }

      // Check for drops in allow/channels structures (common in multi-channel campaigns)
      if (obj.allow?.channels) {
        for (const channel of obj.allow.channels) {
          drops.push(...this.collectAllDrops(channel, depth + 1, seenIds));
        }
      }

      // Check for eventBasedDrops (some campaigns use this)
      if (Array.isArray(obj.eventBasedDrops)) {
        for (const drop of obj.eventBasedDrops) {
          if (drop?.id && !seenIds.has(drop.id)) {
            seenIds.add(drop.id);
            drops.push(drop);
          }
        }
      }

      // Recurse into arrays and objects to find nested drops
      if (Array.isArray(obj)) {
        for (const item of obj) {
          drops.push(...this.collectAllDrops(item, depth + 1, seenIds));
        }
      } else {
        for (const [key, val] of Object.entries(obj)) {
          // Skip already processed keys and non-objects
          if (key === 'timeBasedDrops' || key === 'eventBasedDrops') continue;
          if (val && typeof val === 'object') {
            drops.push(...this.collectAllDrops(val, depth + 1, seenIds));
          }
        }
      }

      return drops;
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
     * Enhanced to merge drops instead of replacing
     */
    searchDropsInResponse(obj, depth = 0) {
      if (!obj || typeof obj !== 'object' || depth > 15) return;

      // Found a campaign-like object with an ID
      if (obj.id && typeof obj.id === 'string') {
        const allDrops = this.collectAllDrops(obj);
        if (allDrops.length > 0) {
          // Merge with existing drops for this campaign
          const existingDrops = state.details[obj.id] || [];
          const existingIds = new Set(existingDrops.map(d => d.id));
          const newDrops = allDrops.filter(d => !existingIds.has(d.id));

          if (newDrops.length > 0) {
            state.details = {
              ...state.details,
              [obj.id]: [...existingDrops, ...newDrops]
            };
            dispatchCampaigns();
          }
        }
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
    const url = args[0]?.url || args[0];
    const isGraphQL = typeof url === 'string' && url.includes(CONFIG.GRAPHQL_URL);

    // Track pending GraphQL requests
    if (isGraphQL) {
      state.pendingRequests++;
    }

    const response = await originalFetch.apply(this, args);

    try {
      if (isGraphQL) {
        const clone = response.clone();
        clone.json().then(data => {
          // Mark response received
          state.lastApiResponse = Date.now();
          state.pendingRequests = Math.max(0, state.pendingRequests - 1);

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
        }).catch(() => {
          state.pendingRequests = Math.max(0, state.pendingRequests - 1);
        });
      }
    } catch (e) {
      if (isGraphQL) {
        state.pendingRequests = Math.max(0, state.pendingRequests - 1);
      }
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
        position: fixed !important; top: 20px !important; right: 20px !important;
        padding: 16px 24px !important; background: ${isError ? '#c62828' : '#7b2ff7'} !important;
        color: #fff !important; border-radius: 12px !important; font-size: 18px !important;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif !important;
        z-index: 2147483646 !important; box-shadow: 0 4px 20px rgba(0,0,0,0.5) !important;
        max-width: 480px !important; line-height: 1.4 !important;
        border-left: 4px solid ${isError ? '#ff5252' : '#b266ff'} !important;
      `;
      div.textContent = message;
      // Append to <html> so body zoom doesn't shrink it
      document.documentElement.appendChild(div);
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
  // Speech Bubble
  // ==========================================================================
  const BUBBLE_ID = 'tdt-speech-bubble';
  const BUBBLE_STYLE_ID = 'tdt-speech-bubble-style';

  function showSpeechBubble() {
    document.getElementById(BUBBLE_ID)?.remove();
    document.getElementById(BUBBLE_STYLE_ID)?.remove();

    const title = tNotif('bubble_keep_focused');
    const sub = tNotif('bubble_keep_focused_sub');

    // Inject keyframes into <head> (unaffected by body zoom)
    const style = document.createElement('style');
    style.id = BUBBLE_STYLE_ID;
    style.textContent = `
      @keyframes _tdt_pop_in {
        0%   { transform: translate(-50%, -50%) scale(0.5); opacity: 0; }
        65%  { transform: translate(-50%, -50%) scale(1.04); opacity: 1; }
        100% { transform: translate(-50%, -50%) scale(1); opacity: 1; }
      }
      @keyframes _tdt_fade_out {
        from { transform: translate(-50%, -50%) scale(1); opacity: 1; }
        to   { transform: translate(-50%, -50%) scale(0.88); opacity: 0; }
      }
      @keyframes _tdt_pulse {
        0%, 100% { box-shadow: 0 0 0 0 rgba(145,71,255,0.5), 0 24px 64px rgba(0,0,0,0.7); }
        50%       { box-shadow: 0 0 0 18px rgba(145,71,255,0), 0 24px 64px rgba(0,0,0,0.7); }
      }
      @keyframes _tdt_icon_bounce {
        0%, 100% { transform: translateY(0); }
        40%       { transform: translateY(-10px); }
        60%       { transform: translateY(-5px); }
      }
    `;
    document.head.appendChild(style);

    // Append to <html>, NOT <body> — body.style.zoom won't scale this element
    const bubble = document.createElement('div');
    bubble.id = BUBBLE_ID;
    bubble.style.cssText = `
      position: fixed !important;
      top: 50% !important;
      left: 50% !important;
      transform: translate(-50%, -50%) scale(0.5);
      z-index: 2147483647 !important;
      pointer-events: none !important;
      animation: _tdt_pop_in 0.45s cubic-bezier(0.34, 1.56, 0.64, 1) forwards !important;
    `;

    bubble.innerHTML = `
      <div style="
        background: #18181b;
        border: 3px solid #9147ff;
        border-radius: 28px;
        padding: 44px 52px 40px;
        width: 520px;
        text-align: center;
        box-shadow: 0 0 0 0 rgba(145,71,255,0.5), 0 24px 64px rgba(0,0,0,0.7);
        animation: _tdt_pulse 2.2s ease-in-out 0.5s infinite;
        position: relative;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      ">
        <!-- tail pointing toward top-right notification bar -->
        <div style="
          position: absolute; top: -22px; right: 72px;
          width: 0; height: 0;
          border-left: 16px solid transparent;
          border-right: 16px solid transparent;
          border-bottom: 22px solid #9147ff;
        "></div>
        <div style="
          position: absolute; top: -17px; right: 73px;
          width: 0; height: 0;
          border-left: 15px solid transparent;
          border-right: 15px solid transparent;
          border-bottom: 18px solid #18181b;
          z-index: 1;
        "></div>

        <div style="font-size: 60px; margin-bottom: 16px; display: block; animation: _tdt_icon_bounce 1.6s ease-in-out 0.6s infinite; line-height: 1;">🎁</div>
        <div style="color: #9147ff; font-weight: 700; font-size: 13px; text-transform: uppercase; letter-spacing: 2.5px; margin-bottom: 14px;">Twitch Drops Tracker</div>
        <div style="color: #efeff1; font-weight: 700; font-size: 28px; line-height: 1.2; margin-bottom: 12px;">${title}</div>
        <div style="color: #adadb8; font-size: 17px; line-height: 1.55;">${sub}</div>
      </div>
    `;

    // Append to documentElement (<html>) so body zoom doesn't shrink it
    document.documentElement.appendChild(bubble);

    setTimeout(() => {
      const el = document.getElementById(BUBBLE_ID);
      if (!el) return;
      el.style.animation = '_tdt_fade_out 0.35s ease forwards !important';
      setTimeout(() => {
        el?.remove();
        document.getElementById(BUBBLE_STYLE_ID)?.remove();
      }, 350);
    }, 4500);
  }

  // ==========================================================================
  // Game Filter
  // ==========================================================================
  function getGameFilter() {
    try {
      const filterData = document.documentElement.getAttribute('data-twitch-drops-filter');
      if (filterData) {
        return JSON.parse(filterData);
      }
    } catch (e) {
      log.error('Failed to parse game filter:', e);
    }
    return { enabled: false, games: {} };
  }

  function isGameAllowed(gameName) {
    const filter = getGameFilter();
    if (!filter.enabled) return true; // No filtering active
    if (!gameName) return true; // Can't determine game, allow it
    return filter.games[gameName] !== false; // Allow if checked or not in list
  }

  function getActiveGameCount() {
    const filter = getGameFilter();
    if (!filter.enabled) return null; // No filtering
    return Object.values(filter.games).filter(v => v === true).length;
  }

  /**
   * Try to find the game name from the DOM near a button
   */
  function findGameNameForButton(btn) {
    // Look for a campaign card container
    const card = btn.closest('[class*="campaign"], [class*="Campaign"], [data-test-selector*="campaign"]') ||
                 btn.closest('[class*="ScTower"], [class*="Layout"]');

    if (card) {
      // Try to find game title in the card
      const titleEl = card.querySelector('h3, h4, [class*="title" i], [class*="game" i], p');
      if (titleEl?.textContent) {
        const text = titleEl.textContent.trim();
        // Check if this matches any known campaign game name
        const matchedCampaign = state.campaigns.find(c =>
          c.game?.displayName === text || c.name === text
        );
        if (matchedCampaign) {
          return matchedCampaign.game?.displayName || matchedCampaign.name;
        }
      }

      // Try to match by looking at all text in the card
      const cardText = card.textContent || '';
      for (const campaign of state.campaigns) {
        const gameName = campaign.game?.displayName || campaign.name;
        if (gameName && cardText.includes(gameName)) {
          return gameName;
        }
      }
    }

    return null;
  }

  // ==========================================================================
  // Campaign Expansion Logic
  // ==========================================================================
  const campaignExpander = {
    /**
     * Check if button is a valid campaign expand button
     */
    isValidButton(btn) {
      // Must be visible (either offsetParent or non-zero bounding rect)
      const rect = btn.getBoundingClientRect();
      if (!btn.offsetParent && rect.width === 0) return false;

      // Get zoom level for coordinate adjustment
      const zoom = parseFloat(document.body.style.zoom) / 100 || 1;

      const adjustedLeft = rect.left / zoom;
      const adjustedTop = rect.top / zoom;
      const adjustedWindowWidth = window.innerWidth / zoom;

      // Skip header and left sidebar buttons
      if (adjustedTop < CONFIG.HEADER_HEIGHT) return false;
      if (adjustedLeft < CONFIG.SIDEBAR_WIDTH) return false;
      // Note: no right-side filter — the expand chevron IS at the far right of each row

      // Accept if it has an SVG, an img, or is icon-sized (chevron may be CSS-only)
      const logicalWidth = rect.width / zoom;
      return !!btn.querySelector('svg') ||
             !!btn.querySelector('img') ||
             (logicalWidth > 0 && logicalWidth <= 80);
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
      showSpeechBubble();

      // Check if filtering is active
      const activeGames = getActiveGameCount();
      const filterMsg = activeGames !== null ? ' ' + tNotif('notif_games_selected', {count: activeGames}) : '';
      notification.show(tNotif('notif_keep_focused') + filterMsg, false, true);

      // Try to keep the tab active by requesting visibility
      this.keepTabActive();

      // Save original zoom and zoom out to 25% to see more campaigns
      this.originalZoom = document.body.style.zoom || '100%';
      document.body.style.zoom = '25%';

      await this.delay(CONFIG.PAGE_LOAD_DELAY);

      // Wait for page content to load
      let retries = 0;
      while (retries < 10) {
        const testButtons = document.querySelectorAll('[aria-expanded]');
        if (testButtons.length > 0) break;
        log.info(`Waiting for page to load... (attempt ${retries + 1})`);
        await this.delay(1000);
        retries++;
      }

      let totalExpanded = 0;
      let skippedFiltered = 0;
      const clickedButtons = new Set();

      for (let i = 0; i < CONFIG.MAX_ITERATIONS; i++) {
        const allButtons = document.querySelectorAll('[aria-expanded="false"]');
        const validButtons = Array.from(allButtons).filter(b => this.isValidButton(b));

        log.info(`Iteration ${i}: Found ${allButtons.length} collapsed buttons, ${validButtons.length} valid`);

        let expandedThisRound = 0;
        let hitExpired = false;

        for (const btn of validButtons) {
          const btnId = this.getButtonId(btn, allButtons);
          if (clickedButtons.has(btnId)) continue;

          // Check if this campaign's game is allowed by the filter
          const gameName = findGameNameForButton(btn);
          if (gameName && !isGameAllowed(gameName)) {
            clickedButtons.add(btnId); // Mark as handled so we don't check again
            skippedFiltered++;
            log.info(`Skipping filtered game: ${gameName}`);
            continue;
          }

          // Scroll into view and click
          btn.scrollIntoView({ behavior: 'instant', block: 'center' });
          await this.delay(CONFIG.EXPAND_CLICK_DELAY);
          const responseTimeBefore = state.lastApiResponse;
          btn.click();
          clickedButtons.add(btnId);
          totalExpanded++;
          expandedThisRound++;

          // Wait for API responses to settle (smart wait for large campaigns)
          await this.waitForApiResponse(responseTimeBefore);

          // Check for expired campaign
          const lastDetailId = Object.keys(state.details).pop();
          if (lastDetailId && this.isExpired(lastDetailId)) {
            hitExpired = true;
            break;
          }

          // Update progress
          if (totalExpanded % 5 === 0) {
            const skipMsg = skippedFiltered > 0 ? tNotif('notif_loading_skip', {skipped: skippedFiltered}) : '';
            notification.update(tNotif('notif_loading_count', {count: Object.keys(state.details).length}) + skipMsg);
          }
        }

        if (hitExpired) break;

        // Scroll to find more buttons
        if (expandedThisRound === 0) {
          window.scrollBy(0, CONFIG.SCROLL_AMOUNT);
          await this.delay(CONFIG.SCROLL_DELAY);

          const newButtons = document.querySelectorAll('[aria-expanded="false"]');
          const hasNew = Array.from(newButtons)
            .filter(b => this.isValidButton(b))
            .some(b => !clickedButtons.has(this.getButtonId(b, newButtons)));

          if (!hasNew) break;
        }
      }

      await this.finalize(totalExpanded, skippedFiltered);
    },

    /**
     * Finalize expansion process
     */
    async finalize(totalExpanded, skippedFiltered = 0) {
      // Drain any in-flight GQL requests before reading state
      if (state.pendingRequests > 0) {
        const drainStart = Date.now();
        while (state.pendingRequests > 0 && Date.now() - drainStart < 3000) {
          await this.delay(100);
        }
      }

      // Stop keeping tab active
      this.stopKeepingTabActive();

      // Restore original zoom level
      document.body.style.zoom = this.originalZoom || '100%';

      window.history.replaceState({}, '', window.location.pathname);
      window.scrollTo(0, 0);

      const campaignCount = state.campaigns.length;
      const detailsCount = Object.keys(state.details).length;
      const totalDrops = Object.values(state.details).reduce((sum, drops) => sum + (drops?.length || 0), 0);

      // Only push data to storage if we actually captured drop details.
      // Dispatching with 0 details would overwrite previously-good stored campaigns.
      if (detailsCount > 0) {
        dispatchCampaigns();
      }
      const skipMsg = skippedFiltered > 0 ? tNotif('notif_done_skip', {filtered: skippedFiltered}) : '';

      log.info(`Finalize: expanded=${totalExpanded}, skipped=${skippedFiltered}, campaigns=${campaignCount}, details=${detailsCount}, drops=${totalDrops}`);

      if (campaignCount === 0 && totalExpanded === 0) {
        notification.show(tNotif('notif_no_campaigns'), true);
      } else if (detailsCount === 0 || totalDrops === 0) {
        if (skippedFiltered > 0) {
          notification.show(tNotif('notif_all_skipped', {count: skippedFiltered}), false);
        } else {
          notification.show(tNotif('notif_no_details', {count: campaignCount, expanded: totalExpanded}), true);
        }
      } else {
        notification.show(tNotif('notif_done', {drops: totalDrops, campaigns: detailsCount, skip: skipMsg}));
        // Auto-close tab after 3 seconds
        setTimeout(() => {
          window.close();
        }, 3000);
      }

      log.info(`Expanded ${totalExpanded} campaigns, skipped ${skippedFiltered}, captured ${detailsCount} with details`);
    },

    /**
     * Keep tab active to prevent Chrome from throttling
     */
    keepTabActive() {
      // Play silent audio to prevent tab throttling
      try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        gainNode.gain.value = 0; // Silent
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        oscillator.start();
        this.audioContext = audioContext;
        this.oscillator = oscillator;
      } catch (e) {
        // Audio context not available, fall back to other methods
      }

      // Listen for visibility changes and warn user
      this.visibilityHandler = () => {
        if (document.hidden) {
          notification.show(tNotif('notif_tab_lost'), true, true);
        } else {
          notification.show(tNotif('notif_loading_details'), false, true);
        }
      };
      document.addEventListener('visibilitychange', this.visibilityHandler);

      // Periodic activity to prevent throttling
      this.keepAliveInterval = setInterval(() => {
        // Small DOM read to keep the tab "active"
        void document.body.offsetHeight;
      }, 1000);
    },

    /**
     * Stop keeping tab active
     */
    stopKeepingTabActive() {
      if (this.audioContext) {
        try {
          this.oscillator?.stop();
          this.audioContext.close();
        } catch (e) { /* ignore */ }
      }
      if (this.visibilityHandler) {
        document.removeEventListener('visibilitychange', this.visibilityHandler);
      }
      if (this.keepAliveInterval) {
        clearInterval(this.keepAliveInterval);
      }
    },

    delay: ms => new Promise(resolve => setTimeout(resolve, ms)),

    /**
     * Wait for API responses to settle after clicking expand.
     * Fast-exits if no GQL request is triggered (Twitch Apollo cache hit).
     * Waits up to API_RESPONSE_TIMEOUT if a request IS pending (slow network).
     */
    async waitForApiResponse(responseTimeBefore = 0) {
      const startTime = Date.now();

      // Give React enough time to process the click and trigger any fetch
      await this.delay(80);

      while (Date.now() - startTime < CONFIG.API_RESPONSE_TIMEOUT) {
        // A new response arrived and has settled — done
        if (state.pendingRequests === 0 && state.lastApiResponse > responseTimeBefore) {
          const timeSinceLastResponse = Date.now() - state.lastApiResponse;
          if (timeSinceLastResponse >= CONFIG.API_SETTLE_TIME) break;
        }

        // No pending request and no new response — cache hit, skip quickly
        if (Date.now() - startTime >= CONFIG.API_CACHE_HIT_WAIT &&
            state.pendingRequests === 0 &&
            state.lastApiResponse <= responseTimeBefore) {
          break;
        }

        await this.delay(30);
      }
    }
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
