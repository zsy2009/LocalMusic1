/* ─────────────────────────────────────────────────────────────────
 * MusicCloud – Enhanced Vanilla JS Frontend
 * Features: Search, Play Modes, Prev/Next, Animations
 * ──────────────────────────────────────────────────────────────── */

const API_BASE = "";  // same-origin — no cross-origin prefix needed

// ── Service Worker — purge old caches then re‑register ──────────
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then(function(registrations) {
        for(let registration of registrations) {
            registration.unregister();
        }
    });
    // Delay 1 s so old SW is fully evicted before re‑registering
    setTimeout(() => {
        navigator.serviceWorker.register('sw.js').catch(err => console.log('SW 注册失败:', err));
    }, 1000);
}

/* ── DOM refs ──────────────────────────────────────────────────── */
const loginPanel  = document.getElementById("login-panel");
const playerPanel = document.getElementById("player-panel");
const loginError  = document.getElementById("login-error");

const coverImg    = document.getElementById("cover-img");
const songTitle   = document.getElementById("song-title");
const artistList  = document.getElementById("artist-list");
const songAlbum   = document.getElementById("song-album");
const audioPlayer = document.getElementById("audio-player");
audioPlayer.crossOrigin = "anonymous";

// ── Web Audio API (spectrum visualizer) ─────────────────────────
let isVisualizerInit = false;
let audioCtx, analyser, audioSource;
const visCanvas   = document.getElementById("visualizer-canvas");
let visCanvasCtx = null;

const searchInput = document.getElementById("search-input");
const centerNav   = document.getElementById("center-nav");
const centerList  = document.getElementById("center-list");
const lyricsUL    = document.getElementById("lyrics-list");
const lyricsContainer = document.getElementById("lyrics-container");

// Custom Controls
const btnMode = document.getElementById("btn-mode");
const btnPrev = document.getElementById("btn-prev");
const btnNext = document.getElementById("btn-next");
const btnPlayPause = document.getElementById("btn-playpause");

// User profile
const userAvatar     = document.getElementById("user-avatar");
const userNickname   = document.getElementById("user-nickname");
const profileBtn     = document.getElementById("profile-btn");
const adminPanelBtn  = document.getElementById("admin-panel-btn");

// Profile modal
const profileModal   = document.getElementById("profile-modal");
const profileNick    = document.getElementById("profile-nickname");
const profileSaveBtn = document.getElementById("profile-save-btn");
const avatarUpload   = document.getElementById("avatar-upload");
const pwdOld         = document.getElementById("pwd-old");
const pwdNew         = document.getElementById("pwd-new");
const pwdConfirm     = document.getElementById("pwd-confirm");
const pwdSaveBtn     = document.getElementById("pwd-save-btn");
const profileMsg     = document.getElementById("profile-msg");
const profileClose   = document.getElementById("profile-close-btn");

// Admin modal
const adminModal     = document.getElementById("admin-modal");
const adminUsername  = document.getElementById("admin-username");
const adminPassword  = document.getElementById("admin-password");
const adminNickname  = document.getElementById("admin-nickname");
const adminRole      = document.getElementById("admin-role");
const adminCreateBtn = document.getElementById("admin-create-btn");
const adminMsg       = document.getElementById("admin-msg");
const adminClose     = document.getElementById("admin-close-btn");
const logoutBtn      = document.getElementById("logout-btn");

// Playlist modals
const plCreateModal  = document.getElementById("playlist-create-modal");
const plCreateName   = document.getElementById("new-playlist-name");
const plCreateConfirm= document.getElementById("playlist-create-confirm");
const plCreateMsg    = document.getElementById("playlist-create-msg");
const plCreateClose  = document.getElementById("playlist-create-close");
const plSelectModal  = document.getElementById("playlist-select-modal");
const plSelectClose  = document.getElementById("playlist-select-close");
const playerFavBtn   = document.getElementById("player-fav-btn");
const navFavorites   = document.getElementById("nav-favorites");

/* ── Global state ──────────────────────────────────────────────── */
let allSongsRaw = [];
let songMap = {};
let libraryTree = { root: [], folders: {} };
let currentFolderContext = "root";

let currentViewPlaylist = [];
let currentPlayingPlaylist = [];
let currentPlayingIndex = -1;
let currentSongId = null;

let lyricsData = [];
let currentLyricIndex = -1;
let lyricLineEls = [];
let mobileLyricLineEls = [];
let activeLyricEl = null;
let activeMobileLyricEl = null;
let lyricScrollFrame = 0;

// Playback Modes: 0=List Loop, 1=Single Loop, 2=Shuffle
const MODES = [
    { id: 0, icon: "🔁", title: "当前: 列表循环" },
    { id: 1, icon: "🔂", title: "当前: 单曲循环" },
    { id: 2, icon: "🔀", title: "当前: 随机播放" }
];
let currentModeIndex = 0;

// Playlists
let myPlaylists = [];
let songIdToAdd = null;

// Favorites & play stats
let myFavorites = new Set();
let playStatsTimer = null;

// View context tracking (for "locate current song" navigation)
let currentViewContext = { type: 'folder', value: 'root' };
let currentPlayingContext = null;
let currentPlayingSong = null;
const LAST_PLAYED_KEY = "musiccloud_last_played";

/* ── Auth helpers ──────────────────────────────────────────────── */
function getToken() { return localStorage.getItem("musiccloud_token"); }
function setToken(token) { localStorage.setItem("musiccloud_token", token); }
function authHeaders() { return { "Authorization": `Bearer ${getToken()}`, "Content-Type": "application/json" }; }

function serializePlaybackContext(context = currentViewContext) {
    if (!context) return { type: "folder", value: "root" };
    if (context.type === "playlist" && context.value) {
        return {
            type: "playlist",
            playlistId: context.value.PlaylistID,
            name: context.value.Name,
        };
    }
    return { type: context.type || "folder", value: context.value || "root" };
}

function saveLastPlayedSong(song) {
    if (!song || !song.SongID) return;

    const payload = {
        songId: song.SongID,
        context: serializePlaybackContext(currentViewContext),
        savedAt: Date.now(),
    };

    try {
        localStorage.setItem(LAST_PLAYED_KEY, JSON.stringify(payload));
    } catch (e) {
        console.warn("Failed to save last played song locally", e);
    }

    fetch(`${API_BASE}/api/users/me/last-played`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ song_id: song.SongID }),
    }).catch((e) => {
        console.warn("Failed to sync last played song", e);
    });
}

function getLastPlayedSongInfo() {
    try {
        const raw = localStorage.getItem(LAST_PLAYED_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (e) {
        return null;
    }
}

async function fetchLastPlayedSongInfo() {
    try {
        const resp = await fetch(`${API_BASE}/api/users/me/last-played`, {
            headers: authHeaders(),
        });
        if (resp.ok) {
            const data = await resp.json();
            if (data.song_id) return { songId: data.song_id, source: "server" };
        }
    } catch (e) {
        console.warn("Failed to fetch server last played song", e);
    }
    return getLastPlayedSongInfo();
}

function getSongListScroller() {
    const centerPanel = document.getElementById("center-panel");
    const centerListStyle = window.getComputedStyle(centerList);
    const centerPanelStyle = centerPanel ? window.getComputedStyle(centerPanel) : null;

    if (centerListStyle.overflowY !== "visible" && centerList.scrollHeight > centerList.clientHeight) {
        return centerList;
    }

    if (centerPanel && centerPanelStyle && centerPanelStyle.overflowY !== "visible" && centerPanel.scrollHeight > centerPanel.clientHeight) {
        return centerPanel;
    }

    return centerList;
}

function scrollSongRowIntoComfortView(row, { smooth = true } = {}) {
    if (!row) return;

    const scroller = getSongListScroller();
    if (!scroller) return;

    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    if (maxScroll <= 0) return;

    const scrollerRect = scroller.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const rowCenter = rowRect.top - scrollerRect.top + rowRect.height / 2;
    const targetTop = Math.min(
        maxScroll,
        Math.max(0, scroller.scrollTop + rowCenter - scroller.clientHeight / 2)
    );

    scroller.scrollTo({
        top: targetTop,
        behavior: smooth ? "smooth" : "auto",
    });
}

function updatePlayingRowHighlight(songId, { scroll = false, smooth = true } = {}) {
    document.querySelectorAll(".song-item.playing").forEach(el => el.classList.remove("playing"));
    if (!songId) return null;

    const activeRow = centerList.querySelector(`.song-item[data-songid="${songId}"]`);
    if (activeRow) {
        activeRow.classList.add("playing");
        if (scroll) {
            requestAnimationFrame(() => scrollSongRowIntoComfortView(activeRow, { smooth }));
        }
    }
    return activeRow;
}

function renderSongHome(song) {
    if (!song) return;
    renderDirectory(song.Folder || "root");
}

function flashSongRow(row) {
    if (!row) return;
    const originalBg = row.style.backgroundColor;
    row.style.transition = "background-color 0.3s";
    row.style.backgroundColor = "rgba(30, 215, 96, 0.4)";

    setTimeout(() => {
        row.style.backgroundColor = originalBg;
        row.style.transition = "";
    }, 800);
}

async function restoreLastPlayedSong() {
    const saved = await fetchLastPlayedSongInfo();
    if (!saved || !saved.songId) return;

    const song = songMap[Number(saved.songId)];
    if (!song) return;

    renderSongHome(song);

    currentPlayingPlaylist = [...currentViewPlaylist];
    currentPlayingIndex = currentPlayingPlaylist.findIndex(item => item.SongID === song.SongID);
    if (currentPlayingIndex < 0) currentPlayingIndex = 0;

    await playSong(song, { autoplay: false, save: false, smoothScroll: false });
    requestAnimationFrame(() => {
        const row = updatePlayingRowHighlight(song.SongID, { scroll: true, smooth: false });
        if (row) flashSongRow(row);
    });
}


/* ── Toast ─────────────────────────────────────────────────────── */
function showToast(msg, isError = false) {
    const toast = document.createElement("div");
    toast.className = "toast-msg" + (isError ? " error" : " success");
    toast.textContent = msg;
    Object.assign(toast.style, {
        position:"fixed", bottom:"100px", left:"50%", transform:"translateX(-50%)",
        padding:"10px 24px", borderRadius:"20px", fontSize:"14px", zIndex:"2000",
        background: isError ? "rgba(244,67,54,0.9)" : "rgba(30,215,96,0.9)",
        color:"#fff", backdropFilter:"blur(8px)", transition:"opacity .3s",
    });
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity="0"; setTimeout(() => toast.remove(), 300); }, 2500);
}

