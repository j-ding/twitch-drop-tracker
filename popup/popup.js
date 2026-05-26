/**
 * Twitch Drops Tracker - Popup Script
 * Handles UI rendering and user interactions
 */

// =============================================================================
// Configuration & Logger
// =============================================================================
const log = {
  info: (...args) => console.log('[TwitchDrops]', ...args),
  error: (...args) => console.error('[TwitchDrops]', ...args)
};

// =============================================================================
// Global State
// =============================================================================
let gameFilter = { enabled: false, games: {}, hideFiltered: false };
let allCampaigns = [];
let filterSearchQuery = '';

// =============================================================================
// Initialization
// =============================================================================
document.addEventListener('DOMContentLoaded', async () => {
  await i18n.init();
  initTabs();
  initButtons();
  initSettings();
  initFilter();
  loadStoredData();
});

function initTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`${tab.dataset.tab}-tab`).classList.add('active');
    });
  });
}

function initButtons() {
  document.getElementById('refresh-btn').addEventListener('click', refreshData);
  document.getElementById('clear-cache-btn').addEventListener('click', clearCache);
  document.getElementById('open-campaigns-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns' });
  });
  document.getElementById('open-inventory-btn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://www.twitch.tv/drops/inventory' });
  });
  document.getElementById('load-all-drops-btn').addEventListener('click', loadAllDrops);
  document.getElementById('copy-diag-btn').addEventListener('click', copyDiagLog);
}

function loadAllDrops() {
  chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns?loadAllDrops=true' });
  const hint = document.getElementById('scan-hint');
  if (hint) {
    hint.classList.remove('hidden');
    setTimeout(() => hint.classList.add('hidden'), 12000);
  }
}

async function copyDiagLog() {
  const btn = document.getElementById('copy-diag-btn');
  const feedback = document.getElementById('diag-copy-feedback');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'getDiagLog' });
    if (!response?.log) {
      feedback.textContent = 'No log yet — run a scan first.';
      feedback.className = 'diag-feedback diag-feedback-warn';
      setTimeout(() => { feedback.className = 'diag-feedback hidden'; }, 3000);
      return;
    }

    await navigator.clipboard.writeText(response.log);
    btn.textContent = 'Copied!';
    const date = response.date ? new Date(response.date).toLocaleString() : '';
    feedback.textContent = date ? `Last scan: ${date}` : 'Copied to clipboard';
    feedback.className = 'diag-feedback diag-feedback-ok';
    setTimeout(() => {
      btn.textContent = 'Copy Log';
      feedback.className = 'diag-feedback hidden';
    }, 3000);
  } catch (e) {
    feedback.textContent = 'Copy failed — try again.';
    feedback.className = 'diag-feedback diag-feedback-warn';
    setTimeout(() => { feedback.className = 'diag-feedback hidden'; }, 3000);
  }
}

// =============================================================================
// Settings
// =============================================================================
function initSettings() {
  const settingsBtn = document.getElementById('settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const settingsPanel = document.getElementById('settings-panel');

  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });

  initLanguageSelector();
}

function initLanguageSelector() {
  const select = document.getElementById('language-select');
  if (!select) return;
  LANGUAGES.forEach(lang => {
    const option = document.createElement('option');
    option.value = lang.code;
    option.textContent = lang.name;
    select.appendChild(option);
  });
  chrome.storage.local.get(['language'], ({ language = 'en' }) => {
    select.value = language;
  });
  select.addEventListener('change', () => i18n.setLanguage(select.value));
}

