/* ─────────────────────────────────────────────────────────────────
 * MusicCloud – Enhanced Vanilla JS Frontend
 * Features: Search, Play Modes, Prev/Next, Animations
 * ──────────────────────────────────────────────────────────────── */

const API_BASE = "";  // same-origin — no cross-origin prefix needed

// ── Service Worker — purge old caches then re‑register ──────────
const UI_BUILD_VERSION = "20260712-i18n-lyrics-notice1";
const UI_BUILD_RELOAD_KEY = "musiccloud_ui_build_reloaded";
if ('caches' in window) {
    caches.keys().then((names) => Promise.all(names.map((name) => caches.delete(name)))).catch(() => {});
}
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistrations().then((registrations) => {
        registrations.forEach((registration) => registration.unregister());
    }).catch(() => {});
}
try {
    if (sessionStorage.getItem(UI_BUILD_RELOAD_KEY) !== UI_BUILD_VERSION) {
        sessionStorage.setItem(UI_BUILD_RELOAD_KEY, UI_BUILD_VERSION);
        if (!location.search.includes('uiBuild=' + UI_BUILD_VERSION)) {
            const url = new URL(location.href);
            url.searchParams.set('uiBuild', UI_BUILD_VERSION);
            location.replace(url.toString());
        }
    }
} catch (e) {}

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
const visualizerToggleBtn = document.getElementById("visualizer-toggle-btn");
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
const adminRefreshBtn = document.getElementById("admin-refresh-btn");
const adminUserList  = document.getElementById("admin-user-list");
const adminBanRefreshBtn = document.getElementById("admin-ban-refresh-btn");
const adminBanActiveOnly = document.getElementById("admin-ban-active-only");
const adminBanList = document.getElementById("admin-ban-list");
const adminMsg       = document.getElementById("admin-msg");
const adminClose     = document.getElementById("admin-close-btn");
const logoutBtn      = document.getElementById("logout-btn");

// Announcement modal
const announcementPanelBtn       = document.getElementById("announcement-panel-btn");
const mobileAnnouncementBtn      = document.getElementById("mobile-announcement-btn");
const announcementModal          = document.getElementById("announcement-modal");
const announcementRefreshBtn     = document.getElementById("announcement-refresh-btn");
const announcementHeaderCloseBtn = document.getElementById("announcement-header-close-btn");
const announcementCreateSection  = document.getElementById("announcement-create-section");
const announcementTitleInput     = document.getElementById("announcement-title-input");
const announcementTargetSelect   = document.getElementById("announcement-target-select");
const announcementPinnedInput    = document.getElementById("announcement-pinned-input");
const announcementBodyInput      = document.getElementById("announcement-body-input");
const announcementFilesInput     = document.getElementById("announcement-files-input");
const announcementFilesList      = document.getElementById("announcement-files-list");
const announcementSubmitBtn      = document.getElementById("announcement-submit-btn");
const announcementCreateMsg      = document.getElementById("announcement-create-msg");
const announcementList           = document.getElementById("announcement-list");
const announcementDetailEmpty    = document.getElementById("announcement-detail-empty");
const announcementDetail         = document.getElementById("announcement-detail");
const announcementDetailTitle    = document.getElementById("announcement-detail-title");
const announcementDetailMeta     = document.getElementById("announcement-detail-meta");
const announcementDetailBody     = document.getElementById("announcement-detail-body");
const announcementDetailFiles    = document.getElementById("announcement-detail-files");
const announcementPinBtn         = document.getElementById("announcement-pin-btn");
const announcementDeleteBtn      = document.getElementById("announcement-delete-btn");
const announcementCloseBtn       = document.getElementById("announcement-close-btn");

// Support ticket modal
const ticketPanelBtn       = document.getElementById("ticket-panel-btn");
const ticketModal          = document.getElementById("ticket-modal");
const ticketRefreshBtn     = document.getElementById("ticket-refresh-btn");
const ticketHeaderCloseBtn = document.getElementById("ticket-header-close-btn");
const ticketCreateSection  = document.getElementById("ticket-create-section");
const ticketListTitle      = document.getElementById("ticket-list-title");
const ticketList           = document.getElementById("ticket-list");
const ticketTitleInput     = document.getElementById("ticket-title-input");
const ticketBodyInput      = document.getElementById("ticket-body-input");
const ticketFilesInput     = document.getElementById("ticket-files-input");
const ticketFilesList      = document.getElementById("ticket-files-list");
const ticketSubmitBtn      = document.getElementById("ticket-submit-btn");
const ticketCreateMsg      = document.getElementById("ticket-create-msg");
const ticketDetailEmpty    = document.getElementById("ticket-detail-empty");
const ticketDetail         = document.getElementById("ticket-detail");
const ticketDetailTitle    = document.getElementById("ticket-detail-title");
const ticketDetailStatus   = document.getElementById("ticket-detail-status");
const ticketDetailMeta     = document.getElementById("ticket-detail-meta");
const ticketMessages       = document.getElementById("ticket-messages");
const ticketReplyBox       = document.getElementById("ticket-reply-box");
const ticketReplyBody      = document.getElementById("ticket-reply-body");
const ticketReplyFiles     = document.getElementById("ticket-reply-files");
const ticketReplyFilesList = document.getElementById("ticket-reply-files-list");
const ticketAdminResultRow = document.getElementById("ticket-admin-result-row");
const ticketAdminResult    = document.getElementById("ticket-admin-result");
const ticketReplySubmitBtn = document.getElementById("ticket-reply-submit-btn");
const ticketReplyMsg       = document.getElementById("ticket-reply-msg");
const ticketCloseBtn       = document.getElementById("ticket-close-btn");

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

// Custom song assets modal
const customAssetModal       = document.getElementById("custom-asset-modal");
const customAssetSongTitle   = document.getElementById("custom-asset-song-title");
const customCoverUpload      = document.getElementById("custom-cover-upload");
const customLyricsText       = document.getElementById("custom-lyrics-text");
const customAssetMsg         = document.getElementById("custom-asset-msg");
const customCoverSaveBtn     = document.getElementById("custom-cover-save-btn");
const customCoverClearBtn    = document.getElementById("custom-cover-clear-btn");
const customLyricsSaveBtn    = document.getElementById("custom-lyrics-save-btn");
const customLyricsClearBtn   = document.getElementById("custom-lyrics-clear-btn");
const customAssetCloseBtn    = document.getElementById("custom-asset-close-btn");

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
    { id: 0, icon: "\u{1F501}", titleKey: "modeList" },
    { id: 1, icon: "\u{1F502}", titleKey: "modeSingle" },
    { id: 2, icon: "\u{1F500}", titleKey: "modeShuffle" }
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
let currentCustomAssetSong = null;
let currentTicketId = null;
let ticketListCache = [];
let currentTicketDetailCache = null;
let ticketAttachmentObjectUrls = [];
let ticketCreateSelectedFiles = [];
let ticketReplySelectedFiles = [];
let announcementListCache = [];
let currentAnnouncementId = null;
let announcementSelectedFiles = [];
let adminUsersCache = [];
let adminBanRecordsCache = [];
let currentWeatherState = null;
let weatherRenderSeq = 0;
let currentIpInfoState = { status: "detecting", ip: "", city: "" };
let ipInfoRenderSeq = 0;
let isNoLyricsNoticeVisible = false;
let announcementAttachmentObjectUrls = [];
const TICKET_USER_MAX_ATTACHMENTS = 9;
const ANNOUNCEMENT_MAX_ATTACHMENTS = 10;
const LAST_PLAYED_KEY = "musiccloud_last_played";

