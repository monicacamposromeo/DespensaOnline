/* ==========================================================================
   DespensaOnline - UI Helpers & Utility Methods
   ========================================================================== */

function setLoading(active) {
    if (active) {
        DOM.loadingSpinner.classList.add('active');
    } else {
        DOM.loadingSpinner.classList.remove('active');
    }
}

function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatCantidad(cantidad, unidad) {
    const n = parseFloat(cantidad) || 0;
    const formatted = Number.isInteger(n) ? n : round2(n);
    return `${formatted} ${unidad || ''}`.trim();
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const parts = dateStr.split('-');
    if (parts.length < 3) return dateStr;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function todayISO() {
    return formatISODate(new Date());
}

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
    // Evita toasts repetidos si se disparan dentro del mismo segundo con el mismo mensaje
    if (window.lastToastMessage === message && Date.now() - (window.lastToastTime || 0) < 1000) {
        return;
    }
    window.lastToastMessage = message;
    window.lastToastTime = Date.now();

    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';

    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${escapeHtml(message)}</span>
    `;

    container.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 250);
    }, 2200);
}