/* ── Favorites data ──────────────────────────────────────────────── */
async function fetchFavorites() {
    try {
        const resp = await fetch(`${API_BASE}/api/favorites`, { headers: authHeaders() });
        if (!resp.ok) return;
        const favs = await resp.json();
        myFavorites = new Set(favs.map(s => s.SongID));
    } catch (e) { console.error("fetchFavorites error:", e); }
}

function updatePlayerFavBtn() {
    if (currentSongId && myFavorites.has(currentSongId)) {
        playerFavBtn.textContent = "❤️";
        playerFavBtn.classList.add("is-fav");
    } else {
        playerFavBtn.textContent = "♡";
        playerFavBtn.classList.remove("is-fav");
    }
}

async function toggleFavorite(songId, btn) {
    try {
        const resp = await fetch(`${API_BASE}/api/favorites/${songId}`, {
            method: "POST", headers: authHeaders(),
        });
        if (!resp.ok) return;
        const data = await resp.json();

        // 1. 更新内存状态
        if (data.is_favorite) {
            myFavorites.add(songId);
        } else {
            myFavorites.delete(songId);
        }

        // 2. 更新触发点击的那个按钮自身
        if (btn) {
            btn.textContent = data.is_favorite ? "❤️" : "♡";
            btn.classList.toggle("is-fav", data.is_favorite);
        }

        // 3. 跨组件状态同步：如果在播放栏点击，需要同步更新列表视图中的红心
        const listRowFavBtn = document.querySelector(`.song-item[data-songid="${songId}"] .favorite-btn`);
        if (listRowFavBtn && listRowFavBtn !== btn) {
            listRowFavBtn.textContent = data.is_favorite ? "❤️" : "♡";
            listRowFavBtn.classList.toggle("is-fav", data.is_favorite);
        }

        // 4. 跨组件状态同步：如果在列表中点击的是当前正在播放的歌，需要同步底部播放栏
        if (songId === currentSongId) {
            updatePlayerFavBtn();
        }

    } catch (e) { console.error("toggleFavorite error:", e); }
}

/* ── Playlists data ────────────────────────────────────────────── */
async function fetchMyPlaylists() {
    try {
        const resp = await fetch(`${API_BASE}/api/playlists`, { headers: authHeaders() });
        if (!resp.ok) return;
        myPlaylists = await resp.json();
    } catch (e) { console.error("fetchMyPlaylists error:", e); }
}

/* ── Modal helpers ─────────────────────────────────────────────── */
function openModal(modal) { modal.classList.add("show"); }
function closeModal(modal) { modal.classList.remove("show"); }

// Click overlay to close
document.querySelectorAll(".modal").forEach(m => {
    m.addEventListener("click", (e) => { if (e.target === m) closeModal(m); });
});

// Prevent clicks inside modals from bubbling to document
if (profileModal) profileModal.addEventListener("click", (e) => e.stopPropagation());
if (adminModal) adminModal.addEventListener("click", (e) => e.stopPropagation());

// Global click to close any open modal
document.addEventListener("click", () => {
    if (profileModal) profileModal.classList.remove("show");
    if (adminModal) adminModal.classList.remove("show");
});

/* ── User profile ──────────────────────────────────────────────── */
async function loadUserProfile() {
    try {
        const resp = await fetch(`${API_BASE}/api/users/me`, { headers: authHeaders() });
        if (!resp.ok) return;
        const user = await resp.json();
        const nickname = user.Nickname || user.Username;
        const avatarUrl = user.AvatarUrl ? API_BASE + user.AvatarUrl : "";
        userNickname.textContent = nickname;
        profileNick.value = user.Nickname || "";
        userAvatar.src = avatarUrl;
        userProfile = user;  // make available globally for weather / location logic

        if (user.Role === "Admin") {
            adminPanelBtn.style.display = "flex";
            const syncBtn = document.getElementById("nav-sync-library");
            if (syncBtn) syncBtn.style.display = "block";
        }
        // Sync hover card
        const hoverAvatar = document.getElementById("hover-card-avatar");
        const hoverNick = document.getElementById("hover-card-nickname");
        if (hoverAvatar) hoverAvatar.src = avatarUrl;
        if (hoverNick) hoverNick.textContent = nickname;
    } catch (e) { console.error("loadUserProfile error:", e); }
}

// Open profile modal
profileBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (adminModal) adminModal.classList.remove("show");
    profileModal.classList.toggle("show");
});
profileClose.addEventListener("click", () => closeModal(profileModal));

// Save nickname
profileSaveBtn.addEventListener("click", async () => {
    const nick = profileNick.value.trim();
    if (!nick) return showToast("昵称不能为空", true);
    try {
        const resp = await fetch(`${API_BASE}/api/users/me/profile`, {
            method: "PUT", headers: authHeaders(),
            body: JSON.stringify({ nickname: nick }),
        });
        if (!resp.ok) throw new Error();
        userNickname.textContent = nick;
        showToast("昵称已更新");
    } catch (e) { showToast("更新失败", true); }
});

// Avatar upload
avatarUpload.addEventListener("change", async () => {
    const file = avatarUpload.files[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("avatar", file);
    try {
        const resp = await fetch(`${API_BASE}/api/users/me/avatar`, {
            method: "POST",
            headers: { "Authorization": `Bearer ${getToken()}` },
            body: formData,
        });
        if (!resp.ok) throw new Error();
        const data = await resp.json();
        userAvatar.src = API_BASE + data.avatar_url + "?t=" + Date.now();
        showToast("头像已更新");
    } catch (e) { showToast("上传失败", true); }
});

// Change password
pwdSaveBtn.addEventListener("click", async () => {
    const oldPwd = pwdOld.value;
    const newPwd = pwdNew.value;
    const confirm = pwdConfirm.value;
    profileMsg.className = "msg-text";

    if (!oldPwd || !newPwd || !confirm) {
        profileMsg.textContent = "请填写所有密码字段"; profileMsg.classList.add("error"); return;
    }
    if (newPwd !== confirm) {
        profileMsg.textContent = "两次新密码不一致"; profileMsg.classList.add("error"); return;
    }
    if (newPwd.length < 4) {
        profileMsg.textContent = "新密码至少 4 位"; profileMsg.classList.add("error"); return;
    }
    try {
        const resp = await fetch(`${API_BASE}/api/users/me/password`, {
            method: "PUT", headers: authHeaders(),
            body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            profileMsg.textContent = err.detail || "密码修改失败";
            profileMsg.classList.add("error");
            return;
        }
        profileMsg.textContent = "密码修改成功，请重新登录";
        profileMsg.classList.add("success");
        pwdOld.value = pwdNew.value = pwdConfirm.value = "";
        setTimeout(() => {
            localStorage.removeItem("musiccloud_token");
            location.reload();
        }, 1500);
    } catch (e) { profileMsg.textContent = "请求失败"; profileMsg.classList.add("error"); }
});

// Admin panel button
adminPanelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (profileModal) profileModal.classList.remove("show");
    adminModal.classList.toggle("show");
});
adminClose.addEventListener("click", () => closeModal(adminModal));

// Admin create user
adminCreateBtn.addEventListener("click", async () => {
    const username = adminUsername.value.trim();
    const password = adminPassword.value;
    const nickname = adminNickname.value.trim();
    const role = adminRole.value;
    adminMsg.className = "msg-text";

    if (!username || !password || !nickname) {
        adminMsg.textContent = "请填写所有字段"; adminMsg.classList.add("error"); return;
    }
    try {
        const resp = await fetch(`${API_BASE}/api/admin/users`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ username, password, nickname, role }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            adminMsg.textContent = err.detail || "创建失败";
            adminMsg.classList.add("error");
            return;
        }
        adminMsg.textContent = "用户创建成功";
        adminMsg.classList.add("success");
        adminUsername.value = adminPassword.value = adminNickname.value = "";
        adminRole.value = "User";
        showToast("用户创建成功");
    } catch (e) { adminMsg.textContent = "请求失败"; adminMsg.classList.add("error"); }
});

// Logout
logoutBtn.addEventListener("click", () => {
    localStorage.removeItem("musiccloud_token");
    window.location.reload();
});

// ── Stats modal ──────────────────────────────────────────────────
const viewStatsBtn = document.getElementById("view-stats-btn");
const statsModal = document.getElementById("stats-modal");
const statsContent = document.getElementById("stats-content");
const statsCloseBtn = document.getElementById("stats-close-btn");

function renderRankList(items, maxVal, labelFn) {
    return items.map((item, i) => `
        <div class="rank-item">
            <div class="rank-info">
                <span>${i + 1}. ${labelFn(item)}</span>
                <span>${item.play_count} 次</span>
            </div>
            <div class="rank-bar-bg">
                <div class="rank-bar-fill" style="width: ${(item.play_count / maxVal) * 100}%"></div>
            </div>
        </div>
    `).join('');
}

if (viewStatsBtn) {
    viewStatsBtn.addEventListener("click", async () => {
        statsModal.classList.add("show");
        statsContent.innerHTML = "正在拉取数据...";

        try {
            const res = await fetch(`${API_BASE}/api/stats/summary`, {
                headers: { "Authorization": `Bearer ${getToken()}` }
            });
            const data = await res.json();

            const songs = data.top_songs || [];
            const artists = data.top_artists || [];

            if (!songs.length && !artists.length) {
                statsContent.innerHTML = "<p>你还没有听过任何歌曲哦，快去听听看吧！</p>";
                return;
            }

            let html = '';

            if (songs.length) {
                const maxSong = songs[0].play_count || 1;
                html += `<h4 style="color: #aaa; margin-bottom: 12px;">👑 最爱单曲 Top ${songs.length}</h4>`;
                html += renderRankList(songs, maxSong, item => item.title);
            }

            if (artists.length) {
                const maxArtist = artists[0].play_count || 1;
                html += `<h4 style="color: #aaa; margin: 24px 0 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">🎤 最爱歌手 Top ${artists.length}</h4>`;
                html += renderRankList(artists, maxArtist, item => item.name);
            }

            statsContent.innerHTML = html;
        } catch (err) {
            statsContent.innerHTML = "<p style='color: red;'>获取统计数据失败</p>";
        }
    });
}

if (statsCloseBtn) {
    statsCloseBtn.addEventListener("click", () => closeModal(statsModal));
}

