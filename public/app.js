// =====================================================================================
// HRTS PORTAL — FRONTEND APPLICATION LOGIC WITH RBAC & AUTHENTICATION (ENGLISH)
// =====================================================================================

const TOKEN_KEY = 'hpr_token';
const USER_KEY = 'hpr_user';

let currentUser = null;
let currentUploadedFile = null;
let currentPreviewData = null;
let activePreviewSheet = null;

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  setupDropzone();
  initDateFilters();
});

// =====================================================================================
// 1. AUTHENTICATION & SESSION MANAGEMENT
// =====================================================================================

/**
 * Check if a JWT token has expired based on its payload 'exp' claim
 */
function isTokenExpired(token) {
  if (!token) return true;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return true;
    const payload = JSON.parse(atob(parts[1]));
    if (!payload.exp) return false;
    // Buffer by 5 seconds
    return Date.now() >= (payload.exp * 1000) - 5000;
  } catch (e) {
    return true;
  }
}

let sessionCheckInterval = null;

/**
 * Monitor session token expiration periodically in the background (every 30s)
 */
function startSessionMonitor() {
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
  }
  sessionCheckInterval = setInterval(() => {
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token || isTokenExpired(token)) {
      if (sessionCheckInterval) {
        clearInterval(sessionCheckInterval);
        sessionCheckInterval = null;
      }
      logout('Your session has expired (60-minute limit). Please sign in again.');
    }
  }, 30000);
}

function initAuth() {
  const token = localStorage.getItem(TOKEN_KEY);
  const savedUser = localStorage.getItem(USER_KEY);

  if (!token || !savedUser) {
    showLoginModal();
    return;
  }

  // Check if session token expired
  if (isTokenExpired(token)) {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    currentUser = null;
    showLoginModal('Your session has expired (60-minute limit). Please sign in again.');
    return;
  }

  try {
    currentUser = JSON.parse(savedUser);
    hideLoginModal();
    applyUserSession(currentUser);
    startSessionMonitor();
  } catch (err) {
    logout();
  }
}

function showLoginModal(errorMessage = null) {
  const modal = document.getElementById('login-modal');
  modal.classList.remove('hidden');
  document.getElementById('user-badge-container').style.display = 'none';

  // Reset password input type and toggle icon
  const passwordInput = document.getElementById('login-password');
  if (passwordInput) {
    passwordInput.type = 'password';
    const toggleIcon = document.querySelector('#login-modal .btn-toggle-password i');
    const toggleBtn = document.querySelector('#login-modal .btn-toggle-password');
    if (toggleIcon) toggleIcon.className = 'fa-solid fa-eye';
    if (toggleBtn) {
      toggleBtn.setAttribute('title', 'Show password');
      toggleBtn.setAttribute('aria-label', 'Show password');
    }
  }

  const alertBox = document.getElementById('login-alert');
  if (errorMessage) {
    alertBox.className = 'alert-box alert-error';
    alertBox.innerText = errorMessage;
    alertBox.classList.remove('hidden');
  } else {
    alertBox.classList.add('hidden');
  }
}

function hideLoginModal() {
  document.getElementById('login-modal').classList.add('hidden');
  document.getElementById('login-alert').classList.add('hidden');
}

async function handleLogin(e) {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const alertBox = document.getElementById('login-alert');
  const submitBtn = document.getElementById('btn-submit-login');

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) return;

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Authenticating...';
  alertBox.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Invalid username or password.');
    }

    // Save token & user profile
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    currentUser = data.user;

    hideLoginModal();
    applyUserSession(currentUser);
    startSessionMonitor();

    passwordInput.value = '';
  } catch (err) {
    alertBox.className = 'alert-box alert-error';
    alertBox.innerText = err.message;
    alertBox.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-arrow-right-to-bracket"></i> Sign In to System';
  }
}

function logout(message = 'You have successfully signed out.') {
  if (sessionCheckInterval) {
    clearInterval(sessionCheckInterval);
    sessionCheckInterval = null;
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  sessionStorage.removeItem('hpr_active_tab');
  currentUser = null;
  resetUpload();
  showLoginModal(message);
}

/**
 * Toggle visibility of password input fields
 * @param {string} inputId - ID of target password input
 * @param {HTMLElement} buttonEl - The toggle button clicked
 */
function togglePasswordVisibility(inputId, buttonEl) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';

  const icon = buttonEl ? buttonEl.querySelector('i') : null;
  if (icon) {
    if (isPassword) {
      icon.className = 'fa-solid fa-eye-slash';
      buttonEl.setAttribute('aria-label', 'Hide password');
      buttonEl.setAttribute('title', 'Hide password');
    } else {
      icon.className = 'fa-solid fa-eye';
      buttonEl.setAttribute('aria-label', 'Show password');
      buttonEl.setAttribute('title', 'Show password');
    }
  }
}