// =============================================================================
// Game Filter
// =============================================================================
async function initFilter() {
  const filterBtn = document.getElementById('filter-btn');
  const closeFilterBtn = document.getElementById('close-filter-btn');
  const filterSidebar = document.getElementById('filter-sidebar');
  const filterOverlay = document.getElementById('filter-overlay');
  const selectAllBtn = document.getElementById('select-all-btn');
  const deselectAllBtn = document.getElementById('deselect-all-btn');
  const fullviewBtn = document.getElementById('fullview-btn');

  // Load saved filter
  const data = await chrome.storage.local.get(['gameFilter']);
  if (data.gameFilter) {
    gameFilter = data.gameFilter;
  }

  // Initialize hideFiltered if not present
  if (gameFilter.hideFiltered === undefined) {
    gameFilter.hideFiltered = false;
  }

  // Set checkbox state
  const hideFilteredCheckbox = document.getElementById('hide-filtered-checkbox');
  hideFilteredCheckbox.checked = gameFilter.hideFiltered;

  // Update filter button indicator
  updateFilterButtonState();

  // Toggle filter sidebar
  filterBtn.addEventListener('click', () => {
    filterSidebar.classList.remove('hidden');
    filterOverlay.classList.remove('hidden');
    setTimeout(() => {
      filterSidebar.classList.add('visible');
      filterOverlay.classList.add('visible');
    }, 10);
  });

  const closeFilter = () => {
    filterSidebar.classList.remove('visible');
    filterOverlay.classList.remove('visible');
    setTimeout(() => {
      filterSidebar.classList.add('hidden');
      filterOverlay.classList.add('hidden');
    }, 250);
  };

  closeFilterBtn.addEventListener('click', closeFilter);
  filterOverlay.addEventListener('click', closeFilter);

  // Select/Deselect all
  selectAllBtn.addEventListener('click', () => {
    Object.keys(gameFilter.games).forEach(game => {
      gameFilter.games[game] = true;
    });
    gameFilter.enabled = false;
    saveAndApplyFilter();
    renderFilterList();
  });

  deselectAllBtn.addEventListener('click', () => {
    Object.keys(gameFilter.games).forEach(game => {
      gameFilter.games[game] = false;
    });
    gameFilter.enabled = true;
    saveAndApplyFilter();
    renderFilterList();
  });

  // Full view button
  fullviewBtn.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('fullpage/fullpage.html') });
  });

  // Filter search input
  const filterSearchInput = document.getElementById('filter-search-input');
  filterSearchInput.addEventListener('input', (e) => {
    filterSearchQuery = e.target.value.toLowerCase().trim();
    renderFilterList();
  });

  // Clear search when closing sidebar
  const originalCloseFilter = closeFilter;
  const closeFilterWithClear = () => {
    filterSearchInput.value = '';
    filterSearchQuery = '';
    originalCloseFilter();
  };
  closeFilterBtn.removeEventListener('click', closeFilter);
  filterOverlay.removeEventListener('click', closeFilter);
  closeFilterBtn.addEventListener('click', closeFilterWithClear);
  filterOverlay.addEventListener('click', closeFilterWithClear);

  // Hide filtered games checkbox
  hideFilteredCheckbox.addEventListener('change', (e) => {
    gameFilter.hideFiltered = e.target.checked;
    saveAndApplyFilter();
  });
}

function updateFilterButtonState() {
  const filterBtn = document.getElementById('filter-btn');
  const hasFilteredGames = Object.values(gameFilter.games).some(v => v === false);
  filterBtn.classList.toggle('filter-active', hasFilteredGames);
}

function populateFilterGames(campaigns) {
  // Extract unique games
  const games = new Map();
  campaigns.forEach(c => {
    if (c.game && !games.has(c.game)) {
      games.set(c.game, c.imageUrl || '');
    }
  });

  // Initialize new games (default to checked)
  games.forEach((imageUrl, gameName) => {
    if (!(gameName in gameFilter.games)) {
      gameFilter.games[gameName] = true;
    }
  });

  // Remove games that no longer exist
  Object.keys(gameFilter.games).forEach(gameName => {
    if (!games.has(gameName)) {
      delete gameFilter.games[gameName];
    }
  });

  // Check if any filter is active
  gameFilter.enabled = Object.values(gameFilter.games).some(v => v === false);

  renderFilterList();
  saveFilter();
}