/* ── Auth helpers ──────────────────────────────────────────────── */
function getToken() { return localStorage.getItem("musiccloud_token"); }
function setToken(token) { localStorage.setItem("musiccloud_token", token); }
function hasToken() { return Boolean(getToken()); }
function authHeaders() {
    const token = getToken();
    const headers = { "Content-Type": "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    return headers;
}
let authExpiredHandled = false;
function handleAuthExpired() {
    if (authExpiredHandled) return;
    authExpiredHandled = true;
    localStorage.removeItem("musiccloud_token");
    try { showToast("登录状态已失效，请重新登录", true); } catch (_) {}
    setTimeout(() => window.location.reload(), 700);
}
function requireValidTokenBeforeFetch() {
    if (hasToken()) return true;
    handleAuthExpired();
    return false;
}
function throwIfUnauthorized(resp) {
    if (resp?.status === 401) {
        handleAuthExpired();
        throw new Error("登录状态已失效，请重新登录");
    }
}


const I18N_LANG_KEY = "musiccloud_language";
const I18N_LANGS = ["zh-CN", "zh-TW", "en", "ja", "ko"];
const I18N = {
    "zh-CN": {
        "language": "语言",
        "username": "用户名",
        "password": "密码",
        "login": "登 录",
        "menu": "菜单",
        "avatar": "头像",
        "loadingWeather": "获取天气中...",
        "customWeather": "自定义天气地区",
        "switch": "切换",
        "ipDetecting": "IP: 探测中...",
        "detecting": "探测中...",
        "estimated": "估算",
        "stats": "听歌统计",
        "searchPlaceholder": "搜索歌曲名称或歌手...",
        "profileCenter": "个人中心",
        "adminPanel": "后台管理",
        "logout": "退出账号",
        "noSong": "未播放任何内容",
        "exploreLibrary": "探索你的音乐库",
        "album": "专辑",
        "favorites": "❤️ 我喜欢的音乐",
        "mobilePlayer": "播放器",
        "qualityPreference": "音质偏好：",
        "qualityTitle": "音质选择",
        "visualizerOnTitle": "\u8282\u5f8b\u6761\uff1a\u5f00",
        "visualizerOffTitle": "\u8282\u5f8b\u6761\uff1a\u5173",
        "visualizerSavedOn": "\u8282\u5f8b\u6761\u5df2\u5f00\u542f",
        "visualizerSavedOff": "\u8282\u5f8b\u6761\u5df2\u5173\u95ed",
        "visualizerSaveFailed": "\u8282\u5f8b\u6761\u72b6\u6001\u4fdd\u5b58\u5931\u8d25",
        "prev": "上一曲",
        "next": "下一曲",
        "originalStream": "原声",
        "profileTitle": "个人中心",
        "nickname": "昵称",
        "save": "保存",
        "changePassword": "修改密码",
        "oldPassword": "旧密码",
        "newPassword": "新密码",
        "confirmPassword": "确认新密码",
        "close": "关闭",
        "createUserTitle": "锦衣卫管理",
        "createUserSection": "创建用户",
        "userListTitle": "用户列表",
        "refresh": "刷新",
        "passwordEncryptedNote": "\u5bc6\u7801\u5df2\u52a0\u5bc6\u5b58\u50a8\uff0c\u4e0d\u80fd\u67e5\u770b\u660e\u6587\uff1b\u8fd9\u91cc\u53ea\u5141\u8bb8\u91cd\u7f6e\u666e\u901a\u7528\u6237\u5bc6\u7801\uff0c\u7ba1\u7406\u5458\u5bc6\u7801\u4e0d\u53ef\u66f4\u6539\u3002\u5220\u9664\u7528\u6237\u4ec5 admin \u8d26\u53f7\u53ef\u7528\u3002",
        "passwordUnreadable": "不可查看（已加密存储）",
        "newPasswordPlaceholder": "输入新密码",
        "resetPassword": "重置密码",
        "adminPasswordLocked": "管理员密码不可更改",
        "userListLoadFailed": "用户列表加载失败",
        "userListLoading": "\u6b63\u5728\u52a0\u8f7d\u7528\u6237\u5217\u8868...",
        "passwordResetSuccess": "密码已重置",
        "accountStatus": "状态",
        "accountActive": "启用",
        "accountInactive": "禁用",
        "deleteUser": "\u5220\u9664\u7528\u6237",
        "deleteUserConfirm": "\u8b66\u544a\uff1a\u786e\u8ba4\u5220\u9664\u8d26\u53f7 {username} \u5417\uff1f\n\n\u8be5\u64cd\u4f5c\u4f1a\u5220\u9664\u8be5\u8d26\u53f7\u53ca\u5176\u76f8\u5173\u6570\u636e\uff0c\u4e14\u65e0\u6cd5\u64a4\u9500\u3002",
        "deleteUserSuccess": "\u7528\u6237\u5df2\u5220\u9664",
        "rootAdminOnlyDelete": "\u53ea\u6709 admin \u8d26\u53f7\u53ef\u5220\u9664\u7528\u6237",
        "role": "角色",
        "user": "普通用户",
        "admin": "管理员",
        "createUser": "创建用户",
        "createPlaylistTitle": "新建歌单",
        "playlistName": "歌单名称",
        "create": "创建",
        "selectPlaylistTitle": "添加到歌单",
        "cancel": "取消",
        "weatherLocationTitle": "设定天气展示地区",
        "country": "国家 / 地区",
        "province": "省 / 州",
        "city": "城市",
        "district": "区 / 县",
        "confirm": "确认",
        "myPlaylists": "我的歌单",
        "newPlaylist": "➕ 新建歌单",
        "folders": "文件夹",
        "rootSongs": "根目录歌曲 ({count})",
        "backRoot": "↩️ 返回根目录",
        "backAllSongs": "↩️ 返回所有歌曲",
        "clearFilter": "↩️ 清除筛选并返回",
        "filterResults": "筛选结果：{keyword} ({count})",
        "noMatch": "没有匹配的歌曲",
        "emptyPlaylist": "歌单中暂无歌曲",
        "noPlaylist": "暂无歌单，请先创建",
        "noFavorites": "还没有收藏歌曲",
        "loadFailed": "加载失败",
        "playlistLoadFailed": "加载歌单失败",
        "addToPlaylist": "添加到歌单",
        "customAssets": "自定义封面和歌词",
        "customAssetsShort": "自定义封面/歌词",
        "customCover": "自定义封面",
        "customLyrics": "自定义歌词",
        "coverFileHint": "支持 JPG、PNG、WebP、GIF；保存后优先展示自定义封面。",
        "lyricsHint": "填写 LRC 时间轴文本；留空或清除后回退默认歌词。",
        "saveCover": "保存封面",
        "clearCover": "清除封面",
        "saveLyrics": "保存歌词",
        "clearLyrics": "清除歌词",
        "customAssetsLoaded": "已载入当前自定义内容",
        "customAssetsSaved": "已保存",
        "customAssetsCleared": "已清除，已回退默认内容",
        "chooseCoverFile": "请先选择封面文件",
        "lyricsEmpty": "歌词内容为空，已回退默认歌词",
        "favorite": "喜欢",
        "locateCurrent": "📍 定位当前播放",
        "locateCurrentTitle": "跳转到正在播放的歌曲",
        "syncing": "正在同步...",
        "syncDone": "同步完成",
        "syncFailed": "同步失败",
        "syncError": "同步出错",
        "unknownSong": "未知歌曲",
        "unknownAlbum": "未知专辑",
        "unknownArtist": "未知歌手",
        "unknown": "未知",
        "enterCredentials": "请输入用户名和密码",
        "loginFailed": "登录失败",
        "networkError": "网络错误，无法连接服务器",
        "allFieldsRequired": "请填写所有字段",
        "userCreateSuccess": "用户创建成功",
        "requestFailed": "请求失败",
        "createSuccess": "创建成功",
        "createFailed": "创建失败",
        "enterPlaylistName": "请输入歌单名称",
        "addFailed": "添加失败",
        "addedToPlaylist": "已添加到“{name}”",
        "passwordAllFields": "请填写所有密码字段",
        "passwordMismatch": "两次新密码不一致",
        "passwordTooShort": "新密码至少 4 位",
        "passwordChanged": "密码修改成功，请重新登录",
        "deleteFailed": "删除失败",
        "weatherLoading": "获取天气中...",
        "weatherFailed": "天气获取失败",
        "locationUnknown": "未知地区",
        "fetchingWeather": "正在获取天气...",
        "saveLocationFailed": "保存失败",
        "locationSaved": "地区已保存: {location}",
        "modeList": "当前: 列表循环",
        "modeSingle": "当前: 单曲循环",
        "modeShuffle": "当前: 随机播放"
    },
    "zh-TW": {
        "language": "語言",
        "username": "使用者名稱",
        "password": "密碼",
        "login": "登 入",
        "menu": "菜单",
        "avatar": "Avatar",
        "loadingWeather": "正在取得天氣...",
        "customWeather": "自訂天氣地區",
        "switch": "切換",
        "ipDetecting": "IP: 探測中...",
        "detecting": "探測中...",
        "estimated": "估算",
        "stats": "听歌统计",
        "searchPlaceholder": "搜尋歌曲名稱或歌手...",
        "profileCenter": "個人中心",
        "adminPanel": "後台管理",
        "logout": "登出帳號",
        "noSong": "尚未播放任何內容",
        "exploreLibrary": "探索你的音樂庫",
        "album": "專輯",
        "favorites": "❤️ 我喜歡的音樂",
        "mobilePlayer": "Player",
        "qualityPreference": "音质偏好：",
        "qualityTitle": "音质选择",
        "visualizerOnTitle": "\u7bc0\u5f8b\u689d\uff1a\u958b",
        "visualizerOffTitle": "\u7bc0\u5f8b\u689d\uff1a\u95dc",
        "visualizerSavedOn": "\u7bc0\u5f8b\u689d\u5df2\u958b\u555f",
        "visualizerSavedOff": "\u7bc0\u5f8b\u689d\u5df2\u95dc\u9589",
        "visualizerSaveFailed": "\u7bc0\u5f8b\u689d\u72c0\u614b\u4fdd\u5b58\u5931\u6557",
        "prev": "上一曲",
        "next": "下一曲",
        "originalStream": "Original stream",
        "profileTitle": "个人中心",
        "nickname": "昵称",
        "save": "保存",
        "changePassword": "修改密码",
        "oldPassword": "旧密码",
        "newPassword": "新密码",
        "confirmPassword": "确认新密码",
        "close": "关闭",
        "createUserTitle": "錦衣衛管理",
        "createUserSection": "創建用戶",
        "userListTitle": "用戶列表",
        "refresh": "重新整理",
        "passwordEncryptedNote": "\u5bc6\u78bc\u5df2\u52a0\u5bc6\u5132\u5b58\uff0c\u4e0d\u80fd\u67e5\u770b\u660e\u6587\uff1b\u9019\u88e1\u53ea\u5141\u8a31\u91cd\u8a2d\u666e\u901a\u7528\u6236\u5bc6\u78bc\uff0c\u7ba1\u7406\u54e1\u5bc6\u78bc\u4e0d\u53ef\u66f4\u6539\u3002\u522a\u9664\u7528\u6236\u50c5 admin \u5e33\u865f\u53ef\u7528\u3002",
        "passwordUnreadable": "不可查看（已加密儲存）",
        "newPasswordPlaceholder": "輸入新密碼",
        "resetPassword": "重設密碼",
        "adminPasswordLocked": "管理員密碼不可更改",
        "userListLoadFailed": "用戶列表載入失敗",
        "userListLoading": "\u6b63\u5728\u8f09\u5165\u7528\u6236\u5217\u8868...",
        "passwordResetSuccess": "密碼已重設",
        "accountStatus": "狀態",
        "accountActive": "啟用",
        "accountInactive": "停用",
        "deleteUser": "\u522a\u9664\u7528\u6236",
        "deleteUserConfirm": "\u8b66\u544a\uff1a\u78ba\u8a8d\u522a\u9664\u5e33\u865f {username} \u55ce\uff1f\n\n\u6b64\u64cd\u4f5c\u6703\u522a\u9664\u8a72\u5e33\u865f\u53ca\u5176\u76f8\u95dc\u8cc7\u6599\uff0c\u4e14\u7121\u6cd5\u5fa9\u539f\u3002",
        "deleteUserSuccess": "\u7528\u6236\u5df2\u522a\u9664",
        "rootAdminOnlyDelete": "\u53ea\u6709 admin \u5e33\u865f\u53ef\u522a\u9664\u7528\u6236",
        "role": "角色",
        "user": "普通用户",
        "admin": "管理员",
        "createUser": "创建用户",
        "createPlaylistTitle": "新建歌单",
        "playlistName": "歌单名称",
        "create": "创建",
        "selectPlaylistTitle": "添加到歌单",
        "cancel": "取消",
        "weatherLocationTitle": "设定天气展示地区",
        "country": "国家 / 地区",
        "province": "省 / 州",
        "city": "城市",
        "district": "区 / 县",
        "confirm": "确认",
        "myPlaylists": "我的歌單",
        "newPlaylist": "➕ 新增歌單",
        "folders": "資料夾",
        "rootSongs": "根目錄歌曲 ({count})",
        "backRoot": "↩️ 返回根目錄",
        "backAllSongs": "↩️ 返回所有歌曲",
        "clearFilter": "↩️ 清除篩選並返回",
        "filterResults": "筛选结果：{keyword} ({count})",
        "noMatch": "没有匹配的歌曲",
        "emptyPlaylist": "歌单中暂无歌曲",
        "noPlaylist": "暂无歌单，请先创建",
        "noFavorites": "还没有收藏歌曲",
        "loadFailed": "加载失败",
        "playlistLoadFailed": "加载歌单失败",
        "addToPlaylist": "添加到歌单",
        "customAssets": "自訂封面與歌詞",
        "customAssetsShort": "自訂封面/歌詞",
        "customCover": "自訂封面",
        "customLyrics": "自訂歌詞",
        "coverFileHint": "支援 JPG、PNG、WebP、GIF；儲存後優先顯示自訂封面。",
        "lyricsHint": "填寫 LRC 時間軸文字；留空或清除後回退預設歌詞。",
        "saveCover": "儲存封面",
        "clearCover": "清除封面",
        "saveLyrics": "儲存歌詞",
        "clearLyrics": "清除歌詞",
        "customAssetsLoaded": "已載入目前自訂內容",
        "customAssetsSaved": "已儲存",
        "customAssetsCleared": "已清除，已回退預設內容",
        "chooseCoverFile": "請先選擇封面檔案",
        "lyricsEmpty": "歌詞內容為空，已回退預設歌詞",
        "favorite": "喜欢",
        "locateCurrent": "📍 定位目前播放",
        "locateCurrentTitle": "跳转到正在播放的歌曲",
        "syncing": "正在同步...",
        "syncDone": "同步完成",
        "syncFailed": "同步失败",
        "syncError": "同步出错",
        "unknownSong": "未知歌曲",
        "unknownAlbum": "未知專輯",
        "unknownArtist": "未知歌手",
        "unknown": "Unknown",
        "enterCredentials": "请输入用户名和密码",
        "loginFailed": "登录失败",
        "networkError": "网络错误，无法连接服务器",
        "allFieldsRequired": "Please fill in all fields",
        "userCreateSuccess": "User created",
        "requestFailed": "Request failed",
        "createSuccess": "Created",
        "createFailed": "Create failed",
        "enterPlaylistName": "Please enter a playlist name",
        "addFailed": "Add failed",
        "addedToPlaylist": "Added to \"{name}\"",
        "passwordAllFields": "Please fill in all password fields",
        "passwordMismatch": "The two new passwords do not match",
        "passwordTooShort": "New password must be at least 4 characters",
        "passwordChanged": "Password changed. Please log in again.",
        "deleteFailed": "Delete failed. Please try again later.",
        "weatherLoading": "正在取得天氣...",
        "weatherFailed": "天氣取得失敗",
        "locationUnknown": "未知地區",
        "fetchingWeather": "正在取得天氣...",
        "saveLocationFailed": "Network error. Save failed.",
        "locationSaved": "Location saved: {location}",
        "modeList": "目前: 列表循環",
        "modeSingle": "目前: 單曲循環",
        "modeShuffle": "目前: 隨機播放"
    },
    "en": {
        "language": "Language",
        "username": "Username",
        "password": "Password",
        "login": "Log in",
        "menu": "Menu",
        "avatar": "Avatar",
        "loadingWeather": "Loading weather...",
        "customWeather": "Custom weather location",
        "switch": "Change",
        "ipDetecting": "IP: Detecting...",
        "detecting": "Detecting...",
        "estimated": "Estimated",
        "stats": "Listening stats",
        "searchPlaceholder": "Search songs or artists...",
        "profileCenter": "Profile",
        "adminPanel": "Admin",
        "logout": "Log out",
        "noSong": "Nothing playing",
        "exploreLibrary": "Explore your music library",
        "album": "Album",
        "favorites": "❤️ Liked Songs",
        "mobilePlayer": "Player",
        "qualityPreference": "Quality:",
        "qualityTitle": "Audio quality",
        "visualizerOnTitle": "Rhythm bars: On",
        "visualizerOffTitle": "Rhythm bars: Off",
        "visualizerSavedOn": "Rhythm bars on",
        "visualizerSavedOff": "Rhythm bars off",
        "visualizerSaveFailed": "Failed to save rhythm bar setting",
        "prev": "Previous track",
        "next": "Next track",
        "originalStream": "Original stream",
        "profileTitle": "Profile",
        "nickname": "Nickname",
        "save": "Save",
        "changePassword": "Change password",
        "oldPassword": "Current password",
        "newPassword": "New password",
        "confirmPassword": "Confirm new password",
        "close": "Close",
        "createUserTitle": "Jinyiwei Admin",
        "createUserSection": "Create user",
        "userListTitle": "User list",
        "refresh": "Refresh",
        "passwordEncryptedNote": "Passwords are encrypted and cannot be viewed. You can only reset normal user passwords; admin passwords cannot be changed. User deletion is only available to the admin account.",
        "passwordUnreadable": "Not viewable (encrypted)",
        "newPasswordPlaceholder": "New password",
        "resetPassword": "Reset password",
        "adminPasswordLocked": "Admin password cannot be changed",
        "userListLoadFailed": "Failed to load users",
        "userListLoading": "Loading users...",
        "passwordResetSuccess": "Password reset",
        "accountStatus": "Status",
        "accountActive": "Active",
        "accountInactive": "Disabled",
        "deleteUser": "Delete user",
        "deleteUserConfirm": "Warning: delete account {username}?\n\nThis will delete the account and related data. This action cannot be undone.",
        "deleteUserSuccess": "User deleted",
        "rootAdminOnlyDelete": "Only the admin account can delete users",
        "role": "Role",
        "user": "User",
        "admin": "Admin",
        "createUser": "Create user",
        "createPlaylistTitle": "New playlist",
        "playlistName": "Playlist name",
        "create": "Create",
        "selectPlaylistTitle": "Add to playlist",
        "cancel": "Cancel",
        "weatherLocationTitle": "Weather display location",
        "country": "Country / Region",
        "province": "Province / State",
        "city": "City",
        "district": "District",
        "confirm": "Confirm",
        "myPlaylists": "My Playlists",
        "newPlaylist": "➕ New playlist",
        "folders": "Folders",
        "rootSongs": "Root songs ({count})",
        "backRoot": "↩️ Back to root",
        "backAllSongs": "↩️ Back to all songs",
        "clearFilter": "↩️ Clear filter and go back",
        "filterResults": "Filter results: {keyword} ({count})",
        "noMatch": "No matching songs",
        "emptyPlaylist": "This playlist is empty",
        "noPlaylist": "No playlists yet. Create one first.",
        "noFavorites": "No liked songs yet",
        "loadFailed": "Load failed",
        "playlistLoadFailed": "Failed to load playlist",
        "addToPlaylist": "Add to playlist",
        "customAssets": "Custom cover and lyrics",
        "customAssetsShort": "Custom cover/lyrics",
        "customCover": "Custom cover",
        "customLyrics": "Custom lyrics",
        "coverFileHint": "Supports JPG, PNG, WebP, and GIF. Saved custom covers are shown first.",
        "lyricsHint": "Paste LRC timestamped text. Empty or cleared text falls back to default lyrics.",
        "saveCover": "Save cover",
        "clearCover": "Clear cover",
        "saveLyrics": "Save lyrics",
        "clearLyrics": "Clear lyrics",
        "customAssetsLoaded": "Current custom content loaded",
        "customAssetsSaved": "Saved",
        "customAssetsCleared": "Cleared; default content restored",
        "chooseCoverFile": "Choose a cover file first",
        "lyricsEmpty": "Lyrics are empty; default lyrics restored",
        "favorite": "Like",
        "locateCurrent": "📍 Locate current song",
        "locateCurrentTitle": "Jump to the currently playing song",
        "syncing": "Syncing...",
        "syncDone": "Sync complete",
        "syncFailed": "Sync failed",
        "syncError": "Sync error",
        "unknownSong": "Unknown song",
        "unknownAlbum": "Unknown album",
        "unknownArtist": "Unknown artist",
        "unknown": "Unknown",
        "enterCredentials": "Please enter username and password",
        "loginFailed": "Login failed",
        "networkError": "Network error. Cannot connect to server.",
        "allFieldsRequired": "Please fill in all fields",
        "userCreateSuccess": "User created",
        "requestFailed": "Request failed",
        "createSuccess": "Created",
        "createFailed": "Create failed",
        "enterPlaylistName": "Please enter a playlist name",
        "addFailed": "Add failed",
        "addedToPlaylist": "Added to \"{name}\"",
        "passwordAllFields": "Please fill in all password fields",
        "passwordMismatch": "The two new passwords do not match",
        "passwordTooShort": "New password must be at least 4 characters",
        "passwordChanged": "Password changed. Please log in again.",
        "deleteFailed": "Delete failed. Please try again later.",
        "weatherLoading": "Loading weather...",
        "weatherFailed": "Weather unavailable",
        "locationUnknown": "Location unavailable",
        "fetchingWeather": "Fetching weather...",
        "saveLocationFailed": "Network error. Save failed.",
        "locationSaved": "Location saved: {location}",
        "modeList": "Current: List repeat",
        "modeSingle": "Current: Repeat one",
        "modeShuffle": "Current: Shuffle"
    },
    "ja": {
        "language": "言語",
        "username": "ユーザー名",
        "password": "パスワード",
        "login": "ログイン",
        "menu": "メニュー",
        "avatar": "Avatar",
        "loadingWeather": "天気を取得中...",
        "customWeather": "天気表示地域を設定",
        "switch": "変更",
        "ipDetecting": "IP: 検出中...",
        "detecting": "検出中...",
        "estimated": "推定",
        "stats": "再生統計",
        "searchPlaceholder": "曲名またはアーティストを検索...",
        "profileCenter": "プロフィール",
        "adminPanel": "管理",
        "logout": "ログアウト",
        "noSong": "再生中の曲はありません",
        "exploreLibrary": "音楽ライブラリを探す",
        "album": "アルバム",
        "favorites": "❤️ お気に入り",
        "mobilePlayer": "Player",
        "qualityPreference": "Quality:",
        "qualityTitle": "Audio quality",
        "visualizerOnTitle": "\u30ea\u30ba\u30e0\u30d0\u30fc: \u30aa\u30f3",
        "visualizerOffTitle": "\u30ea\u30ba\u30e0\u30d0\u30fc: \u30aa\u30d5",
        "visualizerSavedOn": "\u30ea\u30ba\u30e0\u30d0\u30fc\u3092\u30aa\u30f3\u306b\u3057\u307e\u3057\u305f",
        "visualizerSavedOff": "\u30ea\u30ba\u30e0\u30d0\u30fc\u3092\u30aa\u30d5\u306b\u3057\u307e\u3057\u305f",
        "visualizerSaveFailed": "\u30ea\u30ba\u30e0\u30d0\u30fc\u8a2d\u5b9a\u306e\u4fdd\u5b58\u306b\u5931\u6557\u3057\u307e\u3057\u305f",
        "prev": "Previous track",
        "next": "Next track",
        "originalStream": "Original stream",
        "profileTitle": "Profile",
        "nickname": "Nickname",
        "save": "Save",
        "changePassword": "Change password",
        "oldPassword": "Current password",
        "newPassword": "New password",
        "confirmPassword": "Confirm new password",
        "close": "Close",
        "createUserTitle": "Jinyiwei Admin",
        "createUserSection": "Create user",
        "userListTitle": "User list",
        "refresh": "Refresh",
        "passwordEncryptedNote": "Passwords are encrypted and cannot be viewed. You can only reset normal user passwords; admin passwords cannot be changed. User deletion is only available to the admin account.",
        "passwordUnreadable": "Not viewable (encrypted)",
        "newPasswordPlaceholder": "New password",
        "resetPassword": "Reset password",
        "adminPasswordLocked": "Admin password cannot be changed",
        "userListLoadFailed": "Failed to load users",
        "userListLoading": "Loading users...",
        "passwordResetSuccess": "Password reset",
        "accountStatus": "Status",
        "accountActive": "Active",
        "accountInactive": "Disabled",
        "deleteUser": "Delete user",
        "deleteUserConfirm": "Warning: delete account {username}?\n\nThis will delete the account and related data. This action cannot be undone.",
        "deleteUserSuccess": "User deleted",
        "rootAdminOnlyDelete": "Only the admin account can delete users",
        "role": "Role",
        "user": "User",
        "admin": "Admin",
        "createUser": "Create user",
        "createPlaylistTitle": "New playlist",
        "playlistName": "Playlist name",
        "create": "Create",
        "selectPlaylistTitle": "Add to playlist",
        "cancel": "Cancel",
        "weatherLocationTitle": "Weather display location",
        "country": "Country / Region",
        "province": "Province / State",
        "city": "City",
        "district": "District",
        "confirm": "Confirm",
        "myPlaylists": "マイプレイリスト",
        "newPlaylist": "➕ 新規プレイリスト",
        "folders": "フォルダー",
        "rootSongs": "ルートの曲 ({count})",
        "backRoot": "↩️ ルートへ戻る",
        "backAllSongs": "↩️ すべての曲へ戻る",
        "clearFilter": "↩️ Clear filter and go back",
        "filterResults": "Filter results: {keyword} ({count})",
        "noMatch": "No matching songs",
        "emptyPlaylist": "This playlist is empty",
        "noPlaylist": "No playlists yet. Create one first.",
        "noFavorites": "No liked songs yet",
        "loadFailed": "Load failed",
        "playlistLoadFailed": "Failed to load playlist",
        "addToPlaylist": "Add to playlist",
        "customAssets": "カスタムカバーと歌詞",
        "customAssetsShort": "カバー/歌詞を編集",
        "customCover": "カスタムカバー",
        "customLyrics": "カスタム歌詞",
        "coverFileHint": "JPG、PNG、WebP、GIF に対応。保存後はカスタムカバーを優先表示します。",
        "lyricsHint": "LRC 形式のタイムスタンプ付き歌詞を入力。空欄または削除で既定歌詞に戻ります。",
        "saveCover": "カバーを保存",
        "clearCover": "カバーを削除",
        "saveLyrics": "歌詞を保存",
        "clearLyrics": "歌詞を削除",
        "customAssetsLoaded": "現在のカスタム内容を読み込みました",
        "customAssetsSaved": "保存しました",
        "customAssetsCleared": "削除しました。既定内容に戻しました",
        "chooseCoverFile": "先にカバー画像を選択してください",
        "lyricsEmpty": "歌詞が空です。既定歌詞に戻しました",
        "favorite": "Like",
        "locateCurrent": "📍 再生中の曲へ",
        "locateCurrentTitle": "Jump to the currently playing song",
        "syncing": "Syncing...",
        "syncDone": "Sync complete",
        "syncFailed": "Sync failed",
        "syncError": "Sync error",
        "unknownSong": "不明な曲",
        "unknownAlbum": "不明なアルバム",
        "unknownArtist": "不明なアーティスト",
        "unknown": "Unknown",
        "enterCredentials": "Please enter username and password",
        "loginFailed": "Login failed",
        "networkError": "Network error. Cannot connect to server.",
        "allFieldsRequired": "Please fill in all fields",
        "userCreateSuccess": "User created",
        "requestFailed": "Request failed",
        "createSuccess": "Created",
        "createFailed": "Create failed",
        "enterPlaylistName": "Please enter a playlist name",
        "addFailed": "Add failed",
        "addedToPlaylist": "Added to \"{name}\"",
        "passwordAllFields": "Please fill in all password fields",
        "passwordMismatch": "The two new passwords do not match",
        "passwordTooShort": "New password must be at least 4 characters",
        "passwordChanged": "Password changed. Please log in again.",
        "deleteFailed": "Delete failed. Please try again later.",
        "weatherLoading": "天気を取得中...",
        "weatherFailed": "天気を取得できません",
        "locationUnknown": "不明な地域",
        "fetchingWeather": "天気を取得中...",
        "saveLocationFailed": "Network error. Save failed.",
        "locationSaved": "Location saved: {location}",
        "modeList": "現在: リストリピート",
        "modeSingle": "現在: 1曲リピート",
        "modeShuffle": "現在: シャッフル"
    },
    "ko": {
        "language": "언어",
        "username": "사용자 이름",
        "password": "비밀번호",
        "login": "로그인",
        "menu": "메뉴",
        "avatar": "Avatar",
        "loadingWeather": "날씨를 가져오는 중...",
        "customWeather": "날씨 표시 지역 설정",
        "switch": "변경",
        "ipDetecting": "IP: 탐지 중...",
        "detecting": "탐지 중...",
        "estimated": "추정",
        "stats": "청취 통계",
        "searchPlaceholder": "곡명 또는 아티스트 검색...",
        "profileCenter": "프로필",
        "adminPanel": "관리",
        "logout": "로그아웃",
        "noSong": "재생 중인 곡 없음",
        "exploreLibrary": "음악 라이브러리 둘러보기",
        "album": "앨범",
        "favorites": "❤️ 좋아요 표시한 음악",
        "mobilePlayer": "Player",
        "qualityPreference": "Quality:",
        "qualityTitle": "Audio quality",
        "visualizerOnTitle": "\ub9ac\ub4ec \ubc14: \ucf2c",
        "visualizerOffTitle": "\ub9ac\ub4ec \ubc14: \ub054",
        "visualizerSavedOn": "\ub9ac\ub4ec \ubc14\ub97c \ucf30\uc2b5\ub2c8\ub2e4",
        "visualizerSavedOff": "\ub9ac\ub4ec \ubc14\ub97c \ub035\uc2b5\ub2c8\ub2e4",
        "visualizerSaveFailed": "\ub9ac\ub4ec \ubc14 \uc124\uc815 \uc800\uc7a5\uc5d0 \uc2e4\ud328\ud588\uc2b5\ub2c8\ub2e4",
        "prev": "Previous track",
        "next": "Next track",
        "originalStream": "Original stream",
        "profileTitle": "Profile",
        "nickname": "Nickname",
        "save": "Save",
        "changePassword": "Change password",
        "oldPassword": "Current password",
        "newPassword": "New password",
        "confirmPassword": "Confirm new password",
        "close": "Close",
        "createUserTitle": "Jinyiwei Admin",
        "createUserSection": "Create user",
        "userListTitle": "User list",
        "refresh": "Refresh",
        "passwordEncryptedNote": "Passwords are encrypted and cannot be viewed. You can only reset normal user passwords; admin passwords cannot be changed. User deletion is only available to the admin account.",
        "passwordUnreadable": "Not viewable (encrypted)",
        "newPasswordPlaceholder": "New password",
        "resetPassword": "Reset password",
        "adminPasswordLocked": "Admin password cannot be changed",
        "userListLoadFailed": "Failed to load users",
        "userListLoading": "Loading users...",
        "passwordResetSuccess": "Password reset",
        "accountStatus": "Status",
        "accountActive": "Active",
        "accountInactive": "Disabled",
        "deleteUser": "Delete user",
        "deleteUserConfirm": "Warning: delete account {username}?\n\nThis will delete the account and related data. This action cannot be undone.",
        "deleteUserSuccess": "User deleted",
        "rootAdminOnlyDelete": "Only the admin account can delete users",
        "role": "Role",
        "user": "User",
        "admin": "Admin",
        "createUser": "Create user",
        "createPlaylistTitle": "New playlist",
        "playlistName": "Playlist name",
        "create": "Create",
        "selectPlaylistTitle": "Add to playlist",
        "cancel": "Cancel",
        "weatherLocationTitle": "Weather display location",
        "country": "Country / Region",
        "province": "Province / State",
        "city": "City",
        "district": "District",
        "confirm": "Confirm",
        "myPlaylists": "내 플레이리스트",
        "newPlaylist": "➕ 새 플레이리스트",
        "folders": "폴더",
        "rootSongs": "루트 곡 ({count})",
        "backRoot": "↩️ 루트로 돌아가기",
        "backAllSongs": "↩️ 모든 곡으로 돌아가기",
        "clearFilter": "↩️ Clear filter and go back",
        "filterResults": "Filter results: {keyword} ({count})",
        "noMatch": "No matching songs",
        "emptyPlaylist": "This playlist is empty",
        "noPlaylist": "No playlists yet. Create one first.",
        "noFavorites": "No liked songs yet",
        "loadFailed": "Load failed",
        "playlistLoadFailed": "Failed to load playlist",
        "addToPlaylist": "Add to playlist",
        "customAssets": "사용자 지정 표지와 가사",
        "customAssetsShort": "표지/가사 편집",
        "customCover": "사용자 지정 표지",
        "customLyrics": "사용자 지정 가사",
        "coverFileHint": "JPG, PNG, WebP, GIF를 지원합니다. 저장하면 사용자 지정 표지를 먼저 표시합니다.",
        "lyricsHint": "LRC 타임스탬프 가사를 입력하세요. 비우거나 삭제하면 기본 가사로 돌아갑니다.",
        "saveCover": "표지 저장",
        "clearCover": "표지 삭제",
        "saveLyrics": "가사 저장",
        "clearLyrics": "가사 삭제",
        "customAssetsLoaded": "현재 사용자 지정 내용을 불러왔습니다",
        "customAssetsSaved": "저장됨",
        "customAssetsCleared": "삭제됨; 기본 내용으로 돌아갔습니다",
        "chooseCoverFile": "먼저 표지 파일을 선택하세요",
        "lyricsEmpty": "가사가 비어 있어 기본 가사로 돌아갔습니다",
        "favorite": "Like",
        "locateCurrent": "📍 현재 곡 찾기",
        "locateCurrentTitle": "Jump to the currently playing song",
        "syncing": "Syncing...",
        "syncDone": "Sync complete",
        "syncFailed": "Sync failed",
        "syncError": "Sync error",
        "unknownSong": "알 수 없는 곡",
        "unknownAlbum": "알 수 없는 앨범",
        "unknownArtist": "알 수 없는 아티스트",
        "unknown": "Unknown",
        "enterCredentials": "Please enter username and password",
        "loginFailed": "Login failed",
        "networkError": "Network error. Cannot connect to server.",
        "allFieldsRequired": "Please fill in all fields",
        "userCreateSuccess": "User created",
        "requestFailed": "Request failed",
        "createSuccess": "Created",
        "createFailed": "Create failed",
        "enterPlaylistName": "Please enter a playlist name",
        "addFailed": "Add failed",
        "addedToPlaylist": "Added to \"{name}\"",
        "passwordAllFields": "Please fill in all password fields",
        "passwordMismatch": "The two new passwords do not match",
        "passwordTooShort": "New password must be at least 4 characters",
        "passwordChanged": "Password changed. Please log in again.",
        "deleteFailed": "Delete failed. Please try again later.",
        "weatherLoading": "날씨를 가져오는 중...",
        "weatherFailed": "날씨를 가져올 수 없음",
        "locationUnknown": "알 수 없는 지역",
        "fetchingWeather": "날씨를 가져오는 중...",
        "saveLocationFailed": "Network error. Save failed.",
        "locationSaved": "Location saved: {location}",
        "modeList": "현재: 목록 반복",
        "modeSingle": "현재: 한 곡 반복",
        "modeShuffle": "현재: 셔플"
    }
};

const I18N_EXTRA = {
    "zh-CN": {
        "authExpired": "登录状态已失效，请重新登录",
        "mobileTabLibrary": "🎵 曲库",
        "mobileTabPlayer": "🎤 播放",
        "mobileTabMine": "👤 我的",
        "like": "喜欢",
        "remove": "移除",
        "attachment": "附件",
        "attachmentLoadFailed": "加载失败",
        "selectedAttachmentsContinue": "已选择 {count} 个附件，可继续添加或移除",
        "selectedAttachments": "已选择 {count} 个附件",
        "attachmentLimit": "最多只能上传 {count} 个附件",
        "userAttachmentLimit": "普通用户最多只能上传 {count} 个附件",
        "duplicateAttachmentsIgnored": "已忽略重复选择的附件",
        "attachmentTooLarge": "附件 {name} 超过 100MB",
        "ticketTitle": "工单 / 联系开发者",
        "ticketModalTitle": "🎫 工单 / 联系开发者",
        "ticketIntro": "反馈问题、Bug 或补充说明，支持 Markdown 和媒体附件。",
        "ticketCreateTitle": "✍️ 提交新工单",
        "ticketTitlePlaceholder": "请简要描述问题，例如：歌词无法显示",
        "ticketBodyPlaceholder": "请填写问题详情，支持 Markdown。",
        "ticketFileHint": "普通用户：单个附件最大 100MB，最多 9 个附件；可多次点击选择文件累加。",
        "ticketShortcutSubmit": "Ctrl + Enter 提交",
        "ticketSubmit": "提交工单",
        "myTickets": "我的工单",
        "allTickets": "全部工单",
        "ticketSelectDetail": "请选择一个工单查看详情。",
        "ticketAdminResult": "处理结果",
        "ticketResultFollowing": "暂无法处理，跟进中",
        "ticketResultProcessed": "已处理",
        "ticketResultRejected": "已拒绝",
        "ticketShortcutSend": "Ctrl + Enter 发送",
        "ticketReplyPlaceholder": "继续补充说明或回复，支持 Markdown。",
        "ticketReplySubmit": "发送回复",
        "ticketEmpty": "暂无工单。",
        "ticketLoading": "加载中...",
        "ticketLoadFailed": "工单加载失败",
        "ticketDetailLoadFailed": "工单详情加载失败",
        "ticketMessagesCount": "{count} 条消息",
        "ticketSubmitTitleRequired": "请填写工单标题",
        "ticketSubmitBodyRequired": "请填写问题描述或上传附件",
        "ticketSubmitting": "正在提交...",
        "ticketSubmitFailed": "提交失败",
        "ticketSubmitted": "工单已提交",
        "ticketReplyRequired": "请填写回复内容或上传附件",
        "ticketSending": "正在发送...",
        "ticketSendFailed": "发送失败",
        "ticketSent": "已发送",
        "submitter": "提交人",
        "createdAt": "创建",
        "updatedAt": "更新",
        "developerAdmin": "开发者 / 管理员",
        "contactDeveloper": "联系开发者",
        "announcementTitle": "公告",
        "announcementModalTitle": "📢 公告",
        "announcementIntro": "管理员可以向全体成员或指定成员发布公告，支持 Markdown 和附件。",
        "announcementCreateTitle": "✍️ 发布公告",
        "announcementTitlePlaceholder": "公告标题",
        "announcementTargetAria": "公告发送对象",
        "announcementAllMembers": "全体成员",
        "announcementPinnedAfterPublish": "发布后置顶",
        "announcementBodyPlaceholder": "公告正文，支持 Markdown。",
        "announcementFileHint": "公告附件：单个最大 100MB，最多 10 个；禁止上传可执行脚本、HTML、SVG 等高风险文件。",
        "announcementShortcutPublish": "Ctrl + Enter 发布",
        "announcementSubmit": "发布公告",
        "announcementListTitle": "📌 公告列表",
        "announcementSelectDetail": "请选择一条公告查看详情。",
        "announcementPin": "置顶",
        "announcementUnpin": "取消置顶",
        "announcementDelete": "删除",
        "announcementEmpty": "暂无公告。",
        "announcementLoadFailed": "公告加载失败",
        "announcementDetailLoadFailed": "公告详情加载失败",
        "announcementPublishTitleRequired": "请填写公告标题",
        "announcementPublishBodyRequired": "请填写公告内容或上传附件",
        "announcementPublishing": "正在发布...",
        "announcementPublishFailed": "发布失败",
        "announcementPublished": "公告已发布",
        "announcementPinUpdateFailed": "公告置顶更新失败",
        "announcementDeleteConfirm": "确定删除这条公告？删除后成员将不再看到。",
        "announcementDeleted": "公告已删除",
        "announcementDeleteFailed": "公告删除失败",
        "announcementMaxAttachments": "公告最多只能上传 {count} 个附件",
        "announcementPinnedBadge": "置顶",
        "announcementSender": "发布人",
        "announcementTarget": "对象",
        "announcementTime": "时间",
        "adminBanTitle": "BAN管理",
        "adminBanActiveOnly": "只看生效中",
        "adminBanRefresh": "刷新BAN记录",
        "adminBanNote": "这里显示封禁人、封禁时间、封禁原因、解封人、解封时间和解封原因。手动BAN留空时长表示永久BAN。",
        "banPermanent": "永久",
        "banSubjectUserFallback": "用户",
        "banScopeAll": "全站（所有功能）",
        "banScopeLogin": "登录",
        "banScopeRefresh": "登录续期",
        "banScopeStream": "播放/音频流",
        "banScopeTicketCreate": "创建工单",
        "banScopeTicketReply": "回复工单",
        "banScopeAvatar": "上传头像",
        "banScopeStats": "播放统计写入",
        "banScopePlaylist": "歌单编辑",
        "banScopeFavorite": "收藏操作",
        "banScopeWeather": "天气接口",
        "banScopeRegion": "地区搜索",
        "banStatusActive": "生效中",
        "banStatusRevoked": "已解除",
        "banEmpty": "暂无BAN记录",
        "banRange": "范围",
        "banStatus": "状态",
        "banCreator": "封禁人",
        "banTime": "封禁时间",
        "banUntil": "到期",
        "banReason": "原因",
        "banEvidence": "证据",
        "banRevoker": "解封人",
        "banRevokeTime": "解封时间",
        "banRevokeReason": "解封原因",
        "banUnknown": "未知",
        "banNotFilled": "未填写",
        "banLoading": "正在加载BAN记录...",
        "banLoadFailed": "BAN记录加载失败",
        "banButton": "BAN",
        "banUnbanButton": "解除BAN",
        "banPromptReason": "请输入BAN原因（用户：{username}）",
        "banDefaultReason": "违反使用规则或存在异常行为",
        "banPromptHours": "请输入封禁时长（小时），例如 24 或 48；留空表示永久BAN",
        "banConfirm": "确认BAN用户 {username}？\n封禁时长：{duration}",
        "banFailed": "BAN失败",
        "banSuccess": "BAN成功",
        "banPromptRevokeReason": "请输入解除BAN原因（用户：{username}）",
        "banDefaultRevokeReason": "管理员解除BAN",
        "banRevokeConfirm": "确认解除用户 {username} 的BAN？",
        "banRevokeFailed": "解除BAN失败",
        "banRevokeSuccess": "已解除BAN",
        "statsReportTitle": "🎵 你的听歌报告",
        "statsLoading": "正在拉取数据...",
        "statsEmpty": "你还没有听过任何歌曲哦，快去听听看吧！",
        "statsTopSongs": "👑 最爱单曲 Top {count}",
        "statsTopArtists": "🎤 最爱歌手 Top {count}",
        "statsFetchFailed": "获取统计数据失败",
        "playCount": "{count} 次",
        "profileNicknameEmpty": "昵称不能为空",
        "profileNicknameUpdated": "昵称已更新",
        "profileUpdateFailed": "更新失败",
        "profileAvatarUpdated": "头像已更新",
        "profileAvatarUploadFailed": "上传失败",
        "passwordChangeFailed": "密码修改失败",
        "deletePlaylistTitle": "删除歌单",
        "deletePlaylistConfirm": "确定要永久删除歌单 “{name}” 吗？此操作不可逆。",
        "deletePlaylistFailed": "删除失败，请稍后重试",
        "filterHeader": "🔍 筛选结果: {keyword} ({count})",
        "qualityOriginalHiRes": "原声 (Hi-Res)",
        "qualityLossless4416": "无损 (44.1k/16bit)",
        "qualityHigh320": "极高 (320kbps)",
        "qualityStandard128": "标准 (128kbps)",
        "qualityLosslessOriginal": "无损 (原声)",
        "qualityHighOriginal": "极高 (原声)",
        "qualityStandardOriginal": "标准 (原声)",
        "audioInfoFallback": "无法获取音频属性，采用默认选项",
        "noLyricsTitle": "该歌曲的歌词暂时无法显示",
        "noLyricsIntro": "可能原因如下（按常见程度由高到低排列）：",
        "noLyricsReason1": "该歌曲可能为纯音乐、伴奏、现场片段或采样片段，本身没有可同步展示的歌词。",
        "noLyricsReason2": "歌曲语种较少见，或作品较冷门，公开歌词资源暂未收录。",
        "noLyricsReason3": "受版权、内容审核或平台规则影响，歌词平台暂时无法提供该歌曲歌词。",
        "noLyricsReason4": "歌曲标题、歌手、专辑等元数据与歌词库不完全匹配，导致自动匹配失败。",
        "noLyricsReason5": "当前歌词接口、网络连接或第三方歌词服务临时异常，请稍后重试。",
        "noLyricsFooterPrefix": "如有需要或者疑问，请",
        "currentSong": "当前歌曲",
        "lyricsTicketTitle": "歌词问题反馈：{song}",
        "lyricsTicketBody": "歌曲：{song}\n\n问题说明：该歌曲歌词暂时无法显示。",
        "selectCompleteRegion": "请选择完整地区",
        "locationSaveFailedDetail": "保存失败: {detail}",
        "locationSaveNetworkFailed": "网络错误，保存失败",
        "syncLibraryErrorText": "❌ 同步出错",
        "songListFetchFailed": "获取歌曲列表失败",
        "playlistFetchFailed": "获取歌单失败",
        "playlistLoadFailedInline": "加载歌单失败"
    },
    "en": {
        "authExpired": "Your session has expired. Please log in again",
        "mobileTabLibrary": "🎵 Library",
        "mobileTabPlayer": "🎤 Player",
        "mobileTabMine": "👤 Me",
        "like": "Like",
        "remove": "Remove",
        "attachment": "Attachment",
        "attachmentLoadFailed": "Load failed",
        "selectedAttachmentsContinue": "{count} attachments selected. You can add or remove more.",
        "selectedAttachments": "{count} attachments selected",
        "attachmentLimit": "You can upload up to {count} attachments",
        "userAttachmentLimit": "Normal users can upload up to {count} attachments",
        "duplicateAttachmentsIgnored": "Duplicate attachment selections ignored",
        "attachmentTooLarge": "Attachment {name} exceeds 100MB",
        "ticketTitle": "Tickets / Contact developer",
        "ticketModalTitle": "🎫 Tickets / Contact developer",
        "ticketIntro": "Report issues, bugs, or add details. Markdown and media attachments are supported.",
        "ticketCreateTitle": "✍️ New ticket",
        "ticketTitlePlaceholder": "Briefly describe the issue, e.g. lyrics do not show",
        "ticketBodyPlaceholder": "Describe the issue. Markdown is supported.",
        "ticketFileHint": "Normal users: each attachment can be up to 100MB, up to 9 attachments. You can click file selection multiple times to add more.",
        "ticketShortcutSubmit": "Ctrl + Enter to submit",
        "ticketSubmit": "Submit ticket",
        "myTickets": "My tickets",
        "allTickets": "All tickets",
        "ticketSelectDetail": "Select a ticket to view details.",
        "ticketAdminResult": "Result",
        "ticketResultFollowing": "Cannot resolve yet; following up",
        "ticketResultProcessed": "Resolved",
        "ticketResultRejected": "Rejected",
        "ticketShortcutSend": "Ctrl + Enter to send",
        "ticketReplyPlaceholder": "Add more details or reply. Markdown is supported.",
        "ticketReplySubmit": "Send reply",
        "ticketEmpty": "No tickets yet.",
        "ticketLoading": "Loading...",
        "ticketLoadFailed": "Failed to load tickets",
        "ticketDetailLoadFailed": "Failed to load ticket details",
        "ticketMessagesCount": "{count} messages",
        "ticketSubmitTitleRequired": "Please enter a ticket title",
        "ticketSubmitBodyRequired": "Please describe the issue or upload an attachment",
        "ticketSubmitting": "Submitting...",
        "ticketSubmitFailed": "Submit failed",
        "ticketSubmitted": "Ticket submitted",
        "ticketReplyRequired": "Please enter a reply or upload an attachment",
        "ticketSending": "Sending...",
        "ticketSendFailed": "Send failed",
        "ticketSent": "Sent",
        "submitter": "Submitter",
        "createdAt": "Created",
        "updatedAt": "Updated",
        "developerAdmin": "Developer / Admin",
        "contactDeveloper": "contact the developer",
        "announcementTitle": "Announcement",
        "announcementModalTitle": "📢 Announcements",
        "announcementIntro": "Admins can publish announcements to all members or selected members. Markdown and attachments are supported.",
        "announcementCreateTitle": "✍️ Publish announcement",
        "announcementTitlePlaceholder": "Announcement title",
        "announcementTargetAria": "Announcement recipients",
        "announcementAllMembers": "All members",
        "announcementPinnedAfterPublish": "Pin after publishing",
        "announcementBodyPlaceholder": "Announcement body. Markdown is supported.",
        "announcementFileHint": "Announcement attachments: each file up to 100MB, up to 10 files. Executable scripts, HTML, SVG, and other high-risk files are blocked.",
        "announcementShortcutPublish": "Ctrl + Enter to publish",
        "announcementSubmit": "Publish announcement",
        "announcementListTitle": "📌 Announcements",
        "announcementSelectDetail": "Select an announcement to view details.",
        "announcementPin": "Pin",
        "announcementUnpin": "Unpin",
        "announcementDelete": "Delete",
        "announcementEmpty": "No announcements yet.",
        "announcementLoadFailed": "Failed to load announcements",
        "announcementDetailLoadFailed": "Failed to load announcement details",
        "announcementPublishTitleRequired": "Please enter an announcement title",
        "announcementPublishBodyRequired": "Please enter announcement content or upload an attachment",
        "announcementPublishing": "Publishing...",
        "announcementPublishFailed": "Publish failed",
        "announcementPublished": "Announcement published",
        "announcementPinUpdateFailed": "Failed to update pin status",
        "announcementDeleteConfirm": "Delete this announcement? Members will no longer see it after deletion.",
        "announcementDeleted": "Announcement deleted",
        "announcementDeleteFailed": "Failed to delete announcement",
        "announcementMaxAttachments": "Announcements can include up to {count} attachments",
        "announcementPinnedBadge": "Pinned",
        "announcementSender": "Sender",
        "announcementTarget": "Target",
        "announcementTime": "Time",
        "adminBanTitle": "BAN management",
        "adminBanActiveOnly": "Active only",
        "adminBanRefresh": "Refresh BAN records",
        "adminBanNote": "Shows who banned, ban time, reason, who revoked, revoke time, and revoke reason. Leave manual BAN duration empty for a permanent BAN.",
        "banPermanent": "Permanent",
        "banSubjectUserFallback": "User",
        "banScopeAll": "Site-wide (all features)",
        "banScopeLogin": "Login",
        "banScopeRefresh": "Login refresh",
        "banScopeStream": "Playback/audio stream",
        "banScopeTicketCreate": "Create ticket",
        "banScopeTicketReply": "Reply to ticket",
        "banScopeAvatar": "Upload avatar",
        "banScopeStats": "Write playback stats",
        "banScopePlaylist": "Edit playlist",
        "banScopeFavorite": "Favorite action",
        "banScopeWeather": "Weather API",
        "banScopeRegion": "Region search",
        "banStatusActive": "Active",
        "banStatusRevoked": "Revoked",
        "banEmpty": "No BAN records",
        "banRange": "Scope",
        "banStatus": "Status",
        "banCreator": "Banned by",
        "banTime": "Ban time",
        "banUntil": "Until",
        "banReason": "Reason",
        "banEvidence": "Evidence",
        "banRevoker": "Revoked by",
        "banRevokeTime": "Revoke time",
        "banRevokeReason": "Revoke reason",
        "banUnknown": "Unknown",
        "banNotFilled": "Not provided",
        "banLoading": "Loading BAN records...",
        "banLoadFailed": "Failed to load BAN records",
        "banButton": "BAN",
        "banUnbanButton": "Revoke BAN",
        "banPromptReason": "Enter BAN reason (user: {username})",
        "banDefaultReason": "Violation of rules or abnormal behavior",
        "banPromptHours": "Enter BAN duration in hours, e.g. 24 or 48. Leave empty for permanent BAN",
        "banConfirm": "BAN user {username}?\nDuration: {duration}",
        "banFailed": "BAN failed",
        "banSuccess": "BAN succeeded",
        "banPromptRevokeReason": "Enter BAN revoke reason (user: {username})",
        "banDefaultRevokeReason": "Admin revoked BAN",
        "banRevokeConfirm": "Revoke BAN for user {username}?",
        "banRevokeFailed": "Failed to revoke BAN",
        "banRevokeSuccess": "BAN revoked",
        "statsReportTitle": "🎵 Your listening report",
        "statsLoading": "Fetching data...",
        "statsEmpty": "You have not listened to any songs yet. Go play something.",
        "statsTopSongs": "👑 Top songs {count}",
        "statsTopArtists": "🎤 Top artists {count}",
        "statsFetchFailed": "Failed to fetch stats",
        "playCount": "{count} plays",
        "profileNicknameEmpty": "Nickname cannot be empty",
        "profileNicknameUpdated": "Nickname updated",
        "profileUpdateFailed": "Update failed",
        "profileAvatarUpdated": "Avatar updated",
        "profileAvatarUploadFailed": "Upload failed",
        "passwordChangeFailed": "Password change failed",
        "deletePlaylistTitle": "Delete playlist",
        "deletePlaylistConfirm": "Permanently delete playlist “{name}”? This cannot be undone.",
        "deletePlaylistFailed": "Delete failed. Please try again later.",
        "filterHeader": "🔍 Filter results: {keyword} ({count})",
        "qualityOriginalHiRes": "Original (Hi-Res)",
        "qualityLossless4416": "Lossless (44.1k/16bit)",
        "qualityHigh320": "High (320kbps)",
        "qualityStandard128": "Standard (128kbps)",
        "qualityLosslessOriginal": "Lossless (original)",
        "qualityHighOriginal": "High (original)",
        "qualityStandardOriginal": "Standard (original)",
        "audioInfoFallback": "Could not fetch audio attributes; using default options",
        "noLyricsTitle": "Lyrics are not available for this song",
        "noLyricsIntro": "Possible reasons, from most to least common:",
        "noLyricsReason1": "The song may be instrumental, accompaniment, a live segment, or a sample without synced lyrics.",
        "noLyricsReason2": "The language may be uncommon or the work may be obscure, so public lyric sources have not indexed it yet.",
        "noLyricsReason3": "Copyright, moderation, or platform rules may prevent lyric providers from offering lyrics for this song.",
        "noLyricsReason4": "Song title, artist, or album metadata may not fully match lyric databases, causing automatic matching to fail.",
        "noLyricsReason5": "The lyric API, network connection, or third-party lyric service may be temporarily unavailable. Try again later.",
        "noLyricsFooterPrefix": "If needed or if you have questions, please",
        "currentSong": "current song",
        "lyricsTicketTitle": "Lyrics issue: {song}",
        "lyricsTicketBody": "Song: {song}\n\nIssue: lyrics are currently unavailable for this song.",
        "selectCompleteRegion": "Please select a complete region",
        "locationSaveFailedDetail": "Save failed: {detail}",
        "locationSaveNetworkFailed": "Network error. Save failed.",
        "syncLibraryErrorText": "❌ Sync error",
        "songListFetchFailed": "Failed to fetch song list",
        "playlistFetchFailed": "Failed to fetch playlist",
        "playlistLoadFailedInline": "Failed to load playlist"
    },
    "zh-TW": {
        "authExpired": "登入狀態已失效，請重新登入",
        "mobileTabLibrary": "🎵 曲库",
        "mobileTabPlayer": "🎤 播放",
        "mobileTabMine": "👤 我的",
        "like": "喜歡",
        "remove": "移除",
        "attachment": "附件",
        "attachmentLoadFailed": "載入失敗",
        "selectedAttachmentsContinue": "已選擇 {count} 个附件，可繼續新增或移除",
        "selectedAttachments": "已選擇 {count} 个附件",
        "attachmentLimit": "最多只能上傳 {count} 个附件",
        "userAttachmentLimit": "一般使用者最多只能上傳 {count} 个附件",
        "duplicateAttachmentsIgnored": "已忽略重複選擇的附件",
        "attachmentTooLarge": "附件 {name} 超過 100MB",
        "ticketTitle": "工單 / 聯絡開發者",
        "ticketModalTitle": "🎫 工單 / 聯絡開發者",
        "ticketIntro": "回報問題、Bug 或補充說明，支援 Markdown 和媒體附件。",
        "ticketCreateTitle": "✍️ 提交新工單",
        "ticketTitlePlaceholder": "請简要描述問題，例如：歌詞無法顯示",
        "ticketBodyPlaceholder": "請填寫問題詳情，支援 Markdown。",
        "ticketFileHint": "一般使用者：单个附件最大 100MB，最多 9 个附件；可多次点击選擇檔案累加。",
        "ticketShortcutSubmit": "Ctrl + Enter 提交",
        "ticketSubmit": "提交工單",
        "myTickets": "我的工單",
        "allTickets": "全部工單",
        "ticketSelectDetail": "請選擇一个工單查看詳情。",
        "ticketAdminResult": "处理結果",
        "ticketResultFollowing": "暂無法处理，跟进中",
        "ticketResultProcessed": "已处理",
        "ticketResultRejected": "已拒绝",
        "ticketShortcutSend": "Ctrl + Enter 傳送",
        "ticketReplyPlaceholder": "繼續補充說明或回覆，支援 Markdown。",
        "ticketReplySubmit": "傳送回覆",
        "ticketEmpty": "暂无工單。",
        "ticketLoading": "載入中...",
        "ticketLoadFailed": "工單載入失敗",
        "ticketDetailLoadFailed": "工單詳情載入失敗",
        "ticketMessagesCount": "{count} 条訊息",
        "ticketSubmitTitleRequired": "請填寫工單標題",
        "ticketSubmitBodyRequired": "請填寫問題描述或上傳附件",
        "ticketSubmitting": "正在提交...",
        "ticketSubmitFailed": "提交失敗",
        "ticketSubmitted": "工單已提交",
        "ticketReplyRequired": "請填寫回覆内容或上傳附件",
        "ticketSending": "正在傳送...",
        "ticketSendFailed": "傳送失敗",
        "ticketSent": "已傳送",
        "submitter": "提交人",
        "createdAt": "建立",
        "updatedAt": "更新",
        "developerAdmin": "開發者 / 管理員",
        "contactDeveloper": "聯絡開發者",
        "announcementTitle": "公告",
        "announcementModalTitle": "📢 公告",
        "announcementIntro": "管理員可以向全體成員或指定成員發布公告，支援 Markdown 和附件。",
        "announcementCreateTitle": "✍️ 發布公告",
        "announcementTitlePlaceholder": "公告標題",
        "announcementTargetAria": "公告傳送對象",
        "announcementAllMembers": "全體成員",
        "announcementPinnedAfterPublish": "發布後置頂",
        "announcementBodyPlaceholder": "公告正文，支援 Markdown。",
        "announcementFileHint": "公告附件：单个最大 100MB，最多 10 个；禁止上傳可執行脚本、HTML、SVG 等高風險檔案。",
        "announcementShortcutPublish": "Ctrl + Enter 發布",
        "announcementSubmit": "發布公告",
        "announcementListTitle": "📌 公告列表",
        "announcementSelectDetail": "請選擇一条公告查看詳情。",
        "announcementPin": "置頂",
        "announcementUnpin": "取消置頂",
        "announcementDelete": "刪除",
        "announcementEmpty": "暂无公告。",
        "announcementLoadFailed": "公告載入失敗",
        "announcementDetailLoadFailed": "公告詳情載入失敗",
        "announcementPublishTitleRequired": "請填寫公告標題",
        "announcementPublishBodyRequired": "請填寫公告内容或上傳附件",
        "announcementPublishing": "正在發布...",
        "announcementPublishFailed": "發布失敗",
        "announcementPublished": "公告已發布",
        "announcementPinUpdateFailed": "公告置頂更新失敗",
        "announcementDeleteConfirm": "確定刪除这条公告？刪除後成員将不再看到。",
        "announcementDeleted": "公告已刪除",
        "announcementDeleteFailed": "公告刪除失敗",
        "announcementMaxAttachments": "公告最多只能上傳 {count} 个附件",
        "announcementPinnedBadge": "置頂",
        "announcementSender": "發布人",
        "announcementTarget": "對象",
        "announcementTime": "时间",
        "adminBanTitle": "BAN管理",
        "adminBanActiveOnly": "只看生效中",
        "adminBanRefresh": "刷新BAN記錄",
        "adminBanNote": "這裡顯示封禁人、封禁时间、封禁原因、解封人、解封时间和解封原因。手动BAN留空時長表示永久BAN。",
        "banPermanent": "永久",
        "banSubjectUserFallback": "用户",
        "banScopeAll": "全站（所有功能）",
        "banScopeLogin": "登入",
        "banScopeRefresh": "登入续期",
        "banScopeStream": "播放/音訊流",
        "banScopeTicketCreate": "建立工單",
        "banScopeTicketReply": "回覆工單",
        "banScopeAvatar": "上傳頭像",
        "banScopeStats": "播放統計寫入",
        "banScopePlaylist": "歌單編輯",
        "banScopeFavorite": "收藏操作",
        "banScopeWeather": "天氣介面",
        "banScopeRegion": "地區搜尋",
        "banStatusActive": "生效中",
        "banStatusRevoked": "已解除",
        "banEmpty": "暂无BAN記錄",
        "banRange": "範圍",
        "banStatus": "狀態",
        "banCreator": "封禁人",
        "banTime": "封禁时间",
        "banUntil": "到期",
        "banReason": "原因",
        "banEvidence": "證據",
        "banRevoker": "解封人",
        "banRevokeTime": "解封时间",
        "banRevokeReason": "解封原因",
        "banUnknown": "未知",
        "banNotFilled": "未填寫",
        "banLoading": "正在載入BAN記錄...",
        "banLoadFailed": "BAN記錄載入失敗",
        "banButton": "BAN",
        "banUnbanButton": "解除BAN",
        "banPromptReason": "請输入BAN原因（用户：{username}）",
        "banDefaultReason": "違反使用規則或存在異常行為",
        "banPromptHours": "請输入封禁時長（小时），例如 24 或 48；留空表示永久BAN",
        "banConfirm": "確認BAN用户 {username}？\n封禁時長：{duration}",
        "banFailed": "BAN失敗",
        "banSuccess": "BAN成功",
        "banPromptRevokeReason": "請输入解除BAN原因（用户：{username}）",
        "banDefaultRevokeReason": "管理員解除BAN",
        "banRevokeConfirm": "確認解除用户 {username} 的BAN？",
        "banRevokeFailed": "解除BAN失敗",
        "banRevokeSuccess": "已解除BAN",
        "statsReportTitle": "🎵 你的聽歌報告",
        "statsLoading": "正在拉取資料...",
        "statsEmpty": "你还没有听过任何歌曲哦，快去听听看吧！",
        "statsTopSongs": "👑 最爱单曲 Top {count}",
        "statsTopArtists": "🎤 最爱歌手 Top {count}",
        "statsFetchFailed": "取得統計資料失敗",
        "playCount": "{count} 次",
        "profileNicknameEmpty": "暱稱不能為空",
        "profileNicknameUpdated": "暱稱已更新",
        "profileUpdateFailed": "更新失敗",
        "profileAvatarUpdated": "頭像已更新",
        "profileAvatarUploadFailed": "上傳失敗",
        "passwordChangeFailed": "密碼修改失敗",
        "deletePlaylistTitle": "刪除歌單",
        "deletePlaylistConfirm": "確定要永久刪除歌單 “{name}” 吗？此操作不可逆。",
        "deletePlaylistFailed": "刪除失敗，請稍後重试",
        "filterHeader": "🔍 篩選結果: {keyword} ({count})",
        "qualityOriginalHiRes": "原聲 (Hi-Res)",
        "qualityLossless4416": "無損 (44.1k/16bit)",
        "qualityHigh320": "極高 (320kbps)",
        "qualityStandard128": "標準 (128kbps)",
        "qualityLosslessOriginal": "無損 (原聲)",
        "qualityHighOriginal": "極高 (原聲)",
        "qualityStandardOriginal": "標準 (原聲)",
        "audioInfoFallback": "無法取得音訊屬性，採用預設选项",
        "noLyricsTitle": "该歌曲的歌詞暫時無法顯示",
        "noLyricsIntro": "可能原因如下（按常见程度由高到低排列）：",
        "noLyricsReason1": "该歌曲可能为纯音乐、伴奏、现场片段或采样片段，本身没有可同步展示的歌詞。",
        "noLyricsReason2": "歌曲语种較少見，或作品較冷門，公開歌詞資源暫未收录。",
        "noLyricsReason3": "受版權、内容審核或平台規則影響，歌詞平台暫時無法提供该歌曲歌詞。",
        "noLyricsReason4": "歌曲標題、歌手、专辑等元資料与歌詞库不完全匹配，導致自动匹配失敗。",
        "noLyricsReason5": "目前歌詞介面、網路连接或第三方歌詞服務临时異常，請稍後重试。",
        "noLyricsFooterPrefix": "如有需要或者疑問，請",
        "currentSong": "目前歌曲",
        "lyricsTicketTitle": "歌詞問題回報：{song}",
        "lyricsTicketBody": "歌曲：{song}\n\n問題說明：该歌曲歌詞暫時無法顯示。",
        "selectCompleteRegion": "請選擇完整地區",
        "locationSaveFailedDetail": "儲存失敗: {detail}",
        "locationSaveNetworkFailed": "網路錯誤，儲存失敗",
        "syncLibraryErrorText": "❌ 同步出錯",
        "songListFetchFailed": "取得歌曲列表失敗",
        "playlistFetchFailed": "取得歌單失敗",
        "playlistLoadFailedInline": "載入歌單失敗"
    }
};
for (const lang of I18N_LANGS) {
    Object.assign(I18N[lang], I18N_EXTRA[lang] || I18N_EXTRA.en || {});
}


const I18N_EXTRA_PATCH = {
    "zh-CN": {
        "noUsers": "暂无用户",
        "passwordResetFailed": "密码重置失败"
    },
    "zh-TW": {
        "noUsers": "暫無使用者",
        "passwordResetFailed": "密碼重設失敗"
    },
    "en": {
        "noUsers": "No users",
        "passwordResetFailed": "Password reset failed"
    },
    "ja": {
        "noUsers": "ユーザーはいません",
        "passwordResetFailed": "パスワードリセットに失敗しました"
    },
    "ko": {
        "noUsers": "사용자가 없습니다",
        "passwordResetFailed": "비밀번호 재설정 실패"
    }
};
for (const lang of I18N_LANGS) {
    Object.assign(I18N[lang], I18N_EXTRA_PATCH[lang] || I18N_EXTRA_PATCH.en || {});
}


const I18N_EXTRA_PATCH2 = {
    "zh-CN": {
        "syncLibrary": "🔄 同步曲库"
    },
    "zh-TW": {
        "syncLibrary": "🔄 同步曲庫"
    },
    "en": {
        "syncLibrary": "🔄 Sync library"
    },
    "ja": {
        "syncLibrary": "🔄 ライブラリを同期"
    },
    "ko": {
        "syncLibrary": "🔄 라이브러리 동기화"
    }
};
for (const lang of I18N_LANGS) {
    Object.assign(I18N[lang], I18N_EXTRA_PATCH2[lang] || I18N_EXTRA_PATCH2.en || {});
}

const I18N_EXTRA_PATCH3 = {
    "zh-CN": { "selectCompleteRegion": "\u8bf7\u9009\u62e9\u5b8c\u6574\u5730\u533a", "locationLoading": "\u6b63\u5728\u52a0\u8f7d\u4e2d", "weatherUnknown": "\u672a\u77e5", "fetchingWeather": "\u6b63\u5728\u83b7\u53d6\u5929\u6c14...", "locationSaved": "\u5730\u533a\u5df2\u4fdd\u5b58: {location}", "locationSaveFailedDetail": "\u4fdd\u5b58\u5931\u8d25: {detail}", "locationSaveNetworkFailed": "\u7f51\u7edc\u9519\u8bef\uff0c\u4fdd\u5b58\u5931\u8d25", "banButton": "BAN" },
    "zh-TW": { "selectCompleteRegion": "\u8acb\u9078\u64c7\u5b8c\u6574\u5730\u5340", "locationLoading": "\u6b63\u5728\u8f09\u5165\u4e2d", "weatherUnknown": "\u672a\u77e5", "fetchingWeather": "\u6b63\u5728\u53d6\u5f97\u5929\u6c23...", "locationSaved": "\u5730\u5340\u5df2\u5132\u5b58: {location}", "locationSaveFailedDetail": "\u5132\u5b58\u5931\u6557: {detail}", "locationSaveNetworkFailed": "\u7db2\u8def\u932f\u8aa4\uff0c\u5132\u5b58\u5931\u6557", "banButton": "BAN" },
    "en": { "selectCompleteRegion": "Please select a complete region", "locationLoading": "Loading location", "weatherUnknown": "Unknown", "fetchingWeather": "Fetching weather...", "locationSaved": "Location saved: {location}", "locationSaveFailedDetail": "Save failed: {detail}", "locationSaveNetworkFailed": "Network error. Save failed.", "banButton": "BAN" },
    "ja": { "selectCompleteRegion": "\u5730\u57df\u3092\u5b8c\u5168\u306b\u9078\u629e\u3057\u3066\u304f\u3060\u3055\u3044", "locationLoading": "\u5730\u57df\u3092\u8aad\u307f\u8fbc\u307f\u4e2d", "weatherUnknown": "\u4e0d\u660e", "fetchingWeather": "\u5929\u6c17\u3092\u53d6\u5f97\u4e2d...", "locationSaved": "\u5730\u57df\u3092\u4fdd\u5b58\u3057\u307e\u3057\u305f: {location}", "locationSaveFailedDetail": "\u4fdd\u5b58\u306b\u5931\u6557\u3057\u307e\u3057\u305f: {detail}", "locationSaveNetworkFailed": "\u30cd\u30c3\u30c8\u30ef\u30fc\u30af\u30a8\u30e9\u30fc\u3067\u4fdd\u5b58\u3067\u304d\u307e\u305b\u3093", "banButton": "BAN" },
    "ko": { "selectCompleteRegion": "\uc644\uc804\ud55c \uc9c0\uc5ed\uc744 \uc120\ud0dd\ud558\uc138\uc694", "locationLoading": "\uc9c0\uc5ed \ub85c\ub4dc \uc911", "weatherUnknown": "\uc54c \uc218 \uc5c6\uc74c", "fetchingWeather": "\ub0a0\uc528\ub97c \uac00\uc838\uc624\ub294 \uc911...", "locationSaved": "\uc9c0\uc5ed\uc774 \uc800\uc7a5\ub428: {location}", "locationSaveFailedDetail": "\uc800\uc7a5 \uc2e4\ud328: {detail}", "locationSaveNetworkFailed": "\ub124\ud2b8\uc6cc\ud06c \uc624\ub958\ub85c \uc800\uc7a5\ud558\uc9c0 \ubabb\ud588\uc2b5\ub2c8\ub2e4", "banButton": "BAN" }
};
for (const lang of I18N_LANGS) {
    Object.assign(I18N[lang], I18N_EXTRA_PATCH3[lang] || I18N_EXTRA_PATCH3.en || {});
}

let currentLang = localStorage.getItem(I18N_LANG_KEY) || "zh-CN";
if (!I18N_LANGS.includes(currentLang)) currentLang = "zh-CN";

function t(key, params = {}) {
    const pack = I18N[currentLang] || I18N["zh-CN"];
    let value = pack[key] ?? I18N["zh-CN"]?.[key] ?? I18N.en?.[key] ?? key;
    return String(value).replace(/\{(\w+)\}/g, (_, name) => params[name] ?? "");
}

function setText(selector, key, params = {}) {
    const el = document.querySelector(selector);
    if (el) el.textContent = t(key, params);
}

function setTextAll(selector, key, params = {}) {
    document.querySelectorAll(selector).forEach(el => { el.textContent = t(key, params); });
}

function setAttr(selector, attr, key, params = {}) {
    const el = document.querySelector(selector);
    if (el) el.setAttribute(attr, t(key, params));
}

function weatherLoadingDisplayText() {
    return `\u{1F30D} ${t('weatherLoading')}`;
}

function weatherFetchingDisplayText() {
    return `\u{1F50D} ${t('fetchingWeather')}`;
}

function isWeatherLoadingPlaceholder(value = '') {
    const text = String(value || '').trim();
    return !text || text.startsWith('\u{1F30D}') || text.startsWith('\u{1F50D}') || /\u52a0\u8f7d|\u8f09\u5165|\u83b7\u53d6|\u53d6\u5f97|\u62c9\u53d6|Loading|Fetching|\u8aad\u307f\u8fbc\u307f|\u53d6\u5f97\u4e2d|\ub85c\ub529|\ubd88\ub7ec\uc624\ub294|\uac00\uc838\uc624\ub294/.test(text);
}

function refreshWeatherLoadingI18n() {
    ['#loc-weather-text', '#mobile-loc-weather-text'].forEach(selector => {
        const el = document.querySelector(selector);
        if (el && isWeatherLoadingPlaceholder(el.textContent)) el.textContent = weatherLoadingDisplayText();
    });
}

function refreshIpDetectingI18n() {
    const ipText = document.getElementById('ip-text');
    if (ipText && (/\u63a2\u6d4b\u4e2d|\u63a2\u6e2c\u4e2d|Detecting|\u691c\u51fa\u4e2d|\ud0d0\uc9c0 \uc911/.test(ipText.textContent || '') || !(ipText.textContent || '').trim())) ipText.textContent = t('ipDetecting');
    const ipEstimatedLabel = document.getElementById('ip-estimated-label');
    if (ipEstimatedLabel) ipEstimatedLabel.textContent = t('estimated');
    const ipLocText = document.getElementById('ip-loc-text');
    if (ipLocText && (/\u63a2\u6d4b\u4e2d|\u63a2\u6e2c\u4e2d|Detecting|\u691c\u51fa\u4e2d|\ud0d0\uc9c0 \uc911/.test(ipLocText.textContent || '') || !(ipLocText.textContent || '').trim())) ipLocText.textContent = t('detecting');
}

function setWeatherDisplayText(value) {
    ['loc-weather-text', 'mobile-loc-weather-text'].forEach(id => { const el = document.getElementById(id); if (el) el.textContent = value; });
}

function setWeatherDisplayHtml(value) {
    ['loc-weather-text', 'mobile-loc-weather-text'].forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = value; });
}