/**
 * Apply UI permissions based on user role (Role-Based Access Control)
 */
function applyUserSession(user) {
  hideLoginModal();

  const badgeContainer = document.getElementById('user-badge-container');
  const displayName = document.getElementById('user-display-name');
  const displayRole = document.getElementById('user-display-role');

  const tabUploadBtn = document.getElementById('tab-upload-btn');
  const tabDashboardBtn = document.getElementById('tab-dashboard-btn');
  const tabHistoryBtn = document.getElementById('tab-history-btn');
  const tabUsersBtn = document.getElementById('tab-users-btn');

  badgeContainer.style.display = 'flex';
  displayName.innerText = user.full_name || user.username;

  if (user.role === 'administrator') {
    displayRole.innerText = 'Administrator';
    displayRole.className = 'role-pill role-admin';

    // Administrator has full access to all tabs
    tabDashboardBtn.style.display = 'inline-flex';
    tabHistoryBtn.style.display = 'inline-flex';
    tabUsersBtn.style.display = 'inline-flex';
    tabUploadBtn.style.display = 'inline-flex';
  } else {
    // Standard user can only upload data & view upload history
    displayRole.innerText = 'Standard User';
    displayRole.className = 'role-pill role-user';

    tabDashboardBtn.style.display = 'none';
    tabUsersBtn.style.display = 'none';
    tabUploadBtn.style.display = 'inline-flex';
    tabHistoryBtn.style.display = 'inline-flex';
  }

  // Restore previously active tab on page refresh
  const savedTab = sessionStorage.getItem('hpr_active_tab') || 'upload';
  if (user.role === 'user' && (savedTab === 'dashboard' || savedTab === 'users')) {
    switchTab('upload');
  } else {
    switchTab(savedTab);
  }

  loadLiveStats();
}

/**
 * Fetch wrapper automatically attaching JWT Authorization header
 */
async function authFetch(url, options = {}) {
  const token = localStorage.getItem(TOKEN_KEY);

  const headers = {
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });

  if (response.status === 401) {
    if (sessionCheckInterval) {
      clearInterval(sessionCheckInterval);
      sessionCheckInterval = null;
    }
    // Token invalid or expired
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem('hpr_active_tab');
    currentUser = null;
    showLoginModal('Your session has expired (60-minute limit). Please sign in again.');
    throw new Error('Session expired. Please sign in again.');
  }

  return response;
}

// =====================================================================================
// 2. NAVIGATION TABS
// =====================================================================================

function switchTab(tabId) {
  if (currentUser && currentUser.role === 'user') {
    if (tabId === 'dashboard' || tabId === 'users') {
      alert('Access Restricted: Your account role is only authorized to upload data.');
      return;
    }
  }

  sessionStorage.setItem('hpr_active_tab', tabId);

  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));

  const btn = document.getElementById(`tab-${tabId}-btn`);
  const content = document.getElementById(`tab-${tabId}`);
  if (btn) btn.classList.add('active');
  if (content) content.classList.add('active');

  if (tabId === 'dashboard') {
    loadDashboardSummary();
  } else if (tabId === 'history') {
    loadUploadHistory();
  } else if (tabId === 'users') {
    loadUsers();
  }
}

// =====================================================================================
// 3. LIVE KPI STATS
// =====================================================================================

async function loadLiveStats() {
  try {
    const res = await authFetch('/api/stats');
    if (!res.ok) return;
    const data = await res.json();

    const salesEl = document.getElementById('top-sales-count');
    const refundEl = document.getElementById('top-refund-count');
    const occEl = document.getElementById('top-occupancy-count');

    if (salesEl) salesEl.innerText = (data.total_sales || 0).toLocaleString('en-US');
    if (refundEl) refundEl.innerText = (data.total_refund || 0).toLocaleString('en-US');
    if (occEl) occEl.innerText = (data.total_occupancy || 0).toLocaleString('en-US');
  } catch (err) {
    console.warn('Failed to load live stats:', err);
  }
}

// =====================================================================================
// 4. DROPZONE & FILE UPLOAD HANDLING
// =====================================================================================

function setupDropzone() {
  const dropzone = document.getElementById('dropzone');

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      processSelectedFile(files[0]);
    }
  });
}

function triggerFileInput() {
  document.getElementById('file-input').click();
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) {
    processSelectedFile(files[0]);
  }
}

