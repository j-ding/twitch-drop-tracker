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
// Initialization
// =============================================================================
document.addEventListener('DOMContentLoaded', () => {
  initTabs();
  initButtons();
  initSettings();
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
}

function loadAllDrops() {
  // Tab-based scraping - Twitch blocks direct API calls with integrity checks
  chrome.tabs.create({ url: 'https://www.twitch.tv/drops/campaigns?loadAllDrops=true' });
}

// =============================================================================
// Settings
// =============================================================================
function initSettings() {
  const settingsBtn = document.getElementById('settings-btn');
  const closeSettingsBtn = document.getElementById('close-settings-btn');
  const settingsPanel = document.getElementById('settings-panel');

  // Settings panel toggle
  settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.toggle('hidden');
  });

  closeSettingsBtn.addEventListener('click', () => {
    settingsPanel.classList.add('hidden');
  });
}

// =============================================================================
// Data Loading
// =============================================================================
async function loadStoredData() {
  try {
    const data = await chrome.storage.local.get(['campaigns', 'inventory', 'lastUpdated']);
    if (data.campaigns) renderCampaigns(data.campaigns);
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
      renderCampaigns(response.campaigns || []);
      renderMyProgress(response.inventory || {});
      updateLastUpdated(new Date().toISOString());
    } else {
      showError(response.error || 'Failed to fetch data. Make sure you\'re logged into Twitch.');
    }
  } catch (error) {
    log.error('Error fetching data:', error.message);
    showError('Error connecting to extension. Try reloading.');
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
        <p>Cache cleared</p>
        <p style="font-size: 11px; margin-top: 4px;">Click refresh to load fresh data</p>
      </div>
    `;
    document.getElementById('campaigns-list').innerHTML = emptyState;
    document.getElementById('progress-list').innerHTML = emptyState;
    document.getElementById('last-updated').textContent = 'Cache cleared';
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
        <p>No active campaigns found</p>
        <p style="font-size: 11px; margin-top: 4px;">Click refresh to load campaigns</p>
      </div>
    `;
    return;
  }

  const sorted = [...campaigns].sort((a, b) => new Date(a.endDate) - new Date(b.endDate));

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

  let html = '';
  if (groups.today.length) {
    html += '<div class="section-header danger">⚠️ Expiring Today</div>';
    html += groups.today.map(c => renderCampaignCard(c, 'today')).join('');
  }
  if (groups.tomorrow.length) {
    html += '<div class="section-header orange">🔶 Tomorrow</div>';
    html += groups.tomorrow.map(c => renderCampaignCard(c, 'tomorrow')).join('');
  }
  if (groups.soon.length) {
    html += '<div class="section-header warning">📅 2-3 Days</div>';
    html += groups.soon.map(c => renderCampaignCard(c, 'soon')).join('');
  }
  if (groups.week.length) {
    html += '<div class="section-header soon">📆 This Week</div>';
    html += groups.week.map(c => renderCampaignCard(c, 'week')).join('');
  }
  if (groups.later.length) {
    html += '<div class="section-header">📆 Later</div>';
    html += groups.later.map(c => renderCampaignCard(c, 'later')).join('');
  }

  container.innerHTML = html;
  attachCardListeners(container);
}