function renderFilterList() {
  const container = document.getElementById('filter-games-list');
  let sortedGames = Object.entries(gameFilter.games)
    .sort((a, b) => a[0].localeCompare(b[0]));

  // Apply search filter
  if (filterSearchQuery) {
    sortedGames = sortedGames.filter(([gameName]) =>
      gameName.toLowerCase().includes(filterSearchQuery)
    );
  }

  if (sortedGames.length === 0 && filterSearchQuery) {
    container.innerHTML = `
      <div style="text-align: center; padding: 20px; color: var(--text-muted); font-size: 12px;">
        No games match "${escapeHtml(filterSearchQuery)}"
      </div>
    `;
    return;
  }

  container.innerHTML = sortedGames.map(([gameName, isChecked]) => {
    const campaign = allCampaigns.find(c => c.game === gameName);
    const imageUrl = campaign?.imageUrl || '';
    return `
      <div class="filter-game-item ${isChecked ? 'checked' : ''}" data-game="${escapeHtml(gameName)}">
        <div class="filter-game-checkbox">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
        </div>
        ${imageUrl ? `<img class="filter-game-image" src="${imageUrl}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="filter-game-name">${escapeHtml(gameName)}</span>
      </div>
    `;
  }).join('');

  // Add click handlers
  container.querySelectorAll('.filter-game-item').forEach(item => {
    item.addEventListener('click', () => {
      const gameName = item.dataset.game;
      gameFilter.games[gameName] = !gameFilter.games[gameName];
      item.classList.toggle('checked', gameFilter.games[gameName]);
      gameFilter.enabled = Object.values(gameFilter.games).some(v => v === false);
      saveAndApplyFilter();
    });
  });

  updateFilterButtonState();
}

async function saveFilter() {
  await chrome.storage.local.set({ gameFilter });
  updateFilterButtonState();
}

async function saveAndApplyFilter() {
  await saveFilter();
  renderCampaigns(allCampaigns);
}

function isGameFiltered(gameName) {
  if (!gameFilter.enabled) return false;
  return gameFilter.games[gameName] === false;
}

// =============================================================================
// Data Loading
// =============================================================================
async function loadStoredData() {
  try {
    const data = await chrome.storage.local.get(['campaigns', 'inventory', 'lastUpdated', 'gameFilter']);
    if (data.gameFilter) {
      gameFilter = data.gameFilter;
    }
    if (data.campaigns) {
      allCampaigns = data.campaigns;
      populateFilterGames(allCampaigns);
      renderCampaigns(allCampaigns);
    }
    if (data.inventory) renderMyProgress(data.inventory);
    if (data.lastUpdated) updateLastUpdated(data.lastUpdated);
  } catch (error) {
    log.error('Error loading stored data:', error.message);
  }
}

async function refreshData() {
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.classList.add('loading');

  try {
    const response = await chrome.runtime.sendMessage({ action: 'fetchData' });
    if (response.success) {
      allCampaigns = response.campaigns || [];
      populateFilterGames(allCampaigns);
      renderCampaigns(allCampaigns);
      renderMyProgress(response.inventory || {});
      updateLastUpdated(new Date().toISOString());
    } else {
      showError(response.error || t('error_not_logged_in'));
    }
  } catch (error) {
    log.error('Error fetching data:', error.message);
    showError(t('error_connection'));
  } finally {
    refreshBtn.classList.remove('loading');
  }
}

async function clearCache() {
  try {
    await chrome.storage.local.clear();
    const emptyState = `
      <div class="empty-state">
        <div class="empty-state-icon">🗑️</div>
        <p>${t('cache_cleared')}</p>
        <p style="font-size: 11px; margin-top: 4px;">${t('cache_cleared_hint')}</p>
      </div>
    `;
    document.getElementById('campaigns-list').innerHTML = emptyState;
    document.getElementById('progress-list').innerHTML = emptyState;
    document.getElementById('last-updated').textContent = t('cache_cleared');
  } catch (error) {
    log.error('Error clearing cache:', error.message);
  }
}

// =============================================================================
// Campaigns Tab Rendering
// =============================================================================
function renderCampaigns(campaigns) {
  const container = document.getElementById('campaigns-list');

  if (!campaigns?.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📭</div>
        <p>${t('empty_no_campaigns')}</p>
        <p style="font-size: 11px; margin-top: 4px;">${t('loading_campaigns')}</p>
      </div>
    `;
    return;
  }

  let sorted = [...campaigns].sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

  // Filter out hidden games if hideFiltered is enabled
  if (gameFilter.hideFiltered) {
    sorted = sorted.filter(c => !isGameFiltered(c.game));
  }

  // Use calendar day boundaries (end of each day at 23:59:59)
  const today = new Date();
  const todayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  const tomorrowEnd = new Date(todayEnd.getTime() + 24 * 60 * 60 * 1000);
  const threeDaysEnd = new Date(todayEnd.getTime() + 3 * 24 * 60 * 60 * 1000);
  const weekEnd = new Date(todayEnd.getTime() + 7 * 24 * 60 * 60 * 1000);

  const groups = {
    today: sorted.filter(c => new Date(c.endDate) <= todayEnd),
    tomorrow: sorted.filter(c => { const d = new Date(c.endDate); return d > todayEnd && d <= tomorrowEnd; }),
    soon: sorted.filter(c => { const d = new Date(c.endDate); return d > tomorrowEnd && d <= threeDaysEnd; }),
    week: sorted.filter(c => { const d = new Date(c.endDate); return d > threeDaysEnd && d <= weekEnd; }),
    later: sorted.filter(c => new Date(c.endDate) > weekEnd)
  };

  // Sort each group: non-filtered first, then filtered
  const sortWithFilter = (arr) => {
    return arr.sort((a, b) => {
      const aFiltered = isGameFiltered(a.game);
      const bFiltered = isGameFiltered(b.game);
      if (aFiltered !== bFiltered) return aFiltered ? 1 : -1;
      return new Date(a.endDate) - new Date(b.endDate);
    });
  };

  let html = '';
  if (groups.today.length) {
    html += `<div class="section-header danger">${t('section_expiring_today')}</div>`;
    html += sortWithFilter(groups.today).map(c => renderCampaignCard(c, 'today')).join('');
  }
  if (groups.tomorrow.length) {
    html += `<div class="section-header orange">${t('section_tomorrow')}</div>`;
    html += sortWithFilter(groups.tomorrow).map(c => renderCampaignCard(c, 'tomorrow')).join('');
  }
  if (groups.soon.length) {
    html += `<div class="section-header warning">${t('section_2_3_days')}</div>`;
    html += sortWithFilter(groups.soon).map(c => renderCampaignCard(c, 'soon')).join('');
  }
  if (groups.week.length) {
    html += `<div class="section-header soon">${t('section_this_week')}</div>`;
    html += sortWithFilter(groups.week).map(c => renderCampaignCard(c, 'week')).join('');
  }
  if (groups.later.length) {
    html += `<div class="section-header">${t('section_later')}</div>`;
    html += sortWithFilter(groups.later).map(c => renderCampaignCard(c, 'later')).join('');
  }

  container.innerHTML = html;
  attachCardListeners(container);
}

function renderCampaignCard(campaign, urgency) {
  const drops = campaign.drops || [];
  const claimedCount = drops.filter(d => d.status === 'claimed').length;
  const hasProgress = drops.some(d => ['claimed', 'in_progress', 'claimable'].includes(d.status));
  // Override isCompleted only if drops are actively in progress (not just locked)
  const hasActiveProgress = drops.some(d => d.status === 'in_progress' || d.status === 'claimable');
  const isCompleted = hasActiveProgress ? false : (campaign.isCompleted || (claimedCount === drops.length && drops.length > 0));
  const isFiltered = isGameFiltered(campaign.game);

  const urgencyClassMap = {
    today: 'expiring-today',
    tomorrow: 'expiring-tomorrow',
    soon: 'expiring-soon',
    week: 'expiring-week'
  };
  const urgencyClass = urgencyClassMap[urgency] || '';
  const expiryClass = urgency !== 'later' ? urgency : '';
  const filteredClass = isFiltered ? 'filtered-out' : '';

  const statusBadge = isCompleted
    ? `<span class="campaign-status claimed">${t('status_complete')}</span>`
    : hasProgress ? `<span class="campaign-status in-progress">${claimedCount}/${drops.length}</span>` : '';

  const updatesOffBadge = isFiltered ? `<span class="updates-off-badge">${t('updates_off')}</span>` : '';

  const dropsHtml = drops.length
    ? drops.map(renderDropItem).join('')
    : `<div style="text-align: center; padding: 12px 0; color: var(--text-muted); font-size: 11px;">${t('drops_not_loaded_1')}<br>${t('drops_not_loaded_2')}</div>`;

  const gameSlug = gameNameToSlug(campaign.game);

  return `
    <div class="campaign-card ${urgencyClass} ${isCompleted ? 'completed' : ''} ${filteredClass}" data-id="${campaign.id || ''}">
      <div class="campaign-header">
        <img class="campaign-image clickable" src="${campaign.imageUrl || ''}" alt="" onerror="this.style.display='none'" data-game-slug="${gameSlug}" title="Open ${escapeHtml(campaign.game)} drops on Twitch">
        <div class="campaign-info">
          <div class="campaign-name">${escapeHtml(campaign.game)} ${statusBadge}${updatesOffBadge}</div>
          <div class="campaign-publisher">${escapeHtml(campaign.publisher || '')}</div>
          <div class="campaign-expiry ${expiryClass}">${t('expiry_prefix')}${formatExpiry(new Date(campaign.endDate))}</div>
        </div>
        <svg class="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="campaign-drops">${dropsHtml}</div>
    </div>
  `;
}

function renderDropItem(drop) {
  const progress = drop.progressMinutes || 0;
  const required = drop.requiredMinutes || 60;
  // Force 100% for claimed/claimable drops to handle cases where progress data hasn't updated
  const percentage = (drop.status === 'claimed' || drop.status === 'claimable')
    ? 100
    : Math.min(100, Math.round((progress / required) * 100));

  const statusMap = {
    claimed: { class: 'claimed', text: t('status_claimed') },
    claimable: { class: 'claimable', text: t('status_ready') },
    in_progress: { class: 'in-progress', text: t('status_time', {progress, required}) }
  };

  const status = statusMap[drop.status] || { class: 'locked', text: t('status_locked', {required}) };
  const showProgress = drop.status === 'in_progress' || drop.status === 'claimable' || progress > 0;

  return `
    <div class="drop-item">
      <div class="drop-header">
        ${drop.imageUrl ? `<img class="drop-image" src="${drop.imageUrl}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="drop-name">${escapeHtml(drop.name || t('unknown_drop'))}</span>
        <span class="drop-status ${status.class}">${status.text}</span>
      </div>
      ${showProgress ? `
        <div class="progress-container">
          <div class="progress-bar">
            <div class="progress-fill ${percentage >= 100 ? 'complete' : ''}" style="width: ${percentage}%"></div>
          </div>
          <span class="progress-text">${percentage}%</span>
        </div>
      ` : ''}
    </div>
  `;
}

// =============================================================================
// My Progress Tab Rendering
// =============================================================================
async function renderMyProgress(inventory) {
  const container = document.getElementById('progress-list');
  const { inProgress = [], claimable = [], claimed = [] } = inventory;

  if (!inProgress.length && !claimable.length && !claimed.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🎯</div>
        <p>${t('empty_no_drops')}</p>
        <p style="font-size: 11px; margin-top: 4px;">${t('empty_no_drops_hint')}</p>
      </div>
    `;
    return;
  }

  // Get full campaign data from storage to show all drops
  const { campaigns = [] } = await chrome.storage.local.get(['campaigns']);

  // Find campaigns that have any progress (in_progress, claimable, or claimed drops)
  const activeCampaignIds = new Set([
    ...inProgress.map(d => d.campaignId),
    ...claimable.map(d => d.campaignId),
    ...claimed.map(d => d.campaignId)
  ].filter(Boolean));

  // Get full campaign data for campaigns with progress
  const activeCampaigns = campaigns
    .filter(c => activeCampaignIds.has(c.id) ||
      c.drops?.some(d => ['in_progress', 'claimable', 'claimed'].includes(d.status)))
    .sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

  let html = '';

  // Claimable drops section
  if (claimable.length) {
    html += `<div class="section-header" style="color: var(--accent-purple);">${t('section_ready_to_claim', {count: claimable.length})}</div>`;
    html += claimable.map(d => renderProgressCard(d, 'claimable')).join('');
  }

  // In-progress campaigns with full drop details
  const inProgressCampaigns = activeCampaigns.filter(c =>
    c.drops?.some(d => d.status === 'in_progress' || d.status === 'claimable'));

  if (inProgressCampaigns.length) {
    html += `<div class="section-header">${t('section_in_progress')}</div>`;
    html += inProgressCampaigns.map(renderProgressCampaignCard).join('');
  }

  // Claimed drops (collapsible)
  if (claimed.length) {
    html += `
      <div class="collapsible-header section-header" id="claimed-header">
        <span>${t('section_recently_claimed', {count: claimed.length})}</span>
        <svg class="expand-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div id="claimed-section" class="collapsible-content">
        ${claimed.map(d => renderProgressCard(d, 'claimed')).join('')}
      </div>
    `;
  }

  container.innerHTML = html;
  attachCardListeners(container);

  // Add event listener for claimed section toggle
  const claimedHeader = document.getElementById('claimed-header');
  if (claimedHeader) {
    claimedHeader.addEventListener('click', () => {
      document.getElementById('claimed-section')?.classList.toggle('expanded');
    });
  }

  // Add event listeners for claim buttons
  container.querySelectorAll('.claim-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      chrome.tabs.create({ url: 'https://www.twitch.tv/drops/inventory' });
    });
  });
}