async function processSelectedFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    alert('Unsupported file format! Please upload an Excel file (.xlsx or .xls)');
    return;
  }

  currentUploadedFile = file;

  // Update UI
  document.getElementById('dropzone').classList.add('hidden');
  document.getElementById('file-control-panel').classList.remove('hidden');
  document.getElementById('selected-file-name').innerText = file.name;
  document.getElementById('selected-file-specs').innerText = `${(file.size / (1024 * 1024)).toFixed(2)} MB • Reading worksheets...`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await authFetch('/api/upload/preview', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to process file preview');
    }

    currentPreviewData = await res.json();
    renderSheetOptions(currentPreviewData);
  } catch (err) {
    alert('An error occurred: ' + err.message);
    resetUpload();
  }
}

function resetUpload() {
  currentUploadedFile = null;
  currentPreviewData = null;
  activePreviewSheet = null;

  const fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.value = '';

  document.getElementById('dropzone')?.classList.remove('hidden');
  document.getElementById('file-control-panel')?.classList.add('hidden');
  document.getElementById('sheet-options-panel')?.classList.add('hidden');
  document.getElementById('preview-table-container')?.classList.add('hidden');
  document.getElementById('progress-overlay')?.classList.add('hidden');
  document.getElementById('success-result-card')?.classList.add('hidden');
}

// =====================================================================================
// 5. RENDER SHEET OPTIONS & PREVIEW TABLE
// =====================================================================================

function renderSheetOptions(data) {
  const container = document.getElementById('sheets-grid');
  container.innerHTML = '';

  document.getElementById('selected-file-specs').innerText = 
    `${(data.fileSize / (1024 * 1024)).toFixed(2)} MB • ${data.sheets.length} Worksheets Detected`;

  data.sheets.forEach((sheet, idx) => {
    const isSales = sheet.detectedType === 'sales';
    const isRefund = sheet.detectedType === 'refund';
    const isOccupancy = sheet.detectedType === 'occupancy';
    const cardClass = isSales ? 'detected-sales' : (isRefund ? 'detected-refund' : (isOccupancy ? 'detected-occupancy' : ''));
    const badgeClass = isSales ? 'badge-sales' : (isRefund ? 'badge-refund' : (isOccupancy ? 'badge-occupancy' : ''));
    const typeLabel = isSales ? 'Ticket Sales' : (isRefund ? 'Ticket Refund' : (isOccupancy ? 'Occupancy Report' : 'Custom'));

    const card = document.createElement('div');
    card.className = `sheet-card ${cardClass}`;
    card.innerHTML = `
      <div class="sheet-info-group">
        <div>
          <div class="sheet-name">${escapeHtml(sheet.sheetName)}</div>
          <div class="sheet-meta">${sheet.totalRows.toLocaleString('en-US')} records • ${sheet.headers.length} columns</div>
        </div>
        <span class="sheet-badge ${badgeClass}">${typeLabel}</span>
      </div>
      <div class="sheet-actions">
        <button class="btn btn-sm btn-outline" onclick="previewSheet(${idx})">
          <i class="fa-solid fa-eye"></i> Preview Data
        </button>
      </div>
    `;
    container.appendChild(card);
  });

  document.getElementById('sheet-options-panel').classList.remove('hidden');

  if (data.sheets.length > 0) {
    previewSheet(0);
  }
}

