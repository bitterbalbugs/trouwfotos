/* app.js — Trouwfoto's selector */

// ── Category display names ────────────────────────────────────────────────────
const CATEGORY_NAMES = {
    "1_Getting_ready":        "Getting ready",
    "2_First_look_grouppics": "First look & groepsfoto's",
    "3_Fotomoment":           "Fotomoment",
    "4_Lunch_ontvangst":      "Lunch & ontvangst",
    "5_Ceremonie":            "Ceremonie",
    "6_Toast_taart":          "Toast & taart",
    "7_Diner":                "Diner",
    "8_Lets_party":           "Let's party",
};

function catName(folder) {
    return CATEGORY_NAMES[folder] || folder;
}

// ── State ─────────────────────────────────────────────────────────────────────
const state = {
    user: null,
    currentView: null,
    currentCategory: null,
    allPhotos: [],      // all photos for current category
    selections: {},     // {photo_id: bool} — current user's decisions
    currentIndex: 0,    // index into allPhotos
    animating: false,   // guard against double-taps during card fly-out
};

// ── DOM Helpers ───────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);
const show = (id) => $(id).classList.remove('hidden');
const hide = (id) => $(id).classList.add('hidden');
const setText = (id, t) => { $(id).textContent = t; };

// ── API ───────────────────────────────────────────────────────────────────────
async function apiGet(path) {
    const r = await fetch(path);
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return r.json();
}

async function apiPost(path, body) {
    const r = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
    return r.json();
}

async function apiDelete(path) {
    const r = await fetch(path, { method: 'DELETE' });
    if (!r.ok) throw new Error(`DELETE ${path} → ${r.status}`);
    return r.json();
}

// ── Header ────────────────────────────────────────────────────────────────────
function updateHeader(view) {
    if (view === 'view-landing') {
        hide('app-header');
        return;
    }
    show('app-header');
    hide('header-progress');

    if (view === 'view-overview') {
        hide('btn-back');
        setText('header-title', "Trouwfoto's");
    } else if (view === 'view-swipe') {
        show('btn-back');
        setText('header-title', catName(state.currentCategory || ''));
        show('header-progress');
    } else if (view === 'view-review') {
        show('btn-back');
        setText('header-title', 'Selectie');
    }

    $('btn-user').textContent = state.user ? state.user[0].toUpperCase() : '?';
}

// ── View Management ───────────────────────────────────────────────────────────
const ALL_VIEWS = ['view-landing', 'view-overview', 'view-swipe', 'view-review'];

function showView(viewId) {
    ALL_VIEWS.forEach(v => $(v).classList.toggle('hidden', v !== viewId));
    state.currentView = viewId;
    updateHeader(viewId);
}

// ── Landing ───────────────────────────────────────────────────────────────────
function initLanding() {
    showView('view-landing');
}

document.querySelectorAll('.user-card').forEach(btn => {
    btn.addEventListener('click', () => selectUser(btn.dataset.user));
});

function selectUser(user) {
    state.user = user;
    localStorage.setItem('user', user);
    window.location.hash = '#overview';
}

// ── User Switch Sheet ─────────────────────────────────────────────────────────
function openUserSheet() {
    const sheet = $('user-sheet');
    sheet.classList.remove('hidden');
    sheet.querySelectorAll('.sheet-user-btn').forEach(btn => {
        btn.classList.toggle('current', btn.dataset.user === state.user);
    });
}

function closeUserSheet() {
    $('user-sheet').classList.add('hidden');
}

$('btn-user').addEventListener('click', openUserSheet);
$('sheet-cancel').addEventListener('click', closeUserSheet);
$('sheet-backdrop').addEventListener('click', closeUserSheet);

document.querySelectorAll('.sheet-user-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        closeUserSheet();
        if (btn.dataset.user !== state.user) {
            selectUser(btn.dataset.user);
        }
    });
});

// ── Overview ──────────────────────────────────────────────────────────────────
async function initOverview() {
    showView('view-overview');
    const list = $('category-list');
    list.innerHTML = '<div class="loading">Laden…</div>';

    try {
        const cats = await apiGet(`api/categories?user=${state.user}`);
        renderCategoryList(cats);
    } catch (e) {
        list.innerHTML = '<div class="error">Kon categorieën niet laden.</div>';
        console.error(e);
    }
}

