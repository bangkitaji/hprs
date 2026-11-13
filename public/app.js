// =====================================================================================
// HRTS PORTAL — FRONTEND APPLICATION LOGIC WITH RBAC & AUTHENTICATION (ENGLISH)
// =====================================================================================

const TOKEN_KEY = 'hpr_token';
const USER_KEY = 'hpr_user';

let currentUser = null;
let currentUploadedFile = null;
let currentPreviewData = null;
let activePreviewSheet = null;

let currentUploadCategory = 'hrts'; // 'hrts', 'middleware', 'payment_gateway'
let currentPgProvider = 'auto'; // 'auto', 'xendit', 'finnet', 'doku_all', 'doku_qr'
let currentHistorySourceFilter = '';

function setUploadCategory(cat) {
  currentUploadCategory = cat;
  document.querySelectorAll('.category-btn').forEach((btn) => btn.classList.remove('active'));
  const activeBtn = document.getElementById(`cat-btn-${cat === 'payment_gateway' ? 'pg' : cat}`);
  if (activeBtn) activeBtn.classList.add('active');

  const pgBar = document.getElementById('pg-provider-bar');
  const cardTitle = document.getElementById('upload-card-title');
  const cardDesc = document.getElementById('upload-card-desc');
  const cardBadge = document.getElementById('upload-card-badge');
  const dropTitle = document.getElementById('dropzone-title');
  const fileInput = document.getElementById('file-input');

  if (cat === 'payment_gateway') {
    if (pgBar) pgBar.classList.remove('hidden');
    if (cardTitle) cardTitle.innerHTML = '<i class="fa-solid fa-credit-card card-icon"></i> Upload Payment Gateway Settlement Files';
    if (cardDesc) cardDesc.innerHTML = 'Supports settlement reports from <strong>Xendit (.csv), Finnet (.xlsx), Doku All (.csv), and Doku QR (.xlsx)</strong>.';
    if (cardBadge) cardBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Multi-PG Settlement Reconciliation';
    if (dropTitle) dropTitle.innerText = 'Drag & drop Payment Gateway (.csv / .xlsx) files here';
    if (fileInput) fileInput.accept = '.csv, .xlsx, .xls';
  } else if (cat === 'middleware') {
    if (pgBar) pgBar.classList.add('hidden');
    if (cardTitle) cardTitle.innerHTML = '<i class="fa-solid fa-server card-icon"></i> Upload Middleware Transaction Logs';
    if (cardDesc) cardDesc.innerHTML = 'Supports middleware exports (<strong>.txt with "||" delimiter</strong>, .csv, or .xlsx). Auto-detects header presence.';
    if (cardBadge) cardBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Double Pipe (||) Log Ingestion';
    if (dropTitle) dropTitle.innerText = 'Drag & drop Middleware (.txt / .csv) files here';
    if (fileInput) fileInput.accept = '.txt, .csv, .xlsx, .xls';
  } else {
    if (pgBar) pgBar.classList.add('hidden');
    if (cardTitle) cardTitle.innerHTML = '<i class="fa-solid fa-file-excel card-icon"></i> Upload Ticketing & Occupancy Excel Files';
    if (cardDesc) cardDesc.innerHTML = 'Supports native ticketing system export formats (.xlsx / .xls). <strong>Auto-detects Sales, Refund, & Occupancy report structures.</strong>';
    if (cardBadge) cardBadge.innerHTML = '<i class="fa-solid fa-circle-check"></i> Auto-Detect Sales, Refund & Occupancy';
    if (dropTitle) dropTitle.innerText = 'Drag & drop HRTS Excel files here';
    if (fileInput) fileInput.accept = '.xlsx, .xls';
  }
  resetUpload();
}

function setPgProvider(provider) {
  currentPgProvider = provider;
  document.querySelectorAll('.pg-chip').forEach((c) => c.classList.remove('active'));
  const activeChip = document.getElementById(`pg-chip-${provider}`);
  if (activeChip) activeChip.classList.add('active');
}

function filterUploadHistory(sourceValue) {
  currentHistorySourceFilter = sourceValue || '';
  historyCurrentPage = 1;
  loadUploadHistory();
}

/**
 * Programmatic event listeners for category buttons & PG provider chips
 */
function initCategoryButtons() {
  const catHrts = document.getElementById('cat-btn-hrts');
  const catMw = document.getElementById('cat-btn-middleware');
  const catPg = document.getElementById('cat-btn-pg');

  if (catHrts) {
    catHrts.addEventListener('click', (e) => {
      e.preventDefault();
      setUploadCategory('hrts');
    });
  }
  if (catMw) {
    catMw.addEventListener('click', (e) => {
      e.preventDefault();
      setUploadCategory('middleware');
    });
  }
  if (catPg) {
    catPg.addEventListener('click', (e) => {
      e.preventDefault();
      setUploadCategory('payment_gateway');
    });
  }

  // PG Chips listeners
  const pgChips = [
    { id: 'pg-chip-auto', prov: 'auto' },
    { id: 'pg-chip-xendit', prov: 'xendit' },
    { id: 'pg-chip-finnet', prov: 'finnet' },
    { id: 'pg-chip-doku_all', prov: 'doku_all' },
    { id: 'pg-chip-doku_qr', prov: 'doku_qr' },
  ];
  pgChips.forEach(({ id, prov }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        setPgProvider(prov);
      });
    }
  });
}

