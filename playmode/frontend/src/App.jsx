import React, {useEffect, useMemo, useRef, useState} from 'react';
import axios from 'axios';
import {io} from 'socket.io-client';
import PeerLib from 'simple-peer/simplepeer.min.js';
import yoohLogo from './yooh-logo.svg';

const API = String(import.meta.env.VITE_API_BASE || '/playmode-api').replace(/\/+$/, '');
const WS = String(
  import.meta.env.VITE_WS_BASE || (typeof window !== 'undefined' ? window.location.origin : 'http://127.0.0.1:5173')
).replace(/\/+$/, '');
const PeerImpl = typeof PeerLib === 'function' ? PeerLib : PeerLib?.default;
const PLAYMODE_TOKEN_KEY = 'yooh_playmode_token';

const apiError = (e, fb) => e?.response?.data?.error || fb;
const initials = (v) => {
  const p = String(v || '').trim().split(/\s+/g);
  if (!p[0]) return '?';
  return (p[1] ? `${p[0][0]}${p[1][0]}` : p[0].slice(0, 2)).toUpperCase();
};
const label = (u) => u?.profile?.displayName || u?.username || 'Неизвестно';
const hhmm = (d) => (d ? new Date(d).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) : '');
const dateTime = (d) => (d ? new Date(d).toLocaleString() : '');
const callPalette = ['#8f7f6f', '#e0cc66', '#3f9a7d', '#5f89c7', '#9d6db5', '#d17f62'];
const MAX_PROFILE_IMAGE_DATA_URL = 1500000;
const DEFAULT_EMOJIS = [
  '😀', '😁', '😂', '🤣', '😊', '😍', '😘', '😎', '🤔', '😴',
  '😡', '🥶', '😱', '🤯', '🥳', '🤩', '👍', '👎', '👏', '🙏',
  '🔥', '✨', '⭐', '💯', '✅', '❌', '⚡', '🎮', '🏆', '🎯',
  '🚀', '💡', '📌', '📎', '💬', '🎧', '🎤', '📷', '🖥️', '📱',
  '❤️', '💙', '💚', '💛', '💜', '🧡', '🖤', '🤍', '🤎', '🙂',
  '🙃', '😇', '🤝', '👀', '👌', '🤌', '🫡', '🫶', '🧠', '🍀'
];
const sectionLabel = (name) => {
  const key = String(name || '').trim().toUpperCase();
  if (key === 'TEXT CHANNELS') return 'ТЕКСТОВЫЕ КАНАЛЫ';
  if (key === 'VOICE CHANNELS') return 'ГОЛОСОВЫЕ КАНАЛЫ';
  return name || 'КАНАЛЫ';
};

function normalizeSharedFontFamily(value) {
  const safe = String(value || '').trim().toLowerCase();
  if (safe === 'telegram') return 'yooh';
  return ['system', 'georgia', 'mono', 'yooh'].includes(safe) ? safe : 'system';
}

function resolveSharedFontFamilyCss(fontFamily) {
  const normalized = normalizeSharedFontFamily(fontFamily);
  if (normalized === 'georgia') return "Georgia, 'Times New Roman', serif";
  if (normalized === 'mono') return "'Cascadia Mono', 'SF Mono', Menlo, Consolas, monospace";
  if (normalized === 'yooh') return "'Helvetica Neue', 'SF Pro Text', Arial, sans-serif";
  return "'SF Pro Text', 'Segoe UI', 'Noto Sans', Tahoma, sans-serif";
}

function applySharedFontFamily() {
  if (typeof document === 'undefined') return;
  const family = normalizeSharedFontFamily(localStorage.getItem('yooh_font_family'));
  document.documentElement.style.setProperty('--ui-font-family', resolveSharedFontFamilyCss(family));
}

function hashColor(key) {
  const text = String(key || '');
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return callPalette[hash % callPalette.length];
}