function previewSheet(sheetIdx) {
  if (!currentPreviewData || !currentPreviewData.sheets[sheetIdx]) return;
  const sheet = currentPreviewData.sheets[sheetIdx];
  activePreviewSheet = sheet;

  document.getElementById('preview-table-container').classList.remove('hidden');
  document.getElementById('preview-sheet-name').innerText = `Data Preview: ${sheet.sheetName} (${sheet.detectedType.toUpperCase()})`;
  document.getElementById('preview-rows-badge').innerText = `Showing ${sheet.previewRows.length} of ${sheet.totalRows.toLocaleString('en-US')} records`;

  const thead = document.getElementById('preview-thead');
  const tbody = document.getElementById('preview-tbody');

  thead.innerHTML = `<tr>${sheet.headers.slice(0, 12).map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;

  if (sheet.previewRows && sheet.previewRows.length > 0) {
    tbody.innerHTML = sheet.previewRows
      .map((row) => {
        return `<tr>${sheet.headers.slice(0, 12).map((h) => `<td>${escapeHtml(String(row[h] ?? ''))}</td>`).join('')}</tr>`;
      })
      .join('');
  } else {
    tbody.innerHTML = `<tr><td colspan="${sheet.headers.length}" class="empty-state">No data records found</td></tr>`;
  }
}

function togglePreviewTable() {
  const container = document.getElementById('preview-table-container');
  if (container.classList.contains('hidden')) {
    container.classList.remove('hidden');
    if (!activePreviewSheet && currentPreviewData && currentPreviewData.sheets.length > 0) {
      previewSheet(0);
    }
  } else {
    container.classList.add('hidden');
  }
}

// =====================================================================================
// 6. BATCH INGESTION EXECUTION
// =====================================================================================

async function startBatchIngestion() {
  if (!currentPreviewData) return;

  const progressOverlay = document.getElementById('progress-overlay');
  const progressBarFill = document.getElementById('progress-bar-fill');
  const statusTitle = document.getElementById('progress-status-title');
  const statusDesc = document.getElementById('progress-status-desc');

  progressOverlay.classList.remove('hidden');
  document.getElementById('sheet-options-panel').classList.add('hidden');
  document.getElementById('preview-table-container').classList.add('hidden');

  setStep(1);
  progressBarFill.style.width = '25%';
  statusTitle.innerText = 'Reading Excel File...';
  statusDesc.innerText = 'Mapping header structure and normalizing data types...';

  setTimeout(() => {
    setStep(2);
    progressBarFill.style.width = '50%';
    statusTitle.innerText = 'Validating & Normalizing Values...';
    statusDesc.innerText = 'Parsing serial dates, timestamps, and ticket fares...';
  }, 600);

  setTimeout(async () => {
    setStep(3);
    progressBarFill.style.width = '75%';
    statusTitle.innerText = 'Ingesting into Database Partitions...';
    statusDesc.innerText = 'Executing batch upsert with ON CONFLICT DO UPDATE clause...';

    try {
      const res = await authFetch('/api/upload/process', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tempFilePath: currentPreviewData.tempFilePath,
          originalName: currentPreviewData.fileName,
          fileSize: currentPreviewData.fileSize,
          selectedSheets: currentPreviewData.sheets.map((s) => s.sheetName),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to ingest data into database');
      }

      setStep(4);
      progressBarFill.style.width = '100%';
      statusTitle.innerText = 'Synchronizing Data Mart Summary...';
      statusDesc.innerText = 'Refreshing daily_sales_summary & daily_occupancy_summary tables...';

      setTimeout(() => {
        progressOverlay.classList.add('hidden');
        renderSuccessCard(data.results);
        loadLiveStats();
      }, 700);

    } catch (err) {
      progressOverlay.classList.add('hidden');
      alert('Error during batch ingestion: ' + err.message);
      resetUpload();
    }
  }, 1200);
}

function setStep(stepNum) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`step-${i}`);
    if (el) {
      if (i < stepNum) el.className = 'step-badge done';
      else if (i === stepNum) el.className = 'step-badge active';
      else el.className = 'step-badge';
    }
  }
}

function renderSuccessCard(results) {
  const card = document.getElementById('success-result-card');
  const grid = document.getElementById('result-metrics-grid');

  document.getElementById('result-message-text').innerText = 
    `File "${results.fileName}" has been processed successfully. Records are safely stored in PostgreSQL partitions and summaries are consolidated.`;

  const totalOccupancy = results.totalOccupancyInserted || 0;
  const durationSec = (results.durationMs / 1000).toFixed(2);

  grid.innerHTML = `
    <div class="metric-box">
      <div class="metric-box-label">Sales Records</div>
      <div class="metric-box-val" style="color: #FF4D5E;">${(results.totalSalesInserted || 0).toLocaleString('en-US')}</div>
    </div>
    <div class="metric-box">
      <div class="metric-box-label">Refund Records</div>
      <div class="metric-box-val" style="color: #06B6D4;">${(results.totalRefundInserted || 0).toLocaleString('en-US')}</div>
    </div>
    <div class="metric-box">
      <div class="metric-box-label">Occupancy Records</div>
      <div class="metric-box-val" style="color: #C084FC;">${totalOccupancy.toLocaleString('en-US')}</div>
    </div>
    <div class="metric-box">
      <div class="metric-box-label">Execution Time</div>
      <div class="metric-box-val">${durationSec} sec</div>
    </div>
  `;

  card.classList.remove('hidden');
}

// =====================================================================================
// 7. LIVE DATA MART DASHBOARD (ADMINISTRATOR ONLY)
// =====================================================================================

function initDateFilters() {
  const today = new Date();
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(today.getDate() - 30);

  const startInput = document.getElementById('dash-start-date');
  const endInput = document.getElementById('dash-end-date');

  if (startInput && endInput) {
    startInput.value = thirtyDaysAgo.toISOString().split('T')[0];
    endInput.value = today.toISOString().split('T')[0];
  }
}

async function loadDashboardSummary() {
  const startDate = document.getElementById('dash-start-date').value;
  const endDate = document.getElementById('dash-end-date').value;

  try {
    const url = `/api/summary?startDate=${startDate}&endDate=${endDate}`;
    const res = await authFetch(url);
    if (!res.ok) return;
    const data = await res.json();

    let totalTickets = 0;
    let totalNetRevenue = 0;
    let totalGrossRevenue = 0;

    data.dailyTrends.forEach((d) => {
      totalTickets += parseInt(d.tickets || 0);
      totalNetRevenue += parseFloat(d.net_revenue || 0);
      totalGrossRevenue += parseFloat(d.gross_revenue || 0);
    });

    document.getElementById('kpi-tickets').innerText = totalTickets.toLocaleString('en-US');
    document.getElementById('kpi-net-revenue').innerText = formatIDR(totalNetRevenue);
    document.getElementById('kpi-gross-revenue').innerText = formatIDR(totalGrossRevenue);
    document.getElementById('kpi-refund-amount').innerText = formatIDR(totalGrossRevenue - totalNetRevenue);

    if (data.occupancySummary && data.occupancySummary.length > 0) {
      let totalCap = 0;
      let totalPsg = 0;
      data.occupancySummary.forEach((o) => {
        totalCap += parseInt(o.total_capacity || 0);
        totalPsg += parseInt(o.total_passengers || 0);
      });
      const avgPct = totalCap > 0 ? ((totalPsg / totalCap) * 100).toFixed(1) : '0';
      if (document.getElementById('kpi-avg-occupancy')) {
        document.getElementById('kpi-avg-occupancy').innerText = `${avgPct}%`;
      }
      if (document.getElementById('kpi-occupancy-sub')) {
        document.getElementById('kpi-occupancy-sub').innerText = `${totalPsg.toLocaleString('en-US')} Passengers / ${totalCap.toLocaleString('en-US')} Seats`;
      }
    } else {
      if (document.getElementById('kpi-avg-occupancy')) {
        document.getElementById('kpi-avg-occupancy').innerText = '-';
      }
      if (document.getElementById('kpi-occupancy-sub')) {
        document.getElementById('kpi-occupancy-sub').innerText = 'No data available';
      }
    }

    const stationTbody = document.getElementById('station-tbody');
    if (data.stationBreakdown && data.stationBreakdown.length > 0) {
      stationTbody.innerHTML = data.stationBreakdown
        .map(
          (s) => `
        <tr>
          <td><strong style="color:#fff;">${escapeHtml(s.station)}</strong></td>
          <td style="font-family: var(--font-mono);">${parseInt(s.tickets).toLocaleString('en-US')}</td>
          <td style="font-family: var(--font-mono); color: #10B981;">${formatIDR(s.revenue)}</td>
        </tr>
      `
        )
        .join('');
    } else {
      stationTbody.innerHTML = '<tr><td colspan="3" class="empty-state">No data available for this period</td></tr>';
    }

    const paymentTbody = document.getElementById('payment-tbody');
    if (data.paymentBreakdown && data.paymentBreakdown.length > 0) {
      paymentTbody.innerHTML = data.paymentBreakdown
        .map(
          (p) => `
        <tr>
          <td><strong style="color:#fff;">${escapeHtml(p.channel)}</strong></td>
          <td style="font-family: var(--font-mono);">${parseInt(p.tickets).toLocaleString('en-US')}</td>
          <td style="font-family: var(--font-mono); color: #06B6D4;">${formatIDR(p.revenue)}</td>
        </tr>
      `
        )
        .join('');
    } else {
      paymentTbody.innerHTML = '<tr><td colspan="3" class="empty-state">No data available for this period</td></tr>';
    }
  } catch (err) {
    console.error('Error loadDashboardSummary:', err);
  }
}

// =====================================================================================
// 8. UPLOAD AUDIT HISTORY
// =====================================================================================

let historyCurrentPage = 1;
let historyPageSize = 10;
let historyTotalPages = 1;
let historyTotalRecords = 0;

async function loadUploadHistory(page = historyCurrentPage, limit = historyPageSize) {
  historyCurrentPage = page;
  historyPageSize = limit;

  const tbody = document.getElementById('history-tbody');
  const infoEl = document.getElementById('history-pagination-info');
  const navEl = document.getElementById('history-pagination-controls');
  const pageSizeSelect = document.getElementById('history-page-size');

  if (pageSizeSelect && pageSizeSelect.value !== String(limit)) {
    pageSizeSelect.value = String(limit);
  }

  tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Loading upload history...</td></tr>';

  try {
    const res = await authFetch(`/api/history?page=${page}&limit=${limit}`);
    if (!res.ok) return;
    const result = await res.json();

    const items = Array.isArray(result) ? result : (result.data || []);
    historyTotalRecords = result.total !== undefined ? result.total : items.length;
    historyTotalPages = result.totalPages !== undefined ? result.totalPages : Math.ceil(historyTotalRecords / limit) || 1;

    if (!items || items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No uploaded file history found.</td></tr>';
      if (infoEl) infoEl.textContent = 'Showing 0–0 of 0 records';
      if (navEl) navEl.innerHTML = '';
      return;
    }

    tbody.innerHTML = items
      .map((item) => {
        const isSuccess = item.status === 'success';
        const statusBadge = isSuccess
          ? `<span class="status-pill success"><i class="fa-solid fa-circle-check"></i> Success</span>`
          : `<span class="status-pill failed"><i class="fa-solid fa-circle-xmark"></i> Failed</span>`;

        const formattedDate = item.created_at ? new Date(item.created_at).toLocaleString('en-US') : '-';
        const durationSec = item.duration_ms ? (item.duration_ms / 1000).toFixed(2) + 's' : '-';
        const targetDate = item.target_date ? item.target_date.slice(0, 10) : '-';

        return `
          <tr>
            <td>${formattedDate}</td>
            <td><strong>${escapeHtml(item.file_name)}</strong></td>
            <td>${escapeHtml(item.sheet_name || '-')}</td>
            <td>${targetDate}</td>
            <td>${(item.total_rows || 0).toLocaleString('en-US')} records</td>
            <td>${durationSec}</td>
            <td>${statusBadge}</td>
          </tr>
        `;
      })
      .join('');

    // Update Pagination Info
    const startIdx = (historyCurrentPage - 1) * historyPageSize + 1;
    const endIdx = Math.min(startIdx + items.length - 1, historyTotalRecords);
    if (infoEl) {
      infoEl.textContent = `Showing ${startIdx.toLocaleString('en-US')}–${endIdx.toLocaleString('en-US')} of ${historyTotalRecords.toLocaleString('en-US')} records`;
    }

    // Render Pagination Controls
    renderHistoryPaginationControls();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:#FF4D5E;">Failed to load history: ${escapeHtml(err.message)}</td></tr>`;
    if (infoEl) infoEl.textContent = 'Showing 0–0 of 0 records';
    if (navEl) navEl.innerHTML = '';
  }
}