function renderProgressCampaignCard(campaign) {
  const drops = campaign.drops || [];
  if (!drops.length) return '';

  const claimedCount = drops.filter(d => d.status === 'claimed').length;
  const inProgressCount = drops.filter(d => d.status === 'in_progress').length;
  const endDate = new Date(campaign.endDate);
  const now = Date.now();
  const urgencyClass = endDate <= new Date(now).setHours(23, 59, 59, 999) ? 'expiring-today' :
                       endDate <= new Date(now + 7 * 24 * 60 * 60 * 1000) ? 'expiring-soon' : '';

  // Check if we likely have incomplete data (only in-progress drops, no locked drops)
  const hasLockedDrops = drops.some(d => d.status === 'locked');
  const likelyIncomplete = drops.length <= inProgressCount + claimedCount && !hasLockedDrops && drops.length < 3;

  // Calculate overall progress across all drops (cap each drop at 100%)
  const totalProgress = drops.reduce((sum, d) => {
    const progress = d.progressMinutes || 0;
    const required = d.requiredMinutes || 60;
    return sum + Math.min(progress, required); // Cap at required
  }, 0);
  const totalRequired = drops.reduce((sum, d) => sum + (d.requiredMinutes || 60), 0);
  const overallPercent = Math.min(100, Math.round((totalProgress / totalRequired) * 100));

  // Render all drops with their respective statuses
  const dropsHtml = drops.map(drop => {
    const progress = drop.progressMinutes || 0;
    const required = drop.requiredMinutes || 60;
    // Force 100% for claimed/claimable drops
    const percentage = (drop.status === 'claimed' || drop.status === 'claimable')
      ? 100
      : Math.min(100, Math.round((progress / required) * 100));

    const statusMap = {
      claimed: { class: 'claimed', text: t('status_claimed') },
      claimable: { class: 'claimable', text: t('status_ready') },
      in_progress: { class: 'in-progress', text: t('status_time', {progress, required}) }
    };
    const status = statusMap[drop.status] || { class: 'locked', text: t('status_locked', {required}) };
    const showProgress = drop.status === 'in_progress' || drop.status === 'claimable' || (progress > 0 && drop.status !== 'claimed');

    return `
      <div class="drop-item">
        <div class="drop-header">
          ${drop.imageUrl ? `<img class="drop-image" src="${drop.imageUrl}" alt="" onerror="this.style.display='none'">` : ''}
          <span class="drop-name">${escapeHtml(drop.name || t('unknown_drop'))}</span>
          <span class="drop-status ${status.class}">${status.text}</span>
        </div>
        ${showProgress ? `
          <div class="progress-container">
            <div class="progress-bar"><div class="progress-fill ${percentage >= 100 ? 'complete' : ''}" style="width: ${percentage}%"></div></div>
            <span class="progress-text">${drop.status === 'in_progress' ? t('time_min_left', {minutes: Math.max(0, required - progress)}) : `${percentage}%`}</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Add a note if campaign data might be incomplete
  const incompleteNote = likelyIncomplete
    ? `<div style="text-align: center; padding: 8px; color: var(--text-muted); font-size: 10px; border-top: 1px solid var(--border);">${t('drops_incomplete')}</div>`
    : '';

  const gameSlug = gameNameToSlug(campaign.game);

  return `
    <div class="campaign-card ${urgencyClass}">
      <div class="campaign-header">
        <img class="campaign-image clickable" src="${campaign.imageUrl || ''}" alt="" onerror="this.style.display='none'" data-game-slug="${gameSlug}" title="Open ${escapeHtml(campaign.game)} drops on Twitch">
        <div class="campaign-info">
          <div class="campaign-name">${escapeHtml(campaign.game)} <span class="campaign-status in-progress">${claimedCount}/${drops.length}${likelyIncomplete ? '+' : ''}</span></div>
          <div class="campaign-expiry">${t('expiry_prefix')}${formatExpiry(endDate)}</div>
          <div class="progress-container" style="margin-top: 4px;">
            <div class="progress-bar"><div class="progress-fill ${overallPercent >= 100 ? 'complete' : ''}" style="width: ${Math.min(100, overallPercent)}%"></div></div>
            <span class="progress-text">${overallPercent}%</span>
          </div>
        </div>
        <svg class="expand-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </div>
      <div class="campaign-drops">${dropsHtml}${incompleteNote}</div>
    </div>
  `;
}

function renderProgressCard(drop, type) {
  return `
    <div class="progress-card">
      <div class="progress-card-header">
        <img class="progress-card-image" src="${drop.imageUrl || ''}" alt="" onerror="this.style.display='none'">
        <div class="progress-card-info">
          <div class="progress-card-game">${escapeHtml(drop.game || '')}</div>
          <div class="progress-card-drop">${escapeHtml(drop.name || t('unknown_drop'))}</div>
        </div>
      </div>
      ${type === 'claimable' ? `<button class="claim-btn">${t('btn_claim')}</button>` : ''}
    </div>
  `;
}

// =============================================================================
// Utilities
// =============================================================================
function attachCardListeners(container) {
  container.querySelectorAll('.campaign-header').forEach(header => {
    header.addEventListener('click', (e) => {
      // Don't toggle if clicking on the game image
      if (e.target.classList.contains('campaign-image')) return;
      header.closest('.campaign-card').classList.toggle('expanded');
    });
  });

  // Add click listeners for game images
  container.querySelectorAll('.campaign-image.clickable').forEach(img => {
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      const slug = img.dataset.gameSlug;
      if (slug) {
        chrome.tabs.create({ url: `https://www.twitch.tv/directory/category/${slug}?filter=drops` });
      }
    });
  });
}