async function renderWeatherStateForCurrentLang() {
    const state = currentWeatherState;
    if (!state) { refreshWeatherLoadingI18n(); return; }
    const seq = ++weatherRenderSeq;
    if (state.status === 'loading') { setWeatherDisplayText(weatherLoadingDisplayText()); return; }
    if (state.status === 'fetching') { setWeatherDisplayText(weatherFetchingDisplayText()); return; }
    if (state.status === 'unknown') { setWeatherDisplayText(`\u{1F4CD} ${t('locationUnknown')}`); return; }
    const locLabel = await translatedRegionLabel([state.displayCity, state.displayDistrict], 'weather-location') || state.nativeLocLabel || t('locationLoading');
    if (seq !== weatherRenderSeq) return;
    if (state.status === 'failed') { setWeatherDisplayText(`\u{1F4CD} ${locLabel || ''} | ${t('weatherFailed')}`); return; }
    const weatherLabel = await translateWeatherLabelForCurrentLang(state.weather || t('weatherUnknown'));
    if (seq !== weatherRenderSeq) return;
    setWeatherDisplayHtml(`\u{1F4CD} ${locLabel} <span style="color:#1ed760;margin-left:4px;">\u26C5 ${weatherLabel} ${state.temp || '--'}</span>`);
}

async function renderIpInfoStateForCurrentLang() {
    const state = currentIpInfoState || { status: 'detecting' };
    const seq = ++ipInfoRenderSeq;
    const ipText = document.getElementById('ip-text');
    const ipLocText = document.getElementById('ip-loc-text');
    const ipEstimatedLabel = document.getElementById('ip-estimated-label');
    if (ipEstimatedLabel) ipEstimatedLabel.textContent = t('estimated');
    if (state.status === 'success') {
        if (ipText) ipText.textContent = `IP: ${state.ip || '--'}`;
        const translatedCity = await translatedRegionLabel([state.city], 'ip-location');
        if (seq !== ipInfoRenderSeq) return;
        if (ipLocText) ipLocText.textContent = translatedCity || state.city || '--';
        return;
    }
    if (state.status === 'failed') { if (ipText) ipText.textContent = `IP: ${t('weatherFailed')}`; if (ipLocText) ipLocText.textContent = '--'; return; }
    if (ipText) ipText.textContent = t('ipDetecting');
    if (ipLocText) ipLocText.textContent = t('detecting');
}