function renderHistoryPaginationControls() {
  const navEl = document.getElementById('history-pagination-controls');
  if (!navEl) return;

  if (historyTotalPages <= 1) {
    navEl.innerHTML = '';
    return;
  }

  let html = '';

  // Prev Button
  const isPrevDisabled = historyCurrentPage <= 1;
  html += `
    <button type="button" class="pagination-btn ${isPrevDisabled ? 'disabled' : ''}" 
      onclick="goToHistoryPage(${historyCurrentPage - 1})" 
      ${isPrevDisabled ? 'disabled' : ''} 
      title="Previous Page" aria-label="Previous Page">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `;

  // Page Numbers: sliding window logic
  const maxVisiblePages = 5;
  let startPage = Math.max(1, historyCurrentPage - 2);
  let endPage = Math.min(historyTotalPages, startPage + maxVisiblePages - 1);

  if (endPage - startPage < maxVisiblePages - 1) {
    startPage = Math.max(1, endPage - maxVisiblePages + 1);
  }

  if (startPage > 1) {
    html += `<button type="button" class="pagination-btn" onclick="goToHistoryPage(1)">1</button>`;
    if (startPage > 2) {
      html += `<span class="pagination-ellipsis">…</span>`;
    }
  }

  for (let p = startPage; p <= endPage; p++) {
    const isActive = p === historyCurrentPage;
    html += `
      <button type="button" class="pagination-btn ${isActive ? 'active' : ''}" 
        onclick="goToHistoryPage(${p})" 
        ${isActive ? 'aria-current="page"' : ''}>
        ${p}
      </button>
    `;
  }

  if (endPage < historyTotalPages) {
    if (endPage < historyTotalPages - 1) {
      html += `<span class="pagination-ellipsis">…</span>`;
    }
    html += `<button type="button" class="pagination-btn" onclick="goToHistoryPage(${historyTotalPages})">${historyTotalPages}</button>`;
  }

  // Next Button
  const isNextDisabled = historyCurrentPage >= historyTotalPages;
  html += `
    <button type="button" class="pagination-btn ${isNextDisabled ? 'disabled' : ''}" 
      onclick="goToHistoryPage(${historyCurrentPage + 1})" 
      ${isNextDisabled ? 'disabled' : ''} 
      title="Next Page" aria-label="Next Page">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  navEl.innerHTML = html;
}

function goToHistoryPage(page) {
  if (page < 1 || page > historyTotalPages || page === historyCurrentPage) return;
  loadUploadHistory(page, historyPageSize);
}

function changeHistoryPageSize(newSize) {
  const size = parseInt(newSize, 10) || 10;
  loadUploadHistory(1, size);
}

// =====================================================================================
// 9. USER MANAGEMENT (ADMINISTRATOR ONLY)
// =====================================================================================

async function loadUsers() {
  const tbody = document.getElementById('users-tbody');
  tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading user accounts...</td></tr>';

  try {
    const res = await authFetch('/api/users');
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to load users');
    }
    const users = await res.json();

    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty-state">No registered users found.</td></tr>';
      return;
    }

    tbody.innerHTML = users
      .map((u) => {
        const isAdmin = u.role === 'administrator';
        const rolePill = isAdmin
          ? `<span class="role-pill role-admin">Administrator</span>`
          : `<span class="role-pill role-user">Standard User</span>`;

        const isSelf = currentUser && currentUser.id === u.id;
        const resetBtn = `<button class="btn-action-pwd" onclick="openAdminResetModal(${u.id}, '${escapeHtml(u.username)}')" title="Change password for this user"><i class="fa-solid fa-key"></i> Reset Password</button>`;
        const deleteBtn = isSelf
          ? `<button class="btn-delete-user" disabled title="You cannot delete your active account"><i class="fa-solid fa-lock"></i> Active Account</button>`
          : `<button class="btn-delete-user" onclick="handleDeleteUser(${u.id}, '${escapeHtml(u.username)}')"><i class="fa-solid fa-trash"></i> Delete</button>`;

        const createdDate = u.created_at ? new Date(u.created_at).toLocaleDateString('en-US') : '-';

        return `
          <tr>
            <td><strong>#${u.id}</strong></td>
            <td><code>${escapeHtml(u.username)}</code></td>
            <td><strong>${escapeHtml(u.full_name)}</strong></td>
            <td>${rolePill}</td>
            <td>${createdDate}</td>
            <td style="text-align:center;">
              <div class="user-actions-group">
                ${resetBtn}
                ${deleteBtn}
              </div>
            </td>
          </tr>
        `;
      })
      .join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:#FF4D5E;">Failed to load users: ${escapeHtml(err.message)}</td></tr>`;
  }
}