function renderCampaignCard(campaign, urgency) {
  const drops = campaign.drops || [];
  const claimedCount = drops.filter(d => d.status === 'claimed').length;
  const hasProgress = drops.some(d => ['claimed', 'in_progress', 'claimable'].includes(d.status));
  const isCompleted = campaign.isCompleted || (claimedCount === drops.length && drops.length > 0);

  const urgencyClassMap = {
    today: 'expiring-today',
    tomorrow: 'expiring-tomorrow',
    soon: 'expiring-soon',
    week: 'expiring-week'
  };
  const urgencyClass = urgencyClassMap[urgency] || '';
  const expiryClass = urgency !== 'later' ? urgency : '';

  const statusBadge = isCompleted
    ? '<span class="campaign-status claimed">✓ Complete</span>'
    : hasProgress ? `<span class="campaign-status in-progress">${claimedCount}/${drops.length}</span>` : '';

  const dropsHtml = drops.length
    ? drops.map(renderDropItem).join('')
    : '<div style="text-align: center; padding: 12px 0; color: var(--text-muted); font-size: 11px;">Drop details not loaded yet.<br>Use "Load All Drop Details" below.</div>';

  const gameSlug = gameNameToSlug(campaign.game);

  return `
    <div class="campaign-card ${urgencyClass} ${isCompleted ? 'completed' : ''}" data-id="${campaign.id || ''}">
      <div class="campaign-header">
        <img class="campaign-image clickable" src="${campaign.imageUrl || ''}" alt="" onerror="this.style.display='none'" data-game-slug="${gameSlug}" title="Open ${escapeHtml(campaign.game)} drops on Twitch">
        <div class="campaign-info">
          <div class="campaign-name">${escapeHtml(campaign.game)} ${statusBadge}</div>
          <div class="campaign-publisher">${escapeHtml(campaign.publisher || '')}</div>
          <div class="campaign-expiry ${expiryClass}">Ends: ${formatExpiry(new Date(campaign.endDate))}</div>
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
  const percentage = Math.min(100, Math.round((progress / required) * 100));

  const statusMap = {
    claimed: { class: 'claimed', text: '✓ Claimed' },
    claimable: { class: 'claimable', text: 'Ready!' },
    in_progress: { class: 'in-progress', text: `${progress}/${required} min` }
  };

  const status = statusMap[drop.status] || { class: 'locked', text: `${required} min` };
  const showProgress = drop.status === 'in_progress' || progress > 0;

  return `
    <div class="drop-item">
      <div class="drop-header">
        ${drop.imageUrl ? `<img class="drop-image" src="${drop.imageUrl}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="drop-name">${escapeHtml(drop.name || 'Unknown Drop')}</span>
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
        <p>No drops in progress</p>
        <p style="font-size: 11px; margin-top: 4px;">Watch streams with drops enabled to start earning!</p>
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
    html += `<div class="section-header" style="color: var(--accent-purple);">🎁 Ready to Claim (${claimable.length})</div>`;
    html += claimable.map(d => renderProgressCard(d, 'claimable')).join('');
  }

  // In-progress campaigns with full drop details
  const inProgressCampaigns = activeCampaigns.filter(c =>
    c.drops?.some(d => d.status === 'in_progress' || d.status === 'claimable'));

  if (inProgressCampaigns.length) {
    html += '<div class="section-header">🎯 In Progress</div>';
    html += inProgressCampaigns.map(renderProgressCampaignCard).join('');
  }

  // Claimed drops (collapsible)
  if (claimed.length) {
    html += `
      <div class="collapsible-header section-header" onclick="toggleClaimed()">
        <span>✅ Recently Claimed (${claimed.length})</span>
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
    const percentage = Math.min(100, Math.round((progress / required) * 100));

    const statusMap = {
      claimed: { class: 'claimed', text: '✓ Claimed' },
      claimable: { class: 'claimable', text: 'Ready!' },
      in_progress: { class: 'in-progress', text: `${progress}/${required} min` }
    };
    const status = statusMap[drop.status] || { class: 'locked', text: `${required} min` };
    const showProgress = drop.status === 'in_progress' || (progress > 0 && drop.status !== 'claimed');

    return `
      <div class="drop-item">
        <div class="drop-header">
          ${drop.imageUrl ? `<img class="drop-image" src="${drop.imageUrl}" alt="" onerror="this.style.display='none'">` : ''}
          <span class="drop-name">${escapeHtml(drop.name || 'Unknown Drop')}</span>
          <span class="drop-status ${status.class}">${status.text}</span>
        </div>
        ${showProgress ? `
          <div class="progress-container">
            <div class="progress-bar"><div class="progress-fill ${percentage >= 100 ? 'complete' : ''}" style="width: ${percentage}%"></div></div>
            <span class="progress-text">${drop.status === 'in_progress' ? `${Math.max(0, required - progress)} min left` : `${percentage}%`}</span>
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  // Add a note if campaign data might be incomplete
  const incompleteNote = likelyIncomplete
    ? '<div style="text-align: center; padding: 8px; color: var(--text-muted); font-size: 10px; border-top: 1px solid var(--border);">Other drops may exist. Use "Load All Drop Details" for full info.</div>'
    : '';

  const gameSlug = gameNameToSlug(campaign.game);

  return `
    <div class="campaign-card ${urgencyClass}">
      <div class="campaign-header">
        <img class="campaign-image clickable" src="${campaign.imageUrl || ''}" alt="" onerror="this.style.display='none'" data-game-slug="${gameSlug}" title="Open ${escapeHtml(campaign.game)} drops on Twitch">
        <div class="campaign-info">
          <div class="campaign-name">${escapeHtml(campaign.game)} <span class="campaign-status in-progress">${claimedCount}/${drops.length}${likelyIncomplete ? '+' : ''}</span></div>
          <div class="campaign-expiry">Ends: ${formatExpiry(endDate)}</div>
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
          <div class="progress-card-drop">${escapeHtml(drop.name || 'Unknown Drop')}</div>
        </div>
      </div>
      ${type === 'claimable' ? '<button class="claim-btn" onclick="openInventory()">Claim on Twitch →</button>' : ''}
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
  const text = diffMins < 1 ? 'Updated: Just now' :
               diffMins < 60 ? `Updated: ${diffMins} min ago` :
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

  if (dateOnly.getTime() === today.getTime()) return `Today ${timeStr}`;
  if (dateOnly.getTime() === tomorrow.getTime()) return `Tomorrow ${timeStr}`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
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
