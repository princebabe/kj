/* admin.js – Shared admin panel utilities */
'use strict';

const API_BASE = ''; // paths include /api already
let _currentUser = null;

// ─── Auth ──────────────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem('admin_token'); }
function setToken(t) { localStorage.setItem('admin_token', t); }
function clearAuth() { localStorage.removeItem('admin_token'); localStorage.removeItem('admin_user'); }

function getUser() {
  try { return JSON.parse(localStorage.getItem('admin_user') || 'null'); } catch { return null; }
}
function setUser(u) { localStorage.setItem('admin_user', JSON.stringify(u)); }

function requireAuth() {
  const token = getToken();
  const user  = getUser();
  if (!token || !user) {
    window.location.href = '/admin/index.html';
    return false;
  }
  if (!['admin', 'superadmin'].includes(user.role)) {
    showToast('Access denied: admin role required', 'error');
    clearAuth();
    setTimeout(() => window.location.href = '/admin/index.html', 1500);
    return false;
  }
  _currentUser = user;
  return true;
}

function logout() {
  clearAuth();
  window.location.href = '/admin/index.html';
}

// ─── API Client ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${getToken()}`,
    },
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${path}`, opts);
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    clearAuth();
    window.location.href = '/admin/index.html';
    return null;
  }
  if (!res.ok) {
    const msg = data.error || data.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

const GET    = (path)       => api('GET',    path);
const POST   = (path, body) => api('POST',   path, body);
const PUT    = (path, body) => api('PUT',    path, body);
const PATCH  = (path, body) => api('PATCH',  path, body);
const DELETE = (path)       => api('DELETE', path);

// ─── Toast / Notification ──────────────────────────────────────────────────────
let toastContainer;
function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, type = 'info', duration = 3500) {
  const icons = { success: 'fa-check-circle', error: 'fa-circle-xmark', info: 'fa-info-circle', warning: 'fa-triangle-exclamation' };
  const colors = { success: '#34d399', error: '#f87171', info: '#60a5fa', warning: '#fbbf24' };
  const c = ensureToastContainer();

  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.innerHTML = `
    <i class="fas ${icons[type] || 'fa-info-circle'} toast-icon" style="color:${colors[type]}"></i>
    <span>${message}</span>`;
  c.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 500); }, duration);
}

// ─── Confirm dialog ────────────────────────────────────────────────────────────
function showConfirm(message, title = 'Confirm Action') {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <h3 style="margin-bottom:12px;font-size:16px">${title}</h3>
        <p style="color:var(--text2);font-size:13px;margin-bottom:20px">${message}</p>
        <div style="display:flex;justify-content:flex-end;gap:10px">
          <button class="btn btn-secondary" id="confirm-cancel">Cancel</button>
          <button class="btn btn-danger" id="confirm-ok">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('open'));
    const close = (val) => {
      overlay.classList.remove('open');
      setTimeout(() => overlay.remove(), 300);
      resolve(val);
    };
    overlay.querySelector('#confirm-ok').addEventListener('click', () => close(true));
    overlay.querySelector('#confirm-cancel').addEventListener('click', () => close(false));
  });
}

// ─── Modal helpers ─────────────────────────────────────────────────────────────
function openModal(id)  { document.getElementById(id).classList.add('open'); }
function closeModal(id) { document.getElementById(id).classList.remove('open'); }
function setupModalClose(id) {
  const overlay = document.getElementById(id);
  if (!overlay) return;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(id); });
  overlay.querySelector('.modal-close')?.addEventListener('click', () => closeModal(id));
}

// ─── Sidebar navigation ────────────────────────────────────────────────────────
function initSidebar() {
  const current = window.location.pathname.split('/').pop().replace('.html','');
  document.querySelectorAll('.nav-item').forEach(el => {
    const href = el.getAttribute('href') || '';
    if (href.includes(current) || (current === '' && href.includes('dashboard'))) {
      el.classList.add('active');
    }
  });

  const user = getUser();
  if (user) {
    const initials = user.email.substring(0,2).toUpperCase();
    const nameEl   = document.getElementById('sidebar-user-name');
    const roleEl   = document.getElementById('sidebar-user-role');
    const avatarEl = document.getElementById('sidebar-avatar');
    if (nameEl)   nameEl.textContent = user.email;
    if (roleEl)   roleEl.textContent = user.role;
    if (avatarEl) avatarEl.textContent = initials;
  }

  // Mobile toggle
  const burger = document.getElementById('sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  burger?.addEventListener('click', () => sidebar.classList.toggle('open'));

  document.getElementById('logout-btn')?.addEventListener('click', logout);
}

// ─── Format helpers ────────────────────────────────────────────────────────────
function fmtDate(str) {
  if (!str) return '—';
  const d = new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function fmtDateTime(str) {
  if (!str) return '—';
  const d = new Date(str.includes('T') ? str : str.replace(' ', 'T') + 'Z');
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtNum(n) {
  if (n === null || n === undefined) return '0';
  if (n >= 1e6) return (n/1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n/1e3).toFixed(1) + 'K';
  return String(n);
}

function statusBadge(status) {
  const map = { active:'success', banned:'danger', suspended:'warning', expired:'gray' };
  return `<span class="badge badge-${map[status]||'gray'}">${status}</span>`;
}
function roleBadge(role) {
  const map = { superadmin:'danger', admin:'warning', user:'brand' };
  return `<span class="badge badge-${map[role]||'gray'}">${role}</span>`;
}

// ─── Pagination builder ────────────────────────────────────────────────────────
function buildPagination(page, total, limit, onPage) {
  const totalPages = Math.ceil(total / limit) || 1;
  const el = document.createElement('div');
  el.className = 'pagination';
  el.innerHTML = `
    <span>Showing ${Math.min((page-1)*limit+1, total)}–${Math.min(page*limit,total)} of ${total}</span>
    <div class="pagination-btns">
      <button class="btn btn-secondary btn-sm" ${page<=1?'disabled':''} data-p="${page-1}">← Prev</button>
      <button class="btn btn-secondary btn-sm" ${page>=totalPages?'disabled':''} data-p="${page+1}">Next →</button>
    </div>`;
  el.querySelectorAll('button[data-p]').forEach(b => {
    b.addEventListener('click', () => onPage(parseInt(b.dataset.p)));
  });
  return el;
}

// ─── Mini bar chart (canvas-based, no dependencies) ───────────────────────────
function drawBarChart(canvas, data, label) {
  const ctx  = canvas.getContext('2d');
  const W = canvas.offsetWidth || canvas.parentElement.offsetWidth || 400;
  const H = canvas.offsetHeight || 220;
  canvas.width  = W * devicePixelRatio;
  canvas.height = H * devicePixelRatio;
  ctx.scale(devicePixelRatio, devicePixelRatio);

  if (!data || !data.length) {
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.font = '13px Inter, sans-serif';
    ctx.fillText('No data yet', W/2 - 40, H/2);
    return;
  }

  const maxVal = Math.max(...data.map(d => d.count), 1);
  const pad = { t: 20, r: 10, b: 40, l: 40 };
  const chartW = W - pad.l - pad.r;
  const chartH = H - pad.t - pad.b;
  const barW   = Math.max(8, (chartW / data.length) - 6);

  // Grid lines
  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (chartH / 4) * i;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.font = '10px Inter, sans-serif';
    ctx.fillText(Math.round(maxVal * (1 - i/4)), 4, y + 4);
  }

  // Bars
  const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + chartH);
  grad.addColorStop(0, 'rgba(108,99,245,0.8)');
  grad.addColorStop(1, 'rgba(168,85,247,0.3)');

  data.forEach((d, i) => {
    const barH  = (d.count / maxVal) * chartH;
    const x     = pad.l + (chartW / data.length) * i + (chartW / data.length - barW) / 2;
    const y     = pad.t + chartH - barH;

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, [4, 4, 0, 0]);
    ctx.fill();

    // X label
    ctx.fillStyle = 'rgba(255,255,255,0.3)';
    ctx.font = '9px Inter, sans-serif';
    ctx.fillText(d.day ? d.day.slice(5) : i+1, x + barW/2 - 10, H - pad.b + 14);
  });
}

// ─── Init page ─────────────────────────────────────────────────────────────────
function initPage() {
  if (!requireAuth()) return false;
  initSidebar();
  return true;
}