/**
 * Convert game name to Twitch directory slug
 * e.g., "Vampire: The Masquerade - Bloodhunt" -> "vampire-the-masquerade-bloodhunt"
 */
function gameNameToSlug(gameName) {
  if (!gameName) return '';

  // Special case mappings for games with non-standard slugs
  const specialCases = {
    'overwatch 2': 'overwatch-2',
    'overwatch': 'overwatch-2',  // In case it's stored without the "2"
    'counter-strike 2': 'counter-strike-2',
    'counter-strike': 'counter-strike-2',
    'pubg: battlegrounds': 'pubg-battlegrounds',
    'playerunknowns battlegrounds': 'pubg-battlegrounds'
  };

  const normalized = gameName.toLowerCase().trim();
  if (specialCases[normalized]) {
    return specialCases[normalized];
  }

  return gameName
    .toLowerCase()
    .replace(/[:']/g, '')           // Remove colons and apostrophes
    .replace(/&/g, 'and')           // Replace & with 'and'
    .replace(/[^a-z0-9\s-]/g, '')   // Remove special characters except spaces and hyphens
    .replace(/\s+/g, '-')           // Replace spaces with hyphens
    .replace(/-+/g, '-')            // Replace multiple hyphens with single
    .replace(/^-|-$/g, '');         // Remove leading/trailing hyphens
}

window.toggleClaimed = () => document.getElementById('claimed-section')?.classList.toggle('expanded');
window.openInventory = () => chrome.tabs.create({ url: 'https://www.twitch.tv/drops/inventory' });

function updateLastUpdated(isoString) {
  const diffMins = Math.floor((Date.now() - new Date(isoString)) / 60000);
  const text = diffMins < 1 ? t('last_updated_now') :
               diffMins < 60 ? t('last_updated_ago', {minutes: diffMins}) :
               `Updated: ${new Date(isoString).toLocaleTimeString()}`;
  document.getElementById('last-updated').textContent = text;
}

function formatExpiry(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  const timeStr = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });

  if (dateOnly.getTime() === today.getTime()) return t('expiry_today', {time: timeStr});
  if (dateOnly.getTime() === tomorrow.getTime()) return t('expiry_tomorrow', {time: timeStr});
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showError(message) {
  document.getElementById('campaigns-list').innerHTML = `
    <div class="empty-state">
      <div class="empty-state-icon">⚠️</div>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}