async function handleCreateUser(e) {
  e.preventDefault();
  const alertBox = document.getElementById('user-form-alert');
  const saveBtn = document.getElementById('btn-save-user');

  const username = document.getElementById('new-username').value.trim();
  const full_name = document.getElementById('new-fullname').value.trim();
  const password = document.getElementById('new-password').value;
  const role = document.getElementById('new-role').value;

  saveBtn.disabled = true;
  saveBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving User...';
  alertBox.classList.add('hidden');

  try {
    const res = await authFetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, full_name, password, role }),
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to create user account');
    }

    alertBox.className = 'alert-box alert-success';
    alertBox.innerText = `User account "${data.user.username}" was created successfully!`;
    alertBox.classList.remove('hidden');

    document.getElementById('create-user-form').reset();
    loadUsers();

    setTimeout(() => {
      alertBox.classList.add('hidden');
    }, 4000);
  } catch (err) {
    alertBox.className = 'alert-box alert-error';
    alertBox.innerText = err.message;
    alertBox.classList.remove('hidden');
  } finally {
    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> Save User';
  }
}

async function handleDeleteUser(id, username) {
  if (!confirm(`Are you sure you want to delete user account "${username}"?`)) {
    return;
  }

  try {
    const res = await authFetch(`/api/users/${id}`, {
      method: 'DELETE',
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.error || 'Failed to delete user');
    }

    alert(`User "${username}" has been deleted.`);
    loadUsers();
  } catch (err) {
    alert('Failed to delete user: ' + err.message);
  }
}