function renderCategoryList(cats) {
    const list = $('category-list');
    list.innerHTML = '';

    cats.forEach(cat => {
        const pct = cat.total > 0 ? (cat.swiped / cat.total) * 100 : 0;
        const done = cat.remaining === 0 && cat.total > 0;
        const noPhotos = cat.total === 0;

        const card = document.createElement('div');
        card.className = `category-card${done ? ' done' : ''}`;
        card.innerHTML = `
            <div class="cat-info">
                <div class="cat-name">${catName(cat.name)}</div>
                <div class="cat-count">
                    ${noPhotos ? 'Geen foto\'s' : `
                        <span class="cat-kept">✓ ${cat.kept}</span>
                        <span class="cat-rejected">✕ ${cat.rejected}</span>
                        ${cat.remaining > 0 ? `<span class="cat-remaining">· ${cat.remaining} over</span>` : ''}
                    `}
                </div>
            </div>
            ${done
                ? '<div class="cat-done-icon">✓</div>'
                : noPhotos ? '' : '<div class="cat-arrow">›</div>'
            }
            <div class="cat-progress-bar">
                <div class="cat-progress-fill" style="width:${pct}%"></div>
            </div>
        `;

        if (!noPhotos) {
            card.addEventListener('click', () => {
                window.location.hash = '#swipe/' + encodeURIComponent(cat.name);
            });
        }

        list.appendChild(card);
    });
}

$('btn-review').addEventListener('click', () => {
    window.location.hash = '#review';
});

// ── Swipe ─────────────────────────────────────────────────────────────────────
async function initSwipe(category) {
    state.currentCategory = category;
    state.allPhotos = [];
    state.selections = {};
    state.currentIndex = 0;
    state.animating = false;

    showView('view-swipe');
    hide('photo-card');
    hide('card-empty');
    show('card-loading');
    $('thumb-strip').innerHTML = '';

    const card = $('photo-card');
    card.style.transition = '';
    card.style.transform = '';
    card.style.opacity = '1';
    $('hint-keep').style.opacity = 0;
    $('hint-skip').style.opacity = 0;

    try {
        const [photos, allSels] = await Promise.all([
            apiGet(`api/photos?category=${encodeURIComponent(category)}`),
            apiGet(`api/selections?user=${state.user}`),
        ]);

        state.allPhotos = photos;

        const catIds = new Set(photos.map(p => p.id));
        allSels
            .filter(s => catIds.has(s.photo_id))
            .forEach(s => { state.selections[s.photo_id] = s.choice; });

        const firstUndecided = photos.findIndex(p => !(p.id in state.selections));
        state.currentIndex = firstUndecided >= 0 ? firstUndecided : 0;

        hide('card-loading');

        if (photos.length === 0) {
            show('card-empty');
        } else {
            buildThumbStrip();
            showPhoto(state.currentIndex, false);
        }
    } catch (e) {
        $('card-loading').textContent = 'Kon foto\'s niet laden.';
        console.error(e);
    }
}

// Build the full thumbnail strip (called once on load)
function buildThumbStrip() {
    const strip = $('thumb-strip');
    strip.innerHTML = '';

    state.allPhotos.forEach((photo, i) => {
        const item = document.createElement('div');
        item.className = 'thumb-item';
        item.dataset.index = i;
        applyThumbState(item, i);
        item.addEventListener('click', () => navigateToPhoto(i));
        strip.appendChild(item);
    });
}

// Update a single thumbnail's visual state (active border, decision overlay)
function applyThumbState(item, index) {
    const photo = state.allPhotos[index];
    const isActive = index === state.currentIndex;
    const decided = photo.id in state.selections;
    const choice = state.selections[photo.id];

    item.className = `thumb-item${isActive ? ' active' : ''}`;
    item.innerHTML = `
        <img src="${photo.thumbnail_url}" alt="" loading="lazy">
        ${decided
            ? `<div class="thumb-overlay ${choice ? 'thumb-keep' : 'thumb-reject'}">${choice ? '✓' : '✕'}</div>`
            : ''}
    `;
}

function refreshThumb(index) {
    const strip = $('thumb-strip');
    const item = strip.children[index];
    if (item) applyThumbState(item, index);
}

function updateActiveThumb(oldIndex, newIndex) {
    const strip = $('thumb-strip');
    if (strip.children[oldIndex]) applyThumbState(strip.children[oldIndex], oldIndex);
    if (strip.children[newIndex]) applyThumbState(strip.children[newIndex], newIndex);
}

function scrollThumbTo(index, smooth = true) {
    const strip = $('thumb-strip');
    const item = strip.children[index];
    if (!item) return;
    item.scrollIntoView({ inline: 'center', block: 'nearest', behavior: smooth ? 'smooth' : 'instant' });
}