function applyI18n() {
    document.documentElement.lang = currentLang;
    document.querySelectorAll('#lang-select, #login-lang-select').forEach(sel => {
        sel.value = currentLang;
        sel.setAttribute('aria-label', t('language'));
    });

    setAttr('#username', 'placeholder', 'username');
    setAttr('#password', 'placeholder', 'password');
    setText('#login-btn', 'login');
    setAttr('#mobile-menu-btn', 'title', 'menu');
    setAttr('#user-avatar', 'alt', 'avatar');
    setAttr('#hover-card-avatar', 'alt', 'avatar');
    setText('#change-loc-btn', 'switch');
    setAttr('#change-loc-btn', 'title', 'customWeather');
    refreshWeatherLoadingI18n();
    refreshIpDetectingI18n();
    setText('#view-stats-btn', 'stats');
    setAttr('#search-input', 'placeholder', 'searchPlaceholder');
    setAttr('#profile-btn', 'title', 'profileCenter');
    setAttr('#admin-panel-btn', 'title', 'adminPanel');
    setText('#logout-btn', 'logout');
    setText('#nav-favorites', 'favorites');
    setText('#nav-sync-library', 'syncLibrary');
    setText('#mobile-nav-favorites', 'favorites');
    setText('#mobile-view-stats-btn', 'stats');
    setText('#mobile-profile-btn', 'profileCenter');
    setText('.meta-label', 'album');
    if (!currentSongId) {
        setText('#song-title', 'noSong');
        setText('#song-album', 'exploreLibrary');
        setText('#mobile-song-title', 'mobilePlayer');
    }

    setAttr('#sel-quality-desktop', 'title', 'qualityTitle');
    updateVisualizerToggleButton();
    setAttr('#btn-mode', 'title', MODES[currentModeIndex]?.titleKey || 'modeList');
    setAttr('#player-fav-btn', 'title', 'favorite');
    setAttr('#btn-prev', 'title', 'prev');
    setAttr('#btn-next', 'title', 'next');

    setText('#profile-modal h2', 'profileTitle');
    const profileLabels = document.querySelectorAll('#profile-modal label');
    if (profileLabels[0]) profileLabels[0].textContent = t('nickname');
    if (profileLabels[1]) profileLabels[1].textContent = t('avatar');
    if (profileLabels[2]) profileLabels[2].textContent = t('changePassword');
    setAttr('#profile-nickname', 'placeholder', 'nickname');
    setText('#profile-save-btn', 'save');
    setAttr('#pwd-old', 'placeholder', 'oldPassword');
    setAttr('#pwd-new', 'placeholder', 'newPassword');
    setAttr('#pwd-confirm', 'placeholder', 'confirmPassword');
    setText('#pwd-save-btn', 'changePassword');
    setText('#profile-close-btn', 'close');

    setText('#admin-modal h2', 'createUserTitle');
    setText('#admin-create-title', 'createUserSection');
    setText('#admin-user-list-title', 'userListTitle');
    setText('#admin-refresh-btn', 'refresh');
    setText('#admin-password-note', 'passwordEncryptedNote');
    setAttr('#admin-username', 'placeholder', 'username');
    setAttr('#admin-password', 'placeholder', 'password');
    setAttr('#admin-nickname', 'placeholder', 'nickname');
    const userOption = document.querySelector('#admin-role option[value="User"]');
    const adminOption = document.querySelector('#admin-role option[value="Admin"]');
    if (userOption) userOption.textContent = t('user');
    if (adminOption) adminOption.textContent = t('admin');
    setText('#admin-create-btn', 'createUser');
    setText('#admin-close-btn', 'close');

    setText('#playlist-create-modal h2', 'createPlaylistTitle');
    setAttr('#new-playlist-name', 'placeholder', 'playlistName');
    setText('#playlist-create-confirm', 'create');
    setText('#playlist-create-close', 'cancel');
    setText('#playlist-select-modal h2', 'selectPlaylistTitle');
    setText('#playlist-select-close', 'cancel');
    setText('#custom-asset-modal h2', 'customAssets');
    setText('#custom-cover-label', 'customCover');
    setText('#custom-cover-hint', 'coverFileHint');
    setText('#custom-lyrics-label', 'customLyrics');
    setText('#custom-lyrics-hint', 'lyricsHint');
    setText('#custom-cover-save-btn', 'saveCover');
    setText('#custom-cover-clear-btn', 'clearCover');
    setText('#custom-lyrics-save-btn', 'saveLyrics');
    setText('#custom-lyrics-clear-btn', 'clearLyrics');
    setText('#custom-asset-close-btn', 'close');
    setText('#stats-modal h2', 'stats');
    setText('#stats-close-btn', 'close');
    setText('#location-select-modal h3', 'weatherLocationTitle');
    setText('#confirm-loc-btn', 'confirm');
    setText('#loc-modal-close-btn', 'cancel');

    setAttr('#ticket-panel-btn', 'title', 'ticketTitle');
    setText('#mobile-ticket-btn', 'ticketTitle');
    setAttr('#announcement-panel-btn', 'title', 'announcementTitle');
    setText('#mobile-announcement-btn', 'announcementTitle');
    setText('#admin-ban-title', 'adminBanTitle');
    const adminBanActiveLabel = document.querySelector('.admin-ban-active-label');
    if (adminBanActiveLabel) {
        const txt = Array.from(adminBanActiveLabel.childNodes).find(node => node.nodeType === Node.TEXT_NODE);
        if (txt) txt.textContent = ' ' + t('adminBanActiveOnly');
    }
    setText('#admin-ban-refresh-btn', 'adminBanRefresh');
    const adminBanNote = document.querySelector('.admin-ban-section .admin-note');
    if (adminBanNote) adminBanNote.textContent = t('adminBanNote');
    setText('#announcement-modal-title', 'announcementModalTitle');
    setText('#announcement-modal .ticket-title-block p', 'announcementIntro');
    setText('#announcement-refresh-btn', 'refresh');
    setAttr('#announcement-header-close-btn', 'title', 'close');
    setText('#announcement-create-section h3', 'announcementCreateTitle');
    setAttr('#announcement-title-input', 'placeholder', 'announcementTitlePlaceholder');
    setAttr('#announcement-target-select', 'aria-label', 'announcementTargetAria');
    const announcementTargetAll = document.querySelector('#announcement-target-select option[value=""]');
    if (announcementTargetAll) announcementTargetAll.textContent = t('announcementAllMembers');
    const announcementPinnedText = document.querySelector('.announcement-checkbox-row span');
    if (announcementPinnedText) announcementPinnedText.textContent = t('announcementPinnedAfterPublish');
    setAttr('#announcement-body-input', 'placeholder', 'announcementBodyPlaceholder');
    const announcementHint = document.querySelector('#announcement-files-list + .field-hint');
    if (announcementHint) announcementHint.textContent = t('announcementFileHint');
    const announcementShortcut = document.querySelector('#announcement-create-section .ticket-shortcut-hint');
    if (announcementShortcut) announcementShortcut.textContent = t('announcementShortcutPublish');
    setText('#announcement-submit-btn', 'announcementSubmit');
    setText('.announcement-list-section h3', 'announcementListTitle');
    setText('#announcement-detail-empty', 'announcementSelectDetail');
    setText('#announcement-pin-btn', 'announcementPin');
    setText('#announcement-delete-btn', 'announcementDelete');
    setText('#announcement-close-btn', 'close');
    setText('#ticket-modal-title', 'ticketModalTitle');
    setText('#ticket-modal .ticket-title-block p', 'ticketIntro');
    setText('#ticket-refresh-btn', 'refresh');
    setAttr('#ticket-header-close-btn', 'title', 'close');
    setText('#ticket-create-section h3', 'ticketCreateTitle');
    setAttr('#ticket-title-input', 'placeholder', 'ticketTitlePlaceholder');
    setAttr('#ticket-body-input', 'placeholder', 'ticketBodyPlaceholder');
    const ticketHint = document.querySelector('#ticket-files-list + .field-hint');
    if (ticketHint) ticketHint.textContent = t('ticketFileHint');
    const ticketSubmitShortcut = document.querySelector('#ticket-create-section .ticket-shortcut-hint');
    if (ticketSubmitShortcut) ticketSubmitShortcut.textContent = t('ticketShortcutSubmit');
    setText('#ticket-submit-btn', 'ticketSubmit');
    setText('#ticket-list-title', isCurrentUserAdmin() ? 'allTickets' : 'myTickets');
    setText('#ticket-detail-empty', 'ticketSelectDetail');
    const ticketAdminResultLabel = document.querySelector('label[for="ticket-admin-result"]');
    if (ticketAdminResultLabel) ticketAdminResultLabel.textContent = t('ticketAdminResult');
    const ticketResultFollowing = document.querySelector('#ticket-admin-result option[value="following"]');
    if (ticketResultFollowing) ticketResultFollowing.textContent = t('ticketResultFollowing');
    const ticketResultProcessed = document.querySelector('#ticket-admin-result option[value="processed"]');
    if (ticketResultProcessed) ticketResultProcessed.textContent = t('ticketResultProcessed');
    const ticketResultRejected = document.querySelector('#ticket-admin-result option[value="rejected"]');
    if (ticketResultRejected) ticketResultRejected.textContent = t('ticketResultRejected');
    setAttr('#ticket-reply-body', 'placeholder', 'ticketReplyPlaceholder');
    const ticketReplyShortcut = document.querySelector('#ticket-reply-box .ticket-shortcut-hint');
    if (ticketReplyShortcut) ticketReplyShortcut.textContent = t('ticketShortcutSend');
    setText('#ticket-reply-submit-btn', 'ticketReplySubmit');
    setText('#ticket-close-btn', 'close');

    const locateBtn = document.getElementById('locate-current-btn');
    if (locateBtn) {
        locateBtn.textContent = t('locateCurrent');
        locateBtn.title = t('locateCurrentTitle');
    }
}

async function rerenderCurrentViewForLanguage() {
    if (!playerPanel || playerPanel.style.display === "none") return;
    if (currentViewContext.type === "folder") {
        renderDirectory(currentViewContext.value || "root");
    } else if (currentViewContext.type === "playlist" && currentViewContext.value) {
        await renderPlaylist(currentViewContext.value);
    } else if (currentViewContext.type === "favorites") {
        navFavorites?.click();
    }
    updatePlayingRowHighlight(currentSongId, { scroll: false });
}

async function refreshLocalizedDynamicSurfacesForLanguage() {
    await renderWeatherStateForCurrentLang();
    await renderIpInfoStateForCurrentLang();
    if (ticketModal?.classList.contains('show')) {
        renderTicketSelectedFiles(ticketFilesInput);
        renderTicketSelectedFiles(ticketReplyFiles);
        if (currentTicketDetailCache) renderTicketDetail(currentTicketDetailCache);
        else renderTicketList();
    }
    if (adminModal?.classList.contains('show')) {
        if (adminUsersCache.length) renderAdminUsers(adminUsersCache);
        if (adminBanRecordsCache.length || adminBanList?.children.length) renderAdminBans(adminBanRecordsCache);
    }
    if (isNoLyricsNoticeVisible) showNoLyricsNotice();
}

async function setLanguage(lang) {
    if (!I18N_LANGS.includes(lang)) return;
    currentLang = lang;
    localStorage.setItem(I18N_LANG_KEY, lang);
    applyI18n();
    await rerenderCurrentViewForLanguage();
    await refreshLocalizedDynamicSurfacesForLanguage();
}