// ── Playlist create modal ────────────────────────────────────────
plCreateClose.addEventListener("click", () => closeModal(plCreateModal));
plCreateConfirm.addEventListener("click", async () => {
    const name = plCreateName.value.trim();
    plCreateMsg.className = "msg-text";
    if (!name) { plCreateMsg.textContent = "请输入歌单名称"; plCreateMsg.classList.add("error"); return; }
    try {
        const resp = await fetch(`${API_BASE}/api/playlists`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ name }),
        });
        if (!resp.ok) throw new Error();
        plCreateMsg.textContent = "创建成功"; plCreateMsg.classList.add("success");
        plCreateName.value = "";
        await fetchMyPlaylists();
        renderDirectory("root");
        setTimeout(() => closeModal(plCreateModal), 500);
    } catch (e) { plCreateMsg.textContent = "创建失败"; plCreateMsg.classList.add("error"); }
});

// ── Playlist select modal ────────────────────────────────────────
plSelectClose.addEventListener("click", () => closeModal(plSelectModal));

/* ── Shared player init ────────────────────────────────────────── */
function resetPlayerUI() {
    // Clear to transparent spacer — onerror will swap in fallback SVG
    coverImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    coverImg.classList.add("fallback-cover");
    coverImg.classList.remove("is-playing");
    songTitle.textContent = "未播放任何内容";
    songAlbum.textContent = "探索你的音乐库";
    songAlbum.onclick = null;
    artistList.innerHTML = "";
    currentSongId = null;
    document.getElementById("left-panel").classList.add("idle-state");
}

async function initPlayer() {
    loginPanel.style.display = "none";
    playerPanel.style.display = "block";
    resetPlayerUI();
    await loadUserProfile();
    await loadLibrary();
    await restoreLastPlayedSong();

    // 强制修正视口高度，消除 iOS Safari 地址栏导致的溢出抖动
    function enforceVisualViewport() {
        if (window.visualViewport) {
            const height = window.visualViewport.height;
            const panel = document.getElementById('player-panel');
            if (panel) panel.style.height = height + 'px';
        }
    }
    window.visualViewport?.addEventListener('resize', enforceVisualViewport);
    // 同时监听 window resize 作为 fallback
    window.addEventListener('resize', () => {
        if (!window.visualViewport) {
            const panel = document.getElementById('player-panel');
            if (panel) panel.style.removeProperty('height');
        }
    });
}

/* ── Login ─────────────────────────────────────────────────────── */
document.getElementById("login-btn").addEventListener("click", async () => {
    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();
    loginError.textContent = "";

    if (!username || !password) return loginError.textContent = "请输入用户名和密码";

    try {
        const resp = await fetch(`${API_BASE}/api/auth/login`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            return loginError.textContent = err.detail || "登录失败";
        }
        const data = await resp.json();
        setToken(data.access_token);
        await initPlayer();
    } catch (e) { loginError.textContent = "网络错误，无法连接服务器"; }
});

/* ── Load library ──────────────────────────────────────────────── */
async function loadLibrary() {
    try {
        const resp = await fetch(`${API_BASE}/api/songs`, { headers: authHeaders() });
        if (!resp.ok) throw new Error("获取歌曲列表失败");
        const songs = await resp.json();
        if (!songs.length) return;

        // 全局多级排序：歌手 → 专辑 → 音轨号/标题
        songs.sort((a, b) => {
            const artistA = (a.Artists && a.Artists.length > 0) ? a.Artists[0] : "未知";
            const artistB = (b.Artists && b.Artists.length > 0) ? b.Artists[0] : "未知";
            const artistCmp = artistA.localeCompare(artistB, 'zh-CN', { numeric: true });
            if (artistCmp !== 0) return artistCmp;

            const albumA = a.Album || "未知";
            const albumB = b.Album || "未知";
            const albumCmp = albumA.localeCompare(albumB, 'zh-CN', { numeric: true });
            if (albumCmp !== 0) return albumCmp;

            const trackA = parseInt(a.TrackNumber || a.Track || 0, 10);
            const trackB = parseInt(b.TrackNumber || b.Track || 0, 10);
            if (trackA !== trackB && (trackA > 0 || trackB > 0)) {
                return trackA - trackB;
            }

            const titleA = a.Title || "";
            const titleB = b.Title || "";
            return titleA.localeCompare(titleB, 'zh-CN', { numeric: true });
        });

        allSongsRaw = songs;
        songMap = {};
        libraryTree = { root: [], folders: {} };

        songs.forEach(song => {
            songMap[song.SongID] = song;
            if (!song.Folder) libraryTree.root.push(song);
            else {
                if (!libraryTree.folders[song.Folder]) libraryTree.folders[song.Folder] = [];
                libraryTree.folders[song.Folder].push(song);
            }
        });
        renderDirectory("root");
    } catch (e) { console.error("loadLibrary error:", e); }
}

/* ── Navigation & Rendering ────────────────────────────────────── */
function renderDirectory(folderName) {
    currentFolderContext = folderName;
    currentViewContext = { type: 'folder', value: folderName };
    centerNav.innerHTML = "";
    centerList.innerHTML = "";
    searchInput.value = ""; // 清空搜索框

    if (folderName === "root") {
        // ── My Playlists ──────────────────────────────────────────
        const plHeader = document.createElement("div");
        plHeader.className = "dir-header";
        plHeader.textContent = "🎵 我的歌单";
        centerList.appendChild(plHeader);

        const createBtn = document.createElement("button");
        createBtn.className = "folder-item";
        createBtn.textContent = "➕ 新建歌单";
        createBtn.addEventListener("click", () => openModal(document.getElementById("playlist-create-modal")));
        centerList.appendChild(createBtn);

        if (myPlaylists.length) {
            myPlaylists.forEach(playlist => {
                const container = document.createElement("div");
                container.className = "folder-item playlist-item-container";

                const nameSpan = document.createElement("div");
                nameSpan.className = "playlist-name-span";
                nameSpan.textContent = `🎵 ${playlist.Name}`;
                nameSpan.addEventListener("click", () => renderPlaylist(playlist));

                const delBtn = document.createElement("button");
                delBtn.className = "delete-playlist-btn";
                delBtn.textContent = "🗑️";
                delBtn.title = "删除歌单";
                delBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (confirm(`确定要永久删除歌单 "${playlist.Name}" 吗？此操作不可逆。`)) {
                        try {
                            const res = await fetch(`${API_BASE}/api/playlists/${playlist.PlaylistID}`, {
                                method: "DELETE",
                                headers: { "Authorization": `Bearer ${getToken()}` }
                            });
                            if (res.ok) {
                                await fetchMyPlaylists();
                                renderDirectory("root");
                            } else {
                                alert("删除失败，请稍后重试");
                            }
                        } catch (err) {
                            console.error("删除歌单出错", err);
                        }
                    }
                });

                container.appendChild(nameSpan);
                container.appendChild(delBtn);
                centerList.appendChild(container);
            });
        }

        // ── Folder buttons ───────────────────────────────────────
        const folderNames = Object.keys(libraryTree.folders).sort();
        if (folderNames.length) {
            const header = document.createElement("div"); header.className = "dir-header"; header.textContent = "📁 文件夹"; centerList.appendChild(header);
            folderNames.forEach(name => {
                const btn = document.createElement("button"); btn.className = "folder-item"; btn.textContent = `📁 ${name}`;
                btn.addEventListener("click", () => renderDirectory(name));
                centerList.appendChild(btn);
            });
        }
        currentViewPlaylist = [...libraryTree.root];
        const header = document.createElement("div"); header.className = "dir-header"; header.textContent = `🎵 根目录歌曲 (${currentViewPlaylist.length})`; centerList.appendChild(header);
        currentViewPlaylist.forEach((song, idx) => centerList.appendChild(buildSongRow(song, idx)));
    } else {
        const backBtn = document.createElement("button"); backBtn.className = "nav-back"; backBtn.textContent = "⬅️ 返回根目录";
        backBtn.addEventListener("click", () => renderDirectory("root")); centerNav.appendChild(backBtn);

        const songs = libraryTree.folders[folderName] || [];
        currentViewPlaylist = [...songs];
        const header = document.createElement("div"); header.className = "dir-header"; header.textContent = `📁 ${folderName} (${currentViewPlaylist.length})`; centerList.appendChild(header);
        currentViewPlaylist.forEach((song, idx) => centerList.appendChild(buildSongRow(song, idx)));
    }
}

function buildSongRow(song, idx) {
    const row = document.createElement("div");
    row.className = "song-item";
    row.dataset.songid = song.SongID;
    if (song.SongID === currentSongId) row.classList.add("playing");

    const artists = (song.Artists && song.Artists.length) ? song.Artists.join(", ") : "—";

    // Song info (clickable → play) — 双行结构：标题 + 歌手
    const info = document.createElement("div");
    info.className = "song-info";
    info.title = `${song.Title} — ${artists}`;

    const titleDiv = document.createElement("div");
    titleDiv.className = "song-row-title";
    titleDiv.textContent = song.Title || "未知歌曲";

    const artistDiv = document.createElement("div");
    artistDiv.className = "song-row-artist";
    artistDiv.textContent = artists;

    info.appendChild(titleDiv);
    info.appendChild(artistDiv);
    info.addEventListener("click", () => {
        currentPlayingPlaylist = [...currentViewPlaylist];
        currentPlayingIndex = idx;
        playSong(song);
    });
    row.appendChild(info);

    // Favorite (red-heart) button
    const favBtn = document.createElement("button");
    favBtn.className = "favorite-btn";
    favBtn.title = "喜欢";
    if (myFavorites.has(song.SongID)) {
        favBtn.textContent = "❤️";
        favBtn.classList.add("is-fav");
    } else {
        favBtn.textContent = "♡";
    }
    favBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleFavorite(song.SongID, favBtn);
    });

    // Add-to-playlist button
    const addBtn = document.createElement("button");
    addBtn.className = "add-to-playlist-btn";
    addBtn.textContent = "➕";
    addBtn.title = "添加到歌单";
    addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        songIdToAdd = song.SongID;
        renderPlaylistSelectList();
        openModal(document.getElementById("playlist-select-modal"));
    });

    // Wrap action buttons in a container (hover-reveal)
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "song-actions";
    actionsDiv.appendChild(favBtn);
    actionsDiv.appendChild(addBtn);
    row.appendChild(actionsDiv);

    return row;
}

function renderPlaylistSelectList() {
    const list = document.getElementById("playlist-select-list");
    list.innerHTML = "";
    if (!myPlaylists.length) {
        const empty = document.createElement("div");
        empty.className = "playlist-select-item";
        empty.textContent = "暂无歌单，请先创建";
        list.appendChild(empty);
        return;
    }
    myPlaylists.forEach(pl => {
        const item = document.createElement("div");
        item.className = "playlist-select-item";
        item.textContent = `📋 ${pl.Name}`;
        item.addEventListener("click", async () => {
            try {
                await fetch(`${API_BASE}/api/playlists/${pl.PlaylistID}/songs`, {
                    method: "POST", headers: authHeaders(),
                    body: JSON.stringify({ song_id: songIdToAdd }),
                });
                showToast(`已添加到「${pl.Name}」`);
                closeModal(document.getElementById("playlist-select-modal"));
            } catch (e) { showToast("添加失败", true); }
        });
        list.appendChild(item);
    });
}