function callTileColor(user, idx = 0) {
  if (user?.profile?.bannerColor) return user.profile.bannerColor;
  if (user?.profile?.avatarColor) return user.profile.avatarColor;
  return callPalette[idx % callPalette.length] || '#2f3136';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function normalizeMsg(item) {
  if (!item || typeof item !== 'object') return item;
  return {
    ...item,
    attachments: Array.isArray(item.attachments) ? item.attachments : [],
    reactions: item.reactions && typeof item.reactions === 'object' ? item.reactions : {},
    replyToId: typeof item.replyToId === 'string' ? item.replyToId : '',
    forwardedFrom: item.forwardedFrom && typeof item.forwardedFrom === 'object' ? item.forwardedFrom : null
  };
}

function humanSize(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num) || num <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = num;
  let idx = 0;
  while (n >= 1024 && idx < units.length - 1) {
    n /= 1024;
    idx += 1;
  }
  return `${n.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function extractFirstUrl(text) {
  const match = String(text || '').match(/https?:\/\/[^\s]+/i);
  return match ? match[0] : '';
}

function parseEmojiPackInput(raw) {
  const text = String(raw || '').trim();
  if (!text) return [];
  const hasSeparators = /[\s,;|]/.test(text);
  const parts = hasSeparators ? text.split(/[\s,;|]+/g) : Array.from(text);
  return Array.from(new Set(parts.map((item) => String(item || '').trim()).filter(Boolean))).slice(0, 120);
}

function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function getCropViewportSize(aspect = 1) {
  const safeAspect = Math.max(0.2, Number(aspect) || 1);
  const maxW = 520;
  const maxH = 320;
  let width = maxW;
  let height = width / safeAspect;
  if (height > maxH) {
    height = maxH;
    width = height * safeAspect;
  }
  return {width: Math.round(width), height: Math.round(height)};
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function navigateBackToChats() {
  if (typeof window === 'undefined') return;
  try {
    if (window.top && window.top !== window && window.top.location?.origin === window.location.origin) {
      window.top.location.assign('/');
      return;
    }
  } catch {
    // Cross-origin access can throw in embedded contexts.
  }
  window.location.assign('/');
}

function Icon({children, size = 16}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

const MicIcon = ({size}) => <Icon size={size}><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" /><path d="M19 11a7 7 0 0 1-14 0" /><path d="M12 18v4" /><path d="M8 22h8" /></Icon>;
const MicOffIcon = ({size}) => <Icon size={size}><path d="M3 3l18 18" /><path d="M9 9v2a3 3 0 0 0 5.12 2.12" /><path d="M15 5v3" /><path d="M5 11a7 7 0 0 0 11.49 5.2" /><path d="M12 18v4" /><path d="M8 22h8" /></Icon>;
const PhoneIcon = ({size}) => <Icon size={size}><path d="M22 16.9v3a2 2 0 0 1-2.18 2A19.8 19.8 0 0 1 3.1 4.18 2 2 0 0 1 5.1 2h3a2 2 0 0 1 2 1.72c.12.88.31 1.75.57 2.59a2 2 0 0 1-.45 2.11L9 9.64a16 16 0 0 0 5.36 5.36l1.22-1.22a2 2 0 0 1 2.11-.45c.84.26 1.71.45 2.59.57A2 2 0 0 1 22 16.9z" /></Icon>;
const HangupIcon = ({size}) => <Icon size={size}><path d="M2 16c4-4 16-4 20 0" /><path d="M8 16l-1.5 5" /><path d="M16 16l1.5 5" /></Icon>;
const UserGroupIcon = ({size}) => <Icon size={size}><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></Icon>;
const VolumeIcon = ({size}) => <Icon size={size}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><path d="M19 5a8 8 0 0 1 0 14" /><path d="M15.5 8.5a4 4 0 0 1 0 7" /></Icon>;
const VolumeOffIcon = ({size}) => <Icon size={size}><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" /><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></Icon>;
const CameraIcon = ({size}) => <Icon size={size}><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></Icon>;
const CameraOffIcon = ({size}) => <Icon size={size}><path d="M1 1l22 22" /><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></Icon>;
const ScreenShareIcon = ({size}) => <Icon size={size}><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8" /><path d="M12 17v4" /><path d="M9 8l3-3 3 3" /><path d="M12 5v8" /></Icon>;
const ScreenShareOffIcon = ({size}) => <Icon size={size}><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="3" y1="2" x2="21" y2="20" /><path d="M8 21h8" /><path d="M12 17v4" /></Icon>;
const HashIcon = ({size}) => <Icon size={size}><line x1="5" y1="9" x2="19" y2="9" /><line x1="5" y1="15" x2="19" y2="15" /><line x1="10" y1="4" x2="8" y2="20" /><line x1="16" y1="4" x2="14" y2="20" /></Icon>;
const AtIcon = ({size}) => <Icon size={size}><circle cx="12" cy="12" r="4" /><path d="M16 12v1a4 4 0 1 0 1-2.65" /></Icon>;
const MessageIcon = ({size}) => <Icon size={size}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Icon>;
const MoreIcon = ({size}) => <Icon size={size}><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></Icon>;
const SettingsIcon = ({size}) => <Icon size={size}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.65 1.65 0 0 0 15 19.4a1.65 1.65 0 0 0-1 .6 1.65 1.65 0 0 0-.33 1V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-.33-1 1.65 1.65 0 0 0-1-.6 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-.6-1 1.65 1.65 0 0 0-1-.33H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1-.33 1.65 1.65 0 0 0 .6-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-.6 1.65 1.65 0 0 0 .33-1V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 .33 1 1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c0 .39.14.76.4 1 .24.27.61.42 1 .42H21a2 2 0 1 1 0 4h-.09c-.39 0-.76.15-1 .42-.26.24-.41.61-.41 1.01z" /></Icon>;
const LogoutIcon = ({size}) => <Icon size={size}><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></Icon>;
const SendIcon = ({size}) => <Icon size={size}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></Icon>;
const ChevronDownIcon = ({size}) => <Icon size={size}><polyline points="6 9 12 15 18 9" /></Icon>;
const PlusIcon = ({size}) => <Icon size={size}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></Icon>;
const GiftIcon = ({size}) => <Icon size={size}><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M12 8v13" /><path d="M3 12h18" /><path d="M12 8s-3-1.5-3-3.5S10.3 2 12 5c1.7-3 3-2.5 3 0s-3 3-3 3z" /></Icon>;
const BellIcon = ({size}) => <Icon size={size}><path d="M18 8a6 6 0 0 0-12 0c0 7-3 8-3 8h18s-3-1-3-8" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></Icon>;
const ShieldIcon = ({size}) => <Icon size={size}><path d="M12 3l7 3v6c0 5-3.5 8-7 9-3.5-1-7-4-7-9V6l7-3z" /></Icon>;
const BanIcon = ({size}) => <Icon size={size}><circle cx="12" cy="12" r="9" /><line x1="7.5" y1="16.5" x2="16.5" y2="7.5" /></Icon>;
const PlugIcon = ({size}) => <Icon size={size}><path d="M9 2v6" /><path d="M15 2v6" /><path d="M12 10v6" /><path d="M7 8h10a3 3 0 0 1 0 6H7a3 3 0 0 1 0-6z" /><path d="M12 16v6" /></Icon>;
const UserIcon = ({size}) => <Icon size={size}><path d="M20 21a8 8 0 0 0-16 0" /><circle cx="12" cy="8" r="4" /></Icon>;
const KeyIcon = ({size}) => <Icon size={size}><circle cx="8" cy="12" r="3" /><path d="M11 12h10" /><path d="M17 12v3" /><path d="M20 12v2" /></Icon>;
const MailIcon = ({size}) => <Icon size={size}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M3 7l9 6 9-6" /></Icon>;
const PaperclipIcon = ({size}) => <Icon size={size}><path d="M21.44 11.05 12 20.5a5 5 0 0 1-7.07-7.07l10-10a3.5 3.5 0 0 1 4.95 4.95l-9.9 9.9a2 2 0 1 1-2.83-2.83l8.49-8.48" /></Icon>;
const ReplyIcon = ({size}) => <Icon size={size}><polyline points="9 17 4 12 9 7" /><path d="M20 18v-2a4 4 0 0 0-4-4H4" /></Icon>;
const ForwardIcon = ({size}) => <Icon size={size}><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></Icon>;
const SmileIcon = ({size}) => <Icon size={size}><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></Icon>;
const DownloadIcon = ({size}) => <Icon size={size}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></Icon>;
const EyeIcon = ({size}) => <Icon size={size}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" /><circle cx="12" cy="12" r="3" /></Icon>;

function Avatar({user, onClick, size = 34}) {
  const bg = user?.profile?.avatarColor || hashColor(user?.id || user?.username || 'x');
  const avatarUrl = String(user?.profile?.avatarUrl || '').trim();
  const avatarInner = avatarUrl
    ? <img src={avatarUrl} alt={label(user)} className="avatar-img" />
    : initials(label(user));
  if (typeof onClick === 'function') {
    return (
      <button
        type="button"
        className="avatar-btn"
        onClick={onClick}
        style={{width: size, height: size, background: bg}}
        title={label(user)}
      >
        {avatarInner}
      </button>
    );
  }
  return (
    <div className="avatar-btn static" style={{width: size, height: size, background: bg}} title={label(user)}>
      {avatarInner}
    </div>
  );
}

function ServerInvites({serverId, req, revokeInvite}) {
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    try {
      setLoading(true);
      const {data} = await req('get', `/servers/${serverId}/invites`);
      setInvites(data.invites || []);
    } catch {
      setInvites([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [serverId]);

  if (loading) return <p className="muted">Загрузка приглашений...</p>;
  if (!invites.length) return <p className="muted">Активных приглашений нет.</p>;

  return (
    <div className="invite-list">
      {invites.map((invite) => (
        <div key={invite.id} className="invite-row">
          <code>{invite.code}</code>
          <span className="muted">использований: {invite.uses}{invite.maxUses > 0 ? `/${invite.maxUses}` : ''}</span>
          <button
            type="button"
            className="ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(invite.code);
              } catch {}
            }}
          >
            Копировать
          </button>
          <button
            type="button"
            className="danger"
            onClick={async () => {
              await revokeInvite(invite.id);
              await load();
            }}
          >
            Отозвать
          </button>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [token, setToken] = useState(() => localStorage.getItem(PLAYMODE_TOKEN_KEY) || '');
  const [authMode, setAuthMode] = useState('login');
  const [auth, setAuth] = useState({name: '', username: '', email: '', password: '', confirmPassword: ''});
  const [authErr, setAuthErr] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [uiErr, setUiErr] = useState('');
  const [booting, setBooting] = useState(false);

  const [me, setMe] = useState(null);
  const [servers, setServers] = useState([]);
  const [dms, setDms] = useState([]);
  const [friends, setFriends] = useState({friends: [], incoming: [], outgoing: []});
  const [users, setUsers] = useState([]);

  const [mode, setMode] = useState('servers');
  const [homeTab, setHomeTab] = useState('dms');
  const [friendsView, setFriendsView] = useState('online');
  const [friendsSearch, setFriendsSearch] = useState('');
  const [friendLookup, setFriendLookup] = useState('');
  const [sid, setSid] = useState(null);
  const [cid, setCid] = useState(null);
  const [voiceCid, setVoiceCid] = useState(null);
  const [did, setDid] = useState(null);

  const [msgs, setMsgs] = useState([]);
  const [msgInput, setMsgInput] = useState('');
  const [msgLoading, setMsgLoading] = useState(false);
  const [composerFiles, setComposerFiles] = useState([]);
  const [replyTo, setReplyTo] = useState(null);
  const [recordingVoice, setRecordingVoice] = useState(false);
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);
  const [emojiPickerTab, setEmojiPickerTab] = useState('default');
  const [watchStreams, setWatchStreams] = useState(false);
  const [imagePreview, setImagePreview] = useState(null);

  const [profileOpen, setProfileOpen] = useState(false);
  const [profileForm, setProfileForm] = useState({
    displayName: '',
    bio: '',
    location: '',
    statusText: '',
    avatarColor: '#5865f2',
    bannerColor: '#1e1f22',
    avatarUrl: '',
    bannerUrl: ''
  });
  const [channelOpen, setChannelOpen] = useState(false);
  const [channelForm, setChannelForm] = useState({
    name: '',
    topic: '',
    color: '#949ba4',
    section: '',
    kind: 'text',
    isPrivate: false,
    allowedRoleIds: []
  });
  const [serverSettingsOpen, setServerSettingsOpen] = useState(false);
  const [serverSettingsTab, setServerSettingsTab] = useState('profile');
  const [serverMenuOpen, setServerMenuOpen] = useState(false);
  const [serverPrefsForm, setServerPrefsForm] = useState({
    muted: false,
    mentionsOnly: false,
    desktopEnabled: true,
    soundEnabled: true
  });
  const [serverAuditRows, setServerAuditRows] = useState([]);
  const [serverBans, setServerBans] = useState([]);
  const [serverIntegrations, setServerIntegrations] = useState([]);
  const [serverEmojiPacks, setServerEmojiPacks] = useState([]);
  const [serverProfileForm, setServerProfileForm] = useState({
    name: '',
    tag: '',
    description: '',
    iconUrl: '',
    bannerUrl: '',
    bannerColor: '#1f2937'
  });
  const [formModal, setFormModal] = useState(null);
  const [formModalValues, setFormModalValues] = useState({});
  const [imageCropModal, setImageCropModal] = useState(null);
  const [imageCropZoom, setImageCropZoom] = useState(1);
  const [imageCropOffset, setImageCropOffset] = useState({x: 0, y: 0});
  const [imageCropImageSize, setImageCropImageSize] = useState({width: 0, height: 0});
  const [joinCode, setJoinCode] = useState('');
  const [mini, setMini] = useState(null);

  const [sockOn, setSockOn] = useState(false);
  const [micMute, setMicMute] = useState(false);
  const [speakerMute, setSpeakerMute] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [screenOn, setScreenOn] = useState(false);
  const [call, setCall] = useState(null);
  const [peersView, setPeersView] = useState([]);
  const [peerMedia, setPeerMedia] = useState({});
  const [remoteStreams, setRemoteStreams] = useState({});
  const [focusedTile, setFocusedTile] = useState('');
  const [talkingTiles, setTalkingTiles] = useState([]);
  const [toasts, setToasts] = useState([]);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [voiceState, setVoiceState] = useState({});
  const [incomingDmCall, setIncomingDmCall] = useState(null);
  const [outgoingDmCall, setOutgoingDmCall] = useState(null);
  const [backendOffline, setBackendOffline] = useState(false);

  const sockRef = useRef(null);
  const joinedRef = useRef(null);
  const scopeRef = useRef(null);
  const seqRef = useRef(0);
  const callRef = useRef(null);
  const mediaRef = useRef(null);
  const speakerMuteRef = useRef(false);
  const cameraTrackRef = useRef(null);
  const screenTrackRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const screenStreamRef = useRef(null);
  const talkingWatchRef = useRef(new Map());
  const recorderRef = useRef(null);
  const recordChunksRef = useRef([]);
  const peersRef = useRef(new Map());
  const audioRef = useRef(new Map());
  const videoRef = useRef(new Map());
  const messageListRef = useRef(null);
  const emojiPickerRef = useRef(null);
  const stickToBottomRef = useRef(false);
  const pendingAutoScrollRef = useRef(false);
  const scopeKeyRef = useRef('');
  const formModalResolverRef = useRef(null);
  const imageCropResolverRef = useRef(null);
  const imageCropImageRef = useRef(null);
  const imageCropDragRef = useRef(null);

  useEffect(() => {
    applySharedFontFamily();
    const handleStorage = (event) => {
      if (!event || event.key === 'yooh_font_family') {
        applySharedFontFamily();
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  const server = useMemo(() => servers.find((x) => x.id === sid) || null, [servers, sid]);
  const channel = useMemo(
    () => server?.channels?.find((x) => x.id === cid && (x.kind || 'text') === 'text') || null,
    [server, cid]
  );
  const activeVoiceChannel = useMemo(
    () => server?.channels?.find((x) => x.id === voiceCid && (x.kind || 'text') === 'voice') || null,
    [server, voiceCid]
  );
  const dm = useMemo(() => dms.find((x) => x.id === did) || null, [dms, did]);
  const roles = useMemo(() => server?.roles || [], [server]);
  const can = useMemo(
    () => server?.permissions || {manageServer: false, manageChannels: false, manageMembers: false, manageRoles: false, manageInvites: false},
    [server]
  );
  const canManageCurrentChannel = useMemo(() => {
    if (!channel || !me) return false;
    if (can.manageChannels) return true;
    if (server?.ownerId === me.id) return true;
    return channel.createdByUserId === me.id;
  }, [can.manageChannels, channel, me, server?.ownerId]);
  const serverHeadBannerStyle = useMemo(() => {
    const bannerUrl = String(server?.bannerUrl || '').trim();
    const bannerColor = String(server?.bannerColor || '#1f2937');
    if (bannerUrl) {
      return {
        backgroundImage: `linear-gradient(180deg, rgba(5, 7, 10, 0.08) 0%, rgba(5, 7, 10, 0.72) 100%), url(${bannerUrl})`
      };
    }
    return {
      backgroundImage: `linear-gradient(140deg, ${bannerColor} 0%, #101218 100%)`
    };
  }, [server?.bannerUrl, server?.bannerColor]);
  const memberRoleMap = useMemo(() => {
    const map = new Map();
    for (const item of server?.memberRoles || []) {
      map.set(item.userId, item.roleIds || []);
    }
    return map;
  }, [server]);
  const onlineSet = useMemo(() => new Set(onlineUserIds), [onlineUserIds]);
  const isFriendsPage = mode === 'home' && homeTab === 'friends';
  const scope = useMemo(() => {
    if (mode === 'home' && homeTab === 'dms' && dm) return {type: 'dm', id: dm.id, title: label(dm.otherUser), subtitle: dm.otherUser?.profile?.statusText || 'Личные сообщения'};
    if (mode === 'servers' && channel) return {type: 'channel', id: channel.id, title: channel.name, subtitle: channel.topic || 'Текстовый канал'};
    return null;
  }, [mode, homeTab, dm, channel]);

  const scopeInCall = !!(call && scope && call.scopeType === scope.type && call.scopeId === scope.id);
  const voiceInCall = !!(call && call.scopeType === 'channel' && call.scopeId === voiceCid);
  const inCurrentCall = scopeInCall || voiceInCall;
  const isDmScope = scope?.type === 'dm';
  const outgoingForCurrentDm = !!(
    outgoingDmCall
    && isDmScope
    && outgoingDmCall.dmChannelId === scope?.id
  );
  const incomingForCurrentDm = !!(
    incomingDmCall
    && isDmScope
    && incomingDmCall.dmChannelId === scope?.id
  );
  const known = useMemo(() => {
    const m = new Map();
    if (me) m.set(me.id, me);
    for (const u of users) m.set(u.id, u);
    for (const f of friends.friends || []) m.set(f.id, f);
    for (const i of friends.incoming || []) m.set(i.fromUser.id, i.fromUser);
    for (const o of friends.outgoing || []) m.set(o.toUser.id, o.toUser);
    for (const d of dms) if (d.otherUser) m.set(d.otherUser.id, d.otherUser);
    return m;
  }, [me, users, friends, dms]);
  const members = useMemo(() => {
    if (mode === 'home' && dm?.otherUser && me) return [me, dm.otherUser];
    if (mode === 'servers' && server && channel) {
      const allowedRoles = Array.isArray(channel.allowedRoleIds) ? channel.allowedRoleIds : [];
      const visibleIds = channel.isPrivate
        ? server.memberIds.filter((id) => {
          if (id === server.ownerId) return true;
          const roleIds = memberRoleMap.get(id) || [];
          return roleIds.some((roleId) => allowedRoles.includes(roleId));
        })
        : server.memberIds;
      return visibleIds.map((id) => known.get(id) || {id, username: `user-${id.slice(0, 5)}`});
    }
    return [];
  }, [mode, dm, me, server, channel, known, memberRoleMap]);
  const callTiles = useMemo(() => {
    if (!call || !me) return [];
    const tiles = [];
    const selfMedia = {
      micMuted: micMute,
      speakerMuted: speakerMute,
      cameraOn: !!cameraOn,
      screenOn: !!screenOn
    };
    if (cameraOn && cameraStreamRef.current) {
      tiles.push({
        key: `self:${me.id}:camera`,
        talkKey: `self:${me.id}`,
        socketId: 'self',
        user: me,
        self: true,
        media: selfMedia,
        feedKind: 'camera',
        hasVideo: true,
        stream: cameraStreamRef.current
      });
    }
    if (screenOn && screenStreamRef.current) {
      tiles.push({
        key: `self:${me.id}:screen`,
        talkKey: `self:${me.id}`,
        socketId: 'self',
        user: me,
        self: true,
        media: selfMedia,
        feedKind: 'screen',
        hasVideo: true,
        stream: screenStreamRef.current
      });
    }
    if (!tiles.length) {
      tiles.push({
        key: `self:${me.id}`,
        talkKey: `self:${me.id}`,
        socketId: 'self',
        user: me,
        self: true,
        media: selfMedia,
        feedKind: 'audio',
        hasVideo: false,
        stream: null
      });
    }

    for (let idx = 0; idx < peersView.length; idx += 1) {
      const item = peersView[idx];
      const peerSocketId = item.socketId || `peer:${idx}`;
      const user = (item.user?.id ? (known.get(item.user.id) || item.user) : item.user) || {id: `peer-${idx}`, username: 'Неизвестный'};
      const media = peerMedia[item.socketId] || {micMuted: false, speakerMuted: false, cameraOn: false, screenOn: false};
      const streams = Array.isArray(remoteStreams[item.socketId]) ? remoteStreams[item.socketId] : [];
      const hasMediaVideoFlag = !!(media.cameraOn || media.screenOn);
      const videoStreams = hasMediaVideoFlag
        ? streams.filter((stream) => stream?.getVideoTracks?.().some((t) => t.readyState === 'live' && !t.muted))
        : [];
      if (!videoStreams.length) {
        tiles.push({
          key: `${peerSocketId}:audio`,
          talkKey: peerSocketId,
          socketId: peerSocketId,
          user,
          self: false,
          media,
          feedKind: 'audio',
          hasVideo: false,
          stream: null
        });
        continue;
      }
      const expectedVideoFeeds = Number(!!media.cameraOn) + Number(!!media.screenOn);
      const limitedStreams = expectedVideoFeeds > 0 ? videoStreams.slice(0, expectedVideoFeeds) : videoStreams;
      let usedScreen = false;
      for (let streamIdx = 0; streamIdx < limitedStreams.length; streamIdx += 1) {
        const stream = limitedStreams[streamIdx];
        const track = stream.getVideoTracks?.()[0];
        const settings = track?.getSettings?.() || {};
        const ratio = (settings.width && settings.height) ? (settings.width / settings.height) : 1;
        let feedKind = 'camera';
        if (media.screenOn && !media.cameraOn) {
          feedKind = 'screen';
        } else if (media.screenOn && media.cameraOn) {
          if (!usedScreen && (ratio >= 1.3 || streamIdx === 0)) {
            feedKind = 'screen';
            usedScreen = true;
          } else {
            feedKind = 'camera';
          }
        }
        tiles.push({
          key: `${peerSocketId}:stream:${stream.id || streamIdx}`,
          talkKey: peerSocketId,
          socketId: peerSocketId,
          user,
          self: false,
          media,
          feedKind,
          hasVideo: true,
          stream
        });
      }
    }
    return tiles;
  }, [call, me, peersView, micMute, speakerMute, cameraOn, screenOn, peerMedia, remoteStreams, known]);
  const talkingSet = useMemo(() => new Set(talkingTiles), [talkingTiles]);
  const talkingUserIds = useMemo(() => {
    const set = new Set();
    for (const tile of callTiles) {
      if (talkingSet.has(tile.talkKey) && tile.user?.id) set.add(tile.user.id);
    }
    return set;
  }, [callTiles, talkingSet]);
  const screenTiles = useMemo(
    () => callTiles.filter((tile) => tile.feedKind === 'screen' && tile.hasVideo),
    [callTiles]
  );
  const focusedCallTile = useMemo(() => {
    if (!watchStreams) return null;
    if (!callTiles.length) return null;
    const picked = callTiles.find((tile) => tile.key === focusedTile);
    if (picked) return picked;
    return screenTiles[0] || null;
  }, [callTiles, focusedTile, screenTiles, watchStreams]);
  const compactCallTiles = useMemo(
    () => (focusedCallTile ? callTiles.filter((tile) => tile.key !== focusedCallTile.key) : callTiles),
    [callTiles, focusedCallTile]
  );
  const videoCallTiles = useMemo(
    () => compactCallTiles.filter((tile) => tile.hasVideo),
    [compactCallTiles]
  );
  const audioOnlyCallTiles = useMemo(
    () => compactCallTiles.filter((tile) => !tile.hasVideo),
    [compactCallTiles]
  );
  const focusedCompactTiles = useMemo(
    () => (focusedCallTile ? compactCallTiles : []),
    [compactCallTiles, focusedCallTile]
  );
  const textChannels = useMemo(
    () => (server?.channels || []).filter((x) => (x.kind || 'text') === 'text'),
    [server]
  );
  const voiceChannels = useMemo(
    () => (server?.channels || []).filter((x) => (x.kind || 'text') === 'voice'),
    [server]
  );
  const textSections = useMemo(() => {
    const map = new Map();
    for (const item of textChannels) {
      const key = item.section || 'TEXT CHANNELS';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return Array.from(map.entries());
  }, [textChannels]);
  const voiceSections = useMemo(() => {
    const map = new Map();
    for (const item of voiceChannels) {
      const key = item.section || 'VOICE CHANNELS';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(item);
    }
    return Array.from(map.entries());
  }, [voiceChannels]);
  const voiceMembersByChannel = useMemo(() => {
    const map = new Map();
    for (const [channelId, list] of Object.entries(voiceState || {})) {
      const next = (Array.isArray(list) ? list : [])
        .map((entry) => known.get(entry.userId) || {id: entry.userId, username: entry.username})
        .filter(Boolean);
      map.set(channelId, next);
    }
    return map;
  }, [voiceState, known]);
  const profilePreviewUser = useMemo(() => ({
    id: me?.id || 'preview',
    username: me?.username || 'me',
    profile: {
      displayName: profileForm.displayName || me?.username || 'Пользователь',
      bio: profileForm.bio || '',
      location: profileForm.location || '',
      statusText: profileForm.statusText || '',
      avatarColor: profileForm.avatarColor || '#5865f2',
      bannerColor: profileForm.bannerColor || '#1e1f22',
      avatarUrl: profileForm.avatarUrl || '',
      bannerUrl: profileForm.bannerUrl || ''
    }
  }), [me, profileForm]);
  const permissionLabels = {
    manageServer: 'Сервер',
    manageChannels: 'Каналы',
    manageMembers: 'Участники',
    manageRoles: 'Роли',
    manageInvites: 'Приглашения'
  };
  const friendsList = useMemo(() => friends.friends || [], [friends.friends]);
  const onlineFriends = useMemo(
    () => friendsList.filter((item) => onlineSet.has(item.id)),
    [friendsList, onlineSet]
  );
  const pendingRows = useMemo(
    () => [
      ...(friends.incoming || []).map((item) => ({kind: 'incoming', reqId: item.id, user: item.fromUser})),
      ...(friends.outgoing || []).map((item) => ({kind: 'outgoing', reqId: item.id, user: item.toUser}))
    ],
    [friends]
  );
  const activeContacts = useMemo(() => onlineFriends.slice(0, 8), [onlineFriends]);
  const friendsQuery = friendsSearch.trim().toLowerCase();
  const visibleFriendRows = useMemo(() => {
    const source = friendsView === 'online' ? onlineFriends : friendsList;
    if (!friendsQuery) return source;
    return source.filter((item) => {
      const name = label(item).toLowerCase();
      const user = String(item.username || '').toLowerCase();
      return name.includes(friendsQuery) || user.includes(friendsQuery);
    });
  }, [friendsView, onlineFriends, friendsList, friendsQuery]);
  const msgMap = useMemo(() => {
    const map = new Map();
    for (const item of msgs || []) {
      if (item?.id) map.set(item.id, item);
    }
    return map;
  }, [msgs]);
  const currentServerEmojiPacks = useMemo(
    () => (server?.emojiPacks || []).filter((pack) => Array.isArray(pack.emojis) && pack.emojis.length),
    [server]
  );
  const dmEmojiPacks = useMemo(() => {
    const list = [];
    for (const item of servers || []) {
      for (const pack of item.emojiPacks || []) {
        if (!Array.isArray(pack.emojis) || !pack.emojis.length) continue;
        list.push({
          ...pack,
          id: `${item.id}:${pack.id}`,
          sourceServerId: item.id,
          sourceServerName: item.name || 'Сервер'
        });
      }
    }
    return list;
  }, [servers]);
  const availableEmojiPacks = useMemo(() => {
    const base = [{id: 'default', name: 'Стандартные', emojis: DEFAULT_EMOJIS}];
    if (scope?.type === 'channel') {
      return [...base, ...currentServerEmojiPacks];
    }
    if (scope?.type === 'dm') {
      return [...base, ...dmEmojiPacks];
    }
    return base;
  }, [scope?.type, currentServerEmojiPacks, dmEmojiPacks]);
  const activeEmojiPack = useMemo(() => {
    const picked = availableEmojiPacks.find((pack) => pack.id === emojiPickerTab);
    return picked || availableEmojiPacks[0] || {id: 'default', name: 'Стандартные', emojis: DEFAULT_EMOJIS};
  }, [availableEmojiPacks, emojiPickerTab]);

  const onMessageListScroll = () => {
    const el = messageListRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 80;
  };

  const persistToken = (t) => {
    if (t) {
      localStorage.setItem(PLAYMODE_TOKEN_KEY, t);
      setToken(t);
    } else {
      localStorage.removeItem(PLAYMODE_TOKEN_KEY);
      setToken('');
    }
  };
  const req = (method, url, data) => axios({method, url: `${API}${url}`, data, headers: token ? {Authorization: `Bearer ${token}`} : {}});
  const pushToast = (text, type = 'info', ttl = 3200) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setToasts((prev) => [...prev, {id, text, type}].slice(-5));
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((item) => item.id !== id));
    }, ttl);
  };
  const closeFormModal = (result = null) => {
    setFormModal(null);
    setFormModalValues({});
    const resolve = formModalResolverRef.current;
    formModalResolverRef.current = null;
    if (typeof resolve === 'function') resolve(result);
  };
  const openFormModal = ({title, fields = [], submitText = 'Сохранить', cancelText = 'Отмена'}) => new Promise((resolve) => {
    if (typeof formModalResolverRef.current === 'function') {
      formModalResolverRef.current(null);
    }
    const nextValues = {};
    for (const field of fields) {
      let value = field?.value ?? field?.defaultValue ?? '';
      if (field?.type === 'select' && (value === '' || value == null) && Array.isArray(field?.options) && field.options.length) {
        value = String(field.options[0].value ?? '');
      }
      nextValues[field.id] = String(value ?? '');
    }
    formModalResolverRef.current = resolve;
    setFormModalValues(nextValues);
    setFormModal({title, fields, submitText, cancelText});
  });
  const imageCropViewport = useMemo(
    () => getCropViewportSize(imageCropModal?.aspect || 1),
    [imageCropModal?.aspect]
  );
  const imageCropBaseScale = useMemo(() => {
    if (!imageCropImageSize.width || !imageCropImageSize.height) return 1;
    return Math.max(
      imageCropViewport.width / imageCropImageSize.width,
      imageCropViewport.height / imageCropImageSize.height
    );
  }, [imageCropImageSize.height, imageCropImageSize.width, imageCropViewport.height, imageCropViewport.width]);
  const imageCropRenderScale = imageCropBaseScale * imageCropZoom;
  const clampImageCropOffset = (offset, zoom = imageCropZoom) => {
    if (!imageCropImageSize.width || !imageCropImageSize.height) return {x: 0, y: 0};
    const scale = imageCropBaseScale * zoom;
    const maxX = Math.max(0, (imageCropImageSize.width * scale - imageCropViewport.width) / 2);
    const maxY = Math.max(0, (imageCropImageSize.height * scale - imageCropViewport.height) / 2);
    return {
      x: clampNumber(offset?.x ?? 0, -maxX, maxX),
      y: clampNumber(offset?.y ?? 0, -maxY, maxY)
    };
  };
  const closeImageCropModal = (result = null) => {
    setImageCropModal(null);
    setImageCropZoom(1);
    setImageCropOffset({x: 0, y: 0});
    setImageCropImageSize({width: 0, height: 0});
    imageCropImageRef.current = null;
    imageCropDragRef.current = null;
    const resolve = imageCropResolverRef.current;
    imageCropResolverRef.current = null;
    if (typeof resolve === 'function') resolve(result);
  };
  const openImageCropModal = ({title, sourceUrl, aspect = 1, shape = 'rect', outputWidth = 512, outputHeight = 512}) => new Promise((resolve) => {
    if (!sourceUrl) return resolve(null);
    if (typeof imageCropResolverRef.current === 'function') {
      imageCropResolverRef.current(null);
    }
    imageCropResolverRef.current = resolve;
    setImageCropZoom(1);
    setImageCropOffset({x: 0, y: 0});
    setImageCropImageSize({width: 0, height: 0});
    setImageCropModal({title, sourceUrl, aspect, shape, outputWidth, outputHeight});
    loadImageElement(sourceUrl)
      .then((img) => {
        imageCropImageRef.current = img;
        setImageCropImageSize({
          width: Number(img.naturalWidth || img.width || 0),
          height: Number(img.naturalHeight || img.height || 0)
        });
      })
      .catch(() => {
        closeImageCropModal(null);
        setUiErr('Не удалось открыть изображение для обрезки.');
      });
  });
  const applyImageCrop = () => {
    if (!imageCropModal) return;
    const img = imageCropImageRef.current;
    if (!img || !imageCropImageSize.width || !imageCropImageSize.height) {
      closeImageCropModal(null);
      return;
    }
    const clamped = clampImageCropOffset(imageCropOffset, imageCropZoom);
    const scale = imageCropBaseScale * imageCropZoom;
    const srcW = imageCropViewport.width / scale;
    const srcH = imageCropViewport.height / scale;
    let srcX = imageCropImageSize.width / 2 - (imageCropViewport.width / 2 + clamped.x) / scale;
    let srcY = imageCropImageSize.height / 2 - (imageCropViewport.height / 2 + clamped.y) / scale;
    srcX = clampNumber(srcX, 0, Math.max(0, imageCropImageSize.width - srcW));
    srcY = clampNumber(srcY, 0, Math.max(0, imageCropImageSize.height - srcH));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Number(imageCropModal.outputWidth || 512));
    canvas.height = Math.max(1, Number(imageCropModal.outputHeight || 512));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      closeImageCropModal(null);
      return;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(
      img,
      srcX,
      srcY,
      srcW,
      srcH,
      0,
      0,
      canvas.width,
      canvas.height
    );
    const mime = imageCropModal.shape === 'circle' ? 'image/png' : 'image/jpeg';
    const dataUrl = mime === 'image/jpeg'
      ? canvas.toDataURL(mime, 0.92)
      : canvas.toDataURL(mime);
    closeImageCropModal(dataUrl);
  };
  const onImageCropPointerDown = (e) => {
    if (!imageCropModal) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    imageCropDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origin: {...imageCropOffset}
    };
  };
  const onImageCropPointerMove = (e) => {
    const drag = imageCropDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    setImageCropOffset(clampImageCropOffset({x: drag.origin.x + dx, y: drag.origin.y + dy}));
  };
  const onImageCropPointerUp = (e) => {
    const drag = imageCropDragRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    imageCropDragRef.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };

  const syncPeers = () => setPeersView(Array.from(peersRef.current.values()).map((x) => ({socketId: x.socketId, user: x.user})));
  const setTalking = (tileKey, active) => {
    if (!tileKey) return;
    setTalkingTiles((prev) => {
      const has = prev.includes(tileKey);
      if (active && !has) return [...prev, tileKey];
      if (!active && has) return prev.filter((x) => x !== tileKey);
      return prev;
    });
  };
  const stopTalkingWatch = (tileKey) => {
    const watch = talkingWatchRef.current.get(tileKey);
    if (!watch) return;
    try {
      watch.cancelled = true;
      if (watch.raf) cancelAnimationFrame(watch.raf);
      watch.source?.disconnect?.();
      watch.analyser?.disconnect?.();
      watch.ctx?.close?.();
    } catch {}
    talkingWatchRef.current.delete(tileKey);
    setTalking(tileKey, false);
  };
  const startTalkingWatch = (tileKey, stream) => {
    stopTalkingWatch(tileKey);
    if (!stream?.getAudioTracks?.().length) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    let ctx;
    try {
      ctx = new AudioCtx();
    } catch {
      return;
    }
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.85;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const state = {ctx, analyser, source, raf: 0, cancelled: false};
    talkingWatchRef.current.set(tileKey, state);
    const tick = () => {
      if (state.cancelled) return;
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const n = (data[i] - 128) / 128;
        sum += n * n;
      }
      const rms = Math.sqrt(sum / data.length);
      setTalking(tileKey, rms > 0.03);
      state.raf = requestAnimationFrame(tick);
    };
    tick();
  };
  const detachAudio = (id) => {
    const el = audioRef.current.get(id);
    if (!el) return;
    try {
      el.pause();
      el.srcObject = null;
    } catch {}
    el.remove();
    audioRef.current.delete(id);
  };
  const detachRemoteStream = (id) => {
    stopTalkingWatch(id);
    setRemoteStreams((prev) => {
      if (!prev[id]) return prev;
      const next = {...prev};
      delete next[id];
      return next;
    });
  };
  const syncAudioMuted = (muted) => {
    for (const el of audioRef.current.values()) {
      try {
        el.muted = !!muted;
      } catch {}
    }
  };
  const ensurePeerVideoSet = (entry) => {
    if (!entry) return new Set();
    if (!(entry.videoTrackIds instanceof Set)) entry.videoTrackIds = new Set();
    return entry.videoTrackIds;
  };
  const addVideoTrackToPeerEntry = (entry, track, stream) => {
    if (!entry?.peer || !track || !stream) return;
    const sent = ensurePeerVideoSet(entry);
    if (sent.has(track.id)) return;
    try {
      if (typeof entry.peer.addTrack === 'function') {
        entry.peer.addTrack(track, stream);
        sent.add(track.id);
      }
    } catch {}
  };
  const removeVideoTrackFromPeerEntry = (entry, track, stream) => {
    if (!entry?.peer || !track || !stream) return;
    const sent = ensurePeerVideoSet(entry);
    if (!sent.has(track.id)) return;
    try {
      if (typeof entry.peer.removeTrack === 'function') {
        entry.peer.removeTrack(track, stream);
      }
    } catch {}
    sent.delete(track.id);
  };
  const syncVideoTracksForPeerEntry = (entry) => {
    if (!entry?.peer) return;
    const cameraTrack = cameraTrackRef.current;
    const cameraStream = cameraStreamRef.current;
    const screenTrack = screenTrackRef.current;
    const screenStream = screenStreamRef.current;
    if (cameraTrack && cameraStream) addVideoTrackToPeerEntry(entry, cameraTrack, cameraStream);
    if (screenTrack && screenStream) addVideoTrackToPeerEntry(entry, screenTrack, screenStream);
  };
  const syncVideoTracksForAllPeers = () => {
    for (const entry of peersRef.current.values()) {
      syncVideoTracksForPeerEntry(entry);
    }
  };
  const stopCameraTrack = () => {
    const track = cameraTrackRef.current;
    const stream = cameraStreamRef.current;
    if (track && stream) {
      for (const entry of peersRef.current.values()) {
        removeVideoTrackFromPeerEntry(entry, track, stream);
      }
    }
    if (track) {
      try {
        track.onended = null;
        track.stop();
      } catch {}
    }
    if (stream) {
      for (const tr of stream.getTracks()) {
        try {
          tr.stop();
        } catch {}
      }
    }
    cameraTrackRef.current = null;
    cameraStreamRef.current = null;
  };
  const stopScreenTrack = () => {
    const track = screenTrackRef.current;
    const stream = screenStreamRef.current;
    if (track && stream) {
      for (const entry of peersRef.current.values()) {
        removeVideoTrackFromPeerEntry(entry, track, stream);
      }
    }
    if (track) {
      try {
        track.onended = null;
        track.stop();
      } catch {}
    }
    if (stream) {
      for (const tr of stream.getTracks()) {
        try {
          tr.stop();
        } catch {}
      }
    }
    screenTrackRef.current = null;
    screenStreamRef.current = null;
  };
  const stopMedia = () => {
    for (const key of Array.from(talkingWatchRef.current.keys())) stopTalkingWatch(key);
    stopCameraTrack();
    stopScreenTrack();
    const s = mediaRef.current;
    if (s) {
      for (const t of s.getTracks()) {
        try {
          t.stop();
        } catch {}
      }
    }
    mediaRef.current = null;
  };
  const emitCallMedia = (overrides = {}) => {
    const s = sockRef.current;
    const c = callRef.current;
    if (!s?.connected || !c) return;
    s.emit('call:media:update', {
      scopeType: c.scopeType,
      scopeId: c.scopeId,
      media: {
        micMuted: overrides.micMuted ?? micMute,
        speakerMuted: overrides.speakerMuted ?? speakerMute,
        cameraOn: overrides.cameraOn ?? cameraOn,
        screenOn: overrides.screenOn ?? screenOn
      }
    });
  };
  const clearPeer = (id) => {
    const p = peersRef.current.get(id);
    if (p) {
      try {
        p.peer.destroy();
      } catch {}
      peersRef.current.delete(id);
    }
    detachAudio(id);
    detachRemoteStream(id);
    syncPeers();
  };
  const leaveCall = (skipEmit = false) => {
    const s = sockRef.current;
    const c = callRef.current;
    if (!skipEmit && s?.connected && c) s.emit('call:leave', {scopeType: c.scopeType, scopeId: c.scopeId});
    for (const id of peersRef.current.keys()) clearPeer(id);
    peersRef.current.clear();
    setRemoteStreams({});
    setPeerMedia({});
    setFocusedTile('');
    setWatchStreams(false);
    setTalkingTiles([]);
    setCameraOn(false);
    setScreenOn(false);
    setMicMute(false);
    setSpeakerMute(false);
    stopMedia();
    callRef.current = null;
    setCall(null);
    setPeersView([]);
  };
  const ensureMedia = async () => {
    if (mediaRef.current) return mediaRef.current;
    const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
    for (const tr of stream.getAudioTracks()) tr.enabled = !micMute;
    mediaRef.current = stream;
    startTalkingWatch(`self:${me?.id || 'self'}`, stream);
    return stream;
  };
  const toggleMic = () => {
    const next = !micMute;
    const s = mediaRef.current;
    if (s) for (const tr of s.getAudioTracks()) tr.enabled = !next;
    setMicMute(next);
    emitCallMedia({micMuted: next});
  };
  const toggleSpeaker = () => {
    const next = !speakerMute;
    setSpeakerMute(next);
    syncAudioMuted(next);
    emitCallMedia({speakerMuted: next});
  };
  const disableCamera = () => {
    stopCameraTrack();
    setCameraOn(false);
    emitCallMedia({cameraOn: false, screenOn: !!screenTrackRef.current});
  };
  const toggleCamera = async () => {
    if (!callRef.current) return;
    if (cameraOn) {
      disableCamera();
      return;
    }
    try {
      await ensureMedia();
      const camStream = await navigator.mediaDevices.getUserMedia({audio: false, video: true});
      const track = camStream.getVideoTracks()[0];
      if (!track) return;
      stopCameraTrack();
      cameraStreamRef.current = camStream;
      cameraTrackRef.current = track;
      track.onended = () => disableCamera();
      syncVideoTracksForAllPeers();
      setCameraOn(true);
      emitCallMedia({cameraOn: true, screenOn: !!screenTrackRef.current});
    } catch {
      pushToast('Нет доступа к камере.', 'error');
    }
  };
  const stopScreenShare = (silent = false) => {
    if (!screenTrackRef.current) return;
    stopScreenTrack();
    setScreenOn(false);
    emitCallMedia({screenOn: false, cameraOn: !!cameraTrackRef.current});
    if (!silent) pushToast('Демонстрация экрана остановлена.', 'info');
  };
  const toggleScreenShare = async () => {
    if (!callRef.current) return;
    if (screenOn) {
      stopScreenShare(true);
      return;
    }
    const currentShares = Object.values(peerMedia || {}).filter((item) => item?.screenOn).length + (screenOn ? 1 : 0);
    if (currentShares >= 5) {
      pushToast('Лимит демонстраций экрана: 5 одновременно.', 'error');
      return;
    }
    try {
      await ensureMedia();
      const shareStream = await navigator.mediaDevices.getDisplayMedia({video: true, audio: false});
      const track = shareStream.getVideoTracks?.()[0];
      if (!track) return;
      stopScreenTrack();
      screenStreamRef.current = shareStream;
      screenTrackRef.current = track;
      track.onended = () => stopScreenShare(true);
      syncVideoTracksForAllPeers();
      setScreenOn(true);
      emitCallMedia({screenOn: true, cameraOn: !!cameraTrackRef.current});
      pushToast('Демонстрация экрана включена.', 'success');
    } catch {
      pushToast('Не удалось включить демонстрацию экрана.', 'error');
    }
  };
  async function startCallFor(next) {
    if (!next?.scopeType || !next?.scopeId) return;
    const s = sockRef.current;
    if (!s?.connected) return setUiErr('Сервер сокета пока не подключен.');
    const cur = callRef.current;
    if (cur && cur.scopeType === next.scopeType && cur.scopeId === next.scopeId) return;
    if (cur) leaveCall();
    try {
      await ensureMedia();
      callRef.current = next;
      setCall(next);
      setPeerMedia({});
      setFocusedTile('');
      s.emit('call:join', {scopeType: next.scopeType, scopeId: next.scopeId});
      emitCallMedia({micMuted: micMute, speakerMuted: speakerMute, cameraOn, screenOn});
    } catch {
      setUiErr('Нет доступа к микрофону.');
      leaveCall(true);
    }
  }
  const inviteDmCall = () => {
    if (!dm) return;
    const s = sockRef.current;
    if (!s?.connected) return setUiErr('Сервер сокета пока не подключен.');
    s.emit('dm-call:invite', {dmChannelId: dm.id});
    setOutgoingDmCall({callId: null, dmChannelId: dm.id, user: dm.otherUser || null});
  };
  const cancelDmCall = () => {
    const s = sockRef.current;
    if (outgoingDmCall?.callId && s?.connected) {
      s.emit('dm-call:cancel', {callId: outgoingDmCall.callId});
    }
    setOutgoingDmCall(null);
  };
  const acceptIncomingDmCall = async () => {
    if (!incomingDmCall) return;
    const s = sockRef.current;
    if (!s?.connected) return setUiErr('Сервер сокета пока не подключен.');
    s.emit('dm-call:accept', {callId: incomingDmCall.callId});
  };
  const rejectIncomingDmCall = () => {
    if (!incomingDmCall) return;
    const s = sockRef.current;
    if (s?.connected) {
      s.emit('dm-call:reject', {callId: incomingDmCall.callId});
    }
    setIncomingDmCall(null);
  };
  async function joinVoiceChannel(channelItem) {
    if (!channelItem) return;
    if (voiceCid === channelItem.id && callRef.current?.scopeType === 'channel' && callRef.current?.scopeId === channelItem.id) {
      leaveCall();
      setVoiceCid(null);
      return;
    }
    setVoiceCid(channelItem.id);
    await startCallFor({
      scopeType: 'channel',
      scopeId: channelItem.id,
      label: `${channelItem.name}`
    });
  }

  const logout = () => {
    leaveCall(true);
    try {
      sockRef.current?.disconnect();
    } catch {}
    sockRef.current = null;
    joinedRef.current = null;
    scopeRef.current = null;
    persistToken('');
    setMe(null);
    setServers([]);
    setDms([]);
    setFriends({friends: [], incoming: [], outgoing: []});
    setUsers([]);
    setMsgs([]);
    setSid(null);
    setCid(null);
    setVoiceCid(null);
    setDid(null);
    setJoinCode('');
    setOnlineUserIds([]);
    setVoiceState({});
    setIncomingDmCall(null);
    setOutgoingDmCall(null);
    setBackendOffline(false);
    setServerSettingsOpen(false);
    setServerSettingsTab('profile');
    setServerBans([]);
    setServerIntegrations([]);
    setServerAuditRows([]);
    setServerMenuOpen(false);
    setMode('servers');
    setHomeTab('dms');
  };

  const refreshUsers = async () => {
    if (!token) return;
    try {
      const {data} = await req('get', '/users');
      setUsers(data.users || []);
    } catch (e) {
      if (e?.response?.status === 401) logout();
    }
  };
  const refreshFriends = async () => {
    if (!token) return;
    try {
      const {data} = await req('get', '/friends');
      setFriends(data || {friends: [], incoming: [], outgoing: []});
    } catch (e) {
      if (e?.response?.status === 401) logout();
    }
  };
  const refreshDms = async () => {
    if (!token) return;
    try {
      const {data} = await req('get', '/dms');
      setDms(data.dms || []);
    } catch (e) {
      if (e?.response?.status === 401) logout();
    }
  };
  const refreshServers = async () => {
    if (!token) return;
    try {
      const {data} = await req('get', '/servers');
      setServers(data.servers || []);
    } catch (e) {
      if (e?.response?.status === 401) logout();
    }
  };
  const refreshPresence = async () => {
    if (!token) return;
    try {
      const {data} = await req('get', '/presence');
      setOnlineUserIds(data.onlineUserIds || []);
    } catch {
      // ignore
    }
  };
  const bootstrap = async () => {
    if (!token) return;
    try {
      setBooting(true);
      const {data} = await req('get', '/bootstrap');
      setMe(data.user);
      setServers(data.servers || []);
      setDms(data.dms || []);
      setFriends(data.friends || {friends: [], incoming: [], outgoing: []});
      setOnlineUserIds(data.onlineUserIds || onlineUserIds);
      setBackendOffline(false);
      if ((data.servers || []).length && !sid) {
        setSid(data.servers[0].id);
        setCid(data.servers[0].channels?.[0]?.id || null);
      }
      if ((data.dms || []).length && !did) setDid(data.dms[0].id);
      await refreshPresence();
    } catch (e) {
      if (e?.response?.status === 401) logout();
      setBackendOffline(true);
      setUiErr(apiError(e, 'Игровой backend временно недоступен. Идет автоподключение.'));
    } finally {
      setBooting(false);
    }
  };

  const loadMsgs = async (s) => {
    if (!s || !token) return setMsgs([]);
    const seq = ++seqRef.current;
    setMsgLoading(true);
    try {
      const url = s.type === 'channel' ? `/channels/${s.id}/messages` : `/dms/${s.id}/messages`;
      const {data} = await req('get', url);
      if (seq === seqRef.current) setMsgs((data.messages || []).map((item) => normalizeMsg(item)));
    } catch (e) {
      if (e?.response?.status === 401) logout();
      if (seq === seqRef.current) setMsgs([]);
    } finally {
      if (seq === seqRef.current) setMsgLoading(false);
    }
  };

  const incomingReq = (uid) => (friends.incoming || []).find((x) => x.fromUser.id === uid) || null;
  const outgoingReq = (uid) => (friends.outgoing || []).find((x) => x.toUser.id === uid) || null;
  const addFriend = async (uid) => {
    try {
      await req('post', '/friends/requests', {targetUserId: uid});
      await refreshFriends();
      await refreshUsers();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось отправить запрос в друзья.'));
    }
  };
  const addFriendByName = async () => {
    const raw = friendLookup.trim().replace(/^@/, '');
    if (!raw) return;
    const target = (users || []).find(
      (item) =>
        String(item.username || '').toLowerCase() === raw.toLowerCase()
        || String(label(item) || '').toLowerCase() === raw.toLowerCase()
    );
    if (!target) {
      return setUiErr('Пользователь не найден. Проверьте имя и повторите.');
    }
    await addFriend(target.id);
    setFriendLookup('');
    setFriendsView('pending');
  };
  const acceptReq = async (rid) => {
    try {
      await req('post', `/friends/requests/${rid}/accept`);
      await refreshFriends();
      await refreshUsers();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось принять запрос.'));
    }
  };
  const declineReq = async (rid) => {
    try {
      await req('post', `/friends/requests/${rid}/decline`);
      await refreshFriends();
      await refreshUsers();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось отклонить запрос.'));
    }
  };
  const removeFriend = async (uid) => {
    try {
      await req('delete', `/friends/${uid}`);
      await refreshFriends();
      await refreshUsers();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось удалить друга.'));
    }
  };
  const openDm = async (uid) => {
    try {
      const {data} = await req('post', '/dms', {targetUserId: uid});
      setDms((prev) => (prev.some((x) => x.id === data.dm.id) ? prev : [data.dm, ...prev]));
      setMode('home');
      setHomeTab('dms');
      setDid(data.dm.id);
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось открыть личные сообщения.'));
    }
  };
  const openMini = async (uid) => {
    try {
      const {data} = await req('get', `/profiles/${uid}`);
      setMini(data);
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось открыть профиль.'));
    }
  };
  const saveProfile = async () => {
    try {
      const payload = {
        ...profileForm,
        avatarUrl: String(profileForm.avatarUrl || '').slice(0, MAX_PROFILE_IMAGE_DATA_URL),
        bannerUrl: String(profileForm.bannerUrl || '').slice(0, MAX_PROFILE_IMAGE_DATA_URL)
      };
      const {data} = await req('patch', '/profiles/me', payload);
      setMe(data.user);
      setProfileOpen(false);
      await refreshUsers();
      await refreshFriends();
      await refreshDms();
      pushToast('Профиль обновлен.', 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось обновить профиль.'));
    }
  };
  const loadAvatarFile = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const cropped = await openImageCropModal({
        title: 'Редактировать аватар',
        sourceUrl: dataUrl,
        aspect: 1,
        shape: 'circle',
        outputWidth: 512,
        outputHeight: 512
      });
      if (!cropped) return;
      if (cropped.length > MAX_PROFILE_IMAGE_DATA_URL) {
        setUiErr('Аватар слишком большой после обрезки. Уменьшите масштаб или выберите другое изображение.');
        return;
      }
      setProfileForm((prev) => ({...prev, avatarUrl: cropped}));
    } catch {
      setUiErr('Не удалось прочитать файл аватара.');
    }
  };
  const loadBannerFile = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const cropped = await openImageCropModal({
        title: 'Редактировать баннер',
        sourceUrl: dataUrl,
        aspect: 2.7,
        shape: 'rect',
        outputWidth: 1620,
        outputHeight: 600
      });
      if (!cropped) return;
      if (cropped.length > MAX_PROFILE_IMAGE_DATA_URL) {
        setUiErr('Баннер слишком большой после обрезки. Уменьшите масштаб или выберите другое изображение.');
        return;
      }
      setProfileForm((prev) => ({...prev, bannerUrl: cropped}));
    } catch {
      setUiErr('Не удалось прочитать файл баннера.');
    }
  };
  const loadServerAudit = async (serverId) => {
    try {
      const {data} = await req('get', `/servers/${serverId}/audit`);
      setServerAuditRows(data.audit || []);
    } catch (e) {
      setServerAuditRows([]);
      setUiErr(apiError(e, 'Не удалось загрузить журнал аудита.'));
    }
  };
  const loadServerBans = async (serverId) => {
    try {
      const {data} = await req('get', `/servers/${serverId}/bans`);
      setServerBans(data.bans || []);
    } catch (e) {
      setServerBans([]);
      setUiErr(apiError(e, 'Не удалось загрузить список банов.'));
    }
  };
  const loadServerIntegrations = async (serverId) => {
    try {
      const {data} = await req('get', `/servers/${serverId}/integrations`);
      setServerIntegrations(data.integrations || []);
    } catch (e) {
      setServerIntegrations([]);
      setUiErr(apiError(e, 'Не удалось загрузить интеграции сервера.'));
    }
  };
  const loadServerEmojiPacks = async (serverId) => {
    try {
      const {data} = await req('get', `/servers/${serverId}/emoji-packs`);
      setServerEmojiPacks(data.packs || []);
    } catch (e) {
      setServerEmojiPacks([]);
      setUiErr(apiError(e, 'Не удалось загрузить наборы эмодзи.'));
    }
  };
  const openServerSettings = async (tab = 'profile') => {
    if (!server) return;
    const serverId = server.id;
    setServerProfileForm({
      name: server.name || '',
      tag: server.tag || '',
      description: server.description || '',
      iconUrl: server.iconUrl || '',
      bannerUrl: server.bannerUrl || '',
      bannerColor: server.bannerColor || '#1f2937'
    });
    setServerPrefsForm({
      muted: !!server.preferences?.muted,
      mentionsOnly: !!server.preferences?.mentionsOnly,
      desktopEnabled: server.preferences?.desktopEnabled !== false,
      soundEnabled: server.preferences?.soundEnabled !== false
    });
    setServerEmojiPacks(server.emojiPacks || []);
    if (tab === 'audit') await loadServerAudit(serverId);
    if (tab === 'bans') await loadServerBans(serverId);
    if (tab === 'integrations') await loadServerIntegrations(serverId);
    if (tab === 'emojis') await loadServerEmojiPacks(serverId);
    setServerSettingsTab(tab);
    setServerSettingsOpen(true);
    setServerMenuOpen(false);
  };
  const saveServerProfile = async () => {
    if (!server) return;
    try {
      const payload = {
        ...serverProfileForm,
        iconUrl: String(serverProfileForm.iconUrl || '').slice(0, MAX_PROFILE_IMAGE_DATA_URL),
        bannerUrl: String(serverProfileForm.bannerUrl || '').slice(0, MAX_PROFILE_IMAGE_DATA_URL)
      };
      const {data} = await req('patch', `/servers/${server.id}`, payload);
      setServers((prev) => prev.map((item) => (item.id === server.id ? data.server : item)));
      pushToast('Профиль сервера обновлен.', 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось сохранить профиль сервера.'));
    }
  };
  const loadServerIconFile = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const cropped = await openImageCropModal({
        title: 'Редактировать иконку сервера',
        sourceUrl: dataUrl,
        aspect: 1,
        shape: 'rounded',
        outputWidth: 512,
        outputHeight: 512
      });
      if (!cropped) return;
      if (cropped.length > MAX_PROFILE_IMAGE_DATA_URL) {
        setUiErr('Иконка сервера слишком большая после обрезки. Выберите другое изображение.');
        return;
      }
      setServerProfileForm((prev) => ({...prev, iconUrl: cropped}));
    } catch {
      setUiErr('Не удалось прочитать файл иконки сервера.');
    }
  };
  const loadServerBannerFile = async (file) => {
    if (!file) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const cropped = await openImageCropModal({
        title: 'Редактировать баннер сервера',
        sourceUrl: dataUrl,
        aspect: 2.7,
        shape: 'rect',
        outputWidth: 1620,
        outputHeight: 600
      });
      if (!cropped) return;
      if (cropped.length > MAX_PROFILE_IMAGE_DATA_URL) {
        setUiErr('Баннер сервера слишком большой после обрезки. Выберите другое изображение.');
        return;
      }
      setServerProfileForm((prev) => ({...prev, bannerUrl: cropped}));
    } catch {
      setUiErr('Не удалось прочитать файл баннера сервера.');
    }
  };
  const saveServerPrefs = async () => {
    if (!server) return;
    try {
      const {data} = await req('patch', `/servers/${server.id}/preferences`, serverPrefsForm);
      setServers((prev) => prev.map((item) => (
        item.id === server.id
          ? {...item, preferences: data.preferences}
          : item
      )));
      pushToast('Настройки уведомлений сохранены.', 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось сохранить уведомления сервера.'));
    }
  };
  const createServerEvent = async () => {
    if (!server) return;
    const values = await openFormModal({
      title: 'Создать событие',
      submitText: 'Создать',
      fields: [
        {id: 'name', label: 'Название', placeholder: 'Например: Ночной рейд'},
        {id: 'startsAtInput', label: 'Дата и время', placeholder: '2026-03-01 18:30'},
        {id: 'description', label: 'Описание', type: 'textarea', placeholder: 'Короткое описание события'}
      ]
    });
    const name = String(values?.name || '').trim();
    if (!name) return;
    const startsAtInput = String(values?.startsAtInput || '').trim();
    const description = String(values?.description || '').trim();
    const parsed = startsAtInput ? new Date(startsAtInput) : null;
    const startsAt = parsed && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString()
      : new Date(Date.now() + 60 * 60 * 1000).toISOString();
    try {
      await req('post', `/servers/${server.id}/events`, {name, startsAt, description});
      await refreshServers();
      if (serverSettingsOpen && serverSettingsTab === 'events') {
        await openServerSettings('events');
      }
      setServerMenuOpen(false);
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось создать событие.'));
    }
  };
  const deleteServerEvent = async (eventId) => {
    if (!server || !eventId) return;
    try {
      await req('delete', `/servers/${server.id}/events/${eventId}`);
      await refreshServers();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось удалить событие.'));
    }
  };
  const banMember = async (memberId) => {
    if (!server || !memberId) return;
    if (memberId === me?.id) return setUiErr('Нельзя забанить себя.');
    const values = await openFormModal({
      title: 'Бан участника',
      submitText: 'Забанить',
      fields: [
        {id: 'reason', label: 'Причина (необязательно)', type: 'textarea', placeholder: 'Укажите причину бана'}
      ]
    });
    const reason = String(values?.reason || '').trim();
    try {
      await req('post', `/servers/${server.id}/bans`, {userId: memberId, reason});
      await refreshServers();
      if (serverSettingsOpen && serverSettingsTab === 'bans') await loadServerBans(server.id);
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось забанить участника.'));
    }
  };
  const unbanMember = async (banId) => {
    if (!server || !banId) return;
    try {
      await req('delete', `/servers/${server.id}/bans/${banId}`);
      await loadServerBans(server.id);
      await refreshServers();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось разбанить пользователя.'));
    }
  };
  const createIntegration = async () => {
    if (!server) return;
    const values = await openFormModal({
      title: 'Новая интеграция',
      submitText: 'Добавить',
      fields: [
        {id: 'name', label: 'Название', placeholder: 'Например: CI Webhook'},
        {
          id: 'type',
          label: 'Тип',
          type: 'select',
          defaultValue: 'webhook',
          options: [
            {value: 'webhook', label: 'Webhook'},
            {value: 'bot', label: 'Bot'},
            {value: 'app', label: 'App'}
          ]
        },
        {id: 'url', label: 'Ссылка (необязательно)', placeholder: 'https://...'}
      ]
    });
    const name = String(values?.name || '').trim();
    if (!name) return;
    const type = String(values?.type || 'webhook').trim().toLowerCase();
    const url = String(values?.url || '').trim();
    try {
      await req('post', `/servers/${server.id}/integrations`, {name, type, url});
      await loadServerIntegrations(server.id);
      await refreshServers();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось создать интеграцию.'));
    }
  };
  const createEmojiPack = async () => {
    if (!server) return;
    const values = await openFormModal({
      title: 'Новый набор эмодзи',
      submitText: 'Создать',
      fields: [
        {id: 'name', label: 'Название набора', placeholder: 'Например: Мемы'},
        {id: 'emojis', label: 'Эмодзи (через пробел/запятую)', type: 'textarea', placeholder: '😀 😎 🎮 🔥'}
      ]
    });
    const name = String(values?.name || '').trim();
    const emojis = parseEmojiPackInput(values?.emojis || '');
    if (!name || !emojis.length) {
      pushToast('Укажите название и хотя бы один эмодзи.', 'error');
      return;
    }
    try {
      await req('post', `/servers/${server.id}/emoji-packs`, {name, emojis});
      await refreshServers();
      await loadServerEmojiPacks(server.id);
      pushToast(`Набор "${name}" создан.`, 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось создать набор эмодзи.'));
    }
  };
  const editEmojiPack = async (pack) => {
    if (!server || !pack?.id) return;
    const values = await openFormModal({
      title: 'Редактировать набор эмодзи',
      submitText: 'Сохранить',
      fields: [
        {id: 'name', label: 'Название набора', value: pack.name || ''},
        {id: 'emojis', label: 'Эмодзи (через пробел/запятую)', type: 'textarea', value: (pack.emojis || []).join(' ')}
      ]
    });
    const name = String(values?.name || '').trim();
    const emojis = parseEmojiPackInput(values?.emojis || '');
    if (!name || !emojis.length) {
      pushToast('Название и эмодзи не должны быть пустыми.', 'error');
      return;
    }
    try {
      await req('patch', `/servers/${server.id}/emoji-packs/${pack.id}`, {name, emojis});
      await refreshServers();
      await loadServerEmojiPacks(server.id);
      pushToast(`Набор "${name}" обновлен.`, 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось обновить набор эмодзи.'));
    }
  };
  const deleteEmojiPack = async (packId) => {
    if (!server || !packId) return;
    try {
      await req('delete', `/servers/${server.id}/emoji-packs/${packId}`);
      await refreshServers();
      await loadServerEmojiPacks(server.id);
      pushToast('Набор эмодзи удален.', 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось удалить набор эмодзи.'));
    }
  };
  const toggleIntegration = async (integration) => {
    if (!server || !integration?.id) return;
    try {
      await req('patch', `/servers/${server.id}/integrations/${integration.id}`, {enabled: !integration.enabled});
      await loadServerIntegrations(server.id);
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось обновить интеграцию.'));
    }
  };
  const removeIntegration = async (integrationId) => {
    if (!server || !integrationId) return;
    try {
      await req('delete', `/servers/${server.id}/integrations/${integrationId}`);
      await loadServerIntegrations(server.id);
      await refreshServers();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось удалить интеграцию.'));
    }
  };
  const createChannelQuick = async (kind = 'text', sectionDefault = '') => {
    if (!server) return;
    const isVoice = kind === 'voice';
    const fallbackSection = isVoice ? 'ГОЛОСОВЫЕ КАНАЛЫ' : 'ТЕКСТОВЫЕ КАНАЛЫ';
    const values = await openFormModal({
      title: isVoice ? 'Создать голосовой канал' : 'Создать текстовый канал',
      submitText: 'Создать',
      fields: [
        {id: 'name', label: 'Название канала', placeholder: isVoice ? 'Например: Main Voice' : 'Например: general'},
        {id: 'section', label: 'Раздел', defaultValue: sectionDefault || fallbackSection}
      ]
    });
    const name = String(values?.name || '').trim();
    if (!name) return;
    const section = String(values?.section || sectionDefault || fallbackSection).trim() || sectionDefault || fallbackSection;
    try {
      await req('post', `/servers/${server.id}/channels`, {name, kind: isVoice ? 'voice' : 'text', section});
      await refreshServers();
      setServerMenuOpen(false);
      pushToast(`Канал "${name}" создан.`, 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось создать канал.'));
    }
  };
  const createSectionQuick = async () => {
    if (!server) return;
    const values = await openFormModal({
      title: 'Создать раздел',
      submitText: 'Создать',
      fields: [
        {id: 'section', label: 'Название раздела', placeholder: 'Например: ОСНОВНОЕ'},
        {
          id: 'kind',
          label: 'Тип первого канала',
          type: 'select',
          defaultValue: 'text',
          options: [
            {value: 'text', label: 'Текстовый'},
            {value: 'voice', label: 'Голосовой'}
          ]
        },
        {id: 'firstName', label: 'Название первого канала', placeholder: 'Например: general'}
      ]
    });
    const section = String(values?.section || '').trim();
    if (!section) return;
    const kindRaw = String(values?.kind || 'text').toLowerCase();
    const kind = kindRaw === 'voice' ? 'voice' : 'text';
    const firstName = String(values?.firstName || '').trim();
    if (!firstName) return;
    try {
      await req('post', `/servers/${server.id}/channels`, {name: firstName, kind, section});
      await refreshServers();
      setServerMenuOpen(false);
      pushToast(`Раздел "${section}" создан.`, 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось создать категорию.'));
    }
  };
  const saveChannel = async () => {
    if (!channel) return;
    try {
      const {data} = await req('patch', `/channels/${channel.id}`, channelForm);
      setServers((prev) => prev.map((s) => ({...s, channels: (s.channels || []).map((c) => (c.id === data.channel.id ? data.channel : c))})));
      setChannelOpen(false);
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось обновить канал.'));
    }
  };
  const deleteChannel = async () => {
    if (!channel || !server) return;
    const channelToDelete = channel;
    const confirmed = window.confirm(`Удалить канал "${channelToDelete.name}"? Это действие нельзя отменить.`);
    if (!confirmed) return;
    try {
      await req('delete', `/channels/${channelToDelete.id}`);
      if (callRef.current?.scopeType === 'channel' && callRef.current?.scopeId === channelToDelete.id) {
        leaveCall();
      }
      setServers((prev) => prev.map((s) => (
        s.id === server.id
          ? {...s, channels: (s.channels || []).filter((c) => c.id !== channelToDelete.id)}
          : s
      )));
      if (cid === channelToDelete.id) setCid(null);
      if (voiceCid === channelToDelete.id) setVoiceCid(null);
      setChannelOpen(false);
      await refreshServers();
      pushToast(`Канал "${channelToDelete.name}" удален.`, 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось удалить канал.'));
    }
  };
  const createRole = async () => {
    if (!server) return;
    const values = await openFormModal({
      title: 'Создать роль',
      submitText: 'Создать',
      fields: [{id: 'name', label: 'Название роли', placeholder: 'Например: Модератор'}]
    });
    const name = String(values?.name || '').trim();
    if (!name) return;
    try {
      await req('post', `/servers/${server.id}/roles`, {name, color: '#949ba4'});
      await bootstrap();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось создать роль.'));
    }
  };
  const toggleRolePermission = async (role, key) => {
    if (!server || !role) return;
    try {
      await req('patch', `/servers/${server.id}/roles/${role.id}`, {
        permissions: {...role.permissions, [key]: !role.permissions?.[key]}
      });
      await bootstrap();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось обновить роль.'));
    }
  };
  const updateRoleMeta = async (role) => {
    if (!server || !role) return;
    const values = await openFormModal({
      title: 'Редактировать роль',
      submitText: 'Сохранить',
      fields: [
        {id: 'name', label: 'Название роли', value: role.name || ''},
        {id: 'color', label: 'Цвет роли (hex)', value: role.color || '#949ba4', placeholder: '#949ba4'}
      ]
    });
    const name = String(values?.name || '').trim();
    if (!name) return;
    const color = String(values?.color || role.color || '#949ba4').trim() || role.color || '#949ba4';
    try {
      await req('patch', `/servers/${server.id}/roles/${role.id}`, {name, color});
      await bootstrap();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось обновить роль.'));
    }
  };
  const deleteRole = async (roleId) => {
    if (!server || !roleId) return;
    try {
      await req('delete', `/servers/${server.id}/roles/${roleId}`);
      await bootstrap();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось удалить роль.'));
    }
  };
  const toggleMemberRole = async (memberId, roleId) => {
    if (!server) return;
    const current = memberRoleMap.get(memberId) || [];
    const next = current.includes(roleId) ? current.filter((id) => id !== roleId) : [...current, roleId];
    try {
      await req('patch', `/servers/${server.id}/members/${memberId}`, {roleIds: next});
      await bootstrap();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось обновить роли участника.'));
    }
  };
  const kickMember = async (memberId) => {
    if (!server) return;
    if (memberId === me?.id) return setUiErr('Нельзя кикнуть себя.');
    try {
      await req('patch', `/servers/${server.id}/members/${memberId}`, {kick: true});
      await bootstrap();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось кикнуть участника.'));
    }
  };
  const createInvite = async () => {
    if (!server) return;
    const values = await openFormModal({
      title: 'Создать приглашение',
      submitText: 'Создать',
      fields: [
        {id: 'maxUses', label: 'Максимум использований (0 = без лимита)', type: 'number', defaultValue: '0'},
        {id: 'expiresInHours', label: 'Срок действия в часах (0 = бессрочно)', type: 'number', defaultValue: '0'}
      ]
    });
    const maxUses = Math.max(0, Number(values?.maxUses || 0) || 0);
    const expiresInHours = Math.max(0, Number(values?.expiresInHours || 0) || 0);
    try {
      const {data} = await req('post', `/servers/${server.id}/invites`, {maxUses, expiresInHours});
      await navigator.clipboard.writeText(data.invite.code);
      pushToast(`Код приглашения скопирован: ${data.invite.code}`, 'success');
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось создать приглашение.'));
    }
  };
  const revokeInvite = async (inviteId) => {
    try {
      await req('delete', `/invites/${inviteId}`);
      await bootstrap();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось отозвать приглашение.'));
    }
  };
  const joinByCode = async () => {
    const code = joinCode.trim();
    if (!code) return;
    try {
      const {data} = await req('post', `/invites/${code}/join`);
      setMode('servers');
      setSid(data.server.id);
      setCid(data.server.channels?.[0]?.id || null);
      setJoinCode('');
      await bootstrap();
    } catch (e) {
      setUiErr(apiError(e, 'Не удалось войти по приглашению.'));
    }
  };
  const removeComposerFile = (id) => {
    setComposerFiles((prev) => prev.filter((x) => x.id !== id));
  };
  const addComposerFiles = async (files) => {
    if (!files?.length) return;
    const list = Array.from(files).slice(0, Math.max(0, 6 - composerFiles.length));
    const prepared = [];
    for (const file of list) {
      try {
        const url = await readFileAsDataUrl(file);
        prepared.push({
          id: `${Date.now()}-${Math.random().toString(16).slice(2, 7)}`,
          name: file.name || 'file',
          type: file.type || 'application/octet-stream',
          size: file.size || 0,
          kind: (file.type || '').startsWith('image/')
            ? 'image'
            : ((file.type || '').startsWith('audio/') ? 'audio' : 'file'),
          url
        });
      } catch {
        pushToast(`Не удалось прочитать файл: ${file.name || 'file'}`, 'error');
      }
    }
    if (prepared.length) setComposerFiles((prev) => [...prev, ...prepared].slice(0, 6));
  };
  const toggleVoiceRecord = async () => {
    if (recordingVoice) {
      try {
        recorderRef.current?.stop?.();
      } catch {}
      return;
    }
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      pushToast('Запись голосовых не поддерживается этим браузером.', 'error');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({audio: true, video: false});
      recordChunksRef.current = [];
      const rec = new MediaRecorder(stream);
      recorderRef.current = rec;
      rec.ondataavailable = (event) => {
        if (event.data?.size) recordChunksRef.current.push(event.data);
      };
      rec.onstop = async () => {
        setRecordingVoice(false);
        const blob = new Blob(recordChunksRef.current, {type: 'audio/webm'});
        for (const track of stream.getTracks()) {
          try { track.stop(); } catch {}
        }
        if (!blob.size) return;
        const file = new File([blob], `voice-${Date.now()}.webm`, {type: 'audio/webm'});
        await addComposerFiles([file]);
      };
      rec.start();
      setRecordingVoice(true);
    } catch {
      pushToast('Нет доступа к микрофону для записи.', 'error');
    }
  };
  const toggleReaction = (messageId, emoji) => {
    if (!scope || !messageId || !emoji) return;
    const s = sockRef.current;
    if (!s?.connected) return;
    if (scope.type === 'channel') s.emit('message:reaction:toggle', {channelId: scope.id, messageId, emoji});
    else s.emit('dm:reaction:toggle', {dmChannelId: scope.id, messageId, emoji});
  };
  const deleteMessage = async (message, forEveryone = false) => {
    if (!scope || !message?.id) return;
    if (forEveryone && message.userId !== me?.id) return;
    try {
      if (scope.type === 'channel') {
        await req('delete', `/channels/${scope.id}/messages/${message.id}`, {forEveryone});
      } else if (scope.type === 'dm') {
        await req('delete', `/dms/${scope.id}/messages/${message.id}`, {forEveryone});
      } else {
        return;
      }
      setMsgs((prev) => prev.filter((item) => item.id !== message.id));
      if (replyTo?.id === message.id) setReplyTo(null);
      pushToast(forEveryone ? 'Сообщение удалено у всех.' : 'Сообщение удалено у вас.', 'success');
    } catch (e) {
      setUiErr(apiError(e, forEveryone ? 'Не удалось удалить сообщение у всех.' : 'Не удалось удалить сообщение.'));
    }
  };
  const forwardMessage = async (message) => {
    if (!message) return;
    const friendItems = friends.friends || [];
    if (!friendItems.length) {
      pushToast('Нет друзей для пересылки.', 'error');
      return;
    }
    const values = await openFormModal({
      title: 'Переслать сообщение',
      submitText: 'Переслать',
      fields: [
        {
          id: 'friendId',
          label: 'Кому',
          type: 'select',
          options: friendItems.map((friendItem) => ({
            value: friendItem.id,
            label: `${label(friendItem)} (@${friendItem.username})`
          }))
        }
      ]
    });
    const friend = friendItems.find((x) => x.id === String(values?.friendId || ''));
    if (!friend) {
      pushToast('Не удалось определить получателя.', 'error');
      return;
    }
    try {
      const {data} = await req('post', '/dms', {targetUserId: friend.id});
      const dmId = data?.dm?.id;
      if (!dmId) return;
      const s = sockRef.current;
      if (!s?.connected) return;
      s.emit('dm:create', {
        dmChannelId: dmId,
        content: message.content || '',
        attachments: message.attachments || [],
        forwardedFrom: {
          messageId: message.id,
          userId: message.userId,
          username: message.username
        }
      });
      pushToast(`Сообщение переслано @${friend.username}`, 'success');
    } catch {
      pushToast('Не удалось переслать сообщение.', 'error');
    }
  };
  const appendEmojiToInput = (emoji) => {
    const token = String(emoji || '').trim();
    if (!token) return;
    setMsgInput((prev) => `${prev}${prev && !/\s$/.test(prev) ? ' ' : ''}${token}`);
  };
  const sendMsg = (e) => {
    e.preventDefault();
    const t = msgInput.trim();
    if ((!t && !composerFiles.length) || !scope) return;
    const s = sockRef.current;
    if (!s?.connected) return setUiErr('Соединение с сервером потеряно.');
    pendingAutoScrollRef.current = true;
    const payload = {
      content: t,
      attachments: composerFiles,
      replyToId: replyTo?.id || ''
    };
    if (scope.type === 'channel') s.emit('message:create', {channelId: scope.id, ...payload});
    else s.emit('dm:create', {dmChannelId: scope.id, ...payload});
    setMsgInput('');
    setComposerFiles([]);
    setReplyTo(null);
  };
  const handleComposerInputKeyDown = (event) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    sendMsg(event);
  };

  useEffect(() => {
    speakerMuteRef.current = speakerMute;
    syncAudioMuted(speakerMute);
  }, [speakerMute]);

  useEffect(() => {
    for (const tile of callTiles) {
      const videoEl = videoRef.current.get(tile.key);
      if (!videoEl) continue;
      const stream = tile.hasVideo ? tile.stream : null;
      if (videoEl.srcObject !== stream) {
        videoEl.srcObject = stream || null;
      }
    }
  }, [callTiles, focusedTile]);

  useEffect(() => {
    if (!callRef.current) return;
    emitCallMedia();
  }, [micMute, speakerMute, cameraOn, screenOn, call?.scopeType, call?.scopeId]);

  useEffect(() => {
    if (!token) return;
    bootstrap();
    refreshUsers();
  }, [token]);
  useEffect(() => {
    if (!me) return;
    setProfileForm({
      displayName: me.profile?.displayName || me.username,
      bio: me.profile?.bio || '',
      location: me.profile?.location || '',
      statusText: me.profile?.statusText || '',
      avatarColor: me.profile?.avatarColor || '#5865f2',
      bannerColor: me.profile?.bannerColor || '#1e1f22',
      avatarUrl: me.profile?.avatarUrl || '',
      bannerUrl: me.profile?.bannerUrl || ''
    });
  }, [me]);
  useEffect(() => {
    if (!serverMenuOpen) return undefined;
    const close = () => setServerMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [serverMenuOpen]);
  useEffect(() => {
    if (mode !== 'servers') return;
    if (!servers.length) return setSid(null), setCid(null);
    let s = servers.find((x) => x.id === sid);
    if (!s) s = servers[0], setSid(s.id);
    const textOnly = (s.channels || []).filter((x) => (x.kind || 'text') === 'text');
    if (!textOnly.some((x) => x.id === cid)) setCid(textOnly[0]?.id || null);
    if (!s.channels?.some((x) => x.id === voiceCid)) setVoiceCid(null);
  }, [mode, servers, sid, cid, voiceCid]);
  useEffect(() => {
    if (mode !== 'servers') setServerMenuOpen(false);
  }, [mode]);
  useEffect(() => {
    if (!call || call.scopeType !== 'channel') return;
    const selected = servers.find((item) => item.id === sid);
    const hasInSelected = !!selected?.channels?.some((ch) => ch.id === call.scopeId);
    if (!hasInSelected) {
      leaveCall(true);
      setVoiceCid(null);
      return;
    }
    if (voiceCid !== call.scopeId) setVoiceCid(call.scopeId);
  }, [call?.scopeId, call?.scopeType, sid, servers, voiceCid]);
  useEffect(() => {
    if (mode !== 'home' || homeTab !== 'dms') return;
    if (!dms.length) return setDid(null);
    if (!dms.some((x) => x.id === did)) setDid(dms[0].id);
  }, [mode, homeTab, dms, did]);
  useEffect(() => {
    setReplyTo(null);
    setComposerFiles([]);
    setEmojiPickerOpen(false);
  }, [scope?.type, scope?.id]);
  useEffect(() => {
    if (!emojiPickerOpen) return undefined;
    const onDown = (event) => {
      if (!emojiPickerRef.current) return;
      if (emojiPickerRef.current.contains(event.target)) return;
      setEmojiPickerOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [emojiPickerOpen]);
  useEffect(() => {
    if (!availableEmojiPacks.some((pack) => pack.id === emojiPickerTab)) {
      setEmojiPickerTab(availableEmojiPacks[0]?.id || 'default');
    }
  }, [availableEmojiPacks, emojiPickerTab]);
  useEffect(() => {
    if (inCurrentCall) return;
    setWatchStreams(false);
    setFocusedTile('');
  }, [inCurrentCall]);
  useEffect(() => {
    if (!focusedTile) return;
    if (!callTiles.some((tile) => tile.key === focusedTile && tile.hasVideo)) {
      setFocusedTile('');
    }
  }, [focusedTile, callTiles]);
  useEffect(() => {
    if (!screenTiles.length) return;
    if (!watchStreams) setWatchStreams(true);
  }, [screenTiles.length, watchStreams]);
  useEffect(() => {
    if (!watchStreams) return;
    if (screenTiles.length) return;
    setWatchStreams(false);
    setFocusedTile('');
  }, [watchStreams, screenTiles.length]);
  useEffect(() => () => {
    try {
      recorderRef.current?.stop?.();
    } catch {}
  }, []);
  useEffect(() => () => {
    if (typeof formModalResolverRef.current === 'function') {
      formModalResolverRef.current(null);
      formModalResolverRef.current = null;
    }
  }, []);
  useEffect(() => () => {
    if (typeof imageCropResolverRef.current === 'function') {
      imageCropResolverRef.current(null);
      imageCropResolverRef.current = null;
    }
  }, []);
  useEffect(() => {
    if (!imageCropModal) return;
    const onEscape = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      closeImageCropModal(null);
    };
    window.addEventListener('keydown', onEscape, true);
    return () => window.removeEventListener('keydown', onEscape, true);
  }, [imageCropModal]);
  useEffect(() => {
    if (!imageCropModal) return;
    setImageCropOffset((prev) => clampImageCropOffset(prev));
  }, [
    imageCropModal,
    imageCropZoom,
    imageCropImageSize.width,
    imageCropImageSize.height,
    imageCropViewport.width,
    imageCropViewport.height
  ]);
  useEffect(() => {
    scopeRef.current = scope;
    const nextKey = scope ? `${scope.type}:${scope.id}` : '';
    if (scopeKeyRef.current !== nextKey) {
      scopeKeyRef.current = nextKey;
      stickToBottomRef.current = false;
      pendingAutoScrollRef.current = false;
    }
    if (!scope) return setMsgs([]);
    loadMsgs(scope);
  }, [scope?.type, scope?.id, token]);
  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    if (pendingAutoScrollRef.current) {
      el.scrollTop = el.scrollHeight;
      pendingAutoScrollRef.current = false;
      stickToBottomRef.current = true;
      return;
    }
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distance < 80;
  }, [msgs.length, msgLoading, scope?.type, scope?.id, inCurrentCall]);
  useEffect(() => {
    const s = sockRef.current;
    if (!s?.connected) return;
    const p = joinedRef.current;
    const n = scope ? {type: scope.type, id: scope.id} : null;
    if (p && (!n || p.type !== n.type || p.id !== n.id)) {
      if (p.type === 'channel') s.emit('leave:channel', {channelId: p.id});
      if (p.type === 'dm') s.emit('leave:dm', {dmChannelId: p.id});
      joinedRef.current = null;
    }
    if (n && (!p || p.type !== n.type || p.id !== n.id)) {
      if (n.type === 'channel') s.emit('join:channel', {channelId: n.id});
      if (n.type === 'dm') s.emit('join:dm', {dmChannelId: n.id});
      joinedRef.current = n;
    }
  }, [sockOn, scope?.type, scope?.id]);

  useEffect(() => {
    if (!token) return;
    const s = io(WS, {
      path: '/playmode-socket',
      auth: {token},
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 1200,
      reconnectionDelayMax: 3000,
      timeout: 5000
    });
    sockRef.current = s;

    const sameCall = (t, id) => !!(callRef.current && callRef.current.scopeType === t && callRef.current.scopeId === id);
    const mergeUser = (nextUser) => {
      if (!nextUser?.id) return;
      const patch = (source) => (
        source?.id === nextUser.id
          ? {...source, ...nextUser, profile: {...source?.profile, ...nextUser.profile}}
          : source
      );
      setMe((prev) => patch(prev));
      setUsers((prev) => prev.map((u) => patch(u)));
      setFriends((prev) => ({
        friends: (prev.friends || []).map((u) => patch(u)),
        incoming: (prev.incoming || []).map((item) => ({...item, fromUser: patch(item.fromUser)})),
        outgoing: (prev.outgoing || []).map((item) => ({...item, toUser: patch(item.toUser)}))
      }));
      setDms((prev) => prev.map((item) => ({
        ...item,
        otherUser: item.otherUser ? patch(item.otherUser) : item.otherUser
      })));
    };
    const makePeer = (remoteId, initiator, remoteUser) => {
      if (peersRef.current.has(remoteId)) return peersRef.current.get(remoteId).peer;
      if (!callRef.current) return null;
      if (typeof PeerImpl !== 'function') {
        setUiErr('Не удалось загрузить голосовой движок.');
        return null;
      }
      let p = null;
      try {
        p = new PeerImpl({
          initiator,
          trickle: true,
          stream: mediaRef.current || undefined,
          config: {iceServers: [{urls: 'stun:stun.l.google.com:19302'}]}
        });
      } catch {
        setUiErr('Не удалось создать голосовую сессию.');
        return null;
      }
      p.on('signal', (signal) => {
        const c = callRef.current;
        if (!c) return;
        s.emit('call:signal', {scopeType: c.scopeType, scopeId: c.scopeId, targetSocketId: remoteId, signal});
      });
      p.on('stream', (stream) => {
        if (!stream) return;
        const audioTracks = stream.getAudioTracks?.() || [];
        if (audioTracks.length) {
          let el = audioRef.current.get(remoteId);
          if (!el) {
            el = document.createElement('audio');
            el.autoplay = true;
            el.playsInline = true;
            el.className = 'audio-bin';
            document.body.appendChild(el);
            audioRef.current.set(remoteId, el);
          }
          el.muted = speakerMuteRef.current;
          el.srcObject = stream;
          el.play?.().catch?.(() => {});
          startTalkingWatch(remoteId, stream);
        }
        setRemoteStreams((prev) => {
          const prevList = Array.isArray(prev[remoteId]) ? prev[remoteId] : [];
          const existing = prevList.find((item) => item?.id && item.id === stream.id);
          const nextList = existing
            ? prevList.map((item) => (item?.id === stream.id ? stream : item))
            : [...prevList, stream];
          return {...prev, [remoteId]: nextList};
        });
      });
      p.on('close', () => clearPeer(remoteId));
      p.on('error', () => clearPeer(remoteId));
      const peerEntry = {socketId: remoteId, peer: p, user: remoteUser || {id: 'unknown', username: 'Неизвестный'}, videoTrackIds: new Set()};
      peersRef.current.set(remoteId, peerEntry);
      syncVideoTracksForPeerEntry(peerEntry);
      syncPeers();
      return p;
    };

    s.on('connect', () => {
      setSockOn(true);
      setBackendOffline(false);
      setUiErr((prev) => (prev && prev.includes('Игровой backend') ? '' : prev));
      s.emit('call:state:sync');
      refreshPresence();
      const sc = scopeRef.current;
      if (!sc) return;
      if (sc.type === 'channel') s.emit('join:channel', {channelId: sc.id});
      if (sc.type === 'dm') s.emit('join:dm', {dmChannelId: sc.id});
      joinedRef.current = {type: sc.type, id: sc.id};
    });
    s.on('disconnect', () => {
      setSockOn(false);
      setBackendOffline(true);
      setVoiceState({});
      setPeerMedia({});
      setRemoteStreams({});
      setIncomingDmCall(null);
      setOutgoingDmCall(null);
      joinedRef.current = null;
      leaveCall(true);
    });
    s.on('connect_error', () => {
      setSockOn(false);
      setBackendOffline(true);
      setUiErr((prev) => prev || 'Игровой backend временно недоступен. Идет автоподключение.');
    });
    s.on('message:new', (m) => {
      const sc = scopeRef.current;
      if (sc?.type === 'channel' && sc.id === m.channelId) {
        pendingAutoScrollRef.current = stickToBottomRef.current;
        setMsgs((p) => [...p, normalizeMsg(m)]);
      }
    });
    s.on('dm:created', ({dm}) => {
      if (!dm?.id) return;
      setDms((prev) => {
        const i = prev.findIndex((x) => x.id === dm.id);
        if (i >= 0) {
          const next = [...prev];
          next[i] = {...next[i], ...dm};
          return next;
        }
        return [dm, ...prev];
      });
    });
    s.on('dm:new', (m) => {
      const sc = scopeRef.current;
      if (sc?.type === 'dm' && sc.id === m.dmChannelId) {
        pendingAutoScrollRef.current = stickToBottomRef.current;
        setMsgs((p) => [...p, normalizeMsg(m)]);
      }
      setDms((prev) => {
        const i = prev.findIndex((x) => x.id === m.dmChannelId);
        if (i < 0) return prev;
        const n = [...prev];
        n[i] = {...n[i], lastMessage: m};
        const moved = n.splice(i, 1)[0];
        n.unshift(moved);
        return n;
      });
    });
    s.on('message:update', (m) => {
      if (!m?.id) return;
      const normalized = normalizeMsg(m);
      setMsgs((prev) => prev.map((item) => (item.id === normalized.id ? {...item, ...normalized} : item)));
    });
    s.on('dm:update', (m) => {
      if (!m?.id) return;
      const normalized = normalizeMsg(m);
      setMsgs((prev) => prev.map((item) => (item.id === normalized.id ? {...item, ...normalized} : item)));
    });
    s.on('message:delete', ({messageId, channelId}) => {
      if (!messageId) return;
      const sc = scopeRef.current;
      if (sc?.type === 'channel' && channelId && sc.id !== channelId) return;
      setMsgs((prev) => prev.filter((item) => item.id !== messageId));
      setReplyTo((prev) => (prev?.id === messageId ? null : prev));
    });
    s.on('dm:delete', ({messageId, dmChannelId}) => {
      if (!messageId) return;
      const sc = scopeRef.current;
      if (sc?.type === 'dm' && dmChannelId && sc.id !== dmChannelId) return;
      setMsgs((prev) => prev.filter((item) => item.id !== messageId));
      setReplyTo((prev) => (prev?.id === messageId ? null : prev));
    });
    s.on('friends:update', ({friends: payload}) => {
      setFriends(payload || {friends: [], incoming: [], outgoing: []});
    });
    s.on('users:update', ({users: payload}) => {
      setUsers(payload || []);
    });
    s.on('dms:update', ({dms: payload}) => {
      setDms(payload || []);
    });
    s.on('user:updated', ({user: payload}) => {
      mergeUser(payload);
    });
    s.on('call:participants', ({scopeType, scopeId, participants}) => {
      if (!sameCall(scopeType, scopeId)) return;
      const updates = {};
      for (const x of participants || []) {
        if (!x?.socketId) continue;
        updates[x.socketId] = x.media || {micMuted: false, speakerMuted: false, cameraOn: false, screenOn: false};
        makePeer(x.socketId, true, x.user);
      }
      setPeerMedia((prev) => ({...prev, ...updates}));
    });
    s.on('call:user-joined', ({scopeType, scopeId, socketId, user, media}) => {
      if (!sameCall(scopeType, scopeId) || !socketId) return;
      setPeerMedia((prev) => ({...prev, [socketId]: media || prev[socketId] || {micMuted: false, speakerMuted: false, cameraOn: false, screenOn: false}}));
      makePeer(socketId, false, user);
    });
    s.on('call:user-left', ({scopeType, scopeId, socketId}) => {
      if (!sameCall(scopeType, scopeId) || !socketId) return;
      setPeerMedia((prev) => {
        if (!prev[socketId]) return prev;
        const next = {...prev};
        delete next[socketId];
        return next;
      });
      clearPeer(socketId);
    });
    s.on('call:signal', ({scopeType, scopeId, fromSocketId, signal, user}) => {
      if (!sameCall(scopeType, scopeId) || !fromSocketId || !signal) return;
      const p = peersRef.current.get(fromSocketId)?.peer || makePeer(fromSocketId, false, user);
      if (p && typeof p.signal === 'function') {
        try {
          p.signal(signal);
        } catch {
          clearPeer(fromSocketId);
        }
      }
    });
    s.on('call:media', ({scopeType, scopeId, states}) => {
      if (!sameCall(scopeType, scopeId)) return;
      const next = {};
      for (const item of states || []) {
        if (!item?.socketId) continue;
        next[item.socketId] = {
          micMuted: !!item.micMuted,
          speakerMuted: !!item.speakerMuted,
          cameraOn: !!item.cameraOn,
          screenOn: !!item.screenOn
        };
      }
      setPeerMedia(next);
    });
    s.on('call:media:rejected', ({reason, max}) => {
      if (reason === 'screen_limit') {
        pushToast(`Лимит демонстраций экрана: ${max || 5}.`, 'error');
      } else {
        pushToast('Не удалось применить медиа-настройки звонка.', 'error');
      }
    });
    s.on('call:state', ({scopeType, scopeId, users: callUsers}) => {
      if (scopeType !== 'channel' || !scopeId) return;
      setVoiceState((prev) => {
        const next = {...prev};
        const list = Array.isArray(callUsers) ? callUsers : [];
        if (!list.length) delete next[scopeId];
        else next[scopeId] = list;
        return next;
      });
    });
    s.on('dm-call:ringing', ({callId, dmChannelId, toUserId}) => {
      setOutgoingDmCall((prev) => ({
        callId: callId || prev?.callId || null,
        dmChannelId: dmChannelId || prev?.dmChannelId || null,
        toUserId: toUserId || prev?.toUserId || null,
        user: prev?.user || null
      }));
    });
    s.on('dm-call:incoming', ({callId, dmChannelId, fromUser}) => {
      setIncomingDmCall({callId, dmChannelId, fromUser});
      setUiErr('');
      pushToast(`Входящий звонок от ${label(fromUser)}.`, 'info');
    });
    s.on('dm-call:accepted', async ({callId, dmChannelId, peerUser}) => {
      setIncomingDmCall(null);
      setOutgoingDmCall(null);
      if (!dmChannelId) return;
      setMode('home');
      setHomeTab('dms');
      setDid(dmChannelId);
      const title = peerUser ? label(peerUser) : 'Личный звонок';
      await startCallFor({scopeType: 'dm', scopeId: dmChannelId, label: title});
    });
    s.on('dm-call:rejected', ({callId}) => {
      setIncomingDmCall((prev) => (prev?.callId === callId ? null : prev));
      setOutgoingDmCall((prev) => (prev?.callId === callId ? null : prev));
      pushToast('Звонок отклонен.', 'info');
    });
    s.on('dm-call:canceled', ({callId}) => {
      setIncomingDmCall((prev) => (prev?.callId === callId ? null : prev));
      setOutgoingDmCall((prev) => (prev?.callId === callId ? null : prev));
    });
    s.on('presence:update', ({onlineUserIds: ids}) => {
      setOnlineUserIds(Array.isArray(ids) ? ids : []);
    });

    return () => {
      try {
        s.disconnect();
      } catch {}
      if (sockRef.current === s) sockRef.current = null;
      setSockOn(false);
      setBackendOffline(false);
      setPeerMedia({});
      setRemoteStreams({});
      setIncomingDmCall(null);
      setOutgoingDmCall(null);
      joinedRef.current = null;
      leaveCall(true);
    };
  }, [token]);

  const bindVideoNode = (tileKey, node) => {
    if (!tileKey) return;
    if (!node) {
      videoRef.current.delete(tileKey);
      return;
    }
    videoRef.current.set(tileKey, node);
  };
  const renderCallTile = (tile, compact = false) => (
    <button
      type="button"
      key={tile.key}
      className={`call-tile ${compact ? 'compact' : ''} ${talkingSet.has(tile.talkKey) ? 'speaking' : ''} ${tile.feedKind === 'screen' ? 'screen' : ''}`}
      style={{background: callTileColor(tile.user)}}
      onClick={() => {
        if (tile.hasVideo) setFocusedTile(tile.key);
        if (tile.hasVideo && !watchStreams) setWatchStreams(true);
      }}
    >
      <div className="call-tile-center">
        {tile.hasVideo ? (
          <video
            ref={(node) => bindVideoNode(tile.key, node)}
            className="call-video"
            autoPlay
            playsInline
            muted
          />
        ) : (
          <Avatar user={tile.user} size={compact ? 34 : 76} />
        )}
      </div>
      <div className="call-tile-name">
        <span>{label(tile.user)}{tile.self ? ' (вы)' : ''}</span>
        {tile.feedKind === 'screen' ? <small className="tile-badge live">ЭКРАН</small> : null}
        {tile.media?.micMuted ? <small className="tile-badge mute">MIC OFF</small> : null}
      </div>
    </button>
  );

  async function submitAuth(e) {
    e.preventDefault();
    if (authLoading) return;
    setAuthErr('');
    const name = auth.name.trim();
    const username = auth.username.trim();
    const email = auth.email.trim().toLowerCase();
    const password = auth.password;
    if (authMode === 'register' && !name) {
      return setAuthErr('Укажите имя.');
    }
    if (authMode === 'register' && !username) {
      return setAuthErr('Укажите @username.');
    }
    if (!email) {
      return setAuthErr('Укажите email.');
    }
    if (authMode === 'register' && password !== auth.confirmPassword) {
      return setAuthErr('Пароли не совпадают.');
    }
    if (!password) return setAuthErr('Введите пароль.');
    const url = authMode === 'login' ? '/auth/login' : '/auth/register';
    try {
      setAuthLoading(true);
      const payload = authMode === 'login'
        ? {email, password}
        : {name, username, email, password};
      const {data} = await axios.post(`${API}${url}`, payload);
      persistToken(data.token);
      setMe(data.user);
      setAuth({name: '', username: '', email: '', password: '', confirmPassword: ''});
      setUiErr('');
    } catch (err) {
      const status = err?.response?.status;
      if (status === 409 && authMode === 'register') {
        const conflict = String(err?.response?.data?.error || '').toLowerCase();
        if (conflict.includes('email')) setAuthErr('Эта почта уже используется.');
        else setAuthErr('Этот @username уже занят.');
      } else if (status === 400 && authMode === 'login') {
        setAuthErr('Введите корректную почту.');
      } else if (status === 401 && authMode === 'login') {
        setAuthErr('Неверная почта или пароль.');
      } else {
        setAuthErr(apiError(err, 'Ошибка авторизации.'));
      }
    } finally {
      setAuthLoading(false);
    }
  }

  if (!token) {
    return (
      <div className="auth-screen">
        <div className="auth-layout">
          <aside className="auth-brand">
            <div className="auth-brand-ring" />
            <img className="auth-logo" src={yoohLogo} alt="YOOH" />
            <h1>YOOH</h1>
            <p>Локальный сервер и мессенджер на вашем ПК.</p>
            <div className="auth-brand-points">
              <div><ShieldIcon size={14} /><span>Локальная база</span></div>
              <div><VolumeIcon size={14} /><span>Каналы и звонки</span></div>
              <div><UserGroupIcon size={14} /><span>Друзья и ЛС</span></div>
            </div>
          </aside>

          <form className="auth-card auth-card-modern" onSubmit={submitAuth}>
            <div className="auth-tabs" role="tablist" aria-label="Режим авторизации">
              <button
                type="button"
                className={authMode === 'login' ? 'active' : ''}
                onClick={() => setAuthMode('login')}
                disabled={authLoading}
              >
                Вход
              </button>
              <button
                type="button"
                className={authMode === 'register' ? 'active' : ''}
                onClick={() => setAuthMode('register')}
                disabled={authLoading}
              >
                Регистрация
              </button>
            </div>

            <div className="auth-head">
              <h2>{authMode === 'login' ? 'С возвращением' : 'Создать аккаунт'}</h2>
              <p>{authMode === 'login' ? 'Введите почту и пароль для входа.' : 'Имя, уникальная почта и уникальный @username.'}</p>
            </div>

            {authMode === 'register' ? (
              <label className="auth-field">
                <span>Имя</span>
                <div className="auth-input-wrap">
                  <UserIcon size={14} />
                  <input
                    disabled={authLoading}
                    placeholder="Flenym"
                    value={auth.name}
                    onChange={(e) => setAuth((p) => ({...p, name: e.target.value}))}
                  />
                </div>
              </label>
            ) : null}

            {authMode === 'register' ? (
              <label className="auth-field">
                <span>@username</span>
                <div className="auth-input-wrap">
                  <UserIcon size={14} />
                  <input
                    disabled={authLoading}
                    placeholder="@flenym"
                    value={auth.username}
                    onChange={(e) => setAuth((p) => ({...p, username: e.target.value}))}
                  />
                </div>
              </label>
            ) : null}

            <label className="auth-field">
              <span>Почта</span>
              <div className="auth-input-wrap">
                <MailIcon size={14} />
                <input
                  disabled={authLoading}
                  type="email"
                  placeholder="flenym@mail.com"
                  value={auth.email}
                  onChange={(e) => setAuth((p) => ({...p, email: e.target.value}))}
                />
              </div>
            </label>

            <label className="auth-field">
              <span>Пароль</span>
              <div className="auth-input-wrap">
                <KeyIcon size={14} />
                <input
                  disabled={authLoading}
                  type="password"
                  placeholder="Не менее 6 символов"
                  value={auth.password}
                  onChange={(e) => setAuth((p) => ({...p, password: e.target.value}))}
                />
              </div>
            </label>

            {authMode === 'register' ? (
              <label className="auth-field">
                <span>Повторите пароль</span>
                <div className="auth-input-wrap">
                  <KeyIcon size={14} />
                  <input
                    disabled={authLoading}
                    type="password"
                    placeholder="Повторите пароль"
                    value={auth.confirmPassword}
                    onChange={(e) => setAuth((p) => ({...p, confirmPassword: e.target.value}))}
                  />
                </div>
              </label>
            ) : null}

            {authErr ? <div className="error auth-error-box">{authErr}</div> : null}

            <button className="primary-auth auth-submit-btn" type="submit" disabled={authLoading}>
              {authLoading ? 'Подождите...' : (authMode === 'login' ? 'Войти в YOOH' : 'Создать аккаунт')}
            </button>

            <button
              disabled={authLoading}
              type="button"
              className="auth-link auth-link-modern"
              onClick={() => setAuthMode((m) => (m === 'login' ? 'register' : 'login'))}
            >
              {authMode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти'}
            </button>
          </form>
        </div>
      </div>
    );
  }
  if (booting && !me) {
    return (
      <div className="auth-screen">
        <div className="auth-card"><h1>YOOH</h1><p>Загрузка...</p></div>
      </div>
    );
  }

  return (
    <>
      <div className="flux-shell">
        <aside className="guild-rail">
          <button type="button" className={`guild-home ${mode === 'home' ? 'active' : ''}`} onClick={() => { setMode('home'); setHomeTab('dms'); }} title="Друзья и личные сообщения">Y</button>
          <div className="guild-list">
            {servers.map((s) => (
              <button key={s.id} type="button" className={`guild-item ${mode === 'servers' && s.id === sid ? 'active' : ''}`} onClick={() => { setMode('servers'); setSid(s.id); }} title={s.name}>
                {s.iconUrl
                  ? <img src={s.iconUrl} alt={s.name} className="guild-icon-img" />
                  : initials(s.name)}
              </button>
            ))}
          </div>
          <div className="guild-footer">
            <button type="button" className="guild-add" onClick={async () => {
              const values = await openFormModal({
                title: 'Создать сервер',
                submitText: 'Создать',
                fields: [{id: 'name', label: 'Название сервера', placeholder: "Flenym's Server"}]
              });
              const name = String(values?.name || '').trim();
              if (!name) return;
              try { await req('post', '/servers', {name}); await refreshServers(); setMode('servers'); } catch (e) { setUiErr(apiError(e, 'Не удалось создать сервер.')); }
            }}>+</button>
            <button type="button" className="guild-back" onClick={navigateBackToChats} title="Вернуться в чаты">←</button>
          </div>
        </aside>

        <aside className="channels-panel">
          {mode === 'servers' ? (
            <>
              <div className="server-head server-head-menu-wrap" onClick={(e) => e.stopPropagation()}>
                <button
                  type="button"
                  className="server-menu-btn server-menu-btn-rich"
                  onClick={(e) => {
                    e.stopPropagation();
                    setServerMenuOpen((prev) => !prev);
                  }}
                >
                  <span className="server-head-cover" style={serverHeadBannerStyle} />
                  <span className="server-head-content">
                    <span className="server-head-main">
                      {server?.iconUrl
                        ? <img src={server.iconUrl} alt={server?.name || 'Сервер'} className="server-head-avatar" />
                        : <span className="server-head-avatar fallback">{initials(server?.name || 'S')}</span>}
                      <span className="server-name">{server?.name || 'Нет сервера'}</span>
                    </span>
                    <ChevronDownIcon size={14} />
                  </span>
                </button>
                {serverMenuOpen && server ? (
                  <div className="server-menu-dropdown">
                    <button type="button" className="server-menu-item" onClick={() => setUiErr('Буст без подписки не требуется в локальном режиме.')}>
                      <GiftIcon size={15} />
                      <span>Буст сервера</span>
                    </button>
                    {can.manageInvites ? (
                      <button type="button" className="server-menu-item" onClick={createInvite}>
                        <UserGroupIcon size={15} />
                        <span>Пригласить на сервер</span>
                      </button>
                    ) : null}
                    {can.manageServer ? (
                      <button type="button" className="server-menu-item" onClick={() => openServerSettings('profile')}>
                        <SettingsIcon size={15} />
                        <span>Настройки сервера</span>
                      </button>
                    ) : null}
                    {channel ? (
                      <button
                        type="button"
                        className="server-menu-item"
                        onClick={() => {
                          setChannelForm({
                            name: channel.name || '',
                            topic: channel.topic || '',
                            color: channel.color || '#949ba4',
                            section: channel.section || '',
                            kind: channel.kind || 'text',
                            isPrivate: !!channel.isPrivate,
                            allowedRoleIds: Array.isArray(channel.allowedRoleIds) ? channel.allowedRoleIds : []
                          });
                          setChannelOpen(true);
                          setServerMenuOpen(false);
                        }}
                      >
                        <HashIcon size={15} />
                        <span>Настройки текущего канала</span>
                      </button>
                    ) : null}
                    {can.manageChannels ? (
                      <button type="button" className="server-menu-item" onClick={() => createChannelQuick('text')}>
                        <HashIcon size={15} />
                        <span>Создать текстовый канал</span>
                      </button>
                    ) : null}
                    {can.manageChannels ? (
                      <button type="button" className="server-menu-item" onClick={() => createChannelQuick('voice')}>
                        <VolumeIcon size={15} />
                        <span>Создать голосовой канал</span>
                      </button>
                    ) : null}
                    {can.manageChannels ? (
                      <button type="button" className="server-menu-item" onClick={createSectionQuick}>
                        <PlusIcon size={15} />
                        <span>Создать категорию</span>
                      </button>
                    ) : null}
                    {can.manageChannels ? (
                      <button type="button" className="server-menu-item" onClick={createServerEvent}>
                        <BellIcon size={15} />
                        <span>Создать событие</span>
                      </button>
                    ) : null}
                    {can.manageInvites ? (
                      <button type="button" className="server-menu-item" onClick={() => openServerSettings('invites')}>
                        <ShieldIcon size={15} />
                        <span>Параметры приглашений</span>
                      </button>
                    ) : null}
                    {can.manageMembers ? (
                      <button type="button" className="server-menu-item" onClick={() => openServerSettings('bans')}>
                        <BanIcon size={15} />
                        <span>Баны</span>
                      </button>
                    ) : null}
                    {can.manageServer ? (
                      <button type="button" className="server-menu-item" onClick={() => openServerSettings('integrations')}>
                        <PlugIcon size={15} />
                        <span>Интеграции</span>
                      </button>
                    ) : null}
                    <button type="button" className="server-menu-item" onClick={() => openServerSettings('notifications')}>
                      <BellIcon size={15} />
                      <span>Параметры уведомлений</span>
                    </button>
                    {can.manageServer ? (
                      <button type="button" className="server-menu-item" onClick={() => openServerSettings('audit')}>
                        <ShieldIcon size={15} />
                        <span>Журнал аудита</span>
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
              {(server?.events || []).length ? (
                <div className="events-pane">
                  <div className="channels-head">
                    <span>МЕРОПРИЯТИЯ</span>
                    {can.manageChannels ? <button type="button" onClick={createServerEvent}>+</button> : null}
                  </div>
                  <div className="events-list">
                    {(server?.events || []).slice(0, 4).map((event) => (
                      <button key={event.id} type="button" className="event-row" onClick={() => openServerSettings('events')}>
                        <strong>{event.name}</strong>
                        <small>{dateTime(event.startsAt)}</small>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              <div className="channel-list">
                {textSections.map(([sectionName, items]) => (
                  <div className="channel-group" key={`text:${sectionName}`}>
                    <div className="channels-head">
                      <span>{sectionLabel(sectionName)}</span>
                      <button type="button" onClick={() => createChannelQuick('text', sectionName)}>+</button>
                    </div>
                    {items.map((c) => (
                      <button key={c.id} type="button" className={`channel-item ${c.id === cid ? 'active' : ''}`} onClick={() => setCid(c.id)} title={c.topic || c.name}>
                        <span className="hash icon-hash" style={{color: c.color || '#949ba4'}}><HashIcon size={14} /></span><span>{c.name}</span>
                      </button>
                    ))}
                  </div>
                ))}

                {voiceSections.map(([sectionName, items]) => (
                  <div className="channel-group" key={`voice:${sectionName}`}>
                    <div className="channels-head">
                      <span>{sectionLabel(sectionName)}</span>
                      <button type="button" onClick={() => createChannelQuick('voice', sectionName)}>+</button>
                    </div>
                    {items.map((c) => (
                      <div key={c.id} className="voice-channel-wrap">
                        <button
                          type="button"
                          className={`channel-item voice ${voiceCid === c.id ? 'active' : ''}`}
                          onClick={() => joinVoiceChannel(c)}
                          title={`Подключиться к ${c.name}`}
                        >
                          <span className="voice-prefix" style={{color: c.color || '#949ba4'}}>
                            <VolumeIcon size={13} />
                            <MicIcon size={13} />
                          </span>
                          <span className="voice-sep">|</span>
                          <span>{c.name}</span>
                          {voiceCid === c.id ? <span className="voice-live">В ЭФИРЕ</span> : null}
                        </button>
                        {(voiceMembersByChannel.get(c.id) || []).length ? (
                          <div className="voice-members-list">
                            {(voiceMembersByChannel.get(c.id) || []).map((u) => (
                              <button key={`${c.id}:${u.id}`} type="button" className={`voice-member-row ${talkingUserIds.has(u.id) ? 'speaking' : ''}`} onClick={() => openMini(u.id)}>
                                <Avatar user={u} size={26} />
                                <span>{label(u)}</span>
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                ))}

                <div className="channels-head">
                  <span>СОЗДАТЬ РАЗДЕЛ</span>
                  <button type="button" onClick={createSectionQuick}>+</button>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="server-head"><div className="server-name">YOOH</div></div>
              <div className="home-tabs">
                <button type="button" className={homeTab === 'dms' ? 'active icon-wrap' : 'icon-wrap'} onClick={() => setHomeTab('dms')} title="Личные сообщения"><MessageIcon size={14} /><span>ЛС</span></button>
                <button type="button" className={homeTab === 'friends' ? 'active icon-wrap' : 'icon-wrap'} onClick={() => { setHomeTab('friends'); setFriendsView('online'); }} title="Друзья"><UserGroupIcon size={14} /><span>Друзья</span></button>
              </div>
              <div className="home-list">
                <div className="invite-join-box">
                  <input
                    placeholder="Код приглашения"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value)}
                  />
                  <button type="button" onClick={joinByCode}>Войти</button>
                </div>
                {homeTab === 'dms' ? dms.map((d) => (
                  <button key={d.id} type="button" className={`dm-item ${d.id === did ? 'active' : ''}`} onClick={() => setDid(d.id)}>
                    <Avatar user={d.otherUser} />
                    <span className="dm-meta"><strong>{label(d.otherUser)}</strong><small>{d.lastMessage?.content || 'Сообщений пока нет'}</small></span>
                  </button>
                )) : null}
                {homeTab === 'friends' ? (
                  <div className="panel-stack">
                    <div className="panel-box">
                      <h4>Быстрые ЛС</h4>
                      {dms.slice(0, 6).map((d) => (
                        <button key={d.id} type="button" className="friend-user" onClick={() => { setHomeTab('dms'); setDid(d.id); }}>
                          <Avatar user={d.otherUser} />
                          <span>{label(d.otherUser)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </>
          )}
          <div className="me-card">
            <Avatar user={me} />
            <div><div className="me-name">{label(me)}</div><div className="me-tag">{onlineSet.has(me?.id) ? 'В сети' : (sockOn ? 'Синхронизация' : 'Не в сети')}</div></div>
            <div className="me-actions">
              <button type="button" className="logout-btn icon-btn" onClick={() => setProfileOpen(true)} title="Мой профиль"><SettingsIcon size={14} /></button>
              <button type="button" className="logout-btn icon-btn" onClick={logout} title="Выйти"><LogoutIcon size={14} /></button>
            </div>
          </div>
        </aside>

        <main className="chat-panel">
          {isFriendsPage ? (
            <>
              <header className="chat-top friends-top">
                <div className="chat-top-left">
                  <UserGroupIcon size={16} />
                  <strong>Друзья</strong>
                </div>
                <div className="friends-top-tabs">
                  <button type="button" className={friendsView === 'online' ? 'active' : ''} onClick={() => setFriendsView('online')}>В сети</button>
                  <button type="button" className={friendsView === 'all' ? 'active' : ''} onClick={() => setFriendsView('all')}>Все</button>
                  <button type="button" className={friendsView === 'pending' ? 'active' : ''} onClick={() => setFriendsView('pending')}>Ожидание</button>
                  <button type="button" className={friendsView === 'add' ? 'active add' : 'add'} onClick={() => setFriendsView('add')}>Добавить в друзья</button>
                </div>
              </header>

              {backendOffline ? <div className="banner-warn">Игровой backend временно недоступен. Идет автоподключение.</div> : null}
              {uiErr ? <div className="banner-error">{uiErr}<button type="button" className="ghost" onClick={() => setUiErr('')}>Закрыть</button></div> : null}

              <section className="friends-page">
                {friendsView !== 'add' ? (
                  <div className="friends-search-row">
                    <input
                      placeholder="Поиск друзей"
                      value={friendsSearch}
                      onChange={(e) => setFriendsSearch(e.target.value)}
                    />
                    <span className="muted">
                      {friendsView === 'pending' ? `Ожидает: ${pendingRows.length}` : `Найдено: ${visibleFriendRows.length}`}
                    </span>
                  </div>
                ) : null}

                {friendsView === 'add' ? (
                  <div className="friends-add-wrap">
                    <div className="friends-add-card">
                      <h3>Добавить по имени</h3>
                      <p className="muted">Введите точный логин пользователя и отправьте запрос.</p>
                      <div className="friends-add-form">
                        <input
                          placeholder="username"
                          value={friendLookup}
                          onChange={(e) => setFriendLookup(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') addFriendByName();
                          }}
                        />
                        <button type="button" onClick={addFriendByName}>Отправить запрос</button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {friendsView === 'pending' ? (
                  <div className="friends-list">
                    {pendingRows.length ? pendingRows.map((row) => (
                      <div key={`${row.kind}:${row.reqId}`} className="friend-list-row">
                        <button type="button" className="friend-main" onClick={() => openMini(row.user.id)}>
                          <Avatar user={row.user} />
                          <span className="friend-list-meta">
                            <strong>{label(row.user)}</strong>
                            <small>{row.kind === 'incoming' ? 'Входящий запрос' : 'Исходящий запрос'}</small>
                          </span>
                        </button>
                        <div className="friend-row-actions">
                          {row.kind === 'incoming' ? <button type="button" onClick={() => acceptReq(row.reqId)}>Принять</button> : null}
                          <button type="button" className="ghost" onClick={() => declineReq(row.reqId)}>{row.kind === 'incoming' ? 'Отклонить' : 'Отменить'}</button>
                        </div>
                      </div>
                    )) : <div className="empty-state"><p>Нет ожидающих запросов.</p></div>}
                  </div>
                ) : null}

                {(friendsView === 'online' || friendsView === 'all') ? (
                  <div className="friends-list">
                    {visibleFriendRows.length ? visibleFriendRows.map((u) => (
                      <div key={u.id} className="friend-list-row">
                        <button type="button" className="friend-main" onClick={() => openMini(u.id)}>
                          <Avatar user={u} />
                          <span className="friend-list-meta">
                            <strong>{label(u)}</strong>
                            <small>{onlineSet.has(u.id) ? 'В сети' : 'Не в сети'}</small>
                          </span>
                        </button>
                        <div className="friend-row-actions">
                          <button type="button" className="icon-btn friend-action" onClick={() => openDm(u.id)} title="Открыть ЛС"><MessageIcon size={14} /></button>
                          <button type="button" className="danger" onClick={() => removeFriend(u.id)}>Удалить</button>
                        </div>
                      </div>
                    )) : <div className="empty-state"><p>В этом списке друзей нет.</p></div>}
                  </div>
                ) : null}
              </section>
            </>
          ) : (
            <>
              <header className="chat-top">
                <div className="chat-top-left">
                  {scope?.type === 'channel' ? <span className="hash big icon-hash"><HashIcon size={18} /></span> : <span className="hash big icon-hash"><AtIcon size={18} /></span>}
                  <strong className="chat-title" style={{fontSize: 24, fontWeight: 800, lineHeight: 1}}>{scope?.title || (mode === 'home' ? 'Друзья' : 'Канал')}</strong>
                  <span className="pill chat-subtitle" style={{fontSize: 13, padding: '6px 11px'}}>{scope?.subtitle || 'Локальный сервер'}</span>
                </div>
                <div className="chat-top-right">
                  {scope?.type === 'dm' ? (
                    <button
                      type="button"
                      className={(inCurrentCall || outgoingForCurrentDm) ? 'danger icon-only-btn' : 'icon-only-btn'}
                      title={inCurrentCall ? 'Выйти из звонка' : (outgoingForCurrentDm ? 'Отменить вызов' : 'Позвонить')}
                      onClick={() => {
                        if (inCurrentCall) return leaveCall();
                        if (outgoingForCurrentDm) return cancelDmCall();
                        return inviteDmCall();
                      }}
                    >
                      {(inCurrentCall || outgoingForCurrentDm) ? <HangupIcon size={15} /> : <PhoneIcon size={15} />}
                    </button>
                  ) : null}
                  {scope?.type === 'channel' && activeVoiceChannel ? (
                    <button
                      type="button"
                      className={voiceInCall ? 'danger icon-only-btn' : 'icon-only-btn'}
                      title={voiceInCall ? `Выйти из ${activeVoiceChannel.name}` : `Войти в ${activeVoiceChannel.name}`}
                      onClick={() => joinVoiceChannel(activeVoiceChannel)}
                    >
                      {voiceInCall ? <HangupIcon size={15} /> : <PhoneIcon size={15} />}
                    </button>
                  ) : null}
                </div>
              </header>

              {backendOffline ? <div className="banner-warn">Игровой backend временно недоступен. Идет автоподключение.</div> : null}
              {uiErr ? <div className="banner-error">{uiErr}<button type="button" className="ghost" onClick={() => setUiErr('')}>Закрыть</button></div> : null}
              {scope?.type === 'dm' && outgoingForCurrentDm && !inCurrentCall ? (
                <div className="call-pending-banner">
                  <span>Звоним {label(dm?.otherUser)}...</span>
                  <button type="button" className="danger" onClick={cancelDmCall}>Отменить</button>
                </div>
              ) : null}
              {incomingDmCall ? (
                <div className="incoming-call-pop">
                  <div className="incoming-call-card">
                    <div className="incoming-call-head">
                      <Avatar user={incomingDmCall.fromUser} size={48} />
                      <div>
                        <strong>{label(incomingDmCall.fromUser)}</strong>
                        <p>Входящий звонок в личные сообщения</p>
                      </div>
                    </div>
                    <div className="incoming-call-actions">
                      <button
                        type="button"
                        className="ghost"
                        onClick={rejectIncomingDmCall}
                      >
                        Отклонить
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMode('home');
                          setHomeTab('dms');
                          setDid(incomingDmCall.dmChannelId);
                          acceptIncomingDmCall();
                        }}
                      >
                        Принять
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {inCurrentCall ? (
                <section className="call-stage">
                  <div className="call-stage-head">
                    <div className="call-stage-left">
                      <VolumeIcon size={14} />
                      <span>{call?.label || scope?.title || 'Голосовой канал'}</span>
                    </div>
                    <div className="call-stage-right">
                      <UserGroupIcon size={14} />
                      <span>{callTiles.length}</span>
                    </div>
                  </div>

                  {focusedCallTile ? (
                    <div className="call-focus-wrap">
                      <div className="call-focus-main">
                        {renderCallTile(focusedCallTile, false)}
                      </div>
                      {focusedCompactTiles.length ? (
                        <div className="call-focus-dock">
                          <div className="call-filmstrip call-filmstrip-overlay">
                            {focusedCompactTiles.map((tile) => renderCallTile(tile, true))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="call-layout">
                      {videoCallTiles.length ? (
                        <div className="call-grid call-grid-dynamic">
                          {videoCallTiles.map((tile) => renderCallTile(tile, false))}
                        </div>
                      ) : (
                        <div className="call-grid call-grid-dynamic">
                          {audioOnlyCallTiles.map((tile) => renderCallTile(tile, false))}
                        </div>
                      )}
                      {videoCallTiles.length && audioOnlyCallTiles.length ? (
                        <div className="call-audio-strip">
                          {audioOnlyCallTiles.map((tile) => renderCallTile(tile, true))}
                        </div>
                      ) : null}
                    </div>
                  )}

                  <div className="call-toolbar">
                    <button
                      type="button"
                      className={`circle-btn ${micMute ? 'danger' : ''}`}
                      onClick={toggleMic}
                      title={micMute ? 'Включить микрофон' : 'Выключить микрофон'}
                    >
                      {micMute ? <MicOffIcon size={15} /> : <MicIcon size={15} />}
                    </button>
                    <button
                      type="button"
                      className={`circle-btn ${speakerMute ? 'danger' : ''}`}
                      onClick={toggleSpeaker}
                      title={speakerMute ? 'Включить звук' : 'Выключить звук'}
                    >
                      {speakerMute ? <VolumeOffIcon size={15} /> : <VolumeIcon size={15} />}
                    </button>
                    <button
                      type="button"
                      className={`circle-btn ${cameraOn ? 'active' : ''}`}
                      onClick={toggleCamera}
                      title={cameraOn ? 'Выключить камеру' : 'Включить камеру'}
                    >
                      {cameraOn ? <CameraIcon size={15} /> : <CameraOffIcon size={15} />}
                    </button>
                    <button
                      type="button"
                      className={`circle-btn ${screenOn ? 'active' : ''}`}
                      onClick={toggleScreenShare}
                      title={screenOn ? 'Остановить демонстрацию' : 'Начать демонстрацию'}
                    >
                      {screenOn ? <ScreenShareOffIcon size={15} /> : <ScreenShareIcon size={15} />}
                    </button>
                    <button
                      type="button"
                      className={`circle-btn ${watchStreams ? 'active' : ''}`}
                      onClick={() => setWatchStreams((prev) => !prev)}
                      title="Смотреть стрим"
                    >
                      <EyeIcon size={15} />
                    </button>
                    <button type="button" className="circle-btn danger" onClick={() => leaveCall()} title="Отключиться">
                      <HangupIcon size={15} />
                    </button>
                  </div>
                </section>
              ) : (
                <>
                  <section className="message-list" ref={messageListRef} onScroll={onMessageListScroll}>
                    {!scope ? <div className="empty-state"><h2>YOOH</h2><p>Откройте ЛС, друзей или выберите канал.</p></div> : null}
                    {scope && msgLoading ? <div className="empty-state"><p>Загрузка сообщений...</p></div> : null}
                    {scope && !msgLoading && !msgs.length ? <div className="empty-state"><p>Сообщений пока нет.</p></div> : null}
                    {scope && !msgLoading && msgs.map((m) => {
                      const author = known.get(m.userId) || {id: m.userId, username: m.username};
                      const replyMsg = m.replyToId ? msgMap.get(m.replyToId) : null;
                      const reactionEntries = Object.entries(m.reactions || {}).filter(([, userIds]) => Array.isArray(userIds) && userIds.length);
                      const previewUrl = extractFirstUrl(m.content || '');
                      let previewHost = '';
                      if (previewUrl) {
                        try {
                          previewHost = new URL(previewUrl).hostname;
                        } catch {
                          previewHost = previewUrl;
                        }
                      }
                      return (
                        <article key={m.id} id={`msg-${m.id}`} className="message-row">
                          <Avatar user={author} onClick={() => openMini(author.id)} />
                          <div className="message-body">
                            <div className="message-meta"><button type="button" className="message-author" onClick={() => openMini(author.id)}>{label(author)}</button><time>{hhmm(m.createdAt)}</time></div>
                            {m.forwardedFrom ? (
                              <div className="message-forwarded">
                                Переслано от @{m.forwardedFrom.username || 'user'}
                              </div>
                            ) : null}
                            {replyMsg ? (
                              <button
                                type="button"
                                className="message-reply-preview"
                                onClick={() => {
                                  const el = document.getElementById(`msg-${replyMsg.id}`);
                                  el?.scrollIntoView({behavior: 'smooth', block: 'center'});
                                }}
                              >
                                Ответ на: {(replyMsg.content || '').slice(0, 80) || 'вложение'}
                              </button>
                            ) : null}
                            {m.content ? <div className="message-text">{m.content}</div> : null}
                            {previewUrl ? (
                              <a className="link-preview-card" href={previewUrl} target="_blank" rel="noreferrer">
                                <strong>{previewHost}</strong>
                                <span>{previewUrl}</span>
                              </a>
                            ) : null}
                            {Array.isArray(m.attachments) && m.attachments.length ? (
                              <div className="message-attachments">
                                {m.attachments.map((file) => (
                                  file.kind === 'image' ? (
                                    <button
                                      key={file.id}
                                      type="button"
                                      className="message-image-wrap"
                                      onClick={() => setImagePreview(file)}
                                    >
                                      <img src={file.url} alt={file.name || 'image'} className="message-image" />
                                    </button>
                                  ) : file.kind === 'audio' ? (
                                    <div key={file.id} className="message-file-row">
                                      <audio controls src={file.url} />
                                      <a href={file.url} download={file.name || 'voice.webm'} className="ghost inline-link">Скачать</a>
                                    </div>
                                  ) : (
                                    <div key={file.id} className="message-file-row">
                                      <PaperclipIcon size={13} />
                                      <span>{file.name}</span>
                                      <small>{humanSize(file.size)}</small>
                                      <a href={file.url} download={file.name || 'file'} className="ghost inline-link"><DownloadIcon size={12} />Скачать</a>
                                    </div>
                                  )
                                ))}
                              </div>
                            ) : null}
                            <div className="message-actions-row">
                              <button type="button" className="ghost action-mini" onClick={() => setReplyTo(m)} title="Ответить"><ReplyIcon size={12} />Ответ</button>
                              <button type="button" className="ghost action-mini" onClick={() => forwardMessage(m)} title="Переслать"><ForwardIcon size={12} />Переслать</button>
                              <button type="button" className="ghost action-mini" onClick={() => deleteMessage(m, false)} title="Удалить у себя">У себя</button>
                              {m.userId === me?.id ? (
                                <button type="button" className="ghost action-mini danger" onClick={() => deleteMessage(m, true)} title="Удалить у всех">У всех</button>
                              ) : null}
                              <button type="button" className="ghost action-mini" onClick={() => toggleReaction(m.id, '👍')} title="Реакция">👍</button>
                              <button type="button" className="ghost action-mini" onClick={() => toggleReaction(m.id, '😂')} title="Реакция">😂</button>
                              <button type="button" className="ghost action-mini" onClick={() => toggleReaction(m.id, '🔥')} title="Реакция">🔥</button>
                            </div>
                            {reactionEntries.length ? (
                              <div className="message-reactions">
                                {reactionEntries.map(([emoji, userIds]) => (
                                  <button
                                    key={`${m.id}:${emoji}`}
                                    type="button"
                                    className={`reaction-chip ${userIds.includes(me?.id) ? 'active' : ''}`}
                                    onClick={() => toggleReaction(m.id, emoji)}
                                  >
                                    <span>{emoji}</span>
                                    <small>{userIds.length}</small>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        </article>
                      );
                    })}
                  </section>

                  <form className="composer-wrap" onSubmit={sendMsg}>
                    {replyTo ? (
                      <div className="reply-bar">
                        <span>Ответ: {(replyTo.content || 'вложение').slice(0, 120)}</span>
                        <button type="button" className="ghost action-mini" onClick={() => setReplyTo(null)}>Отмена</button>
                      </div>
                    ) : null}
                    {composerFiles.length ? (
                      <div className="composer-files">
                        {composerFiles.map((file) => (
                          <div key={file.id} className="composer-file-chip">
                            <span>{file.kind === 'image' ? '🖼️' : (file.kind === 'audio' ? '🎤' : '📎')}</span>
                            <small>{file.name}</small>
                            <button type="button" className="ghost action-mini" onClick={() => removeComposerFile(file.id)}>✕</button>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {emojiPickerOpen ? (
                      <div className="emoji-picker-pop" ref={emojiPickerRef}>
                        <div className="emoji-picker-tabs">
                          {availableEmojiPacks.map((pack) => (
                            <button
                              key={pack.id}
                              type="button"
                              className={`emoji-tab-btn ${emojiPickerTab === pack.id ? 'active' : ''}`}
                              onClick={() => setEmojiPickerTab(pack.id)}
                            >
                              {pack.name}
                              {pack.sourceServerName ? <small>{pack.sourceServerName}</small> : null}
                            </button>
                          ))}
                        </div>
                        <div className="emoji-picker-grid">
                          {(activeEmojiPack?.emojis || []).map((emoji, idx) => (
                            <button
                              key={`${activeEmojiPack.id}:${idx}`}
                              type="button"
                              className="emoji-pick-btn"
                              onClick={() => appendEmojiToInput(emoji)}
                              title={emoji}
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                    <div className="composer-main-row">
                      <label className="composer-plus" title="Добавить файл">
                        <PaperclipIcon size={14} />
                        <input type="file" multiple onChange={(e) => addComposerFiles(e.target.files)} hidden />
                      </label>
                      <textarea
                        className="composer-input"
                        rows={1}
                        placeholder={scope ? `Сообщение в ${scope.title}` : 'Выберите чат'}
                        disabled={!scope}
                        value={msgInput}
                        onChange={(e) => setMsgInput(e.target.value)}
                        onKeyDown={handleComposerInputKeyDown}
                      />
                      <button type="button" className={`icon-only-btn ${recordingVoice ? 'danger' : ''}`} title="Голосовое сообщение" onClick={toggleVoiceRecord}>
                        {recordingVoice ? <HangupIcon size={12} /> : <MicIcon size={12} />}
                      </button>
                      <button
                        type="button"
                        className={`icon-only-btn ${emojiPickerOpen ? 'active' : ''}`}
                        title="Добавить эмодзи"
                        onClick={() => setEmojiPickerOpen((prev) => !prev)}
                      >
                        <SmileIcon size={14} />
                      </button>
                      <button type="submit" className="icon-only-btn send-btn" title="Отправить" disabled={!scope || (!msgInput.trim() && !composerFiles.length)}><SendIcon size={14} /></button>
                    </div>
                  </form>
                </>
              )}
            </>
          )}
        </main>

        <aside className="members-panel">
          <div className="members-head">
            {isFriendsPage ? 'АКТИВНЫЕ КОНТАКТЫ' : (scope?.type === 'dm' ? 'УЧАСТНИКИ (ЛС)' : 'УЧАСТНИКИ (КАНАЛ)')}
          </div>
          <div className="members-list">
            {isFriendsPage ? (
              activeContacts.length ? activeContacts.map((u) => (
                <button key={u.id} type="button" className="active-contact-card" onClick={() => openMini(u.id)}>
                  <div className="active-contact-top">
                    <Avatar user={u} />
                    <span className="member-name">{label(u)}</span>
                  </div>
                  <div className="active-contact-sub">{u.profile?.statusText || 'Доступен'}</div>
                </button>
              )) : <p className="muted">Активных контактов нет.</p>
            ) : (
              members.map((u) => (
                <button key={u.id} type="button" className={`member-row ${talkingUserIds.has(u.id) ? 'speaking' : ''}`} onClick={() => openMini(u.id)}>
                  <Avatar user={u} />
                  <span className="member-name">
                    {label(u)}
                    <small className={`presence-dot ${onlineSet.has(u.id) ? 'on' : ''}`} />
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>

      {toasts.length ? (
        <div className="toast-stack">
          {toasts.map((toast) => (
            <div key={toast.id} className={`toast-item ${toast.type || 'info'}`}>
              {toast.text}
            </div>
          ))}
        </div>
      ) : null}

      {imagePreview ? (
        <div className="modal-backdrop" onClick={() => setImagePreview(null)}>
          <div className="image-lightbox" onClick={(e) => e.stopPropagation()}>
            <img src={imagePreview.url} alt={imagePreview.name || 'image'} />
            <div className="image-lightbox-actions">
              <a href={imagePreview.url} download={imagePreview.name || 'image'}><DownloadIcon size={14} />Скачать</a>
              <button type="button" onClick={() => setImagePreview(null)}>Закрыть</button>
            </div>
          </div>
        </div>
      ) : null}

      {formModal ? (
        <div className="modal-backdrop" onClick={() => closeFormModal(null)}>
          <div className="modal-card quick-form-modal" onClick={(e) => e.stopPropagation()}>
            <h3>{formModal.title}</h3>
            <div className="quick-form-fields">
              {(formModal.fields || []).map((field) => (
                <label key={field.id}>
                  {field.label}
                  {field.type === 'textarea' ? (
                    <textarea
                      rows={field.rows || 3}
                      value={formModalValues[field.id] ?? ''}
                      placeholder={field.placeholder || ''}
                      onChange={(e) => setFormModalValues((prev) => ({...prev, [field.id]: e.target.value}))}
                    />
                  ) : field.type === 'select' ? (
                    <select
                      value={formModalValues[field.id] ?? ''}
                      onChange={(e) => setFormModalValues((prev) => ({...prev, [field.id]: e.target.value}))}
                    >
                      {(field.options || []).map((option) => (
                        <option key={`${field.id}:${option.value}`} value={option.value}>{option.label}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type={field.type || 'text'}
                      value={formModalValues[field.id] ?? ''}
                      placeholder={field.placeholder || ''}
                      min={field.min}
                      max={field.max}
                      step={field.step}
                      onChange={(e) => setFormModalValues((prev) => ({...prev, [field.id]: e.target.value}))}
                    />
                  )}
                </label>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => closeFormModal(null)}>
                {formModal.cancelText || 'Отмена'}
              </button>
              <button type="button" onClick={() => closeFormModal({...formModalValues})}>
                {formModal.submitText || 'Сохранить'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {imageCropModal ? (
        <div className="modal-backdrop modal-backdrop-top" onClick={() => closeImageCropModal(null)}>
          <div className="modal-card image-crop-modal" onClick={(e) => e.stopPropagation()}>
            <div className="image-crop-head">
              <h3>{imageCropModal.title || 'Редактировать изображение'}</h3>
              <button type="button" className="ghost image-crop-close" onClick={() => closeImageCropModal(null)}>?</button>
            </div>
            <div className="image-crop-stage-wrap">
              <div
                className={`image-crop-stage ${imageCropModal.shape === 'circle' ? 'circle' : ''} ${imageCropModal.shape === 'rounded' ? 'rounded' : ''}`}
                style={{width: imageCropViewport.width, height: imageCropViewport.height}}
                onPointerDown={onImageCropPointerDown}
                onPointerMove={onImageCropPointerMove}
                onPointerUp={onImageCropPointerUp}
                onPointerCancel={onImageCropPointerUp}
              >
                <img
                  src={imageCropModal.sourceUrl}
                  alt="Crop source"
                  className="image-crop-image"
                  draggable="false"
                  style={{
                    width: imageCropImageSize.width || 1,
                    height: imageCropImageSize.height || 1,
                    transform: `translate(calc(-50% + ${imageCropOffset.x}px), calc(-50% + ${imageCropOffset.y}px)) scale(${imageCropRenderScale})`
                  }}
                />
              </div>
            </div>
            <div className="image-crop-controls">
              <span>Масштаб</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={imageCropZoom}
                onChange={(e) => setImageCropZoom(clampNumber(Number(e.target.value || 1), 1, 3))}
              />
              <small>{Math.round(imageCropZoom * 100)}%</small>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => {
                  setImageCropZoom(1);
                  setImageCropOffset({x: 0, y: 0});
                }}
              >
                Сброс
              </button>
              <button type="button" className="ghost" onClick={() => closeImageCropModal(null)}>
                Отмена
              </button>
              <button type="button" onClick={applyImageCrop}>
                Применить
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {profileOpen ? (
        <div className="modal-backdrop" onClick={() => setProfileOpen(false)}>
          <div className="modal-card profile-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Профиль</h3>
            <div className="profile-editor-grid">
              <section className="profile-editor-form">
                <label>Отображаемое имя
                  <input value={profileForm.displayName} onChange={(e) => setProfileForm((p) => ({...p, displayName: e.target.value}))} />
                </label>
                <label>Местоположение
                  <input value={profileForm.location} onChange={(e) => setProfileForm((p) => ({...p, location: e.target.value}))} placeholder="Город, страна" />
                </label>
                <label>Статус
                  <input value={profileForm.statusText} onChange={(e) => setProfileForm((p) => ({...p, statusText: e.target.value}))} placeholder="Что у вас нового?" />
                </label>
                <label>О себе
                  <textarea rows={4} value={profileForm.bio} onChange={(e) => setProfileForm((p) => ({...p, bio: e.target.value}))} />
                </label>
                <div className="two-col">
                  <label>Цвет аватара
                    <input type="color" value={profileForm.avatarColor} onChange={(e) => setProfileForm((p) => ({...p, avatarColor: e.target.value}))} />
                  </label>
                  <label>Цвет баннера
                    <input type="color" value={profileForm.bannerColor} onChange={(e) => setProfileForm((p) => ({...p, bannerColor: e.target.value}))} />
                  </label>
                </div>
                <label>Ссылка на аватар
                  <input value={profileForm.avatarUrl} onChange={(e) => setProfileForm((p) => ({...p, avatarUrl: e.target.value}))} placeholder="https://..." />
                </label>
                <label>Ссылка на баннер
                  <input value={profileForm.bannerUrl} onChange={(e) => setProfileForm((p) => ({...p, bannerUrl: e.target.value}))} placeholder="https://..." />
                </label>
                <div className="modal-actions start">
                  <label className="ghost upload-btn">
                    Загрузить аватар
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        await loadAvatarFile(file);
                      }}
                      hidden
                    />
                  </label>
                  <label className="ghost upload-btn">
                    Загрузить баннер
                    <input
                      type="file"
                      accept="image/*"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = '';
                        await loadBannerFile(file);
                      }}
                      hidden
                    />
                  </label>
                </div>
              </section>
              <aside className="profile-preview">
                <h4>Предпросмотр</h4>
                <div className="profile-card-preview">
                  <div
                    className="profile-card-banner"
                    style={{
                      background: profileForm.bannerUrl
                        ? `center / cover no-repeat url(${profileForm.bannerUrl})`
                        : profileForm.bannerColor
                    }}
                  />
                  <div className="profile-card-body">
                    <div className="profile-card-avatar">
                      <Avatar user={profilePreviewUser} size={74} />
                    </div>
                    <strong>{label(profilePreviewUser)}</strong>
                    <small>@{profilePreviewUser.username}</small>
                    <p>{profileForm.statusText || 'Статус не указан'}</p>
                    <p>{profileForm.bio || 'Описание профиля'}</p>
                  </div>
                </div>
              </aside>
            </div>
            <div className="modal-actions">
              <button type="button" className="ghost" onClick={() => setProfileOpen(false)}>Отмена</button>
              <button type="button" onClick={saveProfile}>Сохранить</button>
            </div>
          </div>
        </div>
      ) : null}

      {channelOpen && channel ? (
        <div className="modal-backdrop" onClick={() => setChannelOpen(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <h3>Настройки канала</h3>
            <label>Название<input value={channelForm.name} onChange={(e) => setChannelForm((p) => ({...p, name: e.target.value}))} /></label>
            <label>Описание<input value={channelForm.topic} onChange={(e) => setChannelForm((p) => ({...p, topic: e.target.value}))} /></label>
            <label>Цвет<input type="color" value={channelForm.color} onChange={(e) => setChannelForm((p) => ({...p, color: e.target.value}))} /></label>
            <label>Раздел (категория)
              <input value={channelForm.section || ''} onChange={(e) => setChannelForm((p) => ({...p, section: e.target.value}))} placeholder="например: ОСНОВНОЕ" />
            </label>
            <label>Тип канала
              <select value={channelForm.kind || 'text'} onChange={(e) => setChannelForm((p) => ({...p, kind: e.target.value === 'voice' ? 'voice' : 'text'}))}>
                <option value="text">Текстовый</option>
                <option value="voice">Голосовой</option>
              </select>
            </label>
            <div className="modal-actions start">
              <button
                type="button"
                className="ghost"
                onClick={async () => {
                  if (!server) return;
                  const values = await openFormModal({
                    title: 'Новый текстовый канал',
                    submitText: 'Создать',
                    fields: [{id: 'name', label: 'Название', placeholder: 'general'}]
                  });
                  const name = String(values?.name || '').trim();
                  if (!name) return;
                  try {
                    await req('post', `/servers/${server.id}/channels`, {name, kind: 'text', section: channelForm.section || 'ТЕКСТОВЫЕ КАНАЛЫ'});
                    await refreshServers();
                  } catch (e) {
                    setUiErr(apiError(e, 'Не удалось создать текстовый канал.'));
                  }
                }}
              >
                + Текстовый в этом разделе
              </button>
              <button
                type="button"
                className="ghost"
                onClick={async () => {
                  if (!server) return;
                  const values = await openFormModal({
                    title: 'Новый голосовой канал',
                    submitText: 'Создать',
                    fields: [{id: 'name', label: 'Название', placeholder: 'Voice 1'}]
                  });
                  const name = String(values?.name || '').trim();
                  if (!name) return;
                  try {
                    await req('post', `/servers/${server.id}/channels`, {name, kind: 'voice', section: channelForm.section || 'ГОЛОСОВЫЕ КАНАЛЫ'});
                    await refreshServers();
                  } catch (e) {
                    setUiErr(apiError(e, 'Не удалось создать голосовой канал.'));
                  }
                }}
              >
                + Голосовой в этом разделе
              </button>
            </div>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={!!channelForm.isPrivate}
                onChange={(e) => setChannelForm((p) => ({...p, isPrivate: e.target.checked}))}
              />
              Приватный канал (доступ по ролям)
            </label>
            {channelForm.isPrivate ? (
              <div className="perm-list">
                {roles.filter((r) => !r.isDefault).map((role) => (
                  <label key={role.id} className="inline-check">
                    <input
                      type="checkbox"
                      checked={channelForm.allowedRoleIds.includes(role.id)}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setChannelForm((prev) => ({
                          ...prev,
                          allowedRoleIds: checked
                            ? [...prev.allowedRoleIds, role.id]
                            : prev.allowedRoleIds.filter((id) => id !== role.id)
                        }));
                      }}
                    />
                    <span style={{color: role.color}}>{role.name}</span>
                  </label>
                ))}
              </div>
            ) : null}
            <div className="modal-actions">
              {canManageCurrentChannel ? <button type="button" className="danger" onClick={deleteChannel}>Удалить канал</button> : null}
              <button type="button" className="ghost" onClick={() => setChannelOpen(false)}>Отмена</button>
              <button type="button" onClick={saveChannel}>Сохранить</button>
            </div>
          </div>
        </div>
      ) : null}

      {serverSettingsOpen && server ? (
        <div className="modal-backdrop" onClick={() => setServerSettingsOpen(false)}>
          <div className="modal-card large server-settings-modal" onClick={(e) => e.stopPropagation()}>
            <aside className="server-settings-sidebar">
              <h3>{server.name}</h3>
              <button type="button" className={serverSettingsTab === 'profile' ? 'active' : ''} onClick={() => setServerSettingsTab('profile')}>Профиль сервера</button>
              <button type="button" className={serverSettingsTab === 'notifications' ? 'active' : ''} onClick={() => setServerSettingsTab('notifications')}>Уведомления</button>
              <button type="button" className={serverSettingsTab === 'events' ? 'active' : ''} onClick={() => setServerSettingsTab('events')}>События</button>
              <button type="button" className={serverSettingsTab === 'roles' ? 'active' : ''} onClick={() => setServerSettingsTab('roles')}>Роли</button>
              <button type="button" className={serverSettingsTab === 'members' ? 'active' : ''} onClick={() => setServerSettingsTab('members')}>Участники</button>
              <button
                type="button"
                className={serverSettingsTab === 'bans' ? 'active' : ''}
                onClick={async () => {
                  setServerSettingsTab('bans');
                  await loadServerBans(server.id);
                }}
              >
                Баны
              </button>
              <button type="button" className={serverSettingsTab === 'invites' ? 'active' : ''} onClick={() => setServerSettingsTab('invites')}>Приглашения</button>
              <button
                type="button"
                className={serverSettingsTab === 'integrations' ? 'active' : ''}
                onClick={async () => {
                  setServerSettingsTab('integrations');
                  await loadServerIntegrations(server.id);
                }}
              >
                Интеграции
              </button>
              <button
                type="button"
                className={serverSettingsTab === 'emojis' ? 'active' : ''}
                onClick={async () => {
                  setServerSettingsTab('emojis');
                  await loadServerEmojiPacks(server.id);
                }}
              >
                Эмодзи
              </button>
              {can.manageServer ? (
                <button
                  type="button"
                  className={serverSettingsTab === 'audit' ? 'active' : ''}
                  onClick={async () => {
                    setServerSettingsTab('audit');
                    try {
                      const {data} = await req('get', `/servers/${server.id}/audit`);
                      setServerAuditRows(data.audit || []);
                    } catch (e) {
                      setUiErr(apiError(e, 'Не удалось загрузить журнал аудита.'));
                    }
                  }}
                >
                  Журнал аудита
                </button>
              ) : null}
            </aside>
            <section className="server-settings-content">
              {serverSettingsTab === 'profile' ? (
                <div className="server-profile-grid">
                  <section className="panel-box">
                    <div className="panel-head">
                      <h4>Профиль сервера</h4>
                    </div>
                    <label>Имя сервера
                      <input
                        value={serverProfileForm.name}
                        disabled={!can.manageServer}
                        onChange={(e) => setServerProfileForm((prev) => ({...prev, name: e.target.value}))}
                      />
                    </label>
                    <label>Тег сервера
                      <input
                        value={serverProfileForm.tag}
                        disabled={!can.manageServer}
                        onChange={(e) => setServerProfileForm((prev) => ({...prev, tag: e.target.value}))}
                        placeholder="например: gaming, coding"
                      />
                    </label>
                    <label>Описание
                      <textarea
                        rows={4}
                        value={serverProfileForm.description}
                        disabled={!can.manageServer}
                        onChange={(e) => setServerProfileForm((prev) => ({...prev, description: e.target.value}))}
                      />
                    </label>
                    <label>Ссылка на иконку
                      <input
                        value={serverProfileForm.iconUrl}
                        disabled={!can.manageServer}
                        onChange={(e) => setServerProfileForm((prev) => ({...prev, iconUrl: e.target.value}))}
                        placeholder="https://..."
                      />
                    </label>
                    <label>Ссылка на баннер
                      <input
                        value={serverProfileForm.bannerUrl}
                        disabled={!can.manageServer}
                        onChange={(e) => setServerProfileForm((prev) => ({...prev, bannerUrl: e.target.value}))}
                        placeholder="https://..."
                      />
                    </label>
                    <label>Цвет баннера
                      <input
                        type="color"
                        value={serverProfileForm.bannerColor}
                        disabled={!can.manageServer}
                        onChange={(e) => setServerProfileForm((prev) => ({...prev, bannerColor: e.target.value}))}
                      />
                    </label>
                    <div className="modal-actions start">
                      <label className="ghost upload-btn">
                        Иконка из файла
                        <input
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            await loadServerIconFile(file);
                          }}
                          hidden
                          disabled={!can.manageServer}
                        />
                      </label>
                      <label className="ghost upload-btn">
                        Баннер из файла
                        <input
                          type="file"
                          accept="image/*"
                          onChange={async (e) => {
                            const file = e.target.files?.[0];
                            e.target.value = '';
                            await loadServerBannerFile(file);
                          }}
                          hidden
                          disabled={!can.manageServer}
                        />
                      </label>
                    </div>
                    <div className="modal-actions">
                      <button type="button" className="ghost" onClick={() => setServerSettingsOpen(false)}>Закрыть</button>
                      <button type="button" disabled={!can.manageServer} onClick={saveServerProfile}>Сохранить</button>
                    </div>
                  </section>
                  <aside className="panel-box server-preview-card">
                    <h4>Предпросмотр</h4>
                    <div className="server-preview-box">
                      <div
                        className="server-preview-banner"
                        style={{
                          background: serverProfileForm.bannerUrl
                            ? `center / cover no-repeat url(${serverProfileForm.bannerUrl})`
                            : (serverProfileForm.bannerColor || '#1f2937')
                        }}
                      />
                      <div className="server-preview-main">
                        {serverProfileForm.iconUrl
                          ? <img src={serverProfileForm.iconUrl} alt={serverProfileForm.name || 'Server'} className="server-preview-icon" />
                          : <div className="server-preview-icon fallback">{initials(serverProfileForm.name || 'S')}</div>}
                        <strong>{serverProfileForm.name || 'Сервер'}</strong>
                        <small>{serverProfileForm.tag ? `#${serverProfileForm.tag}` : 'без тега'}</small>
                        <p>{serverProfileForm.description || 'Описание сервера появится здесь.'}</p>
                      </div>
                    </div>
                  </aside>
                </div>
              ) : null}

              {serverSettingsTab === 'notifications' ? (
                <section className="panel-box">
                  <div className="panel-head">
                    <h4>Параметры уведомлений</h4>
                  </div>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={!!serverPrefsForm.muted}
                      onChange={(e) => setServerPrefsForm((prev) => ({...prev, muted: e.target.checked}))}
                    />
                    Отключить все уведомления сервера
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={!!serverPrefsForm.mentionsOnly}
                      onChange={(e) => setServerPrefsForm((prev) => ({...prev, mentionsOnly: e.target.checked}))}
                    />
                    Получать только упоминания
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={!!serverPrefsForm.desktopEnabled}
                      onChange={(e) => setServerPrefsForm((prev) => ({...prev, desktopEnabled: e.target.checked}))}
                    />
                    Показывать desktop-уведомления
                  </label>
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={!!serverPrefsForm.soundEnabled}
                      onChange={(e) => setServerPrefsForm((prev) => ({...prev, soundEnabled: e.target.checked}))}
                    />
                    Включить звук уведомлений
                  </label>
                  <div className="modal-actions">
                    <button type="button" onClick={saveServerPrefs}>Сохранить</button>
                  </div>
                </section>
              ) : null}

              {serverSettingsTab === 'events' ? (
                <section className="panel-box">
                  <div className="panel-head">
                    <h4>События сервера</h4>
                    {can.manageChannels ? <button type="button" onClick={createServerEvent}>Создать событие</button> : null}
                  </div>
                  {(server.events || []).length ? (
                    <div className="events-list settings-events-list">
                      {(server.events || []).map((event) => (
                        <div key={event.id} className="event-settings-row">
                          <div className="event-settings-meta">
                            <strong>{event.name}</strong>
                            <small>{dateTime(event.startsAt)}</small>
                            <p>{event.description || 'Без описания'}</p>
                          </div>
                          {can.manageChannels ? (
                            <button type="button" className="danger" onClick={() => deleteServerEvent(event.id)}>Удалить</button>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Событий пока нет.</p>
                  )}
                </section>
              ) : null}

              {serverSettingsTab === 'roles' ? (
                <section className="panel-box">
                  <div className="panel-head">
                    <h4>Роли</h4>
                    {can.manageRoles ? <button type="button" onClick={createRole}>+ Роль</button> : null}
                  </div>
                  {roles.map((role) => (
                    <div key={role.id} className="role-row">
                      <div className="role-title">
                        <span style={{color: role.color}}>{role.name}</span>
                      </div>
                      <div className="role-actions">
                        {can.manageRoles && !role.isDefault ? <button type="button" className="ghost" onClick={() => updateRoleMeta(role)}>Изменить</button> : null}
                        {can.manageRoles && !role.isDefault ? <button type="button" className="danger" onClick={() => deleteRole(role.id)}>Удалить</button> : null}
                      </div>
                      <div className="perm-grid">
                        {['manageServer', 'manageChannels', 'manageMembers', 'manageRoles', 'manageInvites'].map((key) => (
                          <button
                            key={key}
                            type="button"
                            className={role.permissions?.[key] ? 'perm-on' : 'perm-off'}
                            disabled={!can.manageRoles || role.isDefault}
                            onClick={() => toggleRolePermission(role, key)}
                          >
                            {permissionLabels[key] || key}: {role.permissions?.[key] ? 'вкл' : 'выкл'}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ) : null}

              {serverSettingsTab === 'members' ? (
                <section className="panel-box">
                  <div className="panel-head">
                    <h4>Участники</h4>
                  </div>
                  {(server.members || []).map((member) => (
                    <div key={member.id} className="member-settings-row">
                      <div className="member-info">
                        <Avatar user={member} size={24} />
                        <span>{label(member)}</span>
                      </div>
                      <div className="perm-list">
                        {roles.filter((r) => !r.isDefault).map((role) => (
                          <label key={role.id} className="inline-check">
                            <input
                              type="checkbox"
                              disabled={!can.manageMembers || member.id === server.ownerId}
                              checked={(memberRoleMap.get(member.id) || []).includes(role.id)}
                              onChange={() => toggleMemberRole(member.id, role.id)}
                            />
                            <span style={{color: role.color}}>{role.name}</span>
                          </label>
                        ))}
                      </div>
                      {can.manageMembers && member.id !== server.ownerId ? (
                        <div className="member-admin-actions">
                          <button type="button" className="ghost" onClick={() => banMember(member.id)}>Бан</button>
                          <button type="button" className="danger" onClick={() => kickMember(member.id)}>Кик</button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </section>
              ) : null}

              {serverSettingsTab === 'bans' ? (
                <section className="panel-box">
                  <div className="panel-head">
                    <h4>Баны сервера</h4>
                    <button
                      type="button"
                      className="ghost"
                      onClick={() => loadServerBans(server.id)}
                    >
                      Обновить
                    </button>
                  </div>
                  {serverBans.length ? (
                    <div className="audit-list">
                      {serverBans.map((ban) => (
                        <div key={ban.id} className="audit-row">
                          <div>
                            <strong>{ban.user ? label(ban.user) : ban.userId}</strong>
                            <p>{ban.reason || 'Причина не указана'}</p>
                          </div>
                          <div className="audit-meta">
                            <small>{ban.actor ? label(ban.actor) : 'Система'}</small>
                            <small>{dateTime(ban.createdAt)}</small>
                            <button type="button" className="ghost" onClick={() => unbanMember(ban.id)}>Разбанить</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Список банов пуст.</p>
                  )}
                </section>
              ) : null}

              {serverSettingsTab === 'invites' ? (
                <section className="panel-box">
                  <div className="panel-head">
                    <h4>Приглашения</h4>
                    {can.manageInvites ? <button type="button" onClick={createInvite}>Создать приглашение</button> : null}
                  </div>
                  {can.manageInvites ? (
                    <ServerInvites serverId={server.id} req={req} revokeInvite={revokeInvite} />
                  ) : (
                    <p className="muted">Нет прав на управление приглашениями.</p>
                  )}
                </section>
              ) : null}

              {serverSettingsTab === 'integrations' ? (
                <section className="panel-box">
                  <div className="panel-head">
                    <h4>Интеграции</h4>
                    <button type="button" onClick={createIntegration}>Добавить</button>
                  </div>
                  {serverIntegrations.length ? (
                    <div className="audit-list">
                      {serverIntegrations.map((integration) => (
                        <div key={integration.id} className="audit-row">
                          <div>
                            <strong>{integration.name}</strong>
                            <p>{integration.type}{integration.url ? ` | ${integration.url}` : ''}</p>
                          </div>
                          <div className="audit-meta">
                            <small>{integration.enabled ? 'Активна' : 'Отключена'}</small>
                            <small>{dateTime(integration.createdAt)}</small>
                            <div className="member-admin-actions">
                              <button type="button" className="ghost" onClick={() => toggleIntegration(integration)}>{integration.enabled ? 'Выключить' : 'Включить'}</button>
                              <button type="button" className="danger" onClick={() => removeIntegration(integration.id)}>Удалить</button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Интеграций пока нет.</p>
                  )}
                </section>
              ) : null}

              {serverSettingsTab === 'emojis' ? (
                <section className="panel-box">
                  <div className="panel-head">
                    <h4>Наборы эмодзи</h4>
                    {can.manageServer ? <button type="button" onClick={createEmojiPack}>Новый набор</button> : null}
                  </div>
                  {serverEmojiPacks.length ? (
                    <div className="emoji-pack-list">
                      {serverEmojiPacks.map((pack) => (
                        <div key={pack.id} className="emoji-pack-row">
                          <div className="emoji-pack-meta">
                            <strong>{pack.name}</strong>
                            <div className="emoji-pack-preview">
                              {(pack.emojis || []).slice(0, 24).map((emoji, idx) => (
                                <span key={`${pack.id}:${idx}`} className="emoji-chip">{emoji}</span>
                              ))}
                            </div>
                          </div>
                          {can.manageServer ? (
                            <div className="member-admin-actions">
                              <button type="button" className="ghost" onClick={() => editEmojiPack(pack)}>Изменить</button>
                              <button type="button" className="danger" onClick={() => deleteEmojiPack(pack.id)}>Удалить</button>
                            </div>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Пока нет кастомных наборов. Используется стандартный набор.</p>
                  )}
                </section>
              ) : null}

              {serverSettingsTab === 'audit' ? (
                <section className="panel-box">
                  <div className="panel-head">
                    <h4>Журнал аудита</h4>
                    <button
                      type="button"
                      className="ghost"
                      onClick={async () => {
                        try {
                          const {data} = await req('get', `/servers/${server.id}/audit`);
                          setServerAuditRows(data.audit || []);
                        } catch (e) {
                          setUiErr(apiError(e, 'Не удалось загрузить журнал аудита.'));
                        }
                      }}
                    >
                      Обновить
                    </button>
                  </div>
                  {serverAuditRows.length ? (
                    <div className="audit-list">
                      {serverAuditRows.map((entry) => (
                        <div key={entry.id} className="audit-row">
                          <div>
                            <strong>{entry.action}</strong>
                            <p>{entry.details || 'Без деталей'}</p>
                          </div>
                          <div className="audit-meta">
                            <small>{entry.actor ? label(entry.actor) : 'Система'}</small>
                            <small>{dateTime(entry.createdAt)}</small>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="muted">Записей пока нет.</p>
                  )}
                </section>
              ) : null}
            </section>
          </div>
        </div>
      ) : null}

      {mini ? (
        <div className="modal-backdrop" onClick={() => setMini(null)}>
          <div className="mini-profile" onClick={(e) => e.stopPropagation()}>
            <div
              className="mini-banner"
              style={{
                background: mini.profile.profile?.bannerUrl
                  ? `center / cover no-repeat url(${mini.profile.profile?.bannerUrl})`
                  : (mini.profile.profile?.bannerColor || '#1e1f22')
              }}
            />
            <div className="mini-content">
              <Avatar user={mini.profile} size={56} />
              <h4>{label(mini.profile)}</h4>
              <p className="muted">@{mini.profile.username}</p>
              <p>{mini.profile.profile?.bio || 'Нет описания'}</p>
              <p className="muted">{mini.profile.profile?.statusText || 'Статус не указан'}</p>
              {mini.relation !== 'self' ? (
                <div className="modal-actions">
                  {mini.relation === 'none' ? <button type="button" onClick={() => addFriend(mini.profile.id)}>Добавить в друзья</button> : null}
                  {mini.relation === 'incoming' && incomingReq(mini.profile.id) ? <button type="button" onClick={() => acceptReq(incomingReq(mini.profile.id).id)}>Принять запрос</button> : null}
                  {mini.relation === 'outgoing' && outgoingReq(mini.profile.id) ? <button type="button" onClick={() => declineReq(outgoingReq(mini.profile.id).id)}>Отменить запрос</button> : null}
                  {mini.relation === 'friends' ? <button type="button" onClick={() => openDm(mini.profile.id)}>Открыть ЛС</button> : null}
                  {mini.relation === 'friends' ? <button type="button" className="danger" onClick={() => removeFriend(mini.profile.id)}>Удалить из друзей</button> : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