function bindLanguageSelector() {
    document.querySelectorAll('#lang-select, #login-lang-select').forEach(sel => {
        sel.value = currentLang;
        sel.addEventListener('change', (e) => setLanguage(e.target.value));
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindLanguageSelector();
    applyI18n();
});


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
if (ticketModal) ticketModal.addEventListener("click", (e) => e.stopPropagation());
if (announcementModal) announcementModal.addEventListener("click", (e) => e.stopPropagation());

// Global click to close any open modal
document.addEventListener("click", () => {
    if (profileModal) profileModal.classList.remove("show");
    if (adminModal) adminModal.classList.remove("show");
    if (announcementModal) announcementModal.classList.remove("show");
});

/* ── Support tickets ───────────────────────────────────────────── */
function isCurrentUserAdmin() {
    return userProfile?.Role === "Admin";
}

function setTicketMessage(el, text, isError = false) {
    if (!el) return;
    el.className = "msg-text" + (isError ? " error" : (text ? " success" : ""));
    el.textContent = text || "";
}

function formatFileSize(bytes = 0) {
    const size = Number(bytes) || 0;
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`;
    return `${size} B`;
}

const APP_TIME_ZONE = "Asia/Shanghai";
const APP_TIME_ZONE_LABEL = "UTC+8";

function parseBackendDateTime(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatTicketTime(value) {
    if (!value) return "";
    const date = parseBackendDateTime(value);
    if (!date) return String(value).replace("T", " ").slice(0, 19);
    return date.toLocaleString("zh-CN", { hour12: false, timeZone: APP_TIME_ZONE });
}

function escapeTicketHtml(text = "") {
    return String(text).replace(/[&<>"']/g, (ch) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[ch]));
}

function renderTicketMarkdown(text = "", format = "markdown") {
    let html = escapeTicketHtml(text);
    if (format === "markdown") {
        html = html
            .replace(/^### (.*)$/gm, "<h5>$1</h5>")
            .replace(/^## (.*)$/gm, "<h4>$1</h4>")
            .replace(/^# (.*)$/gm, "<h3>$1</h3>")
            .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    }
    return html.replace(/\n/g, "<br>");
}

function getTicketSelectedFiles(input) {
    if (input === ticketFilesInput) return ticketCreateSelectedFiles;
    if (input === ticketReplyFiles) return ticketReplySelectedFiles;
    return Array.from(input?.files || []);
}

function getTicketFilesListEl(input) {
    if (input === ticketFilesInput) return ticketFilesList;
    if (input === ticketReplyFiles) return ticketReplyFilesList;
    return null;
}

function getTicketFileKey(file) {
    return [file.name, file.size, file.lastModified, file.type].join("::");
}

function renderTicketSelectedFiles(input) {
    const listEl = getTicketFilesListEl(input);
    if (!listEl) return;
    const files = getTicketSelectedFiles(input);
    listEl.replaceChildren();
    if (!files.length) {
        listEl.classList.add("empty");
        return;
    }
    listEl.classList.remove("empty");

    const summary = document.createElement("div");
    summary.className = "ticket-selected-files-summary";
    summary.textContent = t("selectedAttachmentsContinue", { count: files.length });
    listEl.appendChild(summary);

    files.forEach((file, index) => {
        const row = document.createElement("div");
        row.className = "ticket-selected-file-row";
        const name = document.createElement("span");
        name.textContent = `${file.name} (${formatFileSize(file.size)})`;
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "ticket-selected-file-remove";
        removeBtn.textContent = t("remove");
        removeBtn.addEventListener("click", () => {
            files.splice(index, 1);
            renderTicketSelectedFiles(input);
        });
        row.append(name, removeBtn);
        listEl.appendChild(row);
    });
}

function addTicketSelectedFiles(input) {
    if (!input) return;
    const selected = getTicketSelectedFiles(input);
    const knownKeys = new Set(selected.map(getTicketFileKey));
    const incoming = Array.from(input.files || []);
    let skippedDuplicate = false;
    let skippedByLimit = false;

    incoming.forEach(file => {
        const key = getTicketFileKey(file);
        if (knownKeys.has(key)) {
            skippedDuplicate = true;
            return;
        }
        if (!isCurrentUserAdmin() && selected.length >= TICKET_USER_MAX_ATTACHMENTS) {
            skippedByLimit = true;
            return;
        }
        selected.push(file);
        knownKeys.add(key);
    });

    input.value = "";
    renderTicketSelectedFiles(input);
    if (skippedByLimit) showToast(t("userAttachmentLimit", { count: TICKET_USER_MAX_ATTACHMENTS }), true);
    else if (skippedDuplicate) showToast(t("duplicateAttachmentsIgnored"), true);
}

function clearTicketSelectedFiles(input) {
    const files = getTicketSelectedFiles(input);
    files.splice(0, files.length);
    if (input) input.value = "";
    renderTicketSelectedFiles(input);
}

function bindTicketFileAccumulator(input) {
    if (!input) return;
    input.addEventListener("change", () => addTicketSelectedFiles(input));
    renderTicketSelectedFiles(input);
}

function validateUserTicketFiles(input) {
    if (!input || isCurrentUserAdmin()) return true;
    const files = getTicketSelectedFiles(input);
    if (files.length > TICKET_USER_MAX_ATTACHMENTS) {
        showToast(t("attachmentLimit", { count: TICKET_USER_MAX_ATTACHMENTS }), true);
        return false;
    }
    const tooLarge = files.find(file => file.size > 100 * 1024 * 1024);
    if (tooLarge) {
        showToast(t("attachmentTooLarge", { name: tooLarge.name }), true);
        return false;
    }
    return true;
}

function appendTicketFiles(formData, input) {
    getTicketSelectedFiles(input).forEach(file => formData.append("attachments", file));
}

function safeTicketStatus(status) {
    return ["pending", "in_progress", "resolved", "rejected"].includes(status) ? status : "pending";
}

function ticketStatusClass(status) {
    return `ticket-status status-${safeTicketStatus(status)}`;
}

function ticketStatusLabel(status, fallback = '') {
    const map = { pending: 'ticketResultFollowing', in_progress: 'ticketResultFollowing', resolved: 'ticketResultProcessed', rejected: 'ticketResultRejected' };
    return map[safeTicketStatus(status)] ? t(map[safeTicketStatus(status)]) : (fallback || status || '');
}

function ticketResultLabel(result, fallback = '') {
    const map = { following: 'ticketResultFollowing', processed: 'ticketResultProcessed', rejected: 'ticketResultRejected' };
    return map[result] ? t(map[result]) : (fallback || '');
}

function localizedAnnouncementTarget(label) {
    const normalized = String(label || '').trim();
    if (!normalized || ['????', '????', 'All members'].includes(normalized)) return t('announcementAllMembers');
    return normalized;
}

function renderTicketList() {
    if (!ticketList) return;
    ticketList.replaceChildren();
    if (ticketListTitle) ticketListTitle.textContent = t(isCurrentUserAdmin() ? "allTickets" : "myTickets");
    if (!ticketListCache.length) {
        const empty = document.createElement("div");
        empty.className = "ticket-empty";
        empty.textContent = t("ticketEmpty");
        ticketList.appendChild(empty);
        return;
    }
    ticketListCache.forEach(ticket => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "ticket-list-item" + (ticket.ticket_id === currentTicketId ? " active" : "");
        const owner = isCurrentUserAdmin() ? `<span>${escapeTicketHtml(ticket.nickname || ticket.username || t("user"))}</span>` : "";
        item.innerHTML = `
            <div class="ticket-list-row"><strong>#${ticket.ticket_id} ${escapeTicketHtml(ticket.title)}</strong><span class="${ticketStatusClass(ticket.status)}">${escapeTicketHtml(ticketStatusLabel(ticket.status, ticket.status_label))}</span></div>
            <div class="ticket-list-meta">${owner}<span>${t("ticketMessagesCount", { count: ticket.message_count || 0 })}</span><span>${formatTicketTime(ticket.updated_at)}</span></div>
        `;
        item.addEventListener("click", () => loadTicketDetail(ticket.ticket_id));
        ticketList.appendChild(item);
    });
}

async function loadTickets(selectFirst = false) {
    if (!ticketList) return;
    ticketList.innerHTML = `<div class="ticket-empty">${t("ticketLoading")}</div>`;
    try {
        const resp = await fetch(`${API_BASE}/api/tickets`, { headers: authHeaders() });
        if (!resp.ok) throw new Error(await resp.text());
        ticketListCache = await resp.json();
        if (selectFirst && !currentTicketId && ticketListCache[0]) currentTicketId = ticketListCache[0].ticket_id;
        renderTicketList();
        if (currentTicketId) await loadTicketDetail(currentTicketId, { skipListRender: true });
    } catch (e) {
        console.error("loadTickets error:", e);
        ticketList.innerHTML = `<div class="ticket-empty error">${t("ticketLoadFailed")}</div>`;
    }
}

function revokeTicketAttachmentObjectUrls() {
    ticketAttachmentObjectUrls.forEach(url => URL.revokeObjectURL(url));
    ticketAttachmentObjectUrls = [];
}

async function hydrateTicketAttachmentLink(card, mediaEl, file) {
    try {
        const resp = await fetch(file.url, { headers: { "Authorization": `Bearer ${getToken()}` } });
        if (!resp.ok) throw new Error("attachment fetch failed");
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        ticketAttachmentObjectUrls.push(objectUrl);
        card.href = objectUrl;
        card.download = file.original_name || "attachment";
        if (mediaEl) mediaEl.src = objectUrl;
    } catch (e) {
        console.error("hydrateTicketAttachmentLink error:", e);
        card.removeAttribute("href");
        card.classList.add("error");
        const failed = document.createElement("em");
        failed.textContent = t("attachmentLoadFailed");
        card.appendChild(failed);
    }
}

function renderTicketAttachments(attachments = []) {
    const wrap = document.createElement("div");
    wrap.className = "ticket-attachments";
    attachments.forEach(file => {
        const card = document.createElement("a");
        card.className = "ticket-attachment";
        card.target = "_blank";
        card.rel = "noopener noreferrer";
        const type = file.content_type || "";
        let mediaEl = null;
        if (type.startsWith("image/")) {
            const img = document.createElement("img");
            img.alt = file.original_name || "attachment";
            mediaEl = img;
            card.appendChild(img);
        } else if (type.startsWith("audio/")) {
            const audio = document.createElement("audio");
            audio.controls = true;
            mediaEl = audio;
            card.appendChild(audio);
        } else if (type.startsWith("video/")) {
            const video = document.createElement("video");
            video.controls = true;
            mediaEl = video;
            card.appendChild(video);
        }
        const label = document.createElement("span");
        label.textContent = `${file.original_name || t("attachment")} (${formatFileSize(file.file_size)})`;
        card.appendChild(label);
        hydrateTicketAttachmentLink(card, mediaEl, file);
        wrap.appendChild(card);
    });
    return wrap;
}

function renderTicketDetail(ticket) {
    if (!ticketDetail || !ticketMessages) return;
    currentTicketId = ticket.ticket_id;
    currentTicketDetailCache = ticket;
    if (ticketDetailEmpty) ticketDetailEmpty.style.display = "none";
    ticketDetail.style.display = "block";
    ticketDetailTitle.textContent = `#${ticket.ticket_id} ${ticket.title}`;
    ticketDetailStatus.textContent = ticketStatusLabel(ticket.status, ticket.status_label);
    ticketDetailStatus.className = ticketStatusClass(ticket.status);
    ticketDetailMeta.textContent = `${t("submitter")}：${ticket.nickname || ticket.username || t("user")}　${t("createdAt")}：${formatTicketTime(ticket.created_at)}　${t("updatedAt")}：${formatTicketTime(ticket.updated_at)}`;
    revokeTicketAttachmentObjectUrls();
    ticketMessages.replaceChildren();
    (ticket.messages || []).forEach(message => {
        const box = document.createElement("article");
        const result = message.result_label ? `<span class="ticket-result">${escapeTicketHtml(ticketResultLabel(message.result, message.result_label))}</span>` : "";
        box.innerHTML = `
            <div class="ticket-message-body">${renderTicketMarkdown(message.body, message.body_format)}</div>
        `;
        if (message.attachments?.length) box.appendChild(renderTicketAttachments(message.attachments));
        ticketMessages.appendChild(box);
    });

    const isClosed = ticket.status === "resolved" || ticket.status === "rejected";
    if (ticketReplyBox) ticketReplyBox.style.display = isClosed ? "none" : "block";
    if (ticketAdminResultRow) ticketAdminResultRow.style.display = isCurrentUserAdmin() ? "flex" : "none";
    if (ticketAdminResult) ticketAdminResult.value = ticket.status === "pending" ? "following" : (ticket.status === "in_progress" ? "following" : "processed");
    requestAnimationFrame(() => {
        if (ticketMessages) ticketMessages.scrollTop = ticketMessages.scrollHeight;
    });
    renderTicketList();
}

async function loadTicketDetail(ticketId, options = {}) {
    try {
        const resp = await fetch(`${API_BASE}/api/tickets/${ticketId}`, { headers: authHeaders() });
        if (!resp.ok) throw new Error(await resp.text());
        const ticket = await resp.json();
        renderTicketDetail(ticket);
        if (!options.skipListRender) await loadTickets(false);
    } catch (e) {
        console.error("loadTicketDetail error:", e);
        showToast(t("ticketDetailLoadFailed"), true);
    }
}

async function openTicketModal(prefill = {}) {
    if (!ticketModal) return;
    if (profileModal) profileModal.classList.remove("show");
    if (adminModal) adminModal.classList.remove("show");
    if (ticketCreateSection) ticketCreateSection.style.display = isCurrentUserAdmin() ? "none" : "block";
    if (ticketTitleInput && prefill.title) ticketTitleInput.value = prefill.title;
    if (ticketBodyInput && prefill.body) ticketBodyInput.value = prefill.body;
    setTicketMessage(ticketCreateMsg, "");
    setTicketMessage(ticketReplyMsg, "");
    openModal(ticketModal);
    await loadTickets(true);
}

if (ticketPanelBtn) {
    ticketPanelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openTicketModal();
    });
}
function closeTicketModal() {
    revokeTicketAttachmentObjectUrls();
    closeModal(ticketModal);
}

if (ticketCloseBtn) ticketCloseBtn.addEventListener("click", closeTicketModal);
if (ticketHeaderCloseBtn) ticketHeaderCloseBtn.addEventListener("click", closeTicketModal);
if (ticketRefreshBtn) ticketRefreshBtn.addEventListener("click", () => loadTickets(false));

function bindTicketSubmitShortcut(textarea, button) {
    if (!textarea || !button) return;
    textarea.addEventListener("keydown", (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            button.click();
        }
    });
}

bindTicketSubmitShortcut(ticketBodyInput, ticketSubmitBtn);
bindTicketSubmitShortcut(ticketReplyBody, ticketReplySubmitBtn);
bindTicketFileAccumulator(ticketFilesInput);
bindTicketFileAccumulator(ticketReplyFiles);

if (ticketSubmitBtn) {
    ticketSubmitBtn.addEventListener("click", async () => {
        if (!validateUserTicketFiles(ticketFilesInput)) return;
        const title = ticketTitleInput.value.trim();
        const body = ticketBodyInput.value.trim();
        if (!title) return setTicketMessage(ticketCreateMsg, t("ticketSubmitTitleRequired"), true);
        if (!body && !getTicketSelectedFiles(ticketFilesInput).length) return setTicketMessage(ticketCreateMsg, t("ticketSubmitBodyRequired"), true);
        const form = new FormData();
        form.append("title", title);
        form.append("body", body);
        form.append("body_format", "markdown");
        appendTicketFiles(form, ticketFilesInput);
        ticketSubmitBtn.disabled = true;
        setTicketMessage(ticketCreateMsg, t("ticketSubmitting"));
        try {
            const resp = await fetch(`${API_BASE}/api/tickets`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${getToken()}` },
                body: form,
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || t("ticketSubmitFailed"));
            }
            const ticket = await resp.json();
            ticketTitleInput.value = "";
            ticketBodyInput.value = "";
            clearTicketSelectedFiles(ticketFilesInput);
            currentTicketId = ticket.ticket_id;
            setTicketMessage(ticketCreateMsg, t("ticketSubmitted"));
            await loadTickets(false);
            renderTicketDetail(ticket);
        } catch (e) {
            setTicketMessage(ticketCreateMsg, e.message || t("ticketSubmitFailed"), true);
        } finally {
            ticketSubmitBtn.disabled = false;
        }
    });
}

if (ticketReplySubmitBtn) {
    ticketReplySubmitBtn.addEventListener("click", async () => {
        if (!currentTicketId) return;
        if (!validateUserTicketFiles(ticketReplyFiles)) return;
        const body = ticketReplyBody.value.trim();
        if (!body && !getTicketSelectedFiles(ticketReplyFiles).length) return setTicketMessage(ticketReplyMsg, t("ticketReplyRequired"), true);
        const form = new FormData();
        form.append("body", body);
        form.append("body_format", "markdown");
        if (isCurrentUserAdmin()) form.append("result", ticketAdminResult.value || "following");
        appendTicketFiles(form, ticketReplyFiles);
        ticketReplySubmitBtn.disabled = true;
        setTicketMessage(ticketReplyMsg, t("ticketSending"));
        try {
            const resp = await fetch(`${API_BASE}/api/tickets/${currentTicketId}/messages`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${getToken()}` },
                body: form,
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || t("ticketSendFailed"));
            }
            const ticket = await resp.json();
            ticketReplyBody.value = "";
            clearTicketSelectedFiles(ticketReplyFiles);
            setTicketMessage(ticketReplyMsg, t("ticketSent"));
            await loadTickets(false);
            renderTicketDetail(ticket);
        } catch (e) {
            setTicketMessage(ticketReplyMsg, e.message || t("ticketSendFailed"), true);
        } finally {
            ticketReplySubmitBtn.disabled = false;
        }
    });
}

/* -- Announcements ------------------------------------------------ */
function syncAnnouncementAdminUi() {
    const isAdmin = isCurrentUserAdmin();
    const card = announcementModal?.querySelector(".announcement-card");
    if (card) {
        card.classList.toggle("announcement-admin-mode", isAdmin);
        card.classList.toggle("announcement-user-mode", !isAdmin);
    }
    if (announcementCreateSection) {
        announcementCreateSection.hidden = !isAdmin;
        announcementCreateSection.setAttribute("aria-hidden", isAdmin ? "false" : "true");
        announcementCreateSection.style.display = isAdmin ? "block" : "none";
    }
    if (!isAdmin) {
        if (announcementTitleInput) announcementTitleInput.value = "";
        if (announcementBodyInput) announcementBodyInput.value = "";
        if (announcementPinnedInput) announcementPinnedInput.checked = false;
        clearAnnouncementSelectedFiles();
    }
    return isAdmin;
}

function setAnnouncementMessage(el, text, isError = false) {
    if (!el) return;
    el.className = "msg-text" + (isError ? " error" : (text ? " success" : ""));
    el.textContent = text || "";
}

function revokeAnnouncementAttachmentObjectUrls() {
    announcementAttachmentObjectUrls.forEach(url => URL.revokeObjectURL(url));
    announcementAttachmentObjectUrls = [];
}

function getAnnouncementFileKey(file) {
    return [file.name, file.size, file.lastModified, file.type].join("::");
}

function renderAnnouncementSelectedFiles() {
    if (!announcementFilesList) return;
    announcementFilesList.replaceChildren();
    if (!announcementSelectedFiles.length) {
        announcementFilesList.classList.add("empty");
        return;
    }
    announcementFilesList.classList.remove("empty");
    const summary = document.createElement("div");
    summary.className = "ticket-selected-files-summary";
    summary.textContent = t("selectedAttachments", { count: announcementSelectedFiles.length });
    announcementFilesList.appendChild(summary);
    announcementSelectedFiles.forEach((file, index) => {
        const row = document.createElement("div");
        row.className = "ticket-selected-file-row";
        const name = document.createElement("span");
        name.textContent = `${file.name} (${formatFileSize(file.size)})`;
        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "ticket-selected-file-remove";
        removeBtn.textContent = t("remove");
        removeBtn.addEventListener("click", () => {
            announcementSelectedFiles.splice(index, 1);
            renderAnnouncementSelectedFiles();
        });
        row.append(name, removeBtn);
        announcementFilesList.appendChild(row);
    });
}

function addAnnouncementSelectedFiles() {
    if (!announcementFilesInput) return;
    const knownKeys = new Set(announcementSelectedFiles.map(getAnnouncementFileKey));
    let skippedByLimit = false;
    Array.from(announcementFilesInput.files || []).forEach(file => {
        if (announcementSelectedFiles.length >= ANNOUNCEMENT_MAX_ATTACHMENTS) {
            skippedByLimit = true;
            return;
        }
        const key = getAnnouncementFileKey(file);
        if (!knownKeys.has(key)) {
            knownKeys.add(key);
            announcementSelectedFiles.push(file);
        }
    });
    announcementFilesInput.value = "";
    renderAnnouncementSelectedFiles();
    if (skippedByLimit) showToast(t("announcementMaxAttachments", { count: ANNOUNCEMENT_MAX_ATTACHMENTS }), true);
}

function clearAnnouncementSelectedFiles() {
    announcementSelectedFiles = [];
    if (announcementFilesInput) announcementFilesInput.value = "";
    renderAnnouncementSelectedFiles();
}

async function hydrateAnnouncementAttachmentLink(card, mediaEl, file) {
    try {
        const resp = await fetch(file.url, { headers: { "Authorization": `Bearer ${getToken()}` } });
        if (!resp.ok) throw new Error("attachment fetch failed");
        const blob = await resp.blob();
        const objectUrl = URL.createObjectURL(blob);
        announcementAttachmentObjectUrls.push(objectUrl);
        card.href = objectUrl;
        card.download = file.original_name || "attachment";
        if (mediaEl) mediaEl.src = objectUrl;
    } catch (e) {
        console.error("hydrateAnnouncementAttachmentLink error:", e);
        card.removeAttribute("href");
        card.classList.add("error");
        const failed = document.createElement("em");
        failed.textContent = "\u52a0\u8f7d\u5931\u8d25";
        card.appendChild(failed);
    }
}

function renderAnnouncementAttachments(attachments = []) {
    const wrap = document.createElement("div");
    wrap.className = "ticket-attachments announcement-attachments";
    attachments.forEach(file => {
        const card = document.createElement("a");
        card.className = "ticket-attachment announcement-attachment";
        card.target = "_blank";
        card.rel = "noopener noreferrer";
        const type = file.content_type || "";
        let mediaEl = null;
        if (type.startsWith("image/")) {
            const img = document.createElement("img");
            img.alt = file.original_name || "attachment";
            mediaEl = img;
            card.appendChild(img);
        } else if (type.startsWith("audio/")) {
            const audio = document.createElement("audio");
            audio.controls = true;
            mediaEl = audio;
            card.appendChild(audio);
        } else if (type.startsWith("video/")) {
            const video = document.createElement("video");
            video.controls = true;
            mediaEl = video;
            card.appendChild(video);
        }
        const label = document.createElement("span");
        label.textContent = `${file.original_name || "\u9644\u4ef6"} (${formatFileSize(file.file_size)})`;
        card.appendChild(label);
        hydrateAnnouncementAttachmentLink(card, mediaEl, file);
        wrap.appendChild(card);
    });
    return wrap;
}

function renderAnnouncementList() {
    if (!announcementList) return;
    announcementList.replaceChildren();
    if (!announcementListCache.length) {
        const empty = document.createElement("div");
        empty.className = "ticket-empty";
        empty.textContent = t("announcementEmpty");
        announcementList.appendChild(empty);
        return;
    }
    announcementListCache.forEach(item => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "announcement-list-item" + (item.announcement_id === currentAnnouncementId ? " active" : "") + (item.is_pinned ? " pinned" : "");
        const pin = item.is_pinned ? `<span class="announcement-pin-badge">${t("announcementPinnedBadge")}</span>` : "";
        const target = isCurrentUserAdmin() ? `<span>${escapeTicketHtml(localizedAnnouncementTarget(item.target_label))}</span>` : "";
        btn.innerHTML = `
            <div class="announcement-list-row"><strong>${pin}${escapeTicketHtml(item.title)}</strong></div>
            <div class="announcement-list-meta">${target}<span>${escapeTicketHtml(item.sender_name || "\u7ba1\u7406\u5458")}</span><span>${formatTicketTime(item.updated_at || item.created_at)}</span></div>
        `;
        btn.addEventListener("click", () => loadAnnouncementDetail(item.announcement_id));
        announcementList.appendChild(btn);
    });
}

async function loadAnnouncements(selectFirst = false) {
    if (!announcementList) return;
    if (!requireValidTokenBeforeFetch()) return;
    announcementList.innerHTML = '<div class="ticket-empty">\u52a0\u8f7d\u4e2d...</div>';
    try {
        const resp = await fetch(`${API_BASE}/api/announcements`, { headers: authHeaders() });
        throwIfUnauthorized(resp);
        if (!resp.ok) throw new Error(await resp.text());
        announcementListCache = await resp.json();
        if (selectFirst && !currentAnnouncementId && announcementListCache[0]) currentAnnouncementId = announcementListCache[0].announcement_id;
        renderAnnouncementList();
        if (currentAnnouncementId) await loadAnnouncementDetail(currentAnnouncementId, { skipListRender: true });
    } catch (e) {
        console.error("loadAnnouncements error:", e);
        announcementList.innerHTML = '<div class="ticket-empty error">\u516c\u544a\u52a0\u8f7d\u5931\u8d25</div>';
    }
}

function renderAnnouncementDetail(item) {
    if (!announcementDetail || !announcementDetailBody) return;
    currentAnnouncementId = item.announcement_id;
    if (announcementDetailEmpty) announcementDetailEmpty.style.display = "none";
    announcementDetail.style.display = "block";
    if (announcementDetailTitle) announcementDetailTitle.textContent = `${item.is_pinned ? `[${t("announcementPinnedBadge")}] ` : ""}${item.title}`;
    if (announcementDetailMeta) announcementDetailMeta.textContent = `${t("announcementSender")}：${item.sender_name || t("admin")}　${t("announcementTarget")}：${localizedAnnouncementTarget(item.target_label)}　${t("announcementTime")}：${formatTicketTime(item.updated_at || item.created_at)}`;
    announcementDetailBody.innerHTML = renderTicketMarkdown(item.body || "", item.body_format || "markdown");
    revokeAnnouncementAttachmentObjectUrls();
    if (announcementDetailFiles) {
        announcementDetailFiles.replaceChildren();
        if (item.attachments?.length) announcementDetailFiles.appendChild(renderAnnouncementAttachments(item.attachments));
    }
    const showAdminActions = isCurrentUserAdmin();
    if (announcementPinBtn) {
        announcementPinBtn.style.display = showAdminActions ? "inline-flex" : "none";
        announcementPinBtn.textContent = item.is_pinned ? t("announcementUnpin") : t("announcementPin");
        announcementPinBtn.dataset.pinned = item.is_pinned ? "1" : "0";
    }
    if (announcementDeleteBtn) announcementDeleteBtn.style.display = showAdminActions ? "inline-flex" : "none";
    renderAnnouncementList();
}

async function loadAnnouncementDetail(announcementId, options = {}) {
    if (!requireValidTokenBeforeFetch()) return;
    try {
        const resp = await fetch(`${API_BASE}/api/announcements/${announcementId}`, { headers: authHeaders() });
        throwIfUnauthorized(resp);
        if (!resp.ok) throw new Error(await resp.text());
        const item = await resp.json();
        renderAnnouncementDetail(item);
        if (!options.skipListRender) await loadAnnouncements(false);
    } catch (e) {
        console.error("loadAnnouncementDetail error:", e);
        showToast("\u516c\u544a\u8be6\u60c5\u52a0\u8f7d\u5931\u8d25", true);
    }
}

async function loadAnnouncementTargets() {
    if (!announcementTargetSelect || !isCurrentUserAdmin()) return;
    announcementTargetSelect.replaceChildren();
    const all = document.createElement("option");
    all.value = "";
    all.textContent = t("announcementAllMembers");
    announcementTargetSelect.appendChild(all);
    try {
        const resp = await fetch(`${API_BASE}/api/admin/users`, { headers: authHeaders() });
        if (!resp.ok) throw new Error(await resp.text());
        const users = await resp.json();
        users.forEach(user => {
            const opt = document.createElement("option");
            opt.value = String(user.user_id);
            opt.textContent = `${user.nickname || user.username} (${user.username})`;
            announcementTargetSelect.appendChild(opt);
        });
    } catch (e) {
        console.error("loadAnnouncementTargets error:", e);
    }
}

async function openAnnouncementModal() {
    if (!announcementModal) return;
    if (!requireValidTokenBeforeFetch()) return;
    if (profileModal) profileModal.classList.remove("show");
    if (adminModal) adminModal.classList.remove("show");
    if (ticketModal) ticketModal.classList.remove("show");
    if (announcementCreateSection) announcementCreateSection.style.display = isCurrentUserAdmin() ? "block" : "none";
    setAnnouncementMessage(announcementCreateMsg, "");
    openModal(announcementModal);
    await loadAnnouncementTargets();
    await loadAnnouncements(true);
}

function closeAnnouncementModal() {
    revokeAnnouncementAttachmentObjectUrls();
    closeModal(announcementModal);
}

if (announcementPanelBtn) {
    announcementPanelBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openAnnouncementModal();
    });
}
if (mobileAnnouncementBtn) mobileAnnouncementBtn.addEventListener("click", () => openAnnouncementModal());
if (announcementCloseBtn) announcementCloseBtn.addEventListener("click", closeAnnouncementModal);
if (announcementHeaderCloseBtn) announcementHeaderCloseBtn.addEventListener("click", closeAnnouncementModal);
if (announcementRefreshBtn) announcementRefreshBtn.addEventListener("click", () => loadAnnouncements(false));
if (announcementFilesInput) announcementFilesInput.addEventListener("change", addAnnouncementSelectedFiles);
renderAnnouncementSelectedFiles();

bindTicketSubmitShortcut(announcementBodyInput, announcementSubmitBtn);