async function renderPlaylist(playlist) {
    currentFolderContext = playlist.Name;
    currentViewContext = { type: 'playlist', value: playlist };
    centerNav.innerHTML = "";
    centerList.innerHTML = "";
    searchInput.value = "";

    const backBtn = document.createElement("button");
    backBtn.className = "nav-back";
    backBtn.textContent = "⬅️ 返回根目录";
    backBtn.addEventListener("click", () => renderDirectory("root"));
    centerNav.appendChild(backBtn);

    const header = document.createElement("div");
    header.className = "dir-header";
    header.textContent = `📋 ${playlist.Name}`;
    centerList.appendChild(header);

    try {
        const resp = await fetch(`${API_BASE}/api/playlists/${playlist.PlaylistID}/songs`, {
            headers: authHeaders(),
        });
        if (!resp.ok) throw new Error("获取歌单失败");
        const songs = await resp.json();

        currentViewPlaylist = [...songs];
        if (!songs.length) {
            const empty = document.createElement("div");
            empty.className = "center-empty";
            empty.textContent = "歌单中暂无歌曲";
            centerList.appendChild(empty);
        } else {
            songs.forEach((song, idx) => centerList.appendChild(buildSongRow(song, idx)));
        }
    } catch (e) {
        const err = document.createElement("div");
        err.className = "center-empty";
        err.textContent = "加载歌单失败";
        centerList.appendChild(err);
    }
}

/* ── Filter & Search Logic ─────────────────────────────────────── */
searchInput.addEventListener("input", (e) => {
    const keyword = e.target.value.trim().toLowerCase();
    if (!keyword) return renderDirectory(currentFolderContext);
    filterAndRenderList("search", keyword);
});

function filterAndRenderList(type, keyword) {
    centerNav.innerHTML = ""; centerList.innerHTML = "";
    
    const backBtn = document.createElement("button"); backBtn.className = "nav-back"; backBtn.textContent = "⬅️ 清除筛选并返回";
    backBtn.addEventListener("click", () => renderDirectory(currentFolderContext)); centerNav.appendChild(backBtn);

    let filtered = [];
    if (type === "search") {
        filtered = allSongsRaw.filter(s => 
            (s.Title && s.Title.toLowerCase().includes(keyword)) ||
            (s.Artists && s.Artists.some(a => a.toLowerCase().includes(keyword)))
        );
    } else if (type === "artist") {
        filtered = allSongsRaw.filter(s => s.Artists && s.Artists.includes(keyword));
    } else if (type === "album") {
        filtered = allSongsRaw.filter(s => s.Album === keyword);
    }

    currentViewPlaylist = [...filtered];
    const header = document.createElement("div"); header.className = "dir-header";
    header.textContent = `🔍 筛选结果: ${keyword} (${filtered.length})`; centerList.appendChild(header);

    if (filtered.length === 0) {
        const empty = document.createElement("div"); empty.className = "center-empty"; empty.textContent = "没有匹配的歌曲"; centerList.appendChild(empty);
    } else {
        filtered.forEach((song, idx) => centerList.appendChild(buildSongRow(song, idx)));
    }
}

/* ── Web Audio Visualizer ──────────────────────────────────────── */
let visDataArray, visMinIndex, visMaxIndex;
let visualizerPeak = 72;
let visualizerCanvasWidth = 0;
let visualizerWorker = null;
let visualizerUsesWorker = false;
let visualizerFramePending = false;
let visualizerWasMobile = false;
let visualizerLastFrameAt = 0;
const VIS_BAR_COUNT = 64;
const VIS_HEIGHT = 120;
const VIS_MAX_FILL = 0.82;
const VIS_MIN_HEIGHT = 2;
const VIS_FRAME_INTERVAL = 1000 / 45;
const smoothedHeights = new Array(VIS_BAR_COUNT).fill(0);

function initVisualizerRenderer() {
    if (!visCanvas) return;

    if (window.Worker && visCanvas.transferControlToOffscreen) {
        try {
            visualizerWorker = new Worker("visualizer-worker.js");
            visualizerWorker.onmessage = (event) => {
                if (event.data && event.data.type === "frame-done") {
                    visualizerFramePending = false;
                }
            };
            visualizerWorker.onerror = () => {
                visualizerFramePending = false;
            };

            const offscreen = visCanvas.transferControlToOffscreen();
            visualizerWorker.postMessage({
                type: "init",
                canvas: offscreen,
                barCount: VIS_BAR_COUNT,
                height: VIS_HEIGHT,
                maxFill: VIS_MAX_FILL,
                minHeight: VIS_MIN_HEIGHT
            }, [offscreen]);
            visualizerUsesWorker = true;
            return;
        } catch (err) {
            console.warn("Visualizer worker unavailable, using main-thread fallback", err);
            visualizerWorker = null;
            visualizerUsesWorker = false;
        }
    }

    visCanvasCtx = visCanvas.getContext("2d");
}

function initVisualizer() {
    if (isVisualizerInit) return;  // ensure media element is only wired once
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioCtx.createAnalyser();

    // 2048-point FFT → 1024 frequency bins, much finer resolution
    analyser.fftSize = 2048;
    const bufferLength = analyser.frequencyBinCount;
    visDataArray = new Uint8Array(bufferLength);

    // Map 60 Hz – 10 kHz to FFT bin indices
    const sampleRate = audioCtx.sampleRate;
    visMinIndex = Math.floor(60 / (sampleRate / analyser.fftSize));
    visMaxIndex = Math.floor(10000 / (sampleRate / analyser.fftSize));

    audioSource = audioCtx.createMediaElementSource(audioPlayer);
    audioSource.connect(analyser);
    analyser.connect(audioCtx.destination);
    initVisualizerRenderer();
    isVisualizerInit = true;
    drawVisualizer();
}

function drawVisualizer() {
    requestAnimationFrame(drawVisualizer);

    const isMobile = window.innerWidth <= 768;
    if (isMobile) {
        if (!visualizerWasMobile) {
            if (visualizerUsesWorker && visualizerWorker) {
                visualizerWorker.postMessage({ type: "clear" });
            } else if (visCanvasCtx) {
                visCanvasCtx.clearRect(0, 0, visCanvas.width, visCanvas.height);
            }
            visualizerWasMobile = true;
        }
        return;
    }
    visualizerWasMobile = false;

    analyser.getByteFrequencyData(visDataArray);

    if (visualizerUsesWorker && visualizerWorker) {
        const now = performance.now();
        if (visualizerFramePending || now - visualizerLastFrameAt < VIS_FRAME_INTERVAL) return;

        visualizerFramePending = true;
        visualizerLastFrameAt = now;
        const frameBuffer = visDataArray.slice().buffer;
        visualizerWorker.postMessage({
            type: "frame",
            data: frameBuffer,
            width: window.innerWidth,
            minIndex: visMinIndex,
            maxIndex: visMaxIndex
        }, [frameBuffer]);
        return;
    }

    drawVisualizerOnMainThread();
}

function drawVisualizerOnMainThread() {
    if (!visCanvasCtx) return;

    if (visualizerCanvasWidth !== window.innerWidth || visCanvas.height !== VIS_HEIGHT) {
        visualizerCanvasWidth = window.innerWidth;
        visCanvas.width = visualizerCanvasWidth;
        visCanvas.height = VIS_HEIGHT;
    }

    visCanvasCtx.clearRect(0, 0, visCanvas.width, visCanvas.height);

    const barWidth = visCanvas.width / VIS_BAR_COUNT;
    const range = Math.max(1, visMaxIndex - visMinIndex);
    const rawBands = new Array(VIS_BAR_COUNT);
    let framePeak = 0;

    for (let i = 0; i < VIS_BAR_COUNT; i++) {
        const bandStart = Math.floor(visMinIndex + (i / VIS_BAR_COUNT) * range);
        const bandEnd = Math.max(bandStart + 1, Math.floor(visMinIndex + ((i + 1) / VIS_BAR_COUNT) * range));
        let sum = 0;
        let count = 0;

        for (let idx = bandStart; idx < bandEnd && idx < visDataArray.length; idx++) {
            sum += visDataArray[idx] || 0;
            count++;
        }

        const trebleLift = 1 + (i / (VIS_BAR_COUNT - 1)) * 0.55;
        const value = (count ? sum / count : 0) * trebleLift;
        rawBands[i] = value;
        if (value > framePeak) framePeak = value;
    }

    visualizerPeak = Math.max(framePeak, visualizerPeak * 0.965, 48);
    const usableHeight = visCanvas.height * VIS_MAX_FILL;
    const gradient = visCanvasCtx.createLinearGradient(0, 0, 0, visCanvas.height);
    gradient.addColorStop(0, "rgba(80, 255, 165, 0.92)");
    gradient.addColorStop(1, "rgba(30, 215, 96, 0.35)");
    visCanvasCtx.fillStyle = gradient;

    for (let i = 0; i < VIS_BAR_COUNT; i++) {
        const normalized = Math.min(1, rawBands[i] / visualizerPeak);
        const shaped = Math.pow(normalized, 0.62);
        const targetHeight = Math.max(VIS_MIN_HEIGHT, shaped * usableHeight);
        const smoothing = targetHeight > smoothedHeights[i] ? 0.42 : 0.16;
        smoothedHeights[i] = smoothedHeights[i] * (1 - smoothing) + targetHeight * smoothing;

        const barHeight = Math.min(usableHeight, smoothedHeights[i]);
        visCanvasCtx.fillRect(
            i * barWidth + 1,
            visCanvas.height - barHeight,
            Math.max(1, barWidth - 2),
            barHeight
        );
    }
}