// Show a specific photo (by index) without any swipe animation
function showPhoto(index, scrollSmooth = true) {
    if (state.allPhotos.length === 0) return;

    const photo = state.allPhotos[index];
    const img = $('card-img');
    img.src = photo.thumbnail_url;
    img.dataset.originalUrl = photo.original_url;

    show('photo-card');
    hide('card-empty');

    updateActiveThumb(state.currentIndex, index);
    state.currentIndex = index;
    scrollThumbTo(index, scrollSmooth);
    updateProgress();

    // Preload neighbours
    [index - 1, index + 1].forEach(i => {
        if (state.allPhotos[i]) {
            const pre = new Image();
            pre.src = state.allPhotos[i].thumbnail_url;
        }
    });
}

// Navigate directly to a photo via thumbnail tap
function navigateToPhoto(index) {
    if (index === state.currentIndex) return;

    const card = $('photo-card');
    card.style.transition = '';
    card.style.transform = '';
    card.style.opacity = '1';
    $('hint-keep').style.opacity = 0;
    $('hint-skip').style.opacity = 0;

    showPhoto(index);
}

function updateProgress() {
    const total = state.allPhotos.length;
    const decided = Object.keys(state.selections).length;
    setText('header-progress', `${decided} / ${total}`);
}

// Find next undecided photo, searching forward from fromIndex (wrapping)
function findNextUndecided(fromIndex) {
    const n = state.allPhotos.length;
    for (let i = 1; i < n; i++) {
        const idx = (fromIndex + i) % n;
        if (!(state.allPhotos[idx].id in state.selections)) return idx;
    }
    return -1; // all decided
}

async function commitSwipe(choice) {
    if (state.allPhotos.length === 0 || state.animating) return;
    state.animating = true;

    const photo = state.allPhotos[state.currentIndex];
    const prevIndex = state.currentIndex;

    // Update local state immediately
    state.selections[photo.id] = choice;
    refreshThumb(prevIndex);
    updateProgress();

    // Fire API in background
    apiPost('api/selections', { photo_id: photo.id, user: state.user, choice }).catch(console.error);

    // Animate card out
    const card = $('photo-card');
    const dir = choice ? 1 : -1;
    card.style.transition = 'transform 0.26s ease-out, opacity 0.26s ease-out';
    card.style.transform = `translateX(${dir * 110}%) rotate(${dir * 16}deg)`;
    card.style.opacity = '0';

    const nextIndex = findNextUndecided(prevIndex);

    setTimeout(() => {
        card.style.transition = '';
        card.style.transform = '';
        card.style.opacity = '1';
        $('hint-keep').style.opacity = 0;
        $('hint-skip').style.opacity = 0;
        state.animating = false;

        if (nextIndex !== -1) {
            showPhoto(nextIndex);
        } else {
            // All decided — stay on current photo, let user browse via strip
            showPhoto(prevIndex);
        }
    }, 270);
}

$('btn-keep').addEventListener('click', () => commitSwipe(true));
$('btn-reject').addEventListener('click', () => commitSwipe(false));