if (announcementSubmitBtn) {
    announcementSubmitBtn.addEventListener("click", async () => {
        if (!isCurrentUserAdmin()) return;
        const title = announcementTitleInput.value.trim();
        const body = announcementBodyInput.value.trim();
        if (!title) return setAnnouncementMessage(announcementCreateMsg, t("announcementPublishTitleRequired"), true);
        if (!body && !announcementSelectedFiles.length) return setAnnouncementMessage(announcementCreateMsg, t("announcementPublishBodyRequired"), true);
        const form = new FormData();
        form.append("title", title);
        form.append("body", body);
        form.append("body_format", "markdown");
        form.append("target_user_id", announcementTargetSelect?.value || "");
        form.append("is_pinned", announcementPinnedInput?.checked ? "true" : "false");
        announcementSelectedFiles.forEach(file => form.append("attachments", file));
        announcementSubmitBtn.disabled = true;
        setAnnouncementMessage(announcementCreateMsg, "\u6b63\u5728\u53d1\u5e03...");
        try {
            const resp = await fetch(`${API_BASE}/api/announcements`, {
                method: "POST",
                headers: { "Authorization": `Bearer ${getToken()}` },
                body: form,
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.detail || "\u53d1\u5e03\u5931\u8d25");
            }
            const item = await resp.json();
            announcementTitleInput.value = "";
            announcementBodyInput.value = "";
            if (announcementPinnedInput) announcementPinnedInput.checked = false;
            if (announcementTargetSelect) announcementTargetSelect.value = "";
            clearAnnouncementSelectedFiles();
            currentAnnouncementId = item.announcement_id;
            setAnnouncementMessage(announcementCreateMsg, "\u516c\u544a\u5df2\u53d1\u5e03");
            await loadAnnouncements(false);
            renderAnnouncementDetail(item);
        } catch (e) {
            setAnnouncementMessage(announcementCreateMsg, e.message || "\u53d1\u5e03\u5931\u8d25", true);
        } finally {
            announcementSubmitBtn.disabled = false;
        }
    });
}

if (announcementPinBtn) {
    announcementPinBtn.addEventListener("click", async () => {
        if (!currentAnnouncementId || !isCurrentUserAdmin()) return;
        const nextPinned = announcementPinBtn.dataset.pinned !== "1";
        announcementPinBtn.disabled = true;
        try {
            const resp = await fetch(`${API_BASE}/api/announcements/${currentAnnouncementId}/pin`, {
                method: "PUT",
                headers: authHeaders(),
                body: JSON.stringify({ is_pinned: nextPinned }),
            });
            if (!resp.ok) throw new Error(await resp.text());
            const item = await resp.json();
            await loadAnnouncements(false);
            renderAnnouncementDetail(item);
        } catch (e) {
            console.error("update announcement pin error:", e);
            showToast("\u516c\u544a\u7f6e\u9876\u66f4\u65b0\u5931\u8d25", true);
        } finally {
            announcementPinBtn.disabled = false;
        }
    });
}

if (announcementDeleteBtn) {
    announcementDeleteBtn.addEventListener("click", async () => {
        if (!currentAnnouncementId || !isCurrentUserAdmin()) return;
        if (!confirm("\u786e\u5b9a\u5220\u9664\u8fd9\u6761\u516c\u544a\uff1f\u5220\u9664\u540e\u6210\u5458\u5c06\u4e0d\u518d\u770b\u5230\u3002")) return;
        announcementDeleteBtn.disabled = true;
        try {
            const resp = await fetch(`${API_BASE}/api/announcements/${currentAnnouncementId}`, {
                method: "DELETE",
                headers: authHeaders(),
            });
            if (!resp.ok) throw new Error(await resp.text());
            currentAnnouncementId = null;
            if (announcementDetail) announcementDetail.style.display = "none";
            if (announcementDetailEmpty) announcementDetailEmpty.style.display = "block";
            await loadAnnouncements(true);
            showToast("\u516c\u544a\u5df2\u5220\u9664");
        } catch (e) {
            console.error("delete announcement error:", e);
            showToast("\u516c\u544a\u5220\u9664\u5931\u8d25", true);
        } finally {
            announcementDeleteBtn.disabled = false;
        }
    });
}

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
        applyVisualizerPreference(user.VisualizerEnabled);
        syncAnnouncementAdminUi();

        if (user.Role === "Admin") {
            adminPanelBtn.style.display = "flex";
            const syncBtn = document.getElementById("nav-sync-library");
            if (syncBtn) syncBtn.style.display = "block";
            [pwdOld, pwdNew, pwdConfirm, pwdSaveBtn].forEach(el => { if (el) el.disabled = true; });
            if (pwdSaveBtn) pwdSaveBtn.title = t('adminPasswordLocked');
        } else {
            [pwdOld, pwdNew, pwdConfirm, pwdSaveBtn].forEach(el => { if (el) el.disabled = false; });
            if (pwdSaveBtn) pwdSaveBtn.removeAttribute('title');
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
    if (announcementModal) announcementModal.classList.remove("show");
    profileModal.classList.toggle("show");
});
profileClose.addEventListener("click", () => closeModal(profileModal));

// Save nickname
profileSaveBtn.addEventListener("click", async () => {
    const nick = profileNick.value.trim();
    if (!nick) return showToast(t("profileNicknameEmpty"), true);
    try {
        const resp = await fetch(`${API_BASE}/api/users/me/profile`, {
            method: "PUT", headers: authHeaders(),
            body: JSON.stringify({ nickname: nick }),
        });
        if (!resp.ok) throw new Error();
        userNickname.textContent = nick;
        showToast(t("profileNicknameUpdated"));
    } catch (e) { showToast(t("profileUpdateFailed"), true); }
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
        showToast(t("profileAvatarUpdated"));
    } catch (e) { showToast(t("profileAvatarUploadFailed"), true); }
});

// Change password
pwdSaveBtn.addEventListener("click", async () => {
    const oldPwd = pwdOld.value;
    const newPwd = pwdNew.value;
    const confirm = pwdConfirm.value;
    profileMsg.className = "msg-text";

    if (!oldPwd || !newPwd || !confirm) {
        profileMsg.textContent = t("passwordAllFields"); profileMsg.classList.add("error"); return;
    }
    if (newPwd !== confirm) {
        profileMsg.textContent = t("passwordMismatch"); profileMsg.classList.add("error"); return;
    }
    if (newPwd.length < 4) {
        profileMsg.textContent = t("passwordTooShort"); profileMsg.classList.add("error"); return;
    }
    try {
        const resp = await fetch(`${API_BASE}/api/users/me/password`, {
            method: "PUT", headers: authHeaders(),
            body: JSON.stringify({ old_password: oldPwd, new_password: newPwd }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            profileMsg.textContent = err.detail || t("passwordChangeFailed");
            profileMsg.classList.add("error");
            return;
        }
        profileMsg.textContent = t("passwordChanged");
        profileMsg.classList.add("success");
        pwdOld.value = pwdNew.value = pwdConfirm.value = "";
        setTimeout(() => {
            localStorage.removeItem("musiccloud_token");
            location.reload();
        }, 1500);
    } catch (e) { profileMsg.textContent = t("requestFailed"); profileMsg.classList.add("error"); }
});

function setAdminMessage(message, isError = false) {
    adminMsg.className = "msg-text";
    adminMsg.textContent = message || "";
    if (message) adminMsg.classList.add(isError ? "error" : "success");
}

function formatBanTime(value) {
    if (!value) return t("banPermanent");
    const formatted = formatTicketTime(value);
    return formatted ? `${formatted}（${APP_TIME_ZONE_LABEL}）` : "";
}

function banSubjectLabel(record) {
    if (record.subject_type === "user") {
        return `${record.target_nickname || record.target_username || record.subject_value} (${record.target_username || t("banSubjectUserFallback")})`;
    }
    if (record.subject_type === "ip") return `IP ${record.subject_value}`;
    return `${record.subject_type}:${record.subject_value}`;
}

function banScopeLabel(scope) {
    const normalized = String(scope || "all").trim() || "all";
    const labels = {
        "all": t("banScopeAll"),
        "auth.login": t("banScopeLogin"),
        "auth.refresh": t("banScopeRefresh"),
        "stream": t("banScopeStream"),
        "ticket.create": t("banScopeTicketCreate"),
        "ticket.reply": t("banScopeTicketReply"),
        "avatar.upload": t("banScopeAvatar"),
        "stats.write": t("banScopeStats"),
        "playlist.write": t("banScopePlaylist"),
        "favorite.write": t("banScopeFavorite"),
        "weather": t("banScopeWeather"),
        "region.search": t("banScopeRegion"),
    };
    return labels[normalized] || normalized;
}

function banStatusLabel(record) {
    return record.is_active ? t("banStatusActive") : t("banStatusRevoked");
}

function renderAdminBans(records = []) {
    if (!adminBanList) return;
    adminBanList.replaceChildren();
    if (!records.length) {
        const empty = document.createElement("div");
        empty.className = "admin-empty";
        empty.textContent = t("banEmpty");
        adminBanList.appendChild(empty);
        return;
    }
    records.forEach(record => {
        const row = document.createElement("div");
        row.className = "admin-ban-row" + (record.is_active ? " active" : " revoked");
        const title = document.createElement("div");
        title.className = "admin-ban-title";
        title.textContent = `#${record.ban_id} ${banSubjectLabel(record)}`;
        const summary = document.createElement("div");
        summary.className = "admin-ban-summary";
        summary.textContent = `${t("banRange")}：${banScopeLabel(record.scope)}　${t("banStatus")}：${banStatusLabel(record)}`;
        const meta = document.createElement("div");
        meta.className = "admin-ban-meta";
        meta.textContent = `${t("banCreator")}：${record.created_by_name || t("banUnknown")}　${t("banTime")}：${formatBanTime(record.banned_at)}　${t("banUntil")}：${record.is_permanent ? t("banPermanent") : formatBanTime(record.banned_until)}`;
        const reason = document.createElement("div");
        reason.className = "admin-ban-reason";
        reason.textContent = `${t("banReason")}：${record.reason || t("banNotFilled")}`;
        row.appendChild(title);
        row.appendChild(summary);
        row.appendChild(meta);
        row.appendChild(reason);
        if (record.evidence) {
            const evidence = document.createElement("div");
            evidence.className = "admin-ban-reason";
            evidence.textContent = `${t("banEvidence")}：${record.evidence}`;
            row.appendChild(evidence);
        }
        if (record.revoked_at || record.revoke_reason) {
            const revoke = document.createElement("div");
            revoke.className = "admin-ban-revoke";
            revoke.textContent = `${t("banRevoker")}：${record.revoked_by_name || t("banUnknown")}　${t("banRevokeTime")}：${formatBanTime(record.revoked_at)}　${t("banRevokeReason")}：${record.revoke_reason || t("banNotFilled")}`;
            row.appendChild(revoke);
        }
        adminBanList.appendChild(row);
    });
}

async function loadAdminBans() {
    if (!adminBanList) return;
    if (!requireValidTokenBeforeFetch()) return;
    adminBanList.innerHTML = `<div class="admin-empty">${t("banLoading")}</div>`;
    try {
        const activeOnly = adminBanActiveOnly?.checked ? "true" : "false";
        const resp = await fetch(`${API_BASE}/api/admin/bans?active_only=${activeOnly}&limit=100`, { headers: authHeaders() });
        throwIfUnauthorized(resp);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || t("banLoadFailed"));
        }
        adminBanRecordsCache = await resp.json();
        renderAdminBans(adminBanRecordsCache);
    } catch (e) {
        adminBanList.innerHTML = "";
        const error = document.createElement("div");
        error.className = "admin-empty error";
        error.textContent = e.message || t("banLoadFailed");
        adminBanList.appendChild(error);
    }
}

function renderAdminUsers(users = []) {
    if (!adminUserList) return;
    adminUserList.innerHTML = "";

    if (!users.length) {
        const empty = document.createElement("div");
        empty.className = "admin-empty";
        empty.textContent = t("noUsers");
        adminUserList.appendChild(empty);
        return;
    }

    users.forEach((item) => {
        const row = document.createElement("div");
        row.className = "admin-user-row";

        const info = document.createElement("div");
        info.className = "admin-user-info";

        const title = document.createElement("div");
        title.className = "admin-user-title";
        title.textContent = `${item.username} / ${item.nickname || item.username}`;

        const meta = document.createElement("div");
        meta.className = "admin-user-meta";
        const roleText = item.role === "Admin" ? t('admin') : t('user');
        const statusText = item.is_active ? t('accountActive') : t('accountInactive');
        meta.textContent = `${t('role')}: ${roleText}\uFF0C ${t('accountStatus')}: ${statusText}`;

        info.appendChild(title);
        info.appendChild(meta);

        const actions = document.createElement("div");
        actions.className = "admin-user-actions";

        if (item.can_reset_password) {
            const input = document.createElement("input");
            input.type = "password";
            input.placeholder = t('newPasswordPlaceholder');
            input.className = "admin-reset-password-input";
            input.dataset.userId = item.user_id;
            input.autocomplete = "new-password";

            const button = document.createElement("button");
            button.type = "button";
            button.className = "btn-primary btn-sm admin-reset-password-btn";
            button.dataset.userId = item.user_id;
            button.textContent = t('resetPassword');

            actions.appendChild(input);
            actions.appendChild(button);
        } else {
            const locked = document.createElement("span");
            locked.className = "admin-password-locked";
            locked.textContent = t('adminPasswordLocked');
            actions.appendChild(locked);
        }

        if (item.can_delete_user) {
            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "btn-danger btn-sm admin-delete-user-btn";
            deleteButton.dataset.userId = item.user_id;
            deleteButton.dataset.username = item.username;
            deleteButton.textContent = t('deleteUser');
            actions.appendChild(deleteButton);
        }


        if (item.can_ban_user && !item.is_banned) {
            const banButton = document.createElement("button");
            banButton.type = "button";
            banButton.className = "btn-danger btn-sm admin-ban-user-btn";
            banButton.dataset.userId = item.user_id;
            banButton.dataset.username = item.username;
            banButton.textContent = t("banButton");
            actions.appendChild(banButton);
        }

        if (item.can_unban_user && item.active_bans?.length) {
            const unbanButton = document.createElement("button");
            unbanButton.type = "button";
            unbanButton.className = "btn-secondary btn-sm admin-unban-user-btn";
            unbanButton.dataset.banId = item.active_bans[0].ban_id;
            unbanButton.dataset.username = item.username;
            unbanButton.textContent = t("banUnbanButton");
            actions.appendChild(unbanButton);
        }

        row.appendChild(info);
        row.appendChild(actions);
        adminUserList.appendChild(row);
    });
}

async function loadAdminUsers() {
    if (!adminUserList) return;
    if (!requireValidTokenBeforeFetch()) return;
    adminUserList.innerHTML = `<div class="admin-empty">${t('userListLoading')}</div>`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    try {
        const resp = await fetch(`${API_BASE}/api/admin/users`, {
            headers: authHeaders(),
            signal: controller.signal,
        });
        throwIfUnauthorized(resp);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            throw new Error(err.detail || t('userListLoadFailed'));
        }
        const users = await resp.json();
        adminUsersCache = users;
        const canCreateAdmin = users.some(item => item.can_create_admin);
        if (adminRole) {
            const adminOption = Array.from(adminRole.options).find(opt => opt.value === "Admin");
            if (adminOption) adminOption.hidden = !canCreateAdmin;
            if (!canCreateAdmin && adminRole.value === "Admin") adminRole.value = "User";
        }
        renderAdminUsers(users);
    } catch (e) {
        adminUserList.innerHTML = "";
        const error = document.createElement("div");
        error.className = "admin-empty error";
        error.textContent = e.name === "AbortError" ? t('userListLoadFailed') : (e.message || t('userListLoadFailed'));
        adminUserList.appendChild(error);
    } finally {
        clearTimeout(timeoutId);
    }
}

// Admin panel button
adminPanelBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!requireValidTokenBeforeFetch()) return;
    if (profileModal) profileModal.classList.remove("show");
    if (announcementModal) announcementModal.classList.remove("show");
    adminModal.classList.toggle("show");
    if (adminModal.classList.contains("show")) {
        loadAdminUsers();
        loadAdminBans();
    }
});
adminClose.addEventListener("click", () => closeModal(adminModal));
if (adminRefreshBtn) adminRefreshBtn.addEventListener("click", () => { loadAdminUsers(); loadAdminBans(); });
if (adminBanRefreshBtn) adminBanRefreshBtn.addEventListener("click", loadAdminBans);
if (adminBanActiveOnly) adminBanActiveOnly.addEventListener("change", loadAdminBans);

// Admin create user
adminCreateBtn.addEventListener("click", async () => {
    const username = adminUsername.value.trim();
    const password = adminPassword.value;
    const nickname = adminNickname.value.trim();
    const role = adminRole.value;
    adminMsg.className = "msg-text";

    if (!username || !password || !nickname) {
        adminMsg.textContent = t("allFieldsRequired"); adminMsg.classList.add("error"); return;
    }
    try {
        const resp = await fetch(`${API_BASE}/api/admin/users`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ username, password, nickname, role }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            adminMsg.textContent = err.detail || t("createFailed");
            adminMsg.classList.add("error");
            return;
        }
        adminMsg.textContent = t("userCreateSuccess");
        adminMsg.classList.add("success");
        adminUsername.value = adminPassword.value = adminNickname.value = "";
        adminRole.value = "User";
        showToast(t("userCreateSuccess"));
        await loadAdminUsers();
    } catch (e) { adminMsg.textContent = t("requestFailed"); adminMsg.classList.add("error"); }
});

if (adminUserList) {
    adminUserList.addEventListener("click", async (event) => {
        const deleteButton = event.target.closest(".admin-delete-user-btn");
        if (deleteButton) {
            const userId = deleteButton.dataset.userId;
            const username = deleteButton.dataset.username || "";
            const confirmed = window.confirm(t('deleteUserConfirm', { username }));

            deleteButton.disabled = true;
            try {
                const resp = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}`, {
                    method: "DELETE",
                    headers: authHeaders(),
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.detail || t('deleteFailed'));
                }
                setAdminMessage(t('deleteUserSuccess'));
                showToast(t('deleteUserSuccess'));
                await loadAdminUsers();
            } catch (e) {
                setAdminMessage(e.message || t('deleteFailed'), true);
            } finally {
                deleteButton.disabled = false;
            }
            return;
        }

        const banButton = event.target.closest(".admin-ban-user-btn");
        if (banButton) {
            const userId = banButton.dataset.userId;
            const username = banButton.dataset.username || "";
            const reason = window.prompt(t("banPromptReason", { username }), t("banDefaultReason")) || "";
            if (!reason.trim()) return;
            const hoursText = window.prompt(t("banPromptHours"), "") || "";
            const body = { scope: "all", reason: reason.trim(), permanent: false };
            if (hoursText.trim()) {
                const hours = Number(hoursText.trim());
                if (!Number.isFinite(hours) || hours <= 0) {
                    setAdminMessage(t("banFailed"), true);
                    return;
                }
                body.hours = Math.round(hours);
            } else {
                body.hours = null;
                body.permanent = true;
            }
            const durationLabel = hoursText ? `${hoursText} h` : t("banPermanent");
            const confirmed = window.confirm(t("banConfirm", { username, duration: durationLabel }));
            banButton.disabled = true;
            try {
                const resp = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/ban`, {
                    method: "POST",
                    headers: authHeaders(),
                    body: JSON.stringify(body),
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.detail || t("banFailed"));
                }
                setAdminMessage(t("banSuccess"));
                showToast(t("banSuccess"));
                await loadAdminUsers();
                await loadAdminBans();
            } catch (e) {
                setAdminMessage(e.message || t("banFailed"), true);
            } finally {
                banButton.disabled = false;
            }
            return;
        }

        const unbanButton = event.target.closest(".admin-unban-user-btn");
        if (unbanButton) {
            const banId = unbanButton.dataset.banId;
            const username = unbanButton.dataset.username || "";
            const reason = window.prompt(t("banPromptRevokeReason", { username }), t("banDefaultRevokeReason")) || t("banDefaultRevokeReason");
            if (!window.confirm(t("banRevokeConfirm", { username }))) return;
            unbanButton.disabled = true;
            try {
                const resp = await fetch(`${API_BASE}/api/admin/bans/${encodeURIComponent(banId)}/revoke`, {
                    method: "POST",
                    headers: authHeaders(),
                    body: JSON.stringify({ reason }),
                });
                if (!resp.ok) {
                    const err = await resp.json().catch(() => ({}));
                    throw new Error(err.detail || t("banRevokeFailed"));
                }
                setAdminMessage(t("banRevokeSuccess"));
                showToast(t("banRevokeSuccess"));
                await loadAdminUsers();
                await loadAdminBans();
            } catch (e) {
                setAdminMessage(e.message || t("banRevokeFailed"), true);
            } finally {
                unbanButton.disabled = false;
            }
            return;
        }

        const button = event.target.closest(".admin-reset-password-btn");
        if (!button) return;

        const userId = button.dataset.userId;
        const input = adminUserList.querySelector(`.admin-reset-password-input[data-user-id="${userId}"]`);
        const newPassword = (input?.value || "").trim();
        if (newPassword.length < 4) {
            setAdminMessage(t('passwordTooShort'), true);
            return;
        }

        button.disabled = true;
        try {
            const resp = await fetch(`${API_BASE}/api/admin/users/${encodeURIComponent(userId)}/password`, {
                method: "PUT",
                headers: authHeaders(),
                body: JSON.stringify({ new_password: newPassword }),
            });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                    throw new Error(err.detail || t("passwordResetFailed"));
            }
            if (input) input.value = "";
            setAdminMessage(t('passwordResetSuccess'));
            showToast(t('passwordResetSuccess'));
            await loadAdminUsers();
        } catch (e) {
            setAdminMessage(e.message || t("passwordResetFailed"), true);
        } finally {
            button.disabled = false;
        }
    });
}

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
                <span>${t("playCount", { count: item.play_count })}</span>
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
        statsContent.innerHTML = t("statsLoading");

        try {
            const res = await fetch(`${API_BASE}/api/stats/summary`, {
                headers: { "Authorization": `Bearer ${getToken()}` }
            });
            const data = await res.json();

            const songs = data.top_songs || [];
            const artists = data.top_artists || [];

            if (!songs.length && !artists.length) {
                statsContent.innerHTML = `<p>${t("statsEmpty")}</p>`;
                return;
            }

            let html = '';

            if (songs.length) {
                const maxSong = songs[0].play_count || 1;
                html += `<h4 style="color: #aaa; margin-bottom: 12px;">${t("statsTopSongs", { count: songs.length })}</h4>`;
                html += renderRankList(songs, maxSong, item => item.title);
            }

            if (artists.length) {
                const maxArtist = artists[0].play_count || 1;
                html += `<h4 style="color: #aaa; margin: 24px 0 12px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 20px;">${t("statsTopArtists", { count: artists.length })}</h4>`;
                html += renderRankList(artists, maxArtist, item => item.name);
            }

            statsContent.innerHTML = html;
        } catch (err) {
            statsContent.innerHTML = `<p style='color: red;'>${t("statsFetchFailed")}</p>`;
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
    if (!name) { plCreateMsg.textContent = t("enterPlaylistName"); plCreateMsg.classList.add("error"); return; }
    try {
        const resp = await fetch(`${API_BASE}/api/playlists`, {
            method: "POST", headers: authHeaders(),
            body: JSON.stringify({ name }),
        });
        if (!resp.ok) throw new Error();
        plCreateMsg.textContent = t("createSuccess"); plCreateMsg.classList.add("success");
        plCreateName.value = "";
        await fetchMyPlaylists();
        renderDirectory("root");
        setTimeout(() => closeModal(plCreateModal), 500);
    } catch (e) { plCreateMsg.textContent = t("createFailed"); plCreateMsg.classList.add("error"); }
});

// ── Playlist select modal ────────────────────────────────────────
plSelectClose.addEventListener("click", () => closeModal(plSelectModal));

/* ── Shared player init ────────────────────────────────────────── */
function resetPlayerUI() {
    // Clear to transparent spacer — onerror will swap in fallback SVG
    coverImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    coverImg.classList.add("fallback-cover");
    coverImg.classList.remove("is-playing");
    songTitle.textContent = t("noSong");
    songAlbum.textContent = t("exploreLibrary");
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

    if (!username || !password) return loginError.textContent = t("enterCredentials");

    try {
        const resp = await fetch(`${API_BASE}/api/auth/login`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password }),
        });
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({}));
            if (err.detail && typeof err.detail === "object") {
                const parts = [err.detail.message, err.detail.reason, err.detail.contact].filter(Boolean);
                return loginError.textContent = parts.join("\n");
            }
            return loginError.textContent = err.detail || t("loginFailed");
        }
        const data = await resp.json();
        setToken(data.access_token);
        await initPlayer();
    } catch (e) { loginError.textContent = t("networkError"); }
});