/* ── Core Playback ─────────────────────────────────────────────── */
async function playSong(song, options = {}) {
    const { autoplay = true, save = true, smoothScroll = true } = options;

    // Clear any pending play‑stats timer from the previous song
    if (playStatsTimer) { clearTimeout(playStatsTimer); playStatsTimer = null; }

    // Exit idle state
    document.getElementById("left-panel").classList.remove("idle-state");

    currentPlayingSong = song;
    currentPlayingContext = { ...currentViewContext };

    currentSongId = song.SongID;
    if (save) saveLastPlayedSong(song);
    songTitle.textContent = song.Title || "未知歌曲";

    if (song.CoverPath) {
        coverImg.classList.remove("fallback-cover");
        coverImg.src = API_BASE + song.CoverPath;
    } else {
        // No cover path — force the onerror fallback
        coverImg.classList.add("fallback-cover");
        coverImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    }

    const albumName = song.Album || "未知专辑";
    songAlbum.textContent = albumName;
    songAlbum.onclick = () => { if (song.Album) { searchInput.value=""; filterAndRenderList("album", song.Album); }};

    artistList.innerHTML = "";
    if (song.Artists) {
        song.Artists.forEach(name => {
            const pill = document.createElement("button"); pill.className = "artist-pill"; pill.textContent = name;
            pill.addEventListener("click", () => { searchInput.value=""; filterAndRenderList("artist", name); });
            artistList.appendChild(pill);
        });
    }

    // Refresh UI highlight and keep the current song in a comfortable position.
    updatePlayingRowHighlight(song.SongID, { scroll: true, smooth: smoothScroll });
    const qualitySelects = [document.getElementById("sel-quality-desktop"), document.getElementById("sel-quality-mobile")];
    try {
        const infoResp = await fetch(`${API_BASE}/api/song_info/${song.SongID}?token=${encodeURIComponent(getToken())}`);
        if (infoResp.ok) {
            const audioData = await infoResp.json();
            qualitySelects.forEach(sel => {
                if (!sel) return;
                // 彻底清空原有所有 Option
                while (sel.firstChild) {
                    sel.removeChild(sel.firstChild);
                }

                if (audioData.is_lossless && (audioData.sample_rate > 48000 || audioData.bits_per_sample > 16)) {
                    sel.add(new Option("原声 (Hi-Res)", "original"));
                    sel.add(new Option("无损 (44.1k/16bit)", "lossless"));
                    sel.add(new Option("极高 (320kbps)", "high"));
                    sel.add(new Option("标准 (128kbps)", "standard"));
                } else if (audioData.is_lossless) {
                    sel.add(new Option("无损 (原声)", "original"));
                    sel.add(new Option("极高 (320kbps)", "high"));
                    sel.add(new Option("标准 (128kbps)", "standard"));
                } else if (!audioData.is_lossless && audioData.bit_rate >= 256000) {
                    sel.add(new Option("极高 (原声)", "original"));
                    sel.add(new Option("标准 (128kbps)", "standard"));
                } else {
                    sel.add(new Option("标准 (原声)", "original"));
                }

                const savedQuality = localStorage.getItem("musiccloud_quality") || "original";
                const optionExists = Array.from(sel.options).some(opt => opt.value === savedQuality);
                sel.value = optionExists ? savedQuality : "original";
            });
        }
    } catch (e) {
        console.error("无法获取音频属性，采用默认选项", e);
    }

    const currentQuality = localStorage.getItem("musiccloud_quality") || "original";
    audioPlayer.src = `${API_BASE}/api/stream/${song.SongID}?token=${encodeURIComponent(getToken())}&quality=${currentQuality}`;

    // ── Media Session metadata (lock screen / system controls) ──
    if ("mediaSession" in navigator) {
        const artworkUrl = song.CoverPath ? API_BASE + song.CoverPath : "";
        const artistStr = (song.Artists && song.Artists.length) ? song.Artists.join(", ") : "未知歌手";
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.Title || "未知歌曲",
            artist: artistStr,
            album: song.Album || "未知专辑",
            artwork: [
                { src: artworkUrl, sizes: "512x512", type: "image/jpeg" },
                { src: artworkUrl, sizes: "512x512", type: "image/png" },
            ],
        });
    }

    if (autoplay) {
        audioPlayer.play().catch(() => {});
        coverImg.classList.add("is-playing");
    } else {
        audioPlayer.pause();
        coverImg.classList.remove("is-playing");
        if (btnPlayPause) btnPlayPause.textContent = "▶️";
    }

    updatePlayerFavBtn();

    await loadLyrics(song.SongID);
}

// 播放控制条事件
audioPlayer.addEventListener("play", () => {
    if (btnPlayPause) btnPlayPause.textContent = "⏸️";
    coverImg.classList.add("is-playing");
    initVisualizer();
    if (audioCtx && audioCtx.state === "suspended") {
        audioCtx.resume();
    }
    // 30 s continuous playback → report play stats
    if (playStatsTimer) clearTimeout(playStatsTimer);
    if (currentSongId) {
        playStatsTimer = setTimeout(async () => {
            try {
                await fetch(`${API_BASE}/api/stats/${currentSongId}`, {
                    method: "POST", headers: authHeaders(),
                });
            } catch (e) { /* silent */ }
        }, 30000);
    }
});
audioPlayer.addEventListener("pause", () => {
    if (btnPlayPause) btnPlayPause.textContent = "▶️";
    coverImg.classList.remove("is-playing");
    // Clear the stats timer on pause — only count continuous playback
    if (playStatsTimer) { clearTimeout(playStatsTimer); playStatsTimer = null; }
});

/* ── Playback Controls (Prev/Next/Mode) ────────────────────────── */
btnMode.addEventListener("click", () => {
    currentModeIndex = (currentModeIndex + 1) % MODES.length;
    btnMode.textContent = MODES[currentModeIndex].icon;
    btnMode.title = MODES[currentModeIndex].title;
});

function playNext() {
    if (!currentPlayingPlaylist.length) return;
    if (currentModeIndex === 2) { // 随机
        currentPlayingIndex = Math.floor(Math.random() * currentPlayingPlaylist.length);
    } else { // 列表循环或单曲手动切歌
        currentPlayingIndex = (currentPlayingIndex + 1) % currentPlayingPlaylist.length;
    }
    playSong(currentPlayingPlaylist[currentPlayingIndex]);
}

function playPrev() {
    if (!currentPlayingPlaylist.length) return;
    if (currentModeIndex === 2) { // 随机
        currentPlayingIndex = Math.floor(Math.random() * currentPlayingPlaylist.length);
    } else {
        currentPlayingIndex = (currentPlayingIndex - 1 + currentPlayingPlaylist.length) % currentPlayingPlaylist.length;
    }
    playSong(currentPlayingPlaylist[currentPlayingIndex]);
}

btnNext.addEventListener("click", playNext);
btnPrev.addEventListener("click", playPrev);

// Play/Pause toggle button
if (btnPlayPause) {
    btnPlayPause.addEventListener("click", () => {
        if (audioPlayer.paused) {
            audioPlayer.play();
        } else {
            audioPlayer.pause();
        }
    });
}

// Player-bar favorite button
playerFavBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!currentSongId) return;
    toggleFavorite(currentSongId, playerFavBtn);
});

// Nav-favorites — render "我喜欢的音乐" in center panel
navFavorites.addEventListener("click", async () => {
    currentFolderContext = "favorites";
    currentViewContext = { type: 'favorites', value: null };
    centerNav.innerHTML = "";
    centerList.innerHTML = "";
    searchInput.value = "";

    const backBtn = document.createElement("button");
    backBtn.className = "nav-back";
    backBtn.textContent = "⬅️ 返回所有歌曲";
    backBtn.addEventListener("click", () => renderDirectory("root"));
    centerNav.appendChild(backBtn);

    const header = document.createElement("div");
    header.className = "dir-header";
    header.textContent = "❤️ 我喜欢的音乐";
    centerList.appendChild(header);

    try {
        const resp = await fetch(`${API_BASE}/api/favorites`, { headers: authHeaders() });
        if (!resp.ok) throw new Error();
        const songs = await resp.json();
        // Refresh the local set from the fresh response
        myFavorites = new Set(songs.map(s => s.SongID));
        currentViewPlaylist = [...songs];
        if (!songs.length) {
            const empty = document.createElement("div");
            empty.className = "center-empty";
            empty.textContent = "还没有收藏歌曲";
            centerList.appendChild(empty);
        } else {
            songs.forEach((s, idx) => centerList.appendChild(buildSongRow(s, idx)));
        }
    } catch (e) {
        const err = document.createElement("div");
        err.className = "center-empty";
        err.textContent = "加载失败";
        centerList.appendChild(err);
    }
});

// ── Sync library button ────────────────────────────────────────
const syncLibraryBtn = document.getElementById("nav-sync-library");
if (syncLibraryBtn) {
    syncLibraryBtn.addEventListener("click", async () => {
        const originalText = syncLibraryBtn.textContent;
        syncLibraryBtn.textContent = "⏳ 正在同步...";
        syncLibraryBtn.style.pointerEvents = "none";

        try {
            const res = await fetch(`${API_BASE}/api/library/scan`, {
                method: "POST",
                headers: authHeaders(),
            });

            if (res.ok) {
                syncLibraryBtn.textContent = "✅ 同步完成";
                await loadLibrary();
            } else {
                syncLibraryBtn.textContent = "❌ 同步失败";
            }
        } catch (err) {
            console.error("同步曲库失败:", err);
            syncLibraryBtn.textContent = "❌ 同步出错";
        }

        setTimeout(() => {
            syncLibraryBtn.textContent = originalText;
            syncLibraryBtn.style.pointerEvents = "auto";
        }, 3000);
    });
}

// ── Locate current song button ──────────────────────────────────
(function initLocateBtn() {
    const leftPanel = document.getElementById("left-panel");
    const locateBtn = document.createElement("button");
    locateBtn.id = "locate-current-btn";
    locateBtn.className = "folder-item";
    locateBtn.textContent = "📍 定位当前播放";
    locateBtn.title = "跳转到正在播放的歌曲";
    // 注入到 menu-functional-area 内部，确保 Flex 布局将其作为中间滚动区的一部分
    const menuArea = leftPanel.querySelector('.menu-functional-area');
    if (menuArea) {
        menuArea.appendChild(locateBtn);
    } else {
        leftPanel.appendChild(locateBtn);  // fallback
    }

    locateBtn.addEventListener("click", async () => {
        if (!currentPlayingSong) return;

        let activeRow = centerList.querySelector(`.song-item[data-songid="${currentPlayingSong.SongID}"]`);
        if (!activeRow) {
            renderSongHome(currentPlayingSong);
            await new Promise(resolve => requestAnimationFrame(resolve));
            activeRow = updatePlayingRowHighlight(currentPlayingSong.SongID, { scroll: false });
        }

        if (activeRow) {
            scrollSongRowIntoComfortView(activeRow, { smooth: true });
            flashSongRow(activeRow);
        }
    });
})();

// ── Media Session action handlers (system media keys / lock screen) ─
if ("mediaSession" in navigator) {
    navigator.mediaSession.setActionHandler("play", () => audioPlayer.play());
    navigator.mediaSession.setActionHandler("pause", () => audioPlayer.pause());
    navigator.mediaSession.setActionHandler("previoustrack", () => playPrev());
    navigator.mediaSession.setActionHandler("nexttrack", () => playNext());
}