// ── Swipe Gesture ─────────────────────────────────────────────────────────────
(function setupSwipeGestures() {
    const card = $('photo-card');
    let drag = { active: false, startX: 0, startY: 0, dx: 0, decided: false };

    const THRESHOLD = 90;

    function onStart(x, y) {
        drag = { active: true, startX: x, startY: y, dx: 0, decided: false };
    }

    function onMove(x, y) {
        if (!drag.active) return;

        const dx = x - drag.startX;
        const dy = y - drag.startY;

        // Determine axis on first significant movement
        if (!drag.decided && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
            drag.decided = true;
            drag.horizontal = Math.abs(dx) > Math.abs(dy);
        }

        if (!drag.decided || !drag.horizontal) return;

        drag.dx = dx;
        const rotation = dx * 0.07;
        card.style.transform = `translateX(${dx}px) rotate(${rotation}deg)`;

        const pct = Math.min(Math.abs(dx) / THRESHOLD, 1);
        if (dx > 0) {
            $('hint-keep').style.opacity = pct * 0.9;
            $('hint-skip').style.opacity = 0;
        } else {
            $('hint-skip').style.opacity = pct * 0.9;
            $('hint-keep').style.opacity = 0;
        }
    }

    function onEnd(wasClick) {
        if (!drag.active) return;
        drag.active = false;

        if (wasClick || (!drag.decided || !drag.horizontal)) {
            // Tap → open zoom
            const url = $('card-img').dataset.originalUrl;
            if (url) openZoom(url);
            snapBack();
            return;
        }

        if (Math.abs(drag.dx) >= THRESHOLD) {
            commitSwipe(drag.dx > 0);
        } else {
            snapBack();
        }
    }

    function snapBack() {
        card.style.transition = 'transform 0.25s ease, opacity 0.25s ease';
        card.style.transform = '';
        $('hint-keep').style.opacity = 0;
        $('hint-skip').style.opacity = 0;
        setTimeout(() => { card.style.transition = ''; }, 260);
    }

    function onCancel() {
        drag.active = false;
        snapBack();
    }

    // Touch
    card.addEventListener('touchstart', e => {
        onStart(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: true });

    card.addEventListener('touchmove', e => {
        onMove(e.touches[0].clientX, e.touches[0].clientY);
        // Prevent page scroll when dragging horizontally
        if (drag.decided && drag.horizontal) e.preventDefault();
    }, { passive: false });

    card.addEventListener('touchend', e => {
        const wasTap = !drag.decided || !drag.horizontal;
        onEnd(wasTap);
    }, { passive: true });

    card.addEventListener('touchcancel', onCancel, { passive: true });

    // Mouse (desktop testing)
    card.addEventListener('mousedown', e => {
        onStart(e.clientX, e.clientY);
        e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
        if (drag.active) onMove(e.clientX, e.clientY);
    });
    document.addEventListener('mouseup', e => {
        if (!drag.active) return;
        const wasTap = !drag.decided || !drag.horizontal;
        onEnd(wasTap);
    });
})();

// ── Review ────────────────────────────────────────────────────────────────────
async function initReview() {
    showView('view-review');

    // Load summary
    try {
        const s = await apiGet('api/summary');
        setText('stat-both', s.both_yes);
        setText('stat-m', s.martijn_only_yes);
        setText('stat-r', s.rosalie_only_yes);
    } catch (e) {
        console.error(e);
    }

    // Activate "both" tab by default
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === 'both'));
    loadReviewTab('both');
}

async function loadReviewTab(tab) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));

    const grid = $('review-grid');
    grid.innerHTML = '<div class="loading">Laden…</div>';

    try {
        const endpoint = tab === 'both' ? 'api/review/both' : 'api/review/discuss';
        const photos = await apiGet(endpoint);
        renderReviewGrid(photos, tab);
    } catch (e) {
        grid.innerHTML = '<div class="error">Kon foto\'s niet laden.</div>';
        console.error(e);
    }
}

function renderReviewGrid(photos, tab) {
    const grid = $('review-grid');

    if (photos.length === 0) {
        grid.innerHTML = `<div class="empty-grid">${
            tab === 'both' ? 'Nog geen foto\'s door beiden geselecteerd.' : 'Niets te bespreken.'
        }</div>`;
        return;
    }

    grid.innerHTML = '';
    let lastCat = null;

    photos.forEach(photo => {
        if (photo.category !== lastCat) {
            const h = document.createElement('div');
            h.className = 'grid-category-header';
            h.textContent = catName(photo.category);
            grid.appendChild(h);
            lastCat = photo.category;
        }

        const item = document.createElement('div');
        item.className = 'grid-item';
        item.innerHTML = `<img src="${photo.thumbnail_url}" alt="${photo.filename}" loading="lazy">${
            tab === 'discuss'
                ? `<div class="who-badge who-${photo.who}">${photo.who[0].toUpperCase()}</div>`
                : ''
        }`;
        item.addEventListener('click', () => openZoom(photo.original_url));
        grid.appendChild(item);
    });
}

document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => loadReviewTab(btn.dataset.tab));
});

// ── Zoom Modal ────────────────────────────────────────────────────────────────
function openZoom(url) {
    $('zoom-img').src = url;
    $('zoom-modal').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function closeZoom() {
    $('zoom-modal').classList.add('hidden');
    $('zoom-img').src = '';
    document.body.style.overflow = '';
}

$('btn-zoom-close').addEventListener('click', closeZoom);
$('zoom-modal').addEventListener('click', e => {
    if (e.target === $('zoom-modal') || e.target.classList.contains('zoom-img-container')) {
        closeZoom();
    }
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeZoom(); });

// ── Back Button ───────────────────────────────────────────────────────────────
$('btn-back').addEventListener('click', () => {
    window.location.hash = '#overview';
});

// ── Router ────────────────────────────────────────────────────────────────────
function route() {
    state.user = localStorage.getItem('user');

    if (!state.user) {
        initLanding();
        return;
    }

    const hash = window.location.hash;
    if (hash.startsWith('#swipe/')) {
        const cat = decodeURIComponent(hash.slice(7));
        initSwipe(cat);
    } else if (hash === '#review') {
        initReview();
    } else {
        initOverview();
    }
}

window.addEventListener('hashchange', route);
route();