// =====================================================================================
// 10. FORMATTERS & UTILITIES
// =====================================================================================

function formatIDR(amount) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(amount || 0);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// =====================================================================================
// 11. CHANGE PASSWORD & PASSWORD MANAGEMENT
// =====================================================================================

function handleModalOverlayClick(e, modalId) {
  if (e.target && e.target.id === modalId) {
    if (modalId === 'change-password-modal') closeChangePasswordModal();
    if (modalId === 'admin-reset-modal') closeAdminResetModal();
  }
}

// Global Escape key listener to close modals
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closeChangePasswordModal();
    closeAdminResetModal();
  }
});

/**
 * Open self-service change password modal (all users)
 */
function openChangePasswordModal() {
  const modal = document.getElementById('change-password-modal');
  if (!modal) return;

  const alertBox = document.getElementById('change-password-alert');
  if (alertBox) alertBox.classList.add('hidden');

  const form = document.getElementById('change-password-form');
  if (form) form.reset();

  // Reset password inputs to type='password' and toggle icons
  ['current-password', 'new-user-password', 'confirm-user-password'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.type = 'password';
  });
  modal.querySelectorAll('.btn-toggle-password i').forEach((icon) => {
    icon.className = 'fa-solid fa-eye';
  });

  modal.classList.remove('hidden');
  const currentPwdInput = document.getElementById('current-password');
  if (currentPwdInput) currentPwdInput.focus();
}