audioPlayer.addEventListener("ended", () => {
    if (currentModeIndex === 1) { // 单曲循环
        audioPlayer.currentTime = 0;
        audioPlayer.play();
    } else {
        playNext();
    }
});

/* Lyrics Logic: low-end friendly sync */
function resetLyricsView() {
    lyricsUL.replaceChildren();
    const mobileLyricsUL = document.getElementById("mobile-lyrics-list");
    if (mobileLyricsUL) mobileLyricsUL.replaceChildren();

    lyricsData = [];
    currentLyricIndex = -1;
    lyricLineEls = [];
    mobileLyricLineEls = [];
    activeLyricEl = null;
    activeMobileLyricEl = null;
    if (lyricScrollFrame) {
        cancelAnimationFrame(lyricScrollFrame);
        lyricScrollFrame = 0;
    }
}

function createLyricLine(item, idx) {
    const li = document.createElement("li");
    li.textContent = item.text;
    li.dataset.index = idx;
    li.dataset.time = item.time;
    return li;
}

function renderMobileLyrics() {
    const mobileLyricsUL = document.getElementById("mobile-lyrics-list");
    if (!mobileLyricsUL) return;

    const fragment = document.createDocumentFragment();
    mobileLyricLineEls = lyricsData.map((item, idx) => {
        const li = createLyricLine(item, idx);
        fragment.appendChild(li);
        return li;
    });
    mobileLyricsUL.replaceChildren(fragment);
    activeMobileLyricEl = null;
}

async function loadLyrics(songId) {
    resetLyricsView();
    try {
        const resp = await fetch(`${API_BASE}/api/lyrics/${songId}`, { headers: authHeaders() });
        if (!resp.ok) return;
        const data = await resp.json();
        if (!data.lyrics) return;

        lyricsData = parseLRC(data.lyrics);
        const fragment = document.createDocumentFragment();
        lyricLineEls = lyricsData.map((item, idx) => {
            const li = createLyricLine(item, idx);
            fragment.appendChild(li);
            return li;
        });
        lyricsUL.replaceChildren(fragment);
        renderMobileLyrics();
    } catch (e) { console.error("loadLyrics error:", e); }
}

function parseLRC(lrcText) {
    const result = [];
    const regex = /\[(\d{2}):(\d{2}\.\d{2,3})\](.*)/;
    for (const line of lrcText.split("\n")) {
        const match = line.match(regex);
        if (match && match[3].trim()) {
            result.push({ time: parseInt(match[1], 10) * 60 + parseFloat(match[2]), text: match[3].trim() });
        }
    }
    return result.sort((a, b) => a.time - b.time);
}

function findLyricIndex(time) {
    let low = 0;
    let high = lyricsData.length - 1;
    let activeIdx = -1;

    while (low <= high) {
        const mid = (low + high) >> 1;
        if (lyricsData[mid].time <= time) {
            activeIdx = mid;
            low = mid + 1;
        } else {
            high = mid - 1;
        }
    }

    return activeIdx;
}

function seekToLyricFromElement(el) {
    const targetTime = parseFloat(el.dataset.time);
    if (!isNaN(targetTime)) {
        audioPlayer.currentTime = targetTime;
        if (audioPlayer.paused) audioPlayer.play();
    }
}

lyricsUL.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-time]");
    if (li) seekToLyricFromElement(li);
});

function centerLyricLine(container, line, extraOffset = 0) {
    if (!container || !line) return;
    const targetTop = line.offsetTop - (container.clientHeight - line.offsetHeight) / 2 + extraOffset;
    container.scrollTop = Math.max(0, targetTop);
}

function updateActiveLyric(activeIdx) {
    if (activeLyricEl) activeLyricEl.classList.remove("active-lyric");
    if (activeMobileLyricEl) activeMobileLyricEl.classList.remove("active-lyric");

    activeLyricEl = activeIdx >= 0 ? lyricLineEls[activeIdx] : null;
    activeMobileLyricEl = activeIdx >= 0 ? mobileLyricLineEls[activeIdx] : null;

    if (activeLyricEl) activeLyricEl.classList.add("active-lyric");
    if (activeMobileLyricEl) activeMobileLyricEl.classList.add("active-lyric");

    if (lyricScrollFrame) cancelAnimationFrame(lyricScrollFrame);
    lyricScrollFrame = requestAnimationFrame(() => {
        lyricScrollFrame = 0;
        if (window.innerWidth > 768) {
            centerLyricLine(lyricsContainer, activeLyricEl);
        } else {
            const mobileLyricsContainer = document.getElementById("mobile-lyrics-container");
            centerLyricLine(mobileLyricsContainer, activeMobileLyricEl, 80);
        }
    });
}

audioPlayer.addEventListener("timeupdate", () => {
    if (!lyricsData.length) return;
    const activeIdx = findLyricIndex(audioPlayer.currentTime);
    if (activeIdx === currentLyricIndex) return;
    currentLyricIndex = activeIdx;
    updateActiveLyric(activeIdx);
});

/* ─────────────────────────────────────────────────────────────────
 *  Auto‑login check — runs on every page load
 * ──────────────────────────────────────────────────────────────── */

(async function checkAuthAndInit() {
    const token = getToken();
    if (!token) return;  // No saved token → show login panel (default)

    try {
        const resp = await fetch(`${API_BASE}/api/users/me`, {
            headers: { "Authorization": `Bearer ${token}` },
        });
        if (!resp.ok) throw new Error("Token invalid");
        // Token is valid → skip login, init the player directly
        await fetchFavorites();
        await fetchMyPlaylists();
        await initPlayer();
    } catch (e) {
        // Token expired / invalid → purge it, stay on login screen
        localStorage.removeItem("musiccloud_token");
    }
})();

// ── Panel resizer (center ↔ right) ──────────────────────────────
const resizer = document.getElementById("panel-resizer");
const rightPanelResize = document.getElementById("right-panel");
let isResizing = false;
let startX = 0;
let startWidth = 0;

if (resizer && rightPanelResize) {
    resizer.addEventListener("mousedown", (e) => {
        isResizing = true;
        resizer.classList.add("active");
        document.body.style.cursor = "col-resize";
        e.preventDefault();

        // 记录鼠标按下的初始X坐标和右侧面板的初始实际宽度
        startX = e.clientX;
        startWidth = parseInt(document.defaultView.getComputedStyle(rightPanelResize).width, 10);
    });

    document.addEventListener("mousemove", (e) => {
        if (!isResizing) return;

        // 计算鼠标水平移动的差值 (往左拖是负数，往右拖是正数)
        const dx = e.clientX - startX;
        // 新宽度 = 初始宽度 - 移动差值
        let newRightWidth = startWidth - dx;

        const MIN_RIGHT_WIDTH = 300;
        const MIN_CENTER_WIDTH = 400;
        const LEFT_PANEL_WIDTH = 250;

        const MAX_RIGHT_WIDTH = window.innerWidth - LEFT_PANEL_WIDTH - MIN_CENTER_WIDTH - 20;

        if (newRightWidth < MIN_RIGHT_WIDTH) newRightWidth = MIN_RIGHT_WIDTH;
        if (newRightWidth > MAX_RIGHT_WIDTH) newRightWidth = MAX_RIGHT_WIDTH;

        rightPanelResize.style.width = newRightWidth + "px";
    });

    document.addEventListener("mouseup", () => {
        if (isResizing) {
            isResizing = false;
            resizer.classList.remove("active");
            document.body.style.cursor = "default";
        }
    });
}

// ── Location & Weather ──────────────────────────────────────────
let userProfile = null;  // populated by loadUserProfile(), holds current user row

/**
 * Fetch weather for a given location.
 *
 * @param {string} queryCity     - 传给天气 API 的城市名（优先区名，更精确）
 * @param {string} [displayCity]  - UI 展示用的市名（可选）
 * @param {string} [displayDistrict] - UI 展示用的区名（可选）
 */
async function fetchWeather(queryCity, displayCity, displayDistrict) {
    // 构建天气 API 请求（优先用区名请求以获得更精细的天气数据）
    let weatherCity = queryCity;
    let locLabel;
    if (displayCity && displayDistrict) {
        locLabel = `${displayCity} ${displayDistrict}`;
    } else if (displayCity) {
        locLabel = displayCity;
    } else {
        locLabel = queryCity;
    }

    try {
        let wRes = await fetch(`${API_BASE}/api/weather?city=${encodeURIComponent(weatherCity)}`);

        // 区名查天气失败 → 降级用市名重试
        if (!wRes.ok && displayDistrict && displayCity) {
            console.log(`区级天气查询失败 (${weatherCity})，降级为市级 (${displayCity})`);
            wRes = await fetch(`${API_BASE}/api/weather?city=${encodeURIComponent(displayCity)}`);
            weatherCity = displayCity;
        }

        if (!wRes.ok) throw new Error("代理请求失败");
        const wData = await wRes.json();

        // 兼容解析 uapi SDK 返回的数据结构（可能在顶层或 data 字段中）
        const dataObj = wData.data || wData;
        const weather = dataObj.weather || dataObj.type || "未知";
        const temp = dataObj.temp || dataObj.temperature || dataObj.high || "--";

        document.getElementById('loc-weather-text').innerHTML =
            `📍 ${locLabel} <span style="color:#1ed760;margin-left:4px;">⛅ ${weather} ${temp}</span>`;
    } catch (e) {
        document.getElementById('loc-weather-text').textContent = `📍 ${locLabel} | 天气获取失败`;
        console.error("天气 API 错误:", e);
    }
}

async function initLocationAndWeather() {
    document.getElementById('loc-weather-text').textContent = '🌍 加载天气中...';

    // 读取省市和区（优先用原生 District 字段，兼容旧版 City 合并格式 "北京-朝阳区"）
    const rawCity = (userProfile && userProfile.City) || '北京';
    const nativeDistrict = (userProfile && userProfile.District) || '';
    let displayCity, displayDistrict, queryCity;

    if (nativeDistrict) {
        // 新格式：District 字段独立存在
        displayCity = rawCity;
        displayDistrict = nativeDistrict;
        queryCity = nativeDistrict;  // 优先用区名查天气
    } else if (rawCity && rawCity.includes('-')) {
        // 旧格式兼容：City="北京-朝阳区" → 拆分
        const parts = rawCity.split('-');
        displayCity = parts[0];
        displayDistrict = parts.slice(1).join('-');
        queryCity = displayDistrict;
    } else {
        displayCity = rawCity;
        displayDistrict = '';
        queryCity = rawCity;
    }

    if (rawCity !== '定位失败') {
        await fetchWeather(queryCity, displayCity, displayDistrict);
    } else {
        document.getElementById('loc-weather-text').textContent = '📍 无法确定位置';
    }

    // 后台静默探测 IP 属地，不阻塞天气卡片
    getIpInfo();
}