/* ── Load library ──────────────────────────────────────────────── */
async function loadLibrary() {
    try {
        const resp = await fetch(`${API_BASE}/api/songs`, { headers: authHeaders() });
        if (!resp.ok) throw new Error(t("songListFetchFailed"));
        const songs = await resp.json();
        if (!songs.length) return;

        // 全局多级排序：歌手 → 专辑 → 音轨号/标题
        songs.sort((a, b) => {
            const artistA = (a.Artists && a.Artists.length > 0) ? a.Artists[0] : t("unknown");
            const artistB = (b.Artists && b.Artists.length > 0) ? b.Artists[0] : t("unknown");
            const artistCmp = artistA.localeCompare(artistB, 'zh-CN', { numeric: true });
            if (artistCmp !== 0) return artistCmp;

            const albumA = a.Album || t("unknown");
            const albumB = b.Album || t("unknown");
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
        plHeader.textContent = t("myPlaylists");
        centerList.appendChild(plHeader);

        const createBtn = document.createElement("button");
        createBtn.className = "folder-item";
        createBtn.textContent = t("newPlaylist");
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
                delBtn.title = t("deletePlaylistTitle");
                delBtn.addEventListener("click", async (e) => {
                    e.stopPropagation();
                    if (confirm(t("deletePlaylistConfirm", { name: playlist.Name }))) {
                        try {
                            const res = await fetch(`${API_BASE}/api/playlists/${playlist.PlaylistID}`, {
                                method: "DELETE",
                                headers: { "Authorization": `Bearer ${getToken()}` }
                            });
                            if (res.ok) {
                                await fetchMyPlaylists();
                                renderDirectory("root");
                            } else {
                                alert(t("deletePlaylistFailed"));
                            }
                        } catch (err) {
                            console.error("delete playlist error", err);
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
            const header = document.createElement("div"); header.className = "dir-header"; header.textContent = t("folders"); centerList.appendChild(header);
            folderNames.forEach(name => {
                const btn = document.createElement("button"); btn.className = "folder-item"; btn.textContent = `📁 ${name}`;
                btn.addEventListener("click", () => renderDirectory(name));
                centerList.appendChild(btn);
            });
        }
        currentViewPlaylist = [...libraryTree.root];
        const header = document.createElement("div"); header.className = "dir-header"; header.textContent = t("rootSongs", { count: currentViewPlaylist.length }); centerList.appendChild(header);
        currentViewPlaylist.forEach((song, idx) => centerList.appendChild(buildSongRow(song, idx)));
    } else {
        const backBtn = document.createElement("button"); backBtn.className = "nav-back"; backBtn.textContent = t("backRoot");
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
    titleDiv.textContent = song.Title || t("unknownSong");

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
    favBtn.title = t("like");
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
    addBtn.title = t("addToPlaylist");
    addBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        songIdToAdd = song.SongID;
        renderPlaylistSelectList();
        openModal(document.getElementById("playlist-select-modal"));
    });

    // Custom cover / lyrics button (Admin only; these assets are global song metadata)
    const customBtn = document.createElement("button");
    customBtn.className = "custom-asset-btn";
    customBtn.textContent = "🎨";
    customBtn.title = t("customAssetsShort");
    customBtn.style.display = userProfile?.Role === "Admin" ? "" : "none";
    customBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openCustomAssetModal(song);
    });

    // Wrap action buttons in a container (hover-reveal)
    const actionsDiv = document.createElement("div");
    actionsDiv.className = "song-actions";
    actionsDiv.appendChild(favBtn);
    actionsDiv.appendChild(addBtn);
    actionsDiv.appendChild(customBtn);
    row.appendChild(actionsDiv);

    return row;
}

function setCustomAssetMessage(message, isError = false) {
    if (!customAssetMsg) return;
    customAssetMsg.className = "msg-text" + (isError ? " error" : " success");
    customAssetMsg.textContent = message || "";
}

function updateSongCustomAssetState(songId, patch = {}) {
    const id = Number(songId);
    if (!id) return;
    const apply = (song) => {
        if (!song || Number(song.SongID) !== id) return;
        if (Object.prototype.hasOwnProperty.call(patch, "CoverPath")) song.CoverPath = patch.CoverPath;
        if (Object.prototype.hasOwnProperty.call(patch, "DefaultCoverPath")) song.DefaultCoverPath = patch.DefaultCoverPath;
        if (Object.prototype.hasOwnProperty.call(patch, "HasCustomCover")) song.HasCustomCover = patch.HasCustomCover;
        if (Object.prototype.hasOwnProperty.call(patch, "HasCustomLyrics")) song.HasCustomLyrics = patch.HasCustomLyrics;
    };
    allSongsRaw.forEach(apply);
    currentViewPlaylist.forEach(apply);
    currentPlayingPlaylist.forEach(apply);
    if (currentPlayingSong && Number(currentPlayingSong.SongID) === id) {
        apply(currentPlayingSong);
        if (patch.CoverPath !== undefined) {
            if (patch.CoverPath) {
                coverImg.classList.remove("fallback-cover");
                coverImg.src = API_BASE + patch.CoverPath;
            } else {
                coverImg.classList.add("fallback-cover");
                coverImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
            }
            const mobileCover = document.getElementById("mobile-cover-img");
            if (mobileCover) mobileCover.src = coverImg.src;
        }
    }
}

async function openCustomAssetModal(song) {
    if (!customAssetModal || !song?.SongID) return;
    currentCustomAssetSong = song;
    customAssetSongTitle.textContent = (song.Title || t("unknownSong")) + " · ID " + song.SongID;
    customCoverUpload.value = "";
    customLyricsText.value = "";
    setCustomAssetMessage("");
    openModal(customAssetModal);
    try {
        const resp = await fetch(API_BASE + "/api/custom-assets/" + song.SongID, { headers: authHeaders() });
        if (!resp.ok) throw new Error("asset status failed");
        const data = await resp.json();
        customLyricsText.value = data.custom_lyrics || "";
        updateSongCustomAssetState(song.SongID, { CoverPath: data.cover_path, DefaultCoverPath: data.default_cover_path, HasCustomCover: data.has_custom_cover, HasCustomLyrics: data.has_custom_lyrics });
        setCustomAssetMessage(t("customAssetsLoaded"));
    } catch (e) { setCustomAssetMessage(t("loadFailed"), true); }
}

async function saveCustomCover() {
    if (!currentCustomAssetSong?.SongID) return;
    const file = customCoverUpload?.files?.[0];
    if (!file) { setCustomAssetMessage(t("chooseCoverFile"), true); return; }
    const formData = new FormData();
    formData.append("cover", file);
    try {
        const resp = await fetch(API_BASE + "/api/custom-assets/" + currentCustomAssetSong.SongID + "/cover", { method: "POST", headers: { "Authorization": "Bearer " + getToken() }, body: formData });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.detail || "cover save failed");
        updateSongCustomAssetState(currentCustomAssetSong.SongID, { CoverPath: data.cover_path, DefaultCoverPath: data.default_cover_path, HasCustomCover: true });
        customCoverUpload.value = "";
        setCustomAssetMessage(t("customAssetsSaved"));
        showToast(t("customAssetsSaved"));
    } catch (e) { setCustomAssetMessage(e.message || t("requestFailed"), true); }
}

async function clearCustomCover() {
    if (!currentCustomAssetSong?.SongID) return;
    try {
        const resp = await fetch(API_BASE + "/api/custom-assets/" + currentCustomAssetSong.SongID + "/cover", { method: "DELETE", headers: authHeaders() });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.detail || "cover clear failed");
        updateSongCustomAssetState(currentCustomAssetSong.SongID, { CoverPath: data.cover_path, DefaultCoverPath: data.default_cover_path, HasCustomCover: false });
        setCustomAssetMessage(t("customAssetsCleared"));
        showToast(t("customAssetsCleared"));
    } catch (e) { setCustomAssetMessage(e.message || t("requestFailed"), true); }
}

async function saveCustomLyrics() {
    if (!currentCustomAssetSong?.SongID) return;
    const lyrics = customLyricsText.value || "";
    try {
        const resp = await fetch(API_BASE + "/api/custom-assets/" + currentCustomAssetSong.SongID + "/lyrics", { method: "PUT", headers: authHeaders(), body: JSON.stringify({ lyrics }) });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.detail || "lyrics save failed");
        updateSongCustomAssetState(currentCustomAssetSong.SongID, { HasCustomLyrics: data.has_custom_lyrics });
        setCustomAssetMessage(data.has_custom_lyrics ? t("customAssetsSaved") : t("lyricsEmpty"));
        showToast(data.has_custom_lyrics ? t("customAssetsSaved") : t("lyricsEmpty"));
        if (currentSongId === currentCustomAssetSong.SongID) await loadLyrics(currentCustomAssetSong.SongID);
    } catch (e) { setCustomAssetMessage(e.message || t("requestFailed"), true); }
}

async function clearCustomLyrics() {
    if (!currentCustomAssetSong?.SongID) return;
    try {
        const resp = await fetch(API_BASE + "/api/custom-assets/" + currentCustomAssetSong.SongID + "/lyrics", { method: "DELETE", headers: authHeaders() });
        const data = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(data.detail || "lyrics clear failed");
        customLyricsText.value = "";
        updateSongCustomAssetState(currentCustomAssetSong.SongID, { HasCustomLyrics: false });
        setCustomAssetMessage(t("customAssetsCleared"));
        showToast(t("customAssetsCleared"));
        if (currentSongId === currentCustomAssetSong.SongID) await loadLyrics(currentCustomAssetSong.SongID);
    } catch (e) { setCustomAssetMessage(e.message || t("requestFailed"), true); }
}

customCoverSaveBtn?.addEventListener("click", saveCustomCover);
customCoverClearBtn?.addEventListener("click", clearCustomCover);
customLyricsSaveBtn?.addEventListener("click", saveCustomLyrics);
customLyricsClearBtn?.addEventListener("click", clearCustomLyrics);
customAssetCloseBtn?.addEventListener("click", () => closeModal(customAssetModal));

function renderPlaylistSelectList() {
    const list = document.getElementById("playlist-select-list");
    list.innerHTML = "";
    if (!myPlaylists.length) {
        const empty = document.createElement("div");
        empty.className = "playlist-select-item";
        empty.textContent = t("noPlaylist");
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
                showToast(t("addedToPlaylist", { name: pl.Name }));
                closeModal(document.getElementById("playlist-select-modal"));
            } catch (e) { showToast(t("addFailed"), true); }
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
    backBtn.textContent = t("backRoot");
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
        if (!resp.ok) throw new Error(t("playlistFetchFailed"));
        const songs = await resp.json();

        currentViewPlaylist = [...songs];
        if (!songs.length) {
            const empty = document.createElement("div");
            empty.className = "center-empty";
            empty.textContent = t("emptyPlaylist");
            centerList.appendChild(empty);
        } else {
            songs.forEach((song, idx) => centerList.appendChild(buildSongRow(song, idx)));
        }
    } catch (e) {
        const err = document.createElement("div");
        err.className = "center-empty";
        err.textContent = t("playlistLoadFailedInline");
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
    
    const backBtn = document.createElement("button"); backBtn.className = "nav-back"; backBtn.textContent = t("clearFilter");
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
    header.textContent = t("filterHeader", { keyword, count: filtered.length }); centerList.appendChild(header);

    if (filtered.length === 0) {
        const empty = document.createElement("div"); empty.className = "center-empty"; empty.textContent = t("noMatch"); centerList.appendChild(empty);
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
let isVisualizerEnabled = true;
let visualizerDisabledFrameCleared = false;
let visualizerLoopActive = false;

function normalizeVisualizerEnabled(value) {
    return !(value === false || value === 0 || value === "0" || value === "false");
}

function clearVisualizerCanvas() {
    if (visualizerUsesWorker && visualizerWorker) {
        visualizerWorker.postMessage({ type: "clear" });
        visualizerFramePending = false;
    } else if (visCanvasCtx && visCanvas) {
        visCanvasCtx.clearRect(0, 0, visCanvas.width, visCanvas.height);
    }
    visualizerDisabledFrameCleared = true;
}

function updateVisualizerToggleButton() {
    if (visCanvas) visCanvas.classList.toggle("visualizer-disabled", !isVisualizerEnabled);
    if (!visualizerToggleBtn) return;
    visualizerToggleBtn.classList.toggle("is-on", isVisualizerEnabled);
    visualizerToggleBtn.classList.toggle("is-off", !isVisualizerEnabled);
    visualizerToggleBtn.setAttribute("aria-pressed", isVisualizerEnabled ? "true" : "false");
    const label = t(isVisualizerEnabled ? "visualizerOnTitle" : "visualizerOffTitle");
    visualizerToggleBtn.title = label;
    visualizerToggleBtn.setAttribute("aria-label", label);
}

function requestVisualizerFrame() {
    if (!isVisualizerEnabled || visualizerLoopActive) return;
    visualizerLoopActive = true;
    requestAnimationFrame(drawVisualizer);
}

function startVisualizerIfNeeded() {
    if (!isVisualizerEnabled || audioPlayer.paused) return;
    try {
        initVisualizer();
        if (audioCtx && audioCtx.state === "suspended") {
            audioCtx.resume().catch(() => {});
        }
        requestVisualizerFrame();
    } catch (e) {
        console.warn("Visualizer start failed", e);
    }
}

function applyVisualizerPreference(value) {
    isVisualizerEnabled = normalizeVisualizerEnabled(value);
    if (!isVisualizerEnabled) {
        clearVisualizerCanvas();
    } else {
        visualizerDisabledFrameCleared = false;
    }
    updateVisualizerToggleButton();
    startVisualizerIfNeeded();
}

async function saveVisualizerPreference(enabled) {
    const resp = await fetch(`${API_BASE}/api/users/me/visualizer`, {
        method: "PUT",
        headers: authHeaders(),
        body: JSON.stringify({ enabled }),
    });
    if (!resp.ok) throw new Error("Failed to save visualizer preference");
    const data = await resp.json();
    if (userProfile) userProfile.VisualizerEnabled = data.enabled;
}

if (visualizerToggleBtn) {
    visualizerToggleBtn.addEventListener("click", async () => {
        const previous = isVisualizerEnabled;
        const next = !previous;
        applyVisualizerPreference(next);
        try {
            await saveVisualizerPreference(next);
            showToast(t(next ? "visualizerSavedOn" : "visualizerSavedOff"));
        } catch (e) {
            console.error("save visualizer preference error:", e);
            applyVisualizerPreference(previous);
            showToast(t("visualizerSaveFailed"), true);
        }
    });
}

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
    requestVisualizerFrame();
}

function drawVisualizer() {
    if (!isVisualizerEnabled) {
        if (!visualizerDisabledFrameCleared) clearVisualizerCanvas();
        visualizerLoopActive = false;
        return;
    }
    requestAnimationFrame(drawVisualizer);

    visualizerDisabledFrameCleared = false;
    if (!analyser || !visDataArray) return;

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
    songTitle.textContent = song.Title || t("unknownSong");

    if (song.CoverPath) {
        coverImg.classList.remove("fallback-cover");
        coverImg.src = API_BASE + song.CoverPath;
    } else {
        // No cover path — force the onerror fallback
        coverImg.classList.add("fallback-cover");
        coverImg.src = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    }

    const albumName = song.Album || t("unknownAlbum");
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
                    sel.add(new Option(t("qualityOriginalHiRes"), "original"));
                    sel.add(new Option(t("qualityLossless4416"), "lossless"));
                    sel.add(new Option(t("qualityHigh320"), "high"));
                    sel.add(new Option(t("qualityStandard128"), "standard"));
                } else if (audioData.is_lossless) {
                    sel.add(new Option(t("qualityLosslessOriginal"), "original"));
                    sel.add(new Option(t("qualityHigh320"), "high"));
                    sel.add(new Option(t("qualityStandard128"), "standard"));
                } else if (!audioData.is_lossless && audioData.bit_rate >= 256000) {
                    sel.add(new Option(t("qualityHighOriginal"), "original"));
                    sel.add(new Option(t("qualityStandard128"), "standard"));
                } else {
                    sel.add(new Option(t("qualityStandardOriginal"), "original"));
                }

                const savedQuality = localStorage.getItem("musiccloud_quality") || "original";
                const optionExists = Array.from(sel.options).some(opt => opt.value === savedQuality);
                sel.value = optionExists ? savedQuality : "original";
            });
        }
    } catch (e) {
        console.error(t("audioInfoFallback"), e);
    }

    const currentQuality = localStorage.getItem("musiccloud_quality") || "original";
    audioPlayer.src = `${API_BASE}/api/stream/${song.SongID}?token=${encodeURIComponent(getToken())}&quality=${currentQuality}`;

    // ── Media Session metadata (lock screen / system controls) ──
    if ("mediaSession" in navigator) {
        const artworkUrl = song.CoverPath ? API_BASE + song.CoverPath : "";
        const artistStr = (song.Artists && song.Artists.length) ? song.Artists.join(", ") : t("unknownArtist");
        navigator.mediaSession.metadata = new MediaMetadata({
            title: song.Title || t("unknownSong"),
            artist: artistStr,
            album: song.Album || t("unknownAlbum"),
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
    if (isVisualizerEnabled) {
        startVisualizerIfNeeded();
    } else {
        clearVisualizerCanvas();
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
    btnMode.title = t(MODES[currentModeIndex].titleKey);
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
    backBtn.textContent = t("backAllSongs");
    backBtn.addEventListener("click", () => renderDirectory("root"));
    centerNav.appendChild(backBtn);

    const header = document.createElement("div");
    header.className = "dir-header";
    header.textContent = t("favorites");
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
            empty.textContent = t("noFavorites");
            centerList.appendChild(empty);
        } else {
            songs.forEach((s, idx) => centerList.appendChild(buildSongRow(s, idx)));
        }
    } catch (e) {
        const err = document.createElement("div");
        err.className = "center-empty";
        err.textContent = t("loadFailed");
        centerList.appendChild(err);
    }
});