// Expose navigation & upload controls globally on window
window.setUploadCategory = setUploadCategory;
window.setPgProvider = setPgProvider;
window.filterUploadHistory = filterUploadHistory;

// Initial Load
document.addEventListener('DOMContentLoaded', () => {
  initAuth();
  initCategoryButtons();
  setupDropzone();
  initDateFilters();
  initReconDateFilters();
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
  const tabReconciliationBtn = document.getElementById('tab-reconciliation-btn');
  const tabHistoryBtn = document.getElementById('tab-history-btn');
  const tabUsersBtn = document.getElementById('tab-users-btn');

  badgeContainer.style.display = 'flex';
  displayName.innerText = user.full_name || user.username;

  if (user.role === 'administrator') {
    displayRole.innerText = 'Administrator';
    displayRole.className = 'role-pill role-admin';

    // Administrator has full access to all tabs
    if (tabDashboardBtn) tabDashboardBtn.style.display = 'inline-flex';
    if (tabReconciliationBtn) tabReconciliationBtn.style.display = 'inline-flex';
    if (tabHistoryBtn) tabHistoryBtn.style.display = 'inline-flex';
    if (tabUsersBtn) tabUsersBtn.style.display = 'inline-flex';
    if (tabUploadBtn) tabUploadBtn.style.display = 'inline-flex';
  } else {
    // Standard user can only upload data & view upload history
    displayRole.innerText = 'Standard User';
    displayRole.className = 'role-pill role-user';

    if (tabDashboardBtn) tabDashboardBtn.style.display = 'none';
    if (tabReconciliationBtn) tabReconciliationBtn.style.display = 'none';
    if (tabUsersBtn) tabUsersBtn.style.display = 'none';
    if (tabUploadBtn) tabUploadBtn.style.display = 'inline-flex';
    if (tabHistoryBtn) tabHistoryBtn.style.display = 'inline-flex';
  }

  // Restore previously active tab on page refresh
  const savedTab = sessionStorage.getItem('hpr_active_tab') || 'upload';
  if (user.role === 'user' && (savedTab === 'dashboard' || savedTab === 'users' || savedTab === 'reconciliation')) {
    switchTab('upload');
  } else {
    switchTab(savedTab);
  }

  loadLiveStats();
}

/**
 * Safely parse response as JSON with informative error extraction for HTML error pages (413, 502, 504, etc.)
 */
async function safeParseJson(res) {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch (_) {
    // Tangani HTML error pages dari Nginx / Reverse Proxy
    if (res.status === 413 || text.includes('413 Request Entity Too Large')) {
      throw new Error('Ukuran file melebihi batas upload web server (HTTP 413: Request Entity Too Large). Silakan tambahkan "client_max_body_size 100M;" di /etc/nginx/nginx.conf.');
    }
    if (res.status === 502 || text.includes('502 Bad Gateway')) {
      throw new Error('Backend server tidak dapat dihubungi (HTTP 502: Bad Gateway). Pastikan PM2 online di port 3030.');
    }
    if (res.status === 504 || text.includes('504 Gateway Time-out')) {
      throw new Error('Waktu pemrosesan file habis (HTTP 504: Gateway Timeout).');
    }
    const cleanMsg = text.replace(/<[^>]*>?/gm, ' ').replace(/\s+/g, ' ').trim();
    throw new Error(`Server returned HTTP ${res.status}: ${cleanMsg.slice(0, 150) || 'Invalid server response'}`);
  }
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
    if (tabId === 'dashboard' || tabId === 'users' || tabId === 'reconciliation') {
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
  } else if (tabId === 'reconciliation') {
    loadReconciliationSummary();
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
  if (!file.name.match(/\.(xlsx|xls|csv|txt)$/i)) {
    alert('Unsupported file format! Please upload an Excel (.xlsx, .xls), CSV (.csv), or Text (.txt) file.');
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

    const data = await safeParseJson(res);
    if (!res.ok) {
      throw new Error(data.error || 'Failed to process file preview');
    }

    currentPreviewData = data;
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
    let cardClass = '';
    let badgeClass = '';
    let typeLabel = 'Data Sheet';

    switch (sheet.detectedType) {
      case 'sales':
        cardClass = 'detected-sales';
        badgeClass = 'badge-sales';
        typeLabel = 'Ticket Sales';
        break;
      case 'refund':
        cardClass = 'detected-refund';
        badgeClass = 'badge-refund';
        typeLabel = 'Ticket Refund';
        break;
      case 'occupancy':
        cardClass = 'detected-occupancy';
        badgeClass = 'badge-occupancy';
        typeLabel = 'Occupancy Report';
        break;
      case 'middleware':
        cardClass = 'detected-middleware';
        badgeClass = 'badge-middleware';
        typeLabel = 'Middleware Log';
        break;
      case 'pg_xendit':
        cardClass = 'detected-xendit';
        badgeClass = 'badge-xendit';
        typeLabel = 'Xendit Settlement';
        break;
      case 'pg_finnet':
        cardClass = 'detected-finnet';
        badgeClass = 'badge-finnet';
        typeLabel = 'Finnet Settlement';
        break;
      case 'pg_doku_qr':
        cardClass = 'detected-doku-qr';
        badgeClass = 'badge-doku-qr';
        typeLabel = 'Doku QRIS Report';
        break;
      case 'pg_doku_all':
        cardClass = 'detected-doku-all';
        badgeClass = 'badge-doku-all';
        typeLabel = 'Doku All Data';
        break;
      default:
        cardClass = '';
        badgeClass = '';
        typeLabel = 'Data Sheet';
    }

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

      const data = await safeParseJson(res);

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
    `File "${results.fileName}" has been processed successfully. Records are safely stored in PostgreSQL and summaries are consolidated.`;

  const durationSec = (results.durationMs / 1000).toFixed(2);
  let metricsHtml = '';

  if (results.totalSalesInserted > 0) {
    metricsHtml += `
      <div class="metric-box">
        <div class="metric-box-label">Sales Records</div>
        <div class="metric-box-val" style="color: #FF4D5E;">${results.totalSalesInserted.toLocaleString('en-US')}</div>
      </div>`;
  }
  if (results.totalRefundInserted > 0) {
    metricsHtml += `
      <div class="metric-box">
        <div class="metric-box-label">Refund Records</div>
        <div class="metric-box-val" style="color: #06B6D4;">${results.totalRefundInserted.toLocaleString('en-US')}</div>
      </div>`;
  }
  if (results.totalOccupancyInserted > 0) {
    metricsHtml += `
      <div class="metric-box">
        <div class="metric-box-label">Occupancy Records</div>
        <div class="metric-box-val" style="color: #C084FC;">${results.totalOccupancyInserted.toLocaleString('en-US')}</div>
      </div>`;
  }
  if (results.totalMiddlewareInserted > 0) {
    metricsHtml += `
      <div class="metric-box">
        <div class="metric-box-label">Middleware Logs</div>
        <div class="metric-box-val" style="color: #06B6D4;">${results.totalMiddlewareInserted.toLocaleString('en-US')}</div>
      </div>`;
  }
  if (results.totalXenditInserted > 0) {
    metricsHtml += `
      <div class="metric-box">
        <div class="metric-box-label">Xendit Records</div>
        <div class="metric-box-val" style="color: #10B981;">${results.totalXenditInserted.toLocaleString('en-US')}</div>
      </div>`;
  }
  if (results.totalFinnetInserted > 0) {
    metricsHtml += `
      <div class="metric-box">
        <div class="metric-box-label">Finnet Records</div>
        <div class="metric-box-val" style="color: #F59E0B;">${results.totalFinnetInserted.toLocaleString('en-US')}</div>
      </div>`;
  }
  if (results.totalDokuQrInserted > 0) {
    metricsHtml += `
      <div class="metric-box">
        <div class="metric-box-label">Doku QR Records</div>
        <div class="metric-box-val" style="color: #A78BFA;">${results.totalDokuQrInserted.toLocaleString('en-US')}</div>
      </div>`;
  }
  if (results.totalDokuAllInserted > 0) {
    metricsHtml += `
      <div class="metric-box">
        <div class="metric-box-label">Doku All Records</div>
        <div class="metric-box-val" style="color: #F472B6;">${results.totalDokuAllInserted.toLocaleString('en-US')}</div>
      </div>`;
  }

  metricsHtml += `
    <div class="metric-box">
      <div class="metric-box-label">Execution Time</div>
      <div class="metric-box-val">${durationSec} sec</div>
    </div>`;

  grid.innerHTML = metricsHtml;
  card.classList.remove('hidden');
}

// =====================================================================================
// 7. LIVE DATA MART DASHBOARD (ADMINISTRATOR ONLY)
// =====================================================================================

function initDateFilters() {
  const today = new Date();
  // Default start date to the 1st day of the previous month so full October + November data is immediately covered
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  const startInput = document.getElementById('dash-start-date');
  const endInput = document.getElementById('dash-end-date');

  const formatLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (startInput && endInput) {
    startInput.value = formatLocal(startDate);
    endInput.value = formatLocal(today);
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

    // Render Payment Gateway & Settlement Summary
    if (data.gatewaySummary) {
      const gw = data.gatewaySummary;
      const netEl = document.getElementById('kpi-pg-net');
      const grossEl = document.getElementById('kpi-pg-gross');
      const feeEl = document.getElementById('kpi-pg-fee');
      const rateEl = document.getElementById('kpi-pg-rate');
      const rateSubEl = document.getElementById('kpi-pg-settled-count');
      const mwEl = document.getElementById('kpi-mw-volume');
      const mwSubEl = document.getElementById('kpi-mw-count');

      if (netEl) netEl.innerText = formatIDR(gw.totalNetAmount || 0);
      if (grossEl) grossEl.innerText = formatIDR(gw.totalGrossAmount || 0);
      if (feeEl) feeEl.innerText = formatIDR(gw.totalFeeAmount || 0);

      const ratePct = gw.totalTransactions > 0 ? ((gw.totalSettledTransactions / gw.totalTransactions) * 100).toFixed(1) : '100.0';
      if (rateEl) rateEl.innerText = `${ratePct}%`;
      if (rateSubEl) rateSubEl.innerText = `${(gw.totalSettledTransactions || 0).toLocaleString('en-US')} of ${(gw.totalTransactions || 0).toLocaleString('en-US')} Settled`;

      if (gw.middleware) {
        if (mwEl) mwEl.innerText = formatIDR(gw.middleware.gross_amount || 0);
        if (mwSubEl) mwSubEl.innerText = `${(gw.middleware.count || 0).toLocaleString('en-US')} Hits Logged`;
      }

      // Populate PG Summary Table
      const pgTbody = document.getElementById('pg-summary-tbody');
      if (pgTbody) {
        const rows = [...gw.providers];
        if (gw.middleware && gw.middleware.count > 0) {
          rows.push({
            provider: 'Middleware',
            channel_desc: 'API & Logging Gateway',
            count: gw.middleware.count,
            settled_count: gw.middleware.count,
            pending_count: 0,
            gross_amount: gw.middleware.gross_amount,
            fee_amount: gw.middleware.fee_amount,
            net_amount: gw.middleware.net_amount,
          });
        }

        if (rows.length > 0 && rows.some(r => r.count > 0)) {
          pgTbody.innerHTML = rows
            .map((p) => {
              const providerClass = p.provider.toLowerCase().replace(' ', '_');
              const providerBadge = `<span class="source-pill source-${providerClass}">${escapeHtml(p.provider)}</span>`;
              const settledInfo = p.pending_count > 0
                ? `<span style="color:#10B981; font-weight:600;">${(p.settled_count || 0).toLocaleString('en-US')}</span> / <span style="color:#F59E0B;">${(p.pending_count || 0).toLocaleString('en-US')} Pend</span>`
                : `<span style="color:#10B981; font-weight:600;"><i class="fa-solid fa-circle-check"></i> ${(p.settled_count || 0).toLocaleString('en-US')} (100%)</span>`;

              return `
                <tr>
                  <td>${providerBadge}</td>
                  <td><span style="color:var(--text-secondary); font-size:12px;">${escapeHtml(p.channel_desc || '-')}</span></td>
                  <td style="font-family: var(--font-mono); font-weight:600;">${(p.count || 0).toLocaleString('en-US')}</td>
                  <td>${settledInfo}</td>
                  <td style="font-family: var(--font-mono);">${formatIDR(p.gross_amount)}</td>
                  <td style="font-family: var(--font-mono); color: #F59E0B;">${formatIDR(p.fee_amount)}</td>
                  <td style="font-family: var(--font-mono); color: #10B981; font-weight:700;">${formatIDR(p.net_amount)}</td>
                </tr>
              `;
            })
            .join('');
        } else {
          pgTbody.innerHTML = '<tr><td colspan="7" class="empty-state">No payment gateway data available for this period</td></tr>';
        }
      }
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

  tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Loading upload history...</td></tr>';

  try {
    const filterParam = currentHistorySourceFilter ? `&source=${encodeURIComponent(currentHistorySourceFilter)}` : '';
    const res = await authFetch(`/api/history?page=${page}&limit=${limit}${filterParam}`);
    if (!res.ok) return;
    const result = await res.json();

    const items = Array.isArray(result) ? result : (result.data || []);
    historyTotalRecords = result.total !== undefined ? result.total : items.length;
    historyTotalPages = result.totalPages !== undefined ? result.totalPages : Math.ceil(historyTotalRecords / limit) || 1;

    if (!items || items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">No uploaded file history found for the selected criteria.</td></tr>';
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

        const srcType = item.source_type || 'hrts';
        const providerName = item.provider ? item.provider.toUpperCase().replace('_', ' ') : srcType.toUpperCase();
        const sourceClass = `source-${item.provider || srcType}`;
        const sourceBadge = `<span class="source-pill ${sourceClass}">${escapeHtml(providerName)}</span>`;

        return `
          <tr>
            <td>${formattedDate}</td>
            <td>${sourceBadge}</td>
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
    tbody.innerHTML = `<tr><td colspan="8" class="empty-state" style="color:#FF4D5E;">Failed to load history: ${escapeHtml(err.message)}</td></tr>`;
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

// =====================================================================================
// 10. THREE-WAY RECONCILIATION HUB & SETTLEMENT ANALYTICS
// =====================================================================================

let currentReconBatchId = null;
let currentReconPage = 1;
let currentReconPageSize = 25;
let reconSearchDebounceTimer = null;

function initReconDateFilters() {
  const today = new Date();
  const startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);

  const startInput = document.getElementById('recon-start-date');
  const endInput = document.getElementById('recon-end-date');

  const formatLocal = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  if (startInput && endInput) {
    startInput.value = formatLocal(startDate);
    endInput.value = formatLocal(today);
  }
}

async function triggerRunReconciliation() {
  const startDate = document.getElementById('recon-start-date').value;
  const endDate = document.getElementById('recon-end-date').value;
  const providerFilter = document.getElementById('recon-provider-filter').value;
  const btn = document.getElementById('btn-run-recon');

  if (!startDate || !endDate) {
    alert('Please select both start and end dates.');
    return;
  }

  const origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Running Matching Engine...';

  try {
    const res = await authFetch('/api/reconciliation/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startDate, endDate, providerFilter }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Failed to execute reconciliation.');
    }

    alert(`Reconciliation Completed!\nBatch: ${data.data.batchNo}\nTotal: ${data.data.totalTransactions.toLocaleString('en-US')} records\nDuration: ${(data.data.durationMs / 1000).toFixed(2)}s`);
    await loadReconciliationSummary(data.data.batchId);
  } catch (err) {
    console.error('Error run reconciliation:', err);
    alert('Reconciliation Error: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

async function loadReconciliationSummary(batchId) {
  try {
    let url = '/api/reconciliation/summary';
    if (batchId) {
      url += `?batchId=${batchId}`;
      currentReconBatchId = batchId;
    } else if (currentReconBatchId) {
      url += `?batchId=${currentReconBatchId}`;
    }

    const res = await authFetch(url);
    if (!res.ok) return;
    const json = await res.json();
    const data = json.data;

    if (!data.hasData || !data.batch) {
      document.getElementById('recon-kpi-total').innerText = '0';
      document.getElementById('recon-kpi-clean').innerText = '0';
      document.getElementById('recon-kpi-pending').innerText = '0';
      document.getElementById('recon-kpi-unsettled').innerText = '0';
      document.getElementById('recon-kpi-orphan').innerText = '0';
      document.getElementById('recon-kpi-fee').innerText = 'Rp 0';
      document.getElementById('recon-provider-tbody').innerHTML = '<tr><td colspan="9" class="empty-state">No reconciliation batches found. Click "Run 3-Way Match" above.</td></tr>';
      document.getElementById('recon-items-tbody').innerHTML = '<tr><td colspan="10" class="empty-state">No reconciliation records available.</td></tr>';
      return;
    }

    const b = data.batch;
    currentReconBatchId = b.id;

    // Populate Batch Selector
    const batchSelect = document.getElementById('recon-batch-select');
    if (batchSelect && data.recentBatches) {
      batchSelect.innerHTML = data.recentBatches
        .map((rb) => `<option value="${rb.id}" ${rb.id === b.id ? 'selected' : ''}>${escapeHtml(rb.batch_no)} (${formatDate(rb.created_at)})</option>`)
        .join('');
    }

    // Populate KPIs
    const totalTrx = parseInt(b.total_transactions || 0, 10);
    const cleanTrx = parseInt(b.total_matched_clean || 0, 10);
    const pendingTrx = parseInt(b.total_matched_pending || 0, 10);
    const unsettledTrx = parseInt(b.total_dispute_unsettled || 0, 10);
    const orphanTrx = parseInt(b.total_dispute_orphan_paid || 0, 10);
    const feeAmt = parseFloat(b.total_fee_amount || 0);
    const grossAmt = parseFloat(b.total_pg_gross_amount || 0);

    const cleanPct = totalTrx > 0 ? ((cleanTrx / totalTrx) * 100).toFixed(1) : '0';
    const effectiveFeePct = grossAmt > 0 ? ((feeAmt / grossAmt) * 100).toFixed(2) : '0';

    document.getElementById('recon-kpi-total').innerText = totalTrx.toLocaleString('en-US');
    document.getElementById('recon-kpi-clean').innerText = cleanTrx.toLocaleString('en-US');
    document.getElementById('recon-kpi-clean-pct').innerText = `${cleanPct}% Clean Rate`;
    document.getElementById('recon-kpi-pending').innerText = pendingTrx.toLocaleString('en-US');
    document.getElementById('recon-kpi-unsettled').innerText = unsettledTrx.toLocaleString('en-US');
    document.getElementById('recon-kpi-orphan').innerText = orphanTrx.toLocaleString('en-US');
    document.getElementById('recon-kpi-fee').innerText = formatIDR(feeAmt);
    document.getElementById('recon-kpi-fee-sub').innerText = `Effective MDR: ${effectiveFeePct}%`;

    const batchInfoEl = document.getElementById('recon-batch-info');
    if (batchInfoEl) {
      batchInfoEl.innerHTML = `<i class="fa-solid fa-barcode"></i> ${escapeHtml(b.batch_no)}`;
    }

    // Populate Provider Breakdown Table
    const provTbody = document.getElementById('recon-provider-tbody');
    if (provTbody && data.providerBreakdown && data.providerBreakdown.length > 0) {
      provTbody.innerHTML = data.providerBreakdown
        .map((p) => {
          const pName = p.provider || 'Other';
          const pBadge = `<span class="source-pill source-${pName.toLowerCase().replace(/\s+/g, '_')}">${escapeHtml(pName)}</span>`;
          return `
            <tr>
              <td>${pBadge}</td>
              <td style="font-family: var(--font-mono); font-weight:600;">${parseInt(p.total_trx).toLocaleString('en-US')}</td>
              <td style="font-family: var(--font-mono); color: #10B981;">${parseInt(p.clean_trx || 0).toLocaleString('en-US')}</td>
              <td style="font-family: var(--font-mono); color: #F59E0B;">${parseInt(p.pending_trx || 0).toLocaleString('en-US')}</td>
              <td style="font-family: var(--font-mono); color: ${p.dispute_trx > 0 ? '#EF4444' : 'var(--text-muted)'}; font-weight:700;">${parseInt(p.dispute_trx || 0).toLocaleString('en-US')}</td>
              <td style="font-family: var(--font-mono);">${formatIDR(p.gross_amount)}</td>
              <td style="font-family: var(--font-mono); color: #F59E0B;">${formatIDR(p.fee_amount)}</td>
              <td style="font-family: var(--font-mono); color: #10B981; font-weight:700;">${formatIDR(p.net_amount)}</td>
              <td style="font-family: var(--font-mono); color: #A78BFA; font-weight:600;">${p.effective_fee_pct}%</td>
            </tr>
          `;
        })
        .join('');
    } else if (provTbody) {
      provTbody.innerHTML = '<tr><td colspan="9" class="empty-state">No provider breakdown data available.</td></tr>';
    }

    // Load items for this batch
    currentReconPage = 1;
    await loadReconciliationItems(1);
  } catch (err) {
    console.error('Error loadReconciliationSummary:', err);
  }
}

function switchReconBatch(batchId) {
  if (batchId) {
    currentReconBatchId = batchId;
    loadReconciliationSummary(batchId);
  }
}

async function loadReconciliationItems(page = currentReconPage) {
  currentReconPage = page;
  const statusFilter = document.getElementById('recon-filter-status')?.value || '';
  const providerFilter = document.getElementById('recon-filter-provider')?.value || '';
  const resolutionFilter = document.getElementById('recon-filter-resolution')?.value || '';
  const search = document.getElementById('recon-search-input')?.value.trim() || '';

  const params = new URLSearchParams({
    page: currentReconPage,
    limit: currentReconPageSize,
  });

  if (currentReconBatchId) params.append('batchId', currentReconBatchId);
  if (statusFilter) params.append('reconStatus', statusFilter);
  if (providerFilter && providerFilter !== 'ALL') params.append('provider', providerFilter);
  if (resolutionFilter) params.append('resolutionStatus', resolutionFilter);
  if (search) params.append('search', search);

  const tbody = document.getElementById('recon-items-tbody');
  tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><i class="fa-solid fa-spinner fa-spin"></i> Loading records...</td></tr>';

  try {
    const res = await authFetch(`/api/reconciliation/items?${params.toString()}`);
    if (!res.ok) return;
    const data = await res.json();

    if (!data.items || data.items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="10" class="empty-state">No matching reconciliation records found.</td></tr>';
      updateReconPagination(0, 0, 0);
      return;
    }

    tbody.innerHTML = data.items
      .map((item) => {
        // Status Badge Mapping
        let statusBadgeClass = `badge-${item.recon_status.toLowerCase()}`;
        let statusLabel = item.recon_status.replace(/_/g, ' ');
        if (item.recon_status === 'MATCH_CLEAN') statusLabel = '<i class="fa-solid fa-circle-check"></i> CLEAN MATCH';
        else if (item.recon_status === 'MATCH_PENDING') statusLabel = '<i class="fa-solid fa-clock"></i> PENDING';
        else if (item.recon_status === 'DISPUTE_UNSETTLED') statusLabel = '<i class="fa-solid fa-triangle-exclamation"></i> UNSETTLED (LEAK)';
        else if (item.recon_status === 'DISPUTE_ORPHAN_PAID') statusLabel = '<i class="fa-solid fa-user-xmark"></i> ORPHAN PAID';
        else if (item.recon_status === 'DISPUTE_AMOUNT_MISMATCH') statusLabel = '<i class="fa-solid fa-circle-half-stroke"></i> AMT MISMATCH';
        else if (item.recon_status === 'MW_ORPHAN') statusLabel = '<i class="fa-solid fa-server"></i> MW ORPHAN';

        // 3-Way Presence Pills
        const hrtsPill = `<span class="presence-pill ${item.has_hrts ? 'active' : 'inactive'}">HRTS</span>`;
        const mwPill = `<span class="presence-pill ${item.has_middleware ? 'active' : 'inactive'}">MW</span>`;
        const pgPill = `<span class="presence-pill ${item.has_pg ? 'active' : 'inactive'}">PG</span>`;

        // Resolution Badge
        const resClass = `res-${(item.resolution_status || 'UNRESOLVED').toLowerCase()}`;

        // Variance styling
        const varianceVal = parseFloat(item.amount_variance || 0);
        let varianceDisplay = '<span style="color:var(--text-muted);">-</span>';
        if (varianceVal !== 0) {
          varianceDisplay = `<span style="color:#EF4444; font-weight:700;">${formatIDR(varianceVal)}</span>`;
        }

        return `
          <tr>
            <td>
              <span style="font-family: var(--font-mono); font-weight:700; color:#fff; font-size:12px;">${escapeHtml(item.golden_reference)}</span>
            </td>
            <td style="font-family: var(--font-mono); font-size:12px; color:var(--text-secondary);">${item.transaction_date || '-'}</td>
            <td>
              <span class="source-pill source-${(item.provider || '').toLowerCase().replace(/\s+/g, '_')}">${escapeHtml(item.provider || '-')}</span>
              <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">${escapeHtml(item.payment_channel || '-')}</div>
            </td>
            <td>
              <div class="presence-group">${hrtsPill}${mwPill}${pgPill}</div>
            </td>
            <td style="font-family: var(--font-mono); font-weight:600; color:#FF4D5E;">${formatIDR(item.hrts_amount)}</td>
            <td style="font-family: var(--font-mono); font-weight:600; color:#10B981;">${formatIDR(item.pg_net_amount)}</td>
            <td style="font-family: var(--font-mono);">${varianceDisplay}</td>
            <td>
              <span class="recon-badge ${statusBadgeClass}">${statusLabel}</span>
            </td>
            <td>
              <span class="res-badge ${resClass}">${escapeHtml(item.resolution_status || 'UNRESOLVED')}</span>
            </td>
            <td>
              <button class="btn btn-sm btn-outline" onclick="openReconDetailModal(${item.id})" title="Inspect 3-way fields">
                <i class="fa-solid fa-eye"></i> Inspect
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    updateReconPagination(data.total, data.page, data.totalPages);
  } catch (err) {
    console.error('Error loadReconciliationItems:', err);
    tbody.innerHTML = '<tr><td colspan="10" class="empty-state">Error loading records.</td></tr>';
  }
}

function updateReconPagination(totalRecords, page, totalPages) {
  const infoEl = document.getElementById('recon-pagination-info');
  const controlsEl = document.getElementById('recon-pagination-controls');
  if (!infoEl || !controlsEl) return;

  if (totalRecords === 0) {
    infoEl.innerText = 'Showing 0–0 of 0 records';
    controlsEl.innerHTML = '';
    return;
  }

  const start = (page - 1) * currentReconPageSize + 1;
  const end = Math.min(page * currentReconPageSize, totalRecords);
  infoEl.innerText = `Showing ${start.toLocaleString('en-US')}–${end.toLocaleString('en-US')} of ${totalRecords.toLocaleString('en-US')} records`;

  let navHtml = '';
  navHtml += `
    <button class="btn-page" ${page <= 1 ? 'disabled' : ''} onclick="loadReconciliationItems(${page - 1})">
      <i class="fa-solid fa-chevron-left"></i>
    </button>
  `;

  // Sliding window pagination
  let startPage = Math.max(1, page - 2);
  let endPage = Math.min(totalPages, page + 2);

  if (startPage > 1) {
    navHtml += `<button class="btn-page" onclick="loadReconciliationItems(1)">1</button>`;
    if (startPage > 2) navHtml += `<span class="page-ellipsis">…</span>`;
  }

  for (let p = startPage; p <= endPage; p++) {
    navHtml += `<button class="btn-page ${p === page ? 'active' : ''}" onclick="loadReconciliationItems(${p})">${p}</button>`;
  }

  if (endPage < totalPages) {
    if (endPage < totalPages - 1) navHtml += `<span class="page-ellipsis">…</span>`;
    navHtml += `<button class="btn-page" onclick="loadReconciliationItems(${totalPages})">${totalPages}</button>`;
  }

  navHtml += `
    <button class="btn-page" ${page >= totalPages ? 'disabled' : ''} onclick="loadReconciliationItems(${page + 1})">
      <i class="fa-solid fa-chevron-right"></i>
    </button>
  `;

  controlsEl.innerHTML = navHtml;
}

function filterReconItems() {
  currentReconPage = 1;
  loadReconciliationItems(1);
}

function handleReconSearch(event) {
  clearTimeout(reconSearchDebounceTimer);
  reconSearchDebounceTimer = setTimeout(() => {
    currentReconPage = 1;
    loadReconciliationItems(1);
  }, 350);
}

function changeReconPageSize(newSize) {
  currentReconPageSize = parseInt(newSize, 10);
  currentReconPage = 1;
  loadReconciliationItems(1);
}

async function openReconDetailModal(itemId) {
  try {
    const res = await authFetch(`/api/reconciliation/items/${itemId}`);
    if (!res.ok) return;
    const json = await res.json();
    const item = json.data;

    document.getElementById('modal-recon-item-id').value = item.id;
    document.getElementById('modal-recon-ref').innerText = item.golden_reference;

    // Status Banner
    const badgeEl = document.getElementById('modal-recon-badge');
    badgeEl.className = `recon-badge badge-${item.recon_status.toLowerCase()}`;
    badgeEl.innerText = item.recon_status.replace(/_/g, ' ');

    let desc = '';
    if (item.recon_status === 'MATCH_CLEAN') desc = 'Fully reconciled across Ticketing, Middleware, and Payment Gateway with zero dispute.';
    else if (item.recon_status === 'MATCH_PENDING') desc = 'Payment recorded in PG but funds settlement is currently pending.';
    else if (item.recon_status === 'DISPUTE_UNSETTLED') desc = 'Ticket sold in HRTS, but no payment was captured in Payment Gateway (Potential Revenue Leakage).';
    else if (item.recon_status === 'DISPUTE_ORPHAN_PAID') desc = 'Customer paid via Payment Gateway, but ticket was NOT issued in HRTS (Customer Dispute Risk).';
    else if (item.recon_status === 'DISPUTE_AMOUNT_MISMATCH') desc = 'Transaction reference matches, but nominal amount differs between ticketing and gateway settlement.';
    else if (item.recon_status === 'MW_ORPHAN') desc = 'Transaction routed through middleware but aborted before ticketing or PG settlement.';
    document.getElementById('modal-recon-desc').innerText = desc;

    document.getElementById('modal-recon-variance').innerText = formatIDR(item.amount_variance || 0);

    // Layer 1: HRTS
    const hrtsBadge = document.getElementById('modal-hrts-present-badge');
    if (item.has_hrts) {
      hrtsBadge.className = 'layer-badge present';
      hrtsBadge.innerText = 'Found';
    } else {
      hrtsBadge.className = 'layer-badge missing';
      hrtsBadge.innerText = 'Missing';
    }
    document.getElementById('modal-hrts-order').innerText = item.hrts_order_no || '-';
    document.getElementById('modal-hrts-tickets').innerText = item.hrts_ticket_count ? `${item.hrts_ticket_count} Tickets` : '-';
    document.getElementById('modal-hrts-station').innerText = item.hrts_station || '-';
    document.getElementById('modal-hrts-time').innerText = item.hrts_trade_time ? formatDate(item.hrts_trade_time) : '-';
    document.getElementById('modal-hrts-fare').innerText = formatIDR(item.hrts_amount);

    // Layer 2: Middleware
    const mwBadge = document.getElementById('modal-mw-present-badge');
    if (item.has_middleware) {
      mwBadge.className = 'layer-badge present';
      mwBadge.innerText = 'Logged';
    } else {
      mwBadge.className = 'layer-badge missing';
      mwBadge.innerText = 'Not Logged';
    }
    document.getElementById('modal-mw-order').innerText = item.mw_order_id || '-';
    document.getElementById('modal-mw-channel').innerText = item.mw_channel || '-';
    document.getElementById('modal-mw-time').innerText = item.mw_transaction_time ? formatDate(item.mw_transaction_time) : '-';
    document.getElementById('modal-mw-fee').innerText = formatIDR(item.mw_fee);
    document.getElementById('modal-mw-amount').innerText = formatIDR(item.mw_amount);

    // Layer 3: PG
    const pgBadge = document.getElementById('modal-pg-present-badge');
    if (item.has_pg) {
      pgBadge.className = 'layer-badge present';
      pgBadge.innerText = 'Settled / Captured';
    } else {
      pgBadge.className = 'layer-badge missing';
      pgBadge.innerText = 'No PG Record';
    }
    document.getElementById('modal-pg-provider').innerText = `${item.provider || '-'} (${item.payment_channel || '-'})`;
    document.getElementById('modal-pg-trx').innerText = item.pg_trx_id || '-';
    document.getElementById('modal-pg-status').innerText = item.pg_settlement_status || '-';
    document.getElementById('modal-pg-fee').innerText = formatIDR(item.pg_fee_amount);
    document.getElementById('modal-pg-net').innerText = formatIDR(item.pg_net_amount);

    // Resolution Form
    document.getElementById('modal-resolution-status').value = item.resolution_status || 'UNRESOLVED';
    document.getElementById('modal-resolution-notes').value = item.resolution_notes || '';

    document.getElementById('recon-detail-modal').classList.remove('hidden');
  } catch (err) {
    console.error('Error openReconDetailModal:', err);
  }
}

function closeReconDetailModal() {
  document.getElementById('recon-detail-modal').classList.add('hidden');
}

async function submitItemResolution() {
  const itemId = document.getElementById('modal-recon-item-id').value;
  const resolutionStatus = document.getElementById('modal-resolution-status').value;
  const resolutionNotes = document.getElementById('modal-resolution-notes').value;

  if (!itemId) return;

  try {
    const res = await authFetch(`/api/reconciliation/items/${itemId}/resolution`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resolutionStatus, resolutionNotes }),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Failed to update resolution.');
    }

    closeReconDetailModal();
    loadReconciliationItems(currentReconPage);
  } catch (err) {
    console.error('Error submitItemResolution:', err);
    alert('Resolution Error: ' + err.message);
  }
}

function exportReconciliationCsv() {
  const statusFilter = document.getElementById('recon-filter-status')?.value || '';
  const providerFilter = document.getElementById('recon-filter-provider')?.value || '';
  const resolutionFilter = document.getElementById('recon-filter-resolution')?.value || '';

  const params = new URLSearchParams();
  if (currentReconBatchId) params.append('batchId', currentReconBatchId);
  if (statusFilter) params.append('reconStatus', statusFilter);
  if (providerFilter && providerFilter !== 'ALL') params.append('provider', providerFilter);
  if (resolutionFilter) params.append('resolutionStatus', resolutionFilter);

  // Trigger download with auth token in headers via fetch blob
  const token = localStorage.getItem('hpr_auth_token') || sessionStorage.getItem('hpr_auth_token');
  fetch(`/api/reconciliation/export?${params.toString()}`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  })
    .then(res => {
      if (!res.ok) throw new Error('Failed to generate CSV export.');
      return res.blob();
    })
    .then(blob => {
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `whoosh_reconciliation_${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    })
    .catch(err => {
      alert('Export Error: ' + err.message);
    });
}