async function getIpInfo() {
    try {
        const resp = await fetch(`${API_BASE}/api/get-ip-info`);
        if (!resp.ok) throw new Error('Backend unavailable');
        const data = await resp.json();
        document.getElementById('ip-text').textContent = `IP: ${data.ip}`;
        document.getElementById('ip-loc-text').textContent = data.city;
    } catch (e) {
        document.getElementById('ip-text').textContent = 'IP: 获取失败';
        document.getElementById('ip-loc-text').textContent = '--';
    }
}

// ── Region data & cascading dropdowns (private /api/regions) ──────

console.log(
    "%c🌍 MusicCloud 四级联动策略追踪 %c\n" +
    "  ├─ /api/regions         → 无区级数据 → 离线静态字典兜底\n" +
    "  ├─ /api/weather         → 优先传区名，失败降级传市名\n" +
    "  └─ /api/users/me/location → 原生四字段 (country/province/city/district) ✓",
    "color:#1ed760;font-weight:bold;", "color:#aaa;"
);

// ═══════════════════════════════════════════════════════════════════
//  离线区县数据字典（API 不支持区级，前端静态补全）
//  格式: { "城市名": ["区县1", "区县2", ...] }
// ═══════════════════════════════════════════════════════════════════
const DISTRICT_MAP = {
    '北京':   ['东城区','西城区','朝阳区','海淀区','丰台区','石景山区','通州区','大兴区','顺义区','昌平区','房山区','门头沟区','平谷区','怀柔区','密云区','延庆区'],
    '上海':   ['黄浦区','徐汇区','长宁区','静安区','普陀区','虹口区','杨浦区','浦东新区','闵行区','宝山区','嘉定区','金山区','松江区','青浦区','奉贤区','崇明区'],
    '天津':   ['和平区','河东区','河西区','南开区','河北区','红桥区','滨海新区','东丽区','西青区','津南区','北辰区','武清区','宝坻区','宁河区','静海区','蓟州区'],
    '重庆':   ['渝中区','大渡口区','江北区','沙坪坝区','九龙坡区','南岸区','北碚区','渝北区','巴南区','涪陵区','綦江区','大足区','长寿区','江津区','合川区','永川区','南川区','璧山区','铜梁区','潼南区','荣昌区','开州区','梁平区','武隆区'],
    '广州':   ['越秀区','海珠区','荔湾区','天河区','白云区','黄埔区','南沙区','番禺区','花都区','增城区','从化区'],
    '深圳':   ['罗湖区','福田区','南山区','宝安区','龙岗区','盐田区','龙华区','坪山区','光明区','大鹏新区'],
    '杭州':   ['上城区','拱墅区','西湖区','滨江区','萧山区','余杭区','临平区','钱塘区','富阳区','临安区','桐庐县','淳安县','建德市'],
    '成都':   ['锦江区','青羊区','金牛区','武侯区','成华区','龙泉驿区','青白江区','新都区','温江区','双流区','郫都区','新津区','都江堰市','彭州市','邛崃市','崇州市','简阳市'],
    '武汉':   ['江岸区','江汉区','硚口区','汉阳区','武昌区','青山区','洪山区','东西湖区','汉南区','蔡甸区','江夏区','黄陂区','新洲区'],
    '南京':   ['玄武区','秦淮区','建邺区','鼓楼区','浦口区','栖霞区','雨花台区','江宁区','六合区','溧水区','高淳区'],
    '苏州':   ['姑苏区','虎丘区','吴中区','相城区','吴江区','常熟市','张家港市','昆山市','太仓市'],
    '西安':   ['新城区','碑林区','莲湖区','灞桥区','未央区','雁塔区','阎良区','临潼区','长安区','高陵区','鄠邑区','蓝田县','周至县'],
    '长沙':   ['芙蓉区','天心区','岳麓区','开福区','雨花区','望城区','长沙县','浏阳市','宁乡市'],
    '郑州':   ['中原区','二七区','管城回族区','金水区','上街区','惠济区','中牟县','巩义市','荥阳市','新密市','新郑市','登封市'],
    '济南':   ['历下区','市中区','槐荫区','天桥区','历城区','长清区','章丘区','济阳区','莱芜区','钢城区'],
    '青岛':   ['市南区','市北区','黄岛区','崂山区','李沧区','城阳区','即墨区','胶州市','平度市','莱西市'],
    '厦门':   ['思明区','海沧区','湖里区','集美区','同安区','翔安区'],
    '福州':   ['鼓楼区','台江区','仓山区','马尾区','晋安区','长乐区','闽侯县'],
    '合肥':   ['瑶海区','庐阳区','蜀山区','包河区','肥东县','肥西县','长丰县','庐江县','巢湖市'],
    '哈尔滨': ['道里区','南岗区','道外区','平房区','松北区','香坊区','呼兰区','阿城区','双城区'],
    '长春':   ['南关区','宽城区','朝阳区','二道区','绿园区','双阳区','九台区'],
    '沈阳':   ['和平区','沈河区','大东区','皇姑区','铁西区','苏家屯区','浑南区','沈北新区','于洪区','辽中区'],
    '大连':   ['中山区','西岗区','沙河口区','甘井子区','旅顺口区','金州区','普兰店区'],
    '昆明':   ['五华区','盘龙区','官渡区','西山区','东川区','呈贡区','晋宁区'],
    '贵阳':   ['南明区','云岩区','花溪区','乌当区','白云区','观山湖区'],
    '南宁':   ['兴宁区','青秀区','江南区','西乡塘区','良庆区','邕宁区','武鸣区'],
    '海口':   ['秀英区','龙华区','琼山区','美兰区'],
    '石家庄': ['长安区','桥西区','新华区','井陉矿区','裕华区','藁城区','鹿泉区','栾城区'],
    '太原':   ['小店区','迎泽区','杏花岭区','尖草坪区','万柏林区','晋源区'],
    '呼和浩特':['新城区','回民区','玉泉区','赛罕区'],
    '拉萨':   ['城关区','堆龙德庆区','达孜区'],
    '兰州':   ['城关区','七里河区','西固区','安宁区','红古区'],
    '西宁':   ['城东区','城中区','城西区','城北区','湟中区'],
    '银川':   ['兴庆区','西夏区','金凤区','灵武市'],
    '乌鲁木齐':['天山区','沙依巴克区','新市区','水磨沟区','头屯河区','达坂城区','米东区'],
    '南昌':   ['东湖区','西湖区','青云谱区','青山湖区','新建区','红谷滩区'],
    '宁波':   ['海曙区','江北区','北仑区','镇海区','鄞州区','奉化区'],
    '无锡':   ['梁溪区','锡山区','惠山区','滨湖区','新吴区','江阴市','宜兴市'],
    '东莞':   ['莞城街道','南城街道','东城街道','万江街道'],
    '佛山':   ['禅城区','南海区','顺德区','三水区','高明区'],
    '珠海':   ['香洲区','斗门区','金湾区'],
    '三亚':   ['海棠区','吉阳区','天涯区','崖州区'],
};

function getDistricts(cityName) {
    // Exact match first, then fuzzy match
    if (DISTRICT_MAP[cityName]) return DISTRICT_MAP[cityName];
    for (const [key, val] of Object.entries(DISTRICT_MAP)) {
        if (cityName.includes(key) || key.includes(cityName)) return val;
    }
    return null;
}

function updateDistrict() {
    const city = selCity.value;
    selDistrict.innerHTML = '';
    const districts = getDistricts(city);
    if (districts && districts.length) {
        districts.forEach(d => selDistrict.add(new Option(d, d)));
        selDistrict.style.display = 'block';
    } else {
        selDistrict.style.display = 'none';
    }
}
const selCountry = document.getElementById('sel-country');
const selProvince = document.getElementById('sel-province');
const selCity = document.getElementById('sel-city');
const selDistrict = document.getElementById('sel-district');
const locModal = document.getElementById('location-select-modal');