function closeChangePasswordModal() {
  const modal = document.getElementById('change-password-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  const alertBox = document.getElementById('change-password-alert');
  if (alertBox) alertBox.classList.add('hidden');
}

/**
 * Submit self-service change password
 */
async function handleChangePassword(e) {
  e.preventDefault();
  const alertBox = document.getElementById('change-password-alert');
  const submitBtn = document.getElementById('btn-submit-change-password');

  const currentPassword = document.getElementById('current-password').value;
  const newPassword = document.getElementById('new-user-password').value;
  const confirmPassword = document.getElementById('confirm-user-password').value;

  if (newPassword !== confirmPassword) {
    alertBox.className = 'alert-box alert-error';
    alertBox.innerText = 'New password confirmation does not match. Please ensure both fields are identical.';
    alertBox.classList.remove('hidden');
    return;
  }

  if (newPassword.length < 6) {
    alertBox.className = 'alert-box alert-error';
    alertBox.innerText = 'New password must be at least 6 characters.';
    alertBox.classList.remove('hidden');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Saving Password...';
  alertBox.classList.add('hidden');

  try {
    const res = await authFetch('/api/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to change password.');
    }

    alertBox.className = 'alert-box alert-success';
    alertBox.innerText = data.message || 'Password changed successfully!';
    alertBox.classList.remove('hidden');

    document.getElementById('change-password-form').reset();

    setTimeout(() => {
      closeChangePasswordModal();
    }, 1800);
  } catch (err) {
    alertBox.className = 'alert-box alert-error';
    alertBox.innerText = err.message;
    alertBox.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Save New Password';
  }
}

/**
 * Open administrator reset password modal for target user
 */
function openAdminResetModal(userId, username) {
  const modal = document.getElementById('admin-reset-modal');
  if (!modal) return;

  const alertBox = document.getElementById('admin-reset-alert');
  if (alertBox) alertBox.classList.add('hidden');

  const form = document.getElementById('admin-reset-form');
  if (form) form.reset();

  document.getElementById('admin-reset-user-id').value = userId;
  document.getElementById('admin-reset-username').innerText = username;

  ['admin-new-password', 'admin-confirm-password'].forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.type = 'password';
  });
  modal.querySelectorAll('.btn-toggle-password i').forEach((icon) => {
    icon.className = 'fa-solid fa-eye';
  });

  modal.classList.remove('hidden');
  const newPwdInput = document.getElementById('admin-new-password');
  if (newPwdInput) newPwdInput.focus();
}

function closeAdminResetModal() {
  const modal = document.getElementById('admin-reset-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  const alertBox = document.getElementById('admin-reset-alert');
  if (alertBox) alertBox.classList.add('hidden');
}

/**
 * Submit administrator reset password for target user
 */
async function handleAdminResetPassword(e) {
  e.preventDefault();
  const alertBox = document.getElementById('admin-reset-alert');
  const submitBtn = document.getElementById('btn-submit-admin-reset');

  const userId = document.getElementById('admin-reset-user-id').value;
  const newPassword = document.getElementById('admin-new-password').value;
  const confirmPassword = document.getElementById('admin-confirm-password').value;

  if (newPassword !== confirmPassword) {
    alertBox.className = 'alert-box alert-error';
    alertBox.innerText = 'New password confirmation does not match.';
    alertBox.classList.remove('hidden');
    return;
  }

  if (newPassword.length < 6) {
    alertBox.className = 'alert-box alert-error';
    alertBox.innerText = 'New password must be at least 6 characters.';
    alertBox.classList.remove('hidden');
    return;
  }

  submitBtn.disabled = true;
  submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Updating...';
  alertBox.classList.add('hidden');

  try {
    const res = await authFetch(`/api/users/${userId}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPassword, confirmPassword }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Failed to reset user password.');
    }

    alertBox.className = 'alert-box alert-success';
    alertBox.innerText = data.message || 'Password updated successfully!';
    alertBox.classList.remove('hidden');

    document.getElementById('admin-reset-form').reset();

    setTimeout(() => {
      closeAdminResetModal();
    }, 1800);
  } catch (err) {
    alertBox.className = 'alert-box alert-error';
    alertBox.innerText = err.message;
    alertBox.classList.remove('hidden');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<i class="fa-solid fa-user-check"></i> Update Password';
  }
}