// ── Sync library button ────────────────────────────────────────
const syncLibraryBtn = document.getElementById("nav-sync-library");
if (syncLibraryBtn) {
    syncLibraryBtn.addEventListener("click", async () => {
        const originalText = syncLibraryBtn.textContent || t("newPlaylist");
        syncLibraryBtn.textContent = t("syncing");
        syncLibraryBtn.style.pointerEvents = "none";

        try {
            const res = await fetch(`${API_BASE}/api/library/scan`, {
                method: "POST",
                headers: authHeaders(),
            });

            if (res.ok) {
                syncLibraryBtn.textContent = t("syncDone");
                await loadLibrary();
            } else {
                syncLibraryBtn.textContent = t("syncFailed");
            }
        } catch (err) {
            console.error("sync library failed", err);
            syncLibraryBtn.textContent = t("syncLibraryErrorText");
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
    locateBtn.textContent = t("locateCurrent");
    locateBtn.title = t("locateCurrentTitle");
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
    isNoLyricsNoticeVisible = false;
    if (lyricScrollFrame) {
        cancelAnimationFrame(lyricScrollFrame);
        lyricScrollFrame = 0;
    }
}

function createNoLyricsNoticeElement() {
    const li = document.createElement("li");
    li.className = "lyrics-empty-notice";

    const title = document.createElement("strong");
    title.textContent = t("noLyricsTitle");

    const intro = document.createElement("p");
    intro.textContent = t("noLyricsIntro");

    const list = document.createElement("ol");
    ["noLyricsReason1", "noLyricsReason2", "noLyricsReason3", "noLyricsReason4", "noLyricsReason5"].forEach(reasonKey => {
        const item = document.createElement("li");
        item.textContent = t(reasonKey);
        list.appendChild(item);
    });

    const footer = document.createElement("p");
    footer.className = "lyrics-empty-notice-footer";
    footer.append(document.createTextNode(`${t("noLyricsFooterPrefix")} `));
    const contactBtn = document.createElement("button");
    contactBtn.type = "button";
    contactBtn.className = "lyrics-contact-ticket-btn";
    contactBtn.textContent = t("contactDeveloper");
    contactBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        const songName = currentPlayingSong?.Title || songTitle?.textContent || t("currentSong");
        openTicketModal({
            title: t("lyricsTicketTitle", { song: songName }),
            body: t("lyricsTicketBody", { song: songName }),

        });
    });
    footer.appendChild(contactBtn);

    li.appendChild(title);
    li.appendChild(intro);
    li.appendChild(list);
    li.appendChild(footer);
    return li;
}

function showNoLyricsNotice() {
    resetLyricsView();
    isNoLyricsNoticeVisible = true;
    lyricsUL.replaceChildren(createNoLyricsNoticeElement());
    const mobileLyricsUL = document.getElementById("mobile-lyrics-list");
    if (mobileLyricsUL) mobileLyricsUL.replaceChildren(createNoLyricsNoticeElement());
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
        if (!resp.ok) {
            showNoLyricsNotice();
            return;
        }
        const data = await resp.json();
        if (!data.lyrics || !String(data.lyrics).trim()) {
            showNoLyricsNotice();
            return;
        }

        lyricsData = parseLRC(data.lyrics);
        if (!lyricsData.length && data.lyrics.trim()) {
            lyricsData = data.lyrics.split(/\r?\n/)
                .map(line => line.trim())
                .filter(Boolean)
                .map((text, idx) => ({ time: idx * 3, text }));
        }
        if (!lyricsData.length) {
            showNoLyricsNotice();
            return;
        }
        const fragment = document.createDocumentFragment();
        lyricLineEls = lyricsData.map((item, idx) => {
            const li = createLyricLine(item, idx);
            fragment.appendChild(li);
            return li;
        });
        lyricsUL.replaceChildren(fragment);
        renderMobileLyrics();
    } catch (e) {
        console.error("loadLyrics error:", e);
        showNoLyricsNotice();
    }
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
function normalizeWeatherQueryName(value) {
    return String(value || '')
        .replace(/\u7279\u522b\u884c\u653f\u533a$/u, '')
        .replace(/[\u5e02\u53bf\u5340\u533a]$/u, '');
}

function normalizeWeatherApiTarget(location) {
    const country = String(location?.country || '');
    const province = String(location?.province || '');
    const city = String(location?.city || '');
    const district = String(location?.district || '');
    const countryAdcode = String(location?.countryAdcode || '');
    const provinceAdcode = String(location?.provinceAdcode || '');
    const cityAdcode = String(location?.cityAdcode || '');
    const districtAdcode = String(location?.districtAdcode || '');
    const locationAdcode = String(location?.locationAdcode || '');
    const queryCity = String(location?.queryCity || district || city || province || country || '');

    const isChina = country === '\u4e2d\u56fd' || country === 'CN' || countryAdcode === '100000';
    if (!isChina) {
        return {
            queryCity: normalizeWeatherQueryName(city || province || country || queryCity),
            adcode: '',
        };
    }

    const provincePrefix = (provinceAdcode || locationAdcode || '').slice(0, 2);

    // Hong Kong and Macau district/adcode weather often returns empty fields.
    // Keep the selected district for display/save, but query weather by SAR name.
    if (provincePrefix === '81' || provincePrefix === '82') {
        return {
            queryCity: normalizeWeatherQueryName(province || city || queryCity),
            adcode: '',
        };
    }

    // Taiwan district/adcode weather is inconsistent. Query by city/county name
    // rather than district adcode to avoid unknown weather.
    if (provincePrefix === '71') {
        return {
            queryCity: normalizeWeatherQueryName(city || province || queryCity),
            adcode: '',
        };
    }

    return {
        queryCity,
        adcode: locationAdcode || districtAdcode || cityAdcode || provinceAdcode || '',
    };
}

const regionDisplayCache = new Map();
function regionTranslateCacheKey(lang, text) { return `${lang || 'zh-CN'}:${text || ''}`; }
function logRegionTranslationError(stage, error, extra = {}) {
    console.error('[RegionTranslation]', stage, {
        lang: currentLang || 'zh-CN',
        ...extra,
        error,
    });
}
async function translateRegionTextsForCurrentLang(texts = [], stage = 'region-display') {
    const lang = currentLang || 'zh-CN';
    const unique = Array.from(new Set(texts.map(v => String(v || '').trim()).filter(Boolean)));
    const fallback = Object.fromEntries(unique.map(v => [v, v]));
    if (!unique.length || lang === 'zh-CN') return fallback;

    const result = {};
    const missing = [];
    unique.forEach(text => {
        const key = regionTranslateCacheKey(lang, text);
        if (regionDisplayCache.has(key)) result[text] = regionDisplayCache.get(key);
        else missing.push(text);
    });

    const chunkSize = 80;
    for (let i = 0; i < missing.length; i += chunkSize) {
        const chunk = missing.slice(i, i + chunkSize);
        let resp;
        let payload = null;
        try {
            resp = await fetch(`${API_BASE}/api/regions/translate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ lang, texts: chunk }),
            });
            payload = await resp.json().catch(async () => ({ raw: await resp.text().catch(() => '') }));
        } catch (error) {
            logRegionTranslationError(stage, error, { texts: chunk });
            chunk.forEach(text => { result[text] = fallback[text]; });
            continue;
        }
        if (!resp.ok) {
            const error = new Error(`Region translation request failed: HTTP ${resp.status} ${payload?.detail || payload?.error || payload?.raw || ''}`);
            logRegionTranslationError(stage, error, { status: resp.status, response: payload, texts: chunk });
            chunk.forEach(text => { result[text] = fallback[text]; });
            continue;
        }
        const translations = payload?.translations || {};
        const unresolved = [];
        chunk.forEach(text => {
            const translated = translations[text] || fallback[text];
            if (!translations[text]) unresolved.push(text);
            regionDisplayCache.set(regionTranslateCacheKey(lang, text), translated);
            result[text] = translated;
        });
        if (unresolved.length) {
            logRegionTranslationError(stage, new Error(`Region translation incomplete; using native fallback for ${unresolved.length} item(s)`), { unresolved, response: payload });
        }
    }
    return { ...fallback, ...result };
}
async function translatedRegionLabel(parts = [], stage = 'region-label') {
    const clean = parts.map(v => String(v || '').trim()).filter(Boolean);
    if (!clean.length) return '';
    const translated = await translateRegionTextsForCurrentLang(clean, stage);
    return clean.map(part => translated[part]).join(' ');
}

const WEATHER_LABEL_TRANSLATIONS = {
    '晴': { 'zh-CN': '晴', 'zh-TW': '晴', en: 'Sunny', ja: '晴れ', ko: '맑음' },
    '少云': { 'zh-CN': '少云', 'zh-TW': '少雲', en: 'Mostly sunny', ja: '晴れ時々曇り', ko: '구름 조금' },
    '晴间多云': { 'zh-CN': '晴间多云', 'zh-TW': '晴時多雲', en: 'Partly cloudy', ja: '晴れ時々曇り', ko: '구름 조금' },
    '多云': { 'zh-CN': '多云', 'zh-TW': '多雲', en: 'Cloudy', ja: '曇り', ko: '구름 많음' },
    '阴': { 'zh-CN': '阴', 'zh-TW': '陰', en: 'Overcast', ja: '曇り', ko: '흐림' },
    '阵雨': { 'zh-CN': '阵雨', 'zh-TW': '陣雨', en: 'Showers', ja: 'にわか雨', ko: '소나기' },
    '雷阵雨': { 'zh-CN': '雷阵雨', 'zh-TW': '雷陣雨', en: 'Thunder showers', ja: '雷雨', ko: '천둥번개를 동반한 소나기' },
    '雷阵雨并伴有冰雹': { 'zh-CN': '雷阵雨并伴有冰雹', 'zh-TW': '雷陣雨伴隨冰雹', en: 'Thunder showers with hail', ja: 'ひょうを伴う雷雨', ko: '우박을 동반한 뇌우' },
    '小雨': { 'zh-CN': '小雨', 'zh-TW': '小雨', en: 'Light rain', ja: '小雨', ko: '약한 비' },
    '中雨': { 'zh-CN': '中雨', 'zh-TW': '中雨', en: 'Moderate rain', ja: '雨', ko: '보통 비' },
    '大雨': { 'zh-CN': '大雨', 'zh-TW': '大雨', en: 'Heavy rain', ja: '大雨', ko: '강한 비' },
    '暴雨': { 'zh-CN': '暴雨', 'zh-TW': '暴雨', en: 'Rainstorm', ja: '豪雨', ko: '폭우' },
    '大暴雨': { 'zh-CN': '大暴雨', 'zh-TW': '大暴雨', en: 'Heavy rainstorm', ja: '激しい豪雨', ko: '강한 폭우' },
    '特大暴雨': { 'zh-CN': '特大暴雨', 'zh-TW': '特大暴雨', en: 'Severe rainstorm', ja: '猛烈な豪雨', ko: '매우 강한 폭우' },
    '雨夹雪': { 'zh-CN': '雨夹雪', 'zh-TW': '雨夾雪', en: 'Sleet', ja: 'みぞれ', ko: '진눈깨비' },
    '阵雪': { 'zh-CN': '阵雪', 'zh-TW': '陣雪', en: 'Snow showers', ja: 'にわか雪', ko: '소낙눈' },
    '小雪': { 'zh-CN': '小雪', 'zh-TW': '小雪', en: 'Light snow', ja: '小雪', ko: '약한 눈' },
    '中雪': { 'zh-CN': '中雪', 'zh-TW': '中雪', en: 'Moderate snow', ja: '雪', ko: '보통 눈' },
    '大雪': { 'zh-CN': '大雪', 'zh-TW': '大雪', en: 'Heavy snow', ja: '大雪', ko: '강한 눈' },
    '暴雪': { 'zh-CN': '暴雪', 'zh-TW': '暴雪', en: 'Blizzard', ja: '吹雪', ko: '눈보라' },
    '雾': { 'zh-CN': '雾', 'zh-TW': '霧', en: 'Fog', ja: '霧', ko: '안개' },
    '冻雨': { 'zh-CN': '冻雨', 'zh-TW': '凍雨', en: 'Freezing rain', ja: '凍雨', ko: '어는 비' },
    '沙尘暴': { 'zh-CN': '沙尘暴', 'zh-TW': '沙塵暴', en: 'Sandstorm', ja: '砂嵐', ko: '모래폭풍' },
    '浮尘': { 'zh-CN': '浮尘', 'zh-TW': '浮塵', en: 'Dust', ja: 'ちり', ko: '먼지' },
    '扬沙': { 'zh-CN': '扬沙', 'zh-TW': '揚沙', en: 'Blowing sand', ja: '砂じん', ko: '날리는 모래' },
    '强沙尘暴': { 'zh-CN': '强沙尘暴', 'zh-TW': '強沙塵暴', en: 'Severe sandstorm', ja: '強い砂嵐', ko: '강한 모래폭풍' },
    '霾': { 'zh-CN': '霾', 'zh-TW': '霾', en: 'Haze', ja: 'もや', ko: '연무' },
    '未知': { 'zh-CN': '未知', 'zh-TW': '未知', en: 'Unknown', ja: '不明', ko: '알 수 없음' },
};

function normalizeWeatherLabelSource(value) {
    return String(value || '').trim().replace(/\s+/g, '');
}

function stripWeatherContextPrefix(value) {
    return String(value || '')
        .replace(/^\s*(weather|weather condition|condition)\s*[:：-]\s*/i, '')
        .replace(/^\s*(天气|天氣|天气情况|天氣狀況)\s*[:：-]\s*/, '')
        .trim();
}

async function translateWeatherLabelForCurrentLang(weather) {
    const raw = String(weather || '').trim() || '未知';
    const key = normalizeWeatherLabelSource(raw);
    const lang = currentLang || 'zh-CN';
    const mapped = WEATHER_LABEL_TRANSLATIONS[key]?.[lang] || WEATHER_LABEL_TRANSLATIONS[key]?.en;
    if (mapped) return mapped;
    if (lang === 'zh-CN') return raw;

    // Weather text must not share the region translation cache. Give the API
    // explicit weather context so single-character terms such as "阴" are not
    // transliterated as names like "Yin".
    const contextText = `天气：${raw}`;
    try {
        const translated = await translateRegionTextsForCurrentLang([contextText], 'weather-text-context');
        const label = stripWeatherContextPrefix(translated[contextText] || '');
        return label || raw;
    } catch (error) {
        logRegionTranslationError('weather-text-context', error, { weather: raw });
        return raw;
    }
}

async function fetchWeather(queryCity, displayCity, displayDistrict, adcode) {
    const nativeLocLabel = [displayCity, displayDistrict].filter(Boolean).join(' ') || queryCity || adcode || t('locationLoading');
    try {
        const params = new URLSearchParams();
        if (adcode) params.set('adcode', adcode);
        if (queryCity) params.set('city', queryCity);
        let wRes = await fetch(`${API_BASE}/api/weather?${params.toString()}`);

        // District/adcode weather failures fall back to city weather.
        if (!wRes.ok && displayDistrict && displayCity) {
            console.log(`District weather query failed (${queryCity || adcode}); fallback to city (${displayCity})`);
            wRes = await fetch(`${API_BASE}/api/weather?city=${encodeURIComponent(displayCity)}`);
        }

        if (!wRes.ok) throw new Error('Weather proxy request failed');
        const wData = await wRes.json();
        const dataObj = wData.data || wData;
        const weather = dataObj.weather || dataObj.type || '\u672a\u77e5';
        const temp = dataObj.temp || dataObj.temperature || dataObj.high || '--';
        currentWeatherState = { status: 'success', queryCity, displayCity, displayDistrict, adcode, nativeLocLabel, weather, temp };
        await renderWeatherStateForCurrentLang();
    } catch (e) {
        logRegionTranslationError('weather-display', e, { queryCity, displayCity, displayDistrict, adcode, nativeLocLabel });
        currentWeatherState = { status: 'failed', queryCity, displayCity, displayDistrict, adcode, nativeLocLabel };
        await renderWeatherStateForCurrentLang();
    }
}


async function initLocationAndWeather() {
    currentWeatherState = { status: 'loading' };
    await renderWeatherStateForCurrentLang();

    const rawCity = (userProfile && userProfile.City) || '\u5317\u4eac';
    const nativeDistrict = (userProfile && userProfile.District) || '';
    let displayCity, displayDistrict, queryCity;

    if (nativeDistrict) {
        displayCity = rawCity;
        displayDistrict = nativeDistrict;
        queryCity = nativeDistrict;
    } else if (rawCity && rawCity.includes('-')) {
        const parts = rawCity.split('-');
        displayCity = parts[0];
        displayDistrict = parts.slice(1).join('-');
        queryCity = displayDistrict;
    } else {
        displayCity = rawCity;
        displayDistrict = '';
        queryCity = rawCity;
    }

    if (rawCity !== '\u5b9a\u4f4d\u5931\u8d25') {
        const weatherTarget = normalizeWeatherApiTarget({
            country: userProfile?.Country || '\u4e2d\u56fd',
            province: userProfile?.Province || '',
            city: displayCity,
            district: displayDistrict,
            queryCity,
            countryAdcode: userProfile?.CountryAdcode || '',
            provinceAdcode: userProfile?.ProvinceAdcode || '',
            cityAdcode: userProfile?.CityAdcode || '',
            districtAdcode: userProfile?.DistrictAdcode || '',
            locationAdcode: userProfile?.LocationAdcode || '',
        });
        await fetchWeather(weatherTarget.queryCity, displayCity, displayDistrict, weatherTarget.adcode);
    } else {
        currentWeatherState = { status: 'unknown' };
        await renderWeatherStateForCurrentLang();
    }

    currentIpInfoState = { status: 'detecting', ip: '', city: '' };
    await renderIpInfoStateForCurrentLang();
    getIpInfo();
}


async function getIpInfo() {
    try {
        const resp = await fetch(`${API_BASE}/api/get-ip-info`);
        if (!resp.ok) throw new Error('Backend unavailable');
        const data = await resp.json();
        currentIpInfoState = { status: 'success', ip: data.ip || '', city: data.city || '' };
        await renderIpInfoStateForCurrentLang();
    } catch (e) {
        logRegionTranslationError('ip-location', e);
        currentIpInfoState = { status: 'failed', ip: '', city: '' };
        await renderIpInfoStateForCurrentLang();
    }
}

// Region data & cascading dropdowns (AMap China primary)
const selCountry = document.getElementById('sel-country');
const selProvince = document.getElementById('sel-province');
const selCity = document.getElementById('sel-city');
const selDistrict = document.getElementById('sel-district');
const locModal = document.getElementById('location-select-modal');
let regionLoadGeneration = 0;
const regionOptionsCache = new Map();
const regionOptionsInflight = new Map();

function regionLoadingText() {
    if (currentLang === 'zh-TW') return '\u6b63\u5728\u8f09\u5165\u5730\u5340...';
    if (currentLang === 'en') return 'Loading regions...';
    if (currentLang === 'ja') return '\u5730\u57df\u3092\u8aad\u307f\u8fbc\u307f\u4e2d...';
    if (currentLang === 'ko') return '\uc9c0\uc5ed\uc744 \ubd88\ub7ec\uc624\ub294 \uc911...';
    return '\u6b63\u5728\u52a0\u8f7d\u5730\u533a...';
}
function regionLoadFailedText() {
    if (currentLang === 'zh-TW') return '\u8f09\u5165\u5931\u6557';
    if (currentLang === 'en') return 'Failed to load';
    if (currentLang === 'ja') return '\u8aad\u307f\u8fbc\u307f\u5931\u6557';
    if (currentLang === 'ko') return '\ubd88\ub7ec\uc624\uae30 \uc2e4\ud328';
    return '\u52a0\u8f7d\u5931\u8d25';
}
function regionCacheKey(params = {}) {
    const sp = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim() !== '') sp.set(key, value);
    });
    sp.set('format', 'options');
    sp.set('lang', currentLang || 'zh-CN');
    return sp.toString();
}
async function fetchJsonWithTimeout(url, timeoutMs = 9000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const resp = await fetch(url, { signal: controller.signal });
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        return await resp.json();
    } finally {
        clearTimeout(timer);
    }
}
async function fetchRegionOptions(params = {}) {
    const key = regionCacheKey(params);
    if (regionOptionsCache.has(key)) return regionOptionsCache.get(key);
    if (regionOptionsInflight.has(key)) return regionOptionsInflight.get(key);
    const request = fetchJsonWithTimeout(`${API_BASE}/api/regions?${key}`).then(data => {
        const list = Array.isArray(data) ? data : [];
        regionOptionsCache.set(key, list);
        return list;
    }).finally(() => regionOptionsInflight.delete(key));
    regionOptionsInflight.set(key, request);
    return request;
}
function clearSelect(selectEl) { if (selectEl) selectEl.innerHTML = ''; }
function setSelectPlaceholder(selectEl, textValue, disabled = true) {
    if (!selectEl) return;
    clearSelect(selectEl);
    const opt = new Option(textValue, '');
    opt.disabled = disabled;
    opt.selected = true;
    selectEl.add(opt);
}
function showSelect(selectEl, visible) {
    if (!selectEl) return;
    selectEl.style.display = visible ? '' : 'none';
    if (!visible) {
        clearSelect(selectEl);
        selectEl.disabled = false;
        selectEl.removeAttribute('aria-busy');
    }
}
function setSelectLoading(selectEl) {
    if (!selectEl) return;
    showSelect(selectEl, true);
    setSelectPlaceholder(selectEl, regionLoadingText(), true);
    selectEl.disabled = true;
    selectEl.setAttribute('aria-busy', 'true');
}
function setSelectFailure(selectEl) {
    if (!selectEl) return;
    showSelect(selectEl, true);
    setSelectPlaceholder(selectEl, regionLoadFailedText(), true);
    selectEl.disabled = true;
    selectEl.removeAttribute('aria-busy');
}
function finishSelectUpdate(selectEl) {
    if (!selectEl) return;
    if (!selectEl.value && selectEl.options.length) selectEl.selectedIndex = 0;
    selectEl.disabled = false;
    selectEl.removeAttribute('aria-busy');
}
function makeRegionOption(item) {
    const payload = (item && typeof item === 'object') ? item : { value: String(item || ''), label: String(item || ''), name: String(item || '') };
    const value = payload.value || payload.adcode || payload.name || payload.label || '';
    const label = payload.label || payload.name || value;
    const opt = new Option(label, value);
    Object.entries(payload).forEach(([key, val]) => {
        if (val === undefined || val === null || typeof val === 'object') return;
        opt.dataset[key.replace(/[A-Z]/g, m => '_' + m.toLowerCase())] = String(val);
    });
    opt.dataset.label = label;
    opt.dataset.name = payload.name || label;
    return opt;
}
function regionPayloadNativeName(item) {
    const payload = (item && typeof item === 'object') ? item : { value: String(item || ''), label: String(item || ''), name: String(item || '') };
    return String(payload.native_name || payload.weather_name || payload.city || payload.name || payload.label || payload.value || '').trim();
}
async function populateTranslatedRegionSelect(selectEl, items, preferred = '', generation = regionLoadGeneration, stage = 'region-options') {
    if (!selectEl) return;
    const list = Array.isArray(items) ? items : [];
    const nativeNames = list.map(regionPayloadNativeName).filter(Boolean);
    let translations = {};
    try {
        translations = await translateRegionTextsForCurrentLang(nativeNames, stage);
    } catch (error) {
        logRegionTranslationError(stage, error, { nativeNames });
        throw error;
    }
    if (isStaleRegionLoad(generation)) return;
    clearSelect(selectEl);
    list.forEach(item => {
        const native = regionPayloadNativeName(item);
        const payload = (item && typeof item === 'object') ? { ...item } : { value: String(item || ''), name: native, native_name: native };
        payload.native_name = payload.native_name || native;
        payload.label = translations[native] || payload.label || payload.name || payload.native_name || payload.value || native;
        selectEl.add(makeRegionOption(payload));
    });
    selectPreferredOption(selectEl, preferred);
    finishSelectUpdate(selectEl);
}

function getSelectedRegionMeta(selectEl) {
    if (!selectEl || selectEl.style.display === 'none') return null;
    const opt = selectEl.selectedOptions && selectEl.selectedOptions[0];
    if (!opt || !opt.value) return null;
    const meta = { ...opt.dataset, value: opt.value, label: opt.dataset.label || opt.textContent || opt.value };
    meta.name = opt.dataset.name || meta.label;
    meta.adcode = opt.dataset.adcode || (/^\d{6}$/.test(opt.value) ? opt.value : '');
    meta.has_children = opt.dataset.has_children === 'true';
    meta.terminal = opt.dataset.terminal === 'true';
    meta.is_direct_admin = opt.dataset.is_direct_admin === 'true';
    return meta;
}
function regionName(meta) { return meta ? (meta.native_name || meta.weather_name || meta.name || meta.label || meta.value || '') : ''; }
function regionDisplayName(meta) { return meta ? (meta.label || meta.name || meta.native_name || meta.value || '') : ''; }
function selectPreferredOption(selectEl, preferred) {
    if (!selectEl || !preferred) return;
    const value = String(preferred);
    const target = Array.from(selectEl.options).find(opt =>
        opt.value === value || opt.dataset.adcode === value || opt.dataset.name === value || opt.dataset.native_name === value || opt.dataset.weather_name === value || opt.dataset.label === value
    );
    if (target) selectEl.value = target.value;
}
function nextRegionLoadGeneration() { regionLoadGeneration += 1; return regionLoadGeneration; }
function isStaleRegionLoad(generation) { return generation !== regionLoadGeneration; }
async function loadCountryRoot(preferredCountry = '', generation = regionLoadGeneration) {
    showSelect(selProvince, false); showSelect(selCity, false); showSelect(selDistrict, false);
    setSelectLoading(selCountry);
    try {
        const countries = await fetchRegionOptions();
        if (isStaleRegionLoad(generation)) return;
        await populateTranslatedRegionSelect(selCountry, countries, preferredCountry || userProfile?.CountryAdcode || userProfile?.Country || '\u4e2d\u56fd', generation, 'country-options');
        await updateProvince(userProfile?.ProvinceAdcode || userProfile?.Province, userProfile?.CityAdcode || userProfile?.City, userProfile?.DistrictAdcode || userProfile?.District, generation);
    } catch (e) { console.error('Failed to load countries:', e); setSelectFailure(selCountry); }
}
async function updateProvince(preferredProvince = '', preferredCity = '', preferredDistrict = '', generation = regionLoadGeneration) {
    const country = getSelectedRegionMeta(selCountry);
    showSelect(selProvince, false); showSelect(selCity, false); showSelect(selDistrict, false);
    if (!country) return;
    setSelectLoading(selProvince);
    try {
        const provinces = await fetchRegionOptions({ country: country.adcode || country.name || country.value });
        if (isStaleRegionLoad(generation)) return;
        if (!provinces.length) { setSelectFailure(selProvince); return; }
        await populateTranslatedRegionSelect(selProvince, provinces, preferredProvince, generation, 'province-options');
        await updateCity(preferredCity, preferredDistrict, generation);
    } catch (e) { console.error('Failed to load provinces:', e); setSelectFailure(selProvince); }
}
async function updateCity(preferredCity = '', preferredDistrict = '', generation = regionLoadGeneration) {
    const country = getSelectedRegionMeta(selCountry);
    const province = getSelectedRegionMeta(selProvince);
    showSelect(selCity, false); showSelect(selDistrict, false);
    if (!country || !province || province.terminal) return;
    const target = province.next_level === 'district' || province.is_direct_admin ? selDistrict : selCity;
    setSelectLoading(target);
    try {
        const children = await fetchRegionOptions({ country: country.name || country.value, province: province.adcode || province.value });
        if (isStaleRegionLoad(generation)) return;
        if (!children.length) { setSelectFailure(target); return; }
        await populateTranslatedRegionSelect(target, children, target === selDistrict ? (preferredDistrict || preferredCity) : preferredCity, generation, target === selDistrict ? 'direct-district-options' : 'city-options');
        if (target === selCity) await updateDistrict(preferredDistrict, generation);
    } catch (e) { console.error('Failed to load cities:', e); setSelectFailure(target); }
}
async function updateDistrict(preferredDistrict = '', generation = regionLoadGeneration) {
    const country = getSelectedRegionMeta(selCountry);
    const province = getSelectedRegionMeta(selProvince);
    const city = getSelectedRegionMeta(selCity);
    showSelect(selDistrict, false);
    if (!country || !province || !city || city.terminal === true || city.has_children === false) return;
    setSelectLoading(selDistrict);
    try {
        const districts = await fetchRegionOptions({ country: country.name || country.value, province: province.adcode || province.value, city: city.adcode || city.value });
        if (isStaleRegionLoad(generation)) return;
        if (!districts.length) { showSelect(selDistrict, false); return; }
        await populateTranslatedRegionSelect(selDistrict, districts, preferredDistrict, generation, 'district-options');
    } catch (e) { console.error('Failed to load districts:', e); setSelectFailure(selDistrict); }
}
if (selCountry) {
    selCountry.addEventListener('change', () => updateProvince('', '', '', nextRegionLoadGeneration()));
    selProvince.addEventListener('change', () => updateCity('', '', nextRegionLoadGeneration()));
}
if (selCity) selCity.addEventListener('change', () => updateDistrict('', nextRegionLoadGeneration()));
const changeLocBtn = document.getElementById('change-loc-btn');
if (changeLocBtn) {
    const newBtn = changeLocBtn.cloneNode(true);
    changeLocBtn.parentNode.replaceChild(newBtn, changeLocBtn);
    newBtn.addEventListener('click', async () => {
        const generation = nextRegionLoadGeneration();
        openModal(locModal);
        showSelect(selCountry, true); setSelectLoading(selCountry);
        showSelect(selProvince, false); showSelect(selCity, false); showSelect(selDistrict, false);
        await loadCountryRoot(userProfile?.CountryAdcode || userProfile?.Country || '\u4e2d\u56fd', generation);
    });
}
const confirmLocBtn = document.getElementById('confirm-loc-btn');
if (confirmLocBtn) {
    confirmLocBtn.addEventListener('click', async () => {
        const country = getSelectedRegionMeta(selCountry);
        const province = getSelectedRegionMeta(selProvince);
        const city = getSelectedRegionMeta(selCity);
        const district = getSelectedRegionMeta(selDistrict);
        if (!country || !province) { showToast(t('selectCompleteRegion'), true); return; }
        const selectedCountry = regionName(country);
        const selectedProvince = regionName(province);
        const selectedDistrict = district ? regionName(district) : '';
        const selectedCity = city ? regionName(city) : (selectedDistrict ? selectedProvince : regionName(province));
        const locationMeta = district || city || province || country;
        const locationAdcode = locationMeta?.adcode || locationMeta?.value || '';
        closeModal(locModal);
        currentWeatherState = { status: 'fetching' };
        await renderWeatherStateForCurrentLang();
        const payload = {
            country: selectedCountry,
            province: selectedProvince,
            city: selectedCity,
            district: selectedDistrict,
            country_adcode: country.adcode || country.value || '',
            province_adcode: province.adcode || province.value || '',
            city_adcode: city?.adcode || city?.value || '',
            district_adcode: district?.adcode || district?.value || '',
            location_adcode: locationAdcode,
            location_name: regionName(locationMeta),
            location_level: locationMeta?.level || '',
            location_center: locationMeta?.center || '',
            location_source: locationMeta?.source || 'amap',
            location_country_code: locationMeta?.country_code || 'CN',
        };
        const weatherTarget = normalizeWeatherApiTarget({
            country: selectedCountry,
            province: selectedProvince,
            city: selectedCity,
            district: selectedDistrict,
            queryCity: selectedDistrict || selectedCity,
            countryAdcode: payload.country_adcode,
            provinceAdcode: payload.province_adcode,
            cityAdcode: payload.city_adcode,
            districtAdcode: payload.district_adcode,
            locationAdcode: payload.location_adcode,
        });
        try {
            console.log('Saving location:', payload);
            const resp = await fetch(`${API_BASE}/api/users/me/location`, { method: 'PUT', headers: authHeaders(), body: JSON.stringify(payload) });
            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                console.error('Save location failed:', resp.status, err);
                showToast(t('locationSaveFailedDetail', { detail: err.detail || resp.status }), true);
                await fetchWeather(weatherTarget.queryCity, selectedCity, selectedDistrict, weatherTarget.adcode);
                return;
            }
            const data = await resp.json();
            console.log('Location saved:', data);
            showToast(t('locationSaved', { location: `${selectedCity}${selectedDistrict ? ' ' + selectedDistrict : ''}` }));
            if (userProfile) {
                userProfile.Country = selectedCountry; userProfile.Province = selectedProvince; userProfile.City = selectedCity; userProfile.District = selectedDistrict;
                userProfile.CountryAdcode = payload.country_adcode; userProfile.ProvinceAdcode = payload.province_adcode; userProfile.CityAdcode = payload.city_adcode;
                userProfile.DistrictAdcode = payload.district_adcode; userProfile.LocationAdcode = payload.location_adcode;
            }
        } catch (e) { console.error('Save location network error:', e); showToast(t('locationSaveNetworkFailed'), true); }
        await fetchWeather(weatherTarget.queryCity, selectedCity, selectedDistrict, weatherTarget.adcode);
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

    const mobileTicketBtn = document.getElementById('mobile-ticket-btn');
    if (mobileTicketBtn) mobileTicketBtn.addEventListener('click', () => openTicketModal());

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