async function updateProvince() {
    const c = selCountry.value;
    selProvince.innerHTML = '';
    selCity.innerHTML = '';
    if (!c) return;
    try {
        const resp = await fetch(`${API_BASE}/api/regions?country=${encodeURIComponent(c)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        const provinces = Object.keys(data).sort();
        provinces.forEach(p => selProvince.add(new Option(p, p)));

        // Default: auto-select "北京" when country is "中国"
        if (c === '中国') {
            const bjOption = Array.from(selProvince.options).find(opt => opt.value.includes('北京'));
            if (bjOption) selProvince.value = bjOption.value;
        }
        updateCity();
    } catch (e) { console.error('Failed to load provinces:', e); }
}

async function updateCity() {
    const c = selCountry.value;
    const p = selProvince.value;
    selCity.innerHTML = '';
    if (!c || !p) return;
    try {
        const resp = await fetch(`${API_BASE}/api/regions?country=${encodeURIComponent(c)}&province=${encodeURIComponent(p)}`);
        if (!resp.ok) return;
        const data = await resp.json();
        data.forEach(city => selCity.add(new Option(city, city)));

        // Default: auto-select "北京" city when province is 北京
        if (c === '中国' && p.includes('北京')) {
            const bjCityOption = Array.from(selCity.options).find(opt => opt.value.includes('北京'));
            if (bjCityOption) {
                selCity.value = bjCityOption.value;
            } else if (selCity.options.length > 0) {
                selCity.value = selCity.options[0].value;
            }
        }
        // 市列表加载完成后，级联更新区列表
        updateDistrict();
    } catch (e) { console.error('Failed to load cities:', e); }
}

if (selCountry) {
    selCountry.addEventListener('change', updateProvince);
    selProvince.addEventListener('change', updateCity);
}

// 当用户手动切换城市时，联动刷新区县列表
if (selCity) {
    selCity.addEventListener('change', updateDistrict);
}

// Bind city‑switch button → open modal (loads countries from our API)
const changeLocBtn = document.getElementById('change-loc-btn');
if (changeLocBtn) {
    const newBtn = changeLocBtn.cloneNode(true);
    changeLocBtn.parentNode.replaceChild(newBtn, changeLocBtn);

    newBtn.addEventListener('click', async () => {
        selCountry.innerHTML = '';
        selProvince.innerHTML = '';
        selCity.innerHTML = '';
        try {
            const resp = await fetch(`${API_BASE}/api/regions`);
            if (!resp.ok) throw new Error('Failed');
            const countries = await resp.json();
            countries.forEach(c => selCountry.add(new Option(c, c)));

            // Default: auto-select "中国" when opening the modal
            selCountry.value = '中国';
            updateProvince();
            openModal(locModal);
        } catch (e) {
            console.error('Failed to load countries:', e);
        }
    });
}

// Confirm location selection
const confirmLocBtn = document.getElementById('confirm-loc-btn');
if (confirmLocBtn) {
    confirmLocBtn.addEventListener('click', async () => {
        const selectedCountry = selCountry.value;
        const selectedProvince = selProvince.value;
        const selectedCity = selCity.value;
        const selectedDistrict = selDistrict.style.display !== 'none' ? selDistrict.value : '';
        closeModal(locModal);

        document.getElementById('loc-weather-text').textContent = "🔍 正在拉取天气...";

        try {
            const payload = {
                country: selectedCountry,
                province: selectedProvince,
                city: selectedCity,
                district: selectedDistrict || "",
            };
            console.log("📍 正在保存地区:", payload);

            const resp = await fetch(`${API_BASE}/api/users/me/location`, {
                method: "PUT",
                headers: authHeaders(),
                body: JSON.stringify(payload),
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                console.error("保存地区失败:", resp.status, err);
                showToast(`保存失败: ${err.detail || resp.status}`, true);
                // 仍然尝试拉取天气（用本地选择的值）
                await fetchWeather(selectedDistrict || selectedCity, selectedCity, selectedDistrict);
                return;
            }

            const data = await resp.json();
            console.log("✅ 地区已保存:", data);
            showToast(`地区已保存: ${data.city}${data.district ? ' ' + data.district : ''}`);

            // Update local cache for display
            if (userProfile) {
                userProfile.City = selectedCity;
                userProfile.District = selectedDistrict || "";
            }
        } catch (e) {
            console.error("保存地区网络错误:", e);
            showToast("网络错误，保存失败", true);
        }

        // 天气查询：优先用区名（更精确），失败则降级用市名
        await fetchWeather(selectedDistrict || selectedCity, selectedCity, selectedDistrict);
    });
}

// Close modal on cancel
const locModalCloseBtn = document.getElementById('loc-modal-close-btn');
if (locModalCloseBtn) {
    locModalCloseBtn.addEventListener('click', () => closeModal(locModal));
}

// Delay 1.5 s to avoid blocking core init
window.addEventListener('load', () => {
    setTimeout(initLocationAndWeather, 1500);
});

// ── Mobile hamburger menu (off‑canvas drawer) ────────────────────
(function initMobileMenu() {
    const menuBtn = document.getElementById('mobile-menu-btn');
    const leftPanel = document.getElementById('left-panel');

    if (!menuBtn || !leftPanel) return;

    menuBtn.addEventListener('click', () => {
        leftPanel.classList.toggle('active');
    });

    // Tap outside drawer to close
    document.addEventListener('click', (e) => {
        if (!leftPanel.classList.contains('active')) return;
        if (!leftPanel.contains(e.target) && e.target !== menuBtn) {
            leftPanel.classList.remove('active');
        }
    });
})();

// ── Mobile tab navigation ────────────────────────────────────────
/* ── 音质选择器双轨同步 ─────────────────────────────────────── */
function setupQualitySelector(id) {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.addEventListener("change", (e) => {
        const newQ = e.target.value;
        localStorage.setItem("musiccloud_quality", newQ);

        // 同步另一个选择器
        const otherId = id === "sel-quality-desktop" ? "sel-quality-mobile" : "sel-quality-desktop";
        const otherSel = document.getElementById(otherId);
        if (otherSel) otherSel.value = newQ;

        // 换源续播
        if (currentSongId) {
            const wasPlaying = !audioPlayer.paused;
            const savedTime = audioPlayer.currentTime;
            audioPlayer.src = `${API_BASE}/api/stream/${currentSongId}?token=${encodeURIComponent(getToken())}&quality=${newQ}`;
            audioPlayer.currentTime = savedTime;
            if (wasPlaying) audioPlayer.play().catch(() => {});
        }
    });
}
setupQualitySelector("sel-quality-desktop");
setupQualitySelector("sel-quality-mobile");

(function initMobileTabs() {
    const tabs = document.querySelectorAll('.tab-item');
    const views = document.querySelectorAll('.mobile-view');
    if (!tabs.length) return;

    const mobileMenuBtn = document.getElementById('mobile-menu-btn');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            views.forEach(v => v.classList.remove('active'));

            tab.classList.add('active');
            const targetId = tab.getAttribute('data-target');
            const target = document.getElementById(targetId);
            if (target) target.classList.add('active');

            // 菜单按钮仅在曲库视图显示
            if (mobileMenuBtn) {
                mobileMenuBtn.style.display = (targetId === 'view-library') ? 'flex' : 'none';
            }
        });
    });

    // Sync mobile player view when a song plays
    const origPlaySong = playSong;
    playSong = async function(song, options = {}) {
        await origPlaySong(song, options);
        // Mirror cover / title / artists to mobile player view
        const mCover = document.getElementById('mobile-cover-img');
        const mTitle = document.getElementById('mobile-song-title');
        const mArtists = document.getElementById('mobile-artist-list');
        const mLyrics = document.getElementById('mobile-lyrics-list');
        const deskLyrics = document.getElementById('lyrics-list');

        if (mCover) mCover.src = coverImg.src;
        if (mTitle) mTitle.textContent = songTitle.textContent;
        // 重新构建移动端的专辑与歌手标签，并绑定跨视图跳转点击事件
        if (mArtists) {
            mArtists.innerHTML = "";

            if (song.Album) {
                const btnAlb = document.createElement("button");
                btnAlb.className = "clickable-tag";
                btnAlb.style.fontSize = "12px";
                btnAlb.style.padding = "4px 10px";
                btnAlb.textContent = "💿 " + song.Album;
                btnAlb.addEventListener("click", () => {
                    const libTab = document.querySelector('.tab-item[data-target="view-library"]');
                    if (libTab) libTab.click();
                    const searchInput = document.getElementById("search-input");
                    if (searchInput) searchInput.value = "";
                    filterAndRenderList("album", song.Album);
                });
                mArtists.appendChild(btnAlb);
            }

            if (song.Artists && song.Artists.length > 0) {
                song.Artists.forEach(name => {
                    const btnArt = document.createElement("button");
                    btnArt.className = "artist-pill";
                    btnArt.style.fontSize = "12px";
                    btnArt.style.padding = "4px 10px";
                    btnArt.textContent = "🎤 " + name;
                    btnArt.addEventListener("click", () => {
                        const libTab = document.querySelector('.tab-item[data-target="view-library"]');
                        if (libTab) libTab.click();
                        const searchInput = document.getElementById("search-input");
                        if (searchInput) searchInput.value = "";
                        filterAndRenderList("artist", name);
                    });
                    mArtists.appendChild(btnArt);
                });
            }
        }
        if (mLyrics && deskLyrics) renderMobileLyrics();
    };

    // Sync mobile user view with profile data
    const origLoadUser = loadUserProfile;
    loadUserProfile = async function() {
        await origLoadUser();
        const mAva = document.getElementById('mobile-user-avatar');
        const mNick = document.getElementById('mobile-user-nickname');
        if (mAva) mAva.src = userAvatar.src;
        if (mNick) mNick.textContent = userNickname.textContent;
    };

    // Bind mobile profile buttons to existing modals
    const mobileProfileBtn = document.getElementById('mobile-profile-btn');
    if (mobileProfileBtn) mobileProfileBtn.addEventListener('click', () => openModal(profileModal));

    const mobileStatsBtn = document.getElementById('mobile-view-stats-btn');
    if (mobileStatsBtn) mobileStatsBtn.addEventListener('click', () => viewStatsBtn.click());

    const mobileFavBtn = document.getElementById('mobile-nav-favorites');
    if (mobileFavBtn) mobileFavBtn.addEventListener('click', () => navFavorites.click());

    // Sync mobile weather display
    setInterval(() => {
        const deskWeather = document.getElementById('loc-weather-text');
        const mobWeather = document.getElementById('mobile-loc-weather-text');
        if (deskWeather && mobWeather) {
            mobWeather.innerHTML = deskWeather.innerHTML;
        }
    }, 2000);

    // 修复移动端歌词点击跳转 (事件委托，解决 innerHTML 复制后事件丢失问题)
    const mobileLyricsList = document.getElementById('mobile-lyrics-list');
    if (mobileLyricsList) {
        mobileLyricsList.addEventListener('click', (e) => {
            const li = e.target.closest('li');
            if (li && li.dataset.time) seekToLyricFromElement(li);
        });
    }
})();

// == 移动端地址栏防遮挡控制逻辑 ==
document.addEventListener('DOMContentLoaded', () => {
    const modeSelect = document.getElementById('address-bar-mode');
    const sliderContainer = document.getElementById('offset-slider-container');
    const offsetSlider = document.getElementById('offset-slider');
    const offsetDisplay = document.getElementById('offset-value-display');
    const root = document.documentElement;

    if (!modeSelect || !sliderContainer || !offsetSlider || !offsetDisplay) {
        return;
    }

    // 1. 初始化：读取 localStorage 缓存
    const savedMode = localStorage.getItem('addressBarMode') || 'top';
    // 为什么这么写：确保即便被篡改，最大也不会超过 150px (防御性编程)
    const savedOffset = Math.min(Math.max(parseInt(localStorage.getItem('addressBarOffset') || '80', 10), 0), 150);

    modeSelect.value = savedMode;
    offsetSlider.value = savedOffset;

    // 2. 核心更新函数
    const updateOffset = () => {
        const mode = modeSelect.value;
        let currentOffset = 0;

        if (mode === 'bottom') {
            sliderContainer.style.display = 'block';
            currentOffset = parseInt(offsetSlider.value, 10);
            // 再次进行边界检查
            if (currentOffset > 150) currentOffset = 150;
            offsetDisplay.innerText = `${currentOffset}px`;
        } else {
            sliderContainer.style.display = 'none';
            currentOffset = 0;
        }

        // 通过修改 CSS 变量，实时推升播放条高度
        root.style.setProperty('--bottom-offset', `${currentOffset}px`);

        // 持久化存储
        localStorage.setItem('addressBarMode', mode);
        localStorage.setItem('addressBarOffset', currentOffset);
    };

    // 3. 绑定事件监听
    if(modeSelect && offsetSlider) {
        modeSelect.addEventListener('change', updateOffset);
        offsetSlider.addEventListener('input', updateOffset);

        // 页面加载时执行一次应用初始状态
        updateOffset();
    }
});