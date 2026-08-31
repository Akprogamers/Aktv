import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Camera, Upload, Calendar as CalIcon, LayoutGrid, SlidersHorizontal,
  Film, Settings as SettingsIcon, Flame, Trophy, TrendingUp, Sun, Moon,
  Monitor, X, Download, Trash2, RefreshCw, Share2, Maximize2, Check,
  ChevronLeft, ChevronRight, Play, Pause, Loader2, ImageOff
} from "lucide-react";

/* ---------------------------------------------------------------
   Gym Progress Tracker
   Client-side demo: challenge setup, daily photo capture w/
   compression, calendar, streak dashboard, before/after slider,
   gallery, and an in-browser timelapse (canvas -> recorded video).
   Data persists via window.storage (personal, per-user).
--------------------------------------------------------------- */

const STORAGE_KEY = "gpt:challenge-v1";
const PHOTOS_PREFIX = "gpt:photo:";

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function fmtDate(d) {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function dayKeyFromIndex(startDate, index) {
  const d = new Date(startDate);
  d.setDate(d.getDate() + index);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function diffDays(a, b) {
  const MS = 86400000;
  return Math.round((new Date(b) - new Date(a)) / MS);
}

/* ---------------- Image compression ---------------- */
function compressImage(file, maxDim = 900, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.onload = () => {
        let { width, height } = img;
        if (width > height && width > maxDim) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else if (height > maxDim) {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ---------------- Theme ---------------- */
function useTheme() {
  const [mode, setMode] = useState("dark"); // dark | light | auto
  const [resolved, setResolved] = useState("dark");

  useEffect(() => {
    let saved;
    try { saved = localStorage.getItem("__unused"); } catch (e) { /* artifacts: no localStorage */ }
  }, []);

  useEffect(() => {
    if (mode === "auto") {
      const mql = window.matchMedia("(prefers-color-scheme: dark)");
      const apply = () => setResolved(mql.matches ? "dark" : "light");
      apply();
      mql.addEventListener?.("change", apply);
      return () => mql.removeEventListener?.("change", apply);
    }
    setResolved(mode);
  }, [mode]);

  return { mode, setMode, resolved };
}

/* ---------------- Root App ---------------- */
export default function App() {
  const { mode, setMode, resolved } = useTheme();
  const isDark = resolved === "dark";

  const [challenge, setChallenge] = useState(null);
  const [photos, setPhotos] = useState({}); // dayIndex -> {url, ts}
  const [tab, setTab] = useState("dashboard");
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [lightbox, setLightbox] = useState(null); // dayIndex

  const showToast = useCallback((msg, kind = "ok") => {
    setToast({ msg, kind, id: uid() });
    setTimeout(() => setToast((t) => (t && t.msg === msg ? null : t)), 2600);
  }, []);

  /* ---- load persisted state ---- */
  useEffect(() => {
    (async () => {
      try {
        const res = await window.storage.get(STORAGE_KEY, false);
        if (res && res.value) {
          const parsed = JSON.parse(res.value);
          setChallenge(parsed);
          if (parsed && typeof parsed.totalDays === "number") {
            const entries = {};
            const keys = await window.storage.list(PHOTOS_PREFIX, false);
            if (keys && keys.keys) {
              await Promise.all(
                keys.keys.map(async (k) => {
                  try {
                    const r = await window.storage.get(k, false);
                    if (r && r.value) {
                      const idx = k.replace(PHOTOS_PREFIX, "");
                      entries[idx] = JSON.parse(r.value);
                    }
                  } catch (e) { /* skip */ }
                })
              );
            }
            setPhotos(entries);
          }
        }
      } catch (e) {
        /* no saved challenge yet */
      }
      setLoading(false);
    })();
  }, []);

  const saveChallenge = useCallback(async (next) => {
    setChallenge(next);
    try {
      await window.storage.set(STORAGE_KEY, JSON.stringify(next), false);
    } catch (e) {
      showToast("Could not save challenge data", "err");
    }
  }, [showToast]);

  const savePhoto = useCallback(async (dayIndex, entry) => {
    setPhotos((p) => ({ ...p, [dayIndex]: entry }));
    try {
      await window.storage.set(PHOTOS_PREFIX + dayIndex, JSON.stringify(entry), false);
    } catch (e) {
      showToast("Could not save photo", "err");
    }
  }, [showToast]);

  const deletePhoto = useCallback(async (dayIndex) => {
    setPhotos((p) => {
      const next = { ...p };
      delete next[dayIndex];
      return next;
    });
    try {
      await window.storage.delete(PHOTOS_PREFIX + dayIndex, false);
    } catch (e) { /* ignore */ }
  }, []);

  /* ---- derived challenge stats ---- */
  const stats = useMemo(() => {
    if (!challenge) return null;
    const start = new Date(challenge.startDate);
    const today = new Date(todayISO());
    let currentDay = diffDays(start, today) + 1;
    currentDay = Math.min(Math.max(currentDay, 1), challenge.totalDays);
    const remaining = Math.max(challenge.totalDays - currentDay, 0);
    const uploadedCount = Object.keys(photos).length;
    const missingCount = Math.max(currentDay - uploadedCount, 0);
    const completionPct = Math.round((uploadedCount / challenge.totalDays) * 100);

    // streaks
    let streak = 0;
    let longest = 0;
    let run = 0;
    for (let i = 0; i < challenge.totalDays; i++) {
      if (photos[i]) {
        run += 1;
        longest = Math.max(longest, run);
      } else {
        run = 0;
      }
    }
    for (let i = currentDay - 1; i >= 0; i--) {
      if (photos[i]) streak += 1;
      else break;
    }

    const isOver = diffDays(start, today) + 1 > challenge.totalDays;
    const uploadedToday = !!photos[currentDay - 1] && !isOver;

    return { currentDay, remaining, uploadedCount, missingCount, completionPct, streak, longest, isOver, uploadedToday };
  }, [challenge, photos]);

  const themeVars = isDark
    ? {
        bg: "#08090a", panel: "rgba(255,255,255,0.04)", panelBorder: "rgba(255,255,255,0.08)",
        text: "#f2f4f2", sub: "#9aa39a", accent: "#a6ff3d", accent2: "#5cf2a3",
        danger: "#ff6b6b", cardShadow: "0 8px 32px rgba(0,0,0,0.45)"
      }
    : {
        bg: "#f4f6f3", panel: "rgba(255,255,255,0.7)", panelBorder: "rgba(0,0,0,0.08)",
        text: "#10130f", sub: "#5b655a", accent: "#3fae1f", accent2: "#1f9d6e",
        danger: "#d6453b", cardShadow: "0 8px 24px rgba(0,0,0,0.08)"
      };

  if (loading) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#08090a", color: "#a6ff3d" }}>
        <Loader2 className="spin" size={28} />
        <style>{`.spin{animation:spin 1s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", background: themeVars.bg, color: themeVars.text,
      fontFamily: "'Inter', system-ui, sans-serif", transition: "background .3s,color .3s",
      paddingBottom: 84
    }}>
      <GlobalStyle isDark={isDark} accent={themeVars.accent} />
      <TopBar
        challenge={challenge}
        stats={stats}
        theme={themeVars}
        mode={mode}
        setMode={setMode}
      />

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "16px" }}>
        {!challenge ? (
          <ChallengeSetup theme={themeVars} onCreate={(c) => { saveChallenge(c); showToast("Challenge created — day 1 starts today 💪"); }} />
        ) : (
          <>
            {tab === "dashboard" && (
              <Dashboard theme={themeVars} challenge={challenge} stats={stats} photos={photos}
                onGoUpload={() => setTab("upload")} />
            )}
            {tab === "upload" && (
              <UploadPanel theme={themeVars} challenge={challenge} stats={stats} photos={photos}
                onSave={savePhoto} showToast={showToast} />
            )}
            {tab === "calendar" && (
              <CalendarView theme={themeVars} challenge={challenge} photos={photos}
                onOpenDay={(i) => setLightbox(i)} />
            )}
            {tab === "gallery" && (
              <GalleryView theme={themeVars} challenge={challenge} photos={photos}
                onDelete={deletePhoto} onOpenDay={(i) => setLightbox(i)} showToast={showToast}
                onReplace={savePhoto} />
            )}
            {tab === "compare" && (
              <ComparePanel theme={themeVars} challenge={challenge} photos={photos} />
            )}
            {tab === "timelapse" && (
              <TimelapsePanel theme={themeVars} challenge={challenge} photos={photos} isDark={isDark} showToast={showToast} />
            )}
            {tab === "settings" && (
              <SettingsPanel theme={themeVars} challenge={challenge} onReset={() => {
                setChallenge(null); setPhotos({});
                window.storage.delete(STORAGE_KEY, false).catch(() => {});
              }} />
            )}
          </>
        )}
      </main>

      {challenge && (
        <BottomNav tab={tab} setTab={setTab} theme={themeVars} uploadedToday={stats?.uploadedToday} />
      )}

      {lightbox !== null && photos[lightbox] && (
        <Lightbox
          theme={themeVars}
          dayIndex={lightbox}
          entry={photos[lightbox]}
          challenge={challenge}
          onClose={() => setLightbox(null)}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", left: "50%", bottom: 96, transform: "translateX(-50%)",
          background: toast.kind === "err" ? "#3a1414" : "rgba(20,26,20,0.92)",
          border: `1px solid ${toast.kind === "err" ? "#ff6b6b55" : themeVars.accent + "55"}`,
          color: themeVars.text, padding: "10px 16px", borderRadius: 12, fontSize: 13.5,
          zIndex: 200, backdropFilter: "blur(8px)", maxWidth: "88%", textAlign: "center"
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function GlobalStyle({ isDark, accent }) {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700;800&family=Inter:wght@400;500;600;700;800&display=swap');
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      body { margin: 0; }
      ::selection { background: ${accent}55; }
      button { font-family: inherit; cursor: pointer; }
      input, select { font-family: inherit; }
      input[type="range"] {
        -webkit-appearance: none; appearance: none; height: 4px; border-radius: 4px;
        background: ${accent}33; outline: none;
      }
      input[type="range"]::-webkit-slider-thumb {
        -webkit-appearance: none; width: 20px; height: 20px; border-radius: 50%;
        background: ${accent}; box-shadow: 0 0 12px ${accent}aa; cursor: grab; border: 2px solid #08090a;
      }
      .glass {
        background: ${isDark ? "rgba(255,255,255,0.045)" : "rgba(255,255,255,0.65)"};
        border: 1px solid ${isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)"};
        backdrop-filter: blur(14px);
        -webkit-backdrop-filter: blur(14px);
      }
      @keyframes pulseGlow { 0%,100%{opacity:1} 50%{opacity:.55} }
      @keyframes fadeUp { from{opacity:0; transform:translateY(6px)} to{opacity:1; transform:translateY(0)} }
      .fadeUp { animation: fadeUp .35s ease both; }
      @media (prefers-reduced-motion: reduce) {
        .fadeUp { animation: none !important; }
      }
    `}</style>
  );
}

/* ---------------- Top Bar ---------------- */
function TopBar({ challenge, stats, theme, mode, setMode }) {
  return (
    <div className="glass" style={{
      position: "sticky", top: 0, zIndex: 50, padding: "14px 16px",
      display: "flex", alignItems: "center", justifyContent: "space-between"
    }}>
      <div>
        <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontWeight: 700, fontSize: 17, letterSpacing: -0.3 }}>
          {challenge ? challenge.name : "Gym Progress Tracker"}
        </div>
        {challenge && stats && (
          <div style={{ fontSize: 12, color: theme.sub, marginTop: 2 }}>
            Day {stats.currentDay} / {challenge.totalDays} · {stats.remaining} days left
          </div>
        )}
      </div>
      <ThemeToggle mode={mode} setMode={setMode} theme={theme} />
    </div>
  );
}

function ThemeToggle({ mode, setMode, theme }) {
  const opts = [
    { k: "light", Icon: Sun },
    { k: "auto", Icon: Monitor },
    { k: "dark", Icon: Moon },
  ];
  return (
    <div className="glass" style={{ display: "flex", borderRadius: 999, padding: 3, gap: 2 }}>
      {opts.map(({ k, Icon }) => (
        <button key={k} onClick={() => setMode(k)}
          style={{
            border: "none", borderRadius: 999, padding: "6px 8px",
            background: mode === k ? theme.accent : "transparent",
            color: mode === k ? "#08090a" : theme.sub,
            display: "grid", placeItems: "center"
          }}>
          <Icon size={14} />
        </button>
      ))}
    </div>
  );
}

/* ---------------- Bottom Nav ---------------- */
function BottomNav({ tab, setTab, theme, uploadedToday }) {
  const items = [
    { k: "dashboard", label: "Home", Icon: TrendingUp },
    { k: "upload", label: "Upload", Icon: Camera },
    { k: "calendar", label: "Calendar", Icon: CalIcon },
    { k: "gallery", label: "Gallery", Icon: LayoutGrid },
    { k: "compare", label: "Compare", Icon: SlidersHorizontal },
    { k: "timelapse", label: "Video", Icon: Film },
    { k: "settings", label: "Settings", Icon: SettingsIcon },
  ];
  return (
    <nav className="glass" style={{
      position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 50,
      display: "flex", overflowX: "auto", padding: "8px 6px",
      borderTop: `1px solid ${theme.panelBorder}`
    }}>
      {items.map(({ k, label, Icon }) => {
        const active = tab === k;
        return (
          <button key={k} onClick={() => setTab(k)} style={{
            flex: "1 0 64px", display: "flex", flexDirection: "column", alignItems: "center",
            gap: 3, border: "none", background: "transparent", padding: "6px 4px",
            color: active ? theme.accent : theme.sub, position: "relative"
          }}>
            <Icon size={19} strokeWidth={active ? 2.4 : 1.9} />
            <span style={{ fontSize: 10, fontWeight: active ? 700 : 500 }}>{label}</span>
            {k === "upload" && !uploadedToday && (
              <span style={{
                position: "absolute", top: 2, right: "28%", width: 7, height: 7, borderRadius: "50%",
                background: theme.danger, boxShadow: `0 0 6px ${theme.danger}`
              }} />
            )}
          </button>
        );
      })}
    </nav>
  );
}

/* ---------------- Challenge Setup ---------------- */
function ChallengeSetup({ theme, onCreate }) {
  const [name, setName] = useState("My Transformation");
  const [startDate, setStartDate] = useState(todayISO());
  const [preset, setPreset] = useState(60);
  const [custom, setCustom] = useState("");

  const totalDays = preset === "custom" ? (parseInt(custom, 10) || 0) : preset;

  return (
    <div className="glass fadeUp" style={{ borderRadius: 20, padding: 22, marginTop: 12, boxShadow: theme.cardShadow }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
        <div style={{
          width: 42, height: 42, borderRadius: 12, display: "grid", placeItems: "center",
          background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent2})`
        }}>
          <Flame size={22} color="#08090a" />
        </div>
        <div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 19, fontWeight: 700 }}>Start your challenge</div>
          <div style={{ fontSize: 12.5, color: theme.sub }}>One photo a day. Watch it add up.</div>
        </div>
      </div>

      <Field label="Challenge name" theme={theme}>
        <input value={name} onChange={(e) => setName(e.target.value)}
          style={inputStyle(theme)} placeholder="e.g. Summer Cut" />
      </Field>

      <Field label="Start date" theme={theme}>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
          style={inputStyle(theme)} />
      </Field>

      <Field label="Duration" theme={theme}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
          {[30, 60, 90, 180].map((d) => (
            <button key={d} onClick={() => setPreset(d)} style={{
              padding: "10px 0", borderRadius: 10, border: `1px solid ${preset === d ? theme.accent : theme.panelBorder}`,
              background: preset === d ? theme.accent + "22" : "transparent", color: theme.text,
              fontWeight: 700, fontSize: 13.5
            }}>{d}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={() => setPreset("custom")} style={{
            padding: "10px 14px", borderRadius: 10, whiteSpace: "nowrap",
            border: `1px solid ${preset === "custom" ? theme.accent : theme.panelBorder}`,
            background: preset === "custom" ? theme.accent + "22" : "transparent", color: theme.text, fontSize: 13.5, fontWeight: 600
          }}>Custom</button>
          {preset === "custom" && (
            <input type="number" min={1} max={999} value={custom} onChange={(e) => setCustom(e.target.value)}
              placeholder="Number of days" style={{ ...inputStyle(theme), marginBottom: 0 }} />
          )}
        </div>
      </Field>

      <div style={{ fontSize: 12.5, color: theme.sub, margin: "10px 2px 18px" }}>
        {totalDays > 0 ? `Ends ${fmtDate(new Date(new Date(startDate).getTime() + (totalDays - 1) * 86400000))}` : "Pick a duration to see your end date"}
      </div>

      <button
        disabled={!name.trim() || !totalDays}
        onClick={() => onCreate({ id: uid(), name: name.trim(), startDate, totalDays })}
        style={{
          width: "100%", padding: "14px 0", borderRadius: 14, border: "none",
          background: (!name.trim() || !totalDays) ? theme.panelBorder : `linear-gradient(135deg, ${theme.accent}, ${theme.accent2})`,
          color: "#08090a", fontWeight: 800, fontSize: 15, letterSpacing: 0.2,
          opacity: (!name.trim() || !totalDays) ? 0.5 : 1
        }}>
        Create challenge
      </button>
    </div>
  );
}

function Field({ label, children, theme }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ fontSize: 12, color: theme.sub, fontWeight: 600, display: "block", marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function inputStyle(theme) {
  return {
    width: "100%", padding: "11px 12px", borderRadius: 10,
    border: `1px solid ${theme.panelBorder}`, background: "transparent",
    color: theme.text, fontSize: 14.5, outline: "none", marginBottom: 0
  };
}

/* ---------------- Dashboard ---------------- */
function Dashboard({ theme, challenge, stats, photos, onGoUpload }) {
  const r = 54, c = 2 * Math.PI * r;
  const pct = stats.completionPct / 100;

  return (
    <div className="fadeUp" style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 12 }}>
      <div className="glass" style={{ borderRadius: 20, padding: 22, boxShadow: theme.cardShadow, display: "flex", alignItems: "center", gap: 20 }}>
        <svg width="132" height="132" viewBox="0 0 132 132" style={{ flexShrink: 0 }}>
          <circle cx="66" cy="66" r={r} fill="none" stroke={theme.panelBorder} strokeWidth="10" />
          <circle cx="66" cy="66" r={r} fill="none" stroke={theme.accent} strokeWidth="10"
            strokeDasharray={c} strokeDashoffset={c - c * pct} strokeLinecap="round"
            transform="rotate(-90 66 66)" style={{ filter: `drop-shadow(0 0 6px ${theme.accent}aa)`, transition: "stroke-dashoffset .6s ease" }} />
          <text x="66" y="60" textAnchor="middle" fontSize="24" fontWeight="800" fill={theme.text} fontFamily="'Space Grotesk', sans-serif">
            {stats.completionPct}%
          </text>
          <text x="66" y="80" textAnchor="middle" fontSize="11" fill={theme.sub}>complete</text>
        </svg>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, color: theme.sub }}>Day</div>
          <div style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 30, fontWeight: 800, lineHeight: 1.1 }}>
            {stats.currentDay}<span style={{ fontSize: 16, color: theme.sub, fontWeight: 600 }}> / {challenge.totalDays}</span>
          </div>
          <div style={{ fontSize: 12.5, color: theme.sub, marginTop: 4 }}>{stats.remaining} days remaining</div>
          {!stats.uploadedToday && !stats.isOver && (
            <button onClick={onGoUpload} style={{
              marginTop: 10, border: "none", borderRadius: 10, padding: "8px 14px",
              background: theme.accent, color: "#08090a", fontWeight: 700, fontSize: 12.5,
              display: "inline-flex", alignItems: "center", gap: 6
            }}>
              <Camera size={14} /> Upload today
            </button>
          )}
          {stats.uploadedToday && (
            <div style={{ marginTop: 10, display: "inline-flex", alignItems: "center", gap: 6, color: theme.accent2, fontSize: 12.5, fontWeight: 700 }}>
              <Check size={14} /> Today logged
            </div>
          )}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <StatCard theme={theme} Icon={Flame} label="Current streak" value={`${stats.streak} ${stats.streak === 1 ? "day" : "days"}`} accent={theme.accent} />
        <StatCard theme={theme} Icon={Trophy} label="Longest streak" value={`${stats.longest} ${stats.longest === 1 ? "day" : "days"}`} accent={theme.accent2} />
        <StatCard theme={theme} Icon={Check} label="Uploaded" value={`${stats.uploadedCount} photos`} accent={theme.accent} />
        <StatCard theme={theme} Icon={ImageOff} label="Missing" value={`${stats.missingCount} days`} accent={theme.danger} />
      </div>

      {stats.isOver && (
        <div className="glass" style={{ borderRadius: 16, padding: 16, textAlign: "center" }}>
          <div style={{ fontWeight: 800, marginBottom: 4 }}>Challenge complete 🎉</div>
          <div style={{ fontSize: 12.5, color: theme.sub }}>Head to the Video tab to generate your timelapse.</div>
        </div>
      )}
    </div>
  );
}

function StatCard({ theme, Icon, label, value, accent }) {
  return (
    <div className="glass" style={{ borderRadius: 16, padding: 15, boxShadow: theme.cardShadow }}>
      <div style={{
        width: 30, height: 30, borderRadius: 9, display: "grid", placeItems: "center",
        background: accent + "22", marginBottom: 8
      }}>
        <Icon size={16} color={accent} />
      </div>
      <div style={{ fontSize: 17, fontWeight: 800, fontFamily: "'Space Grotesk', sans-serif" }}>{value}</div>
      <div style={{ fontSize: 11.5, color: theme.sub }}>{label}</div>
    </div>
  );
}

/* ---------------- Upload Panel ---------------- */
function UploadPanel({ theme, challenge, stats, photos, onSave, showToast }) {
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const fileRef = useRef(null);
  const camRef = useRef(null);
  const dayIndex = stats.currentDay - 1;
  const existing = photos[dayIndex];
  const [confirmReplace, setConfirmReplace] = useState(false);

  const handleFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { showToast("Please choose an image file", "err"); return; }
    setBusy(true);
    try {
      const dataUrl = await compressImage(file);
      setPreview(dataUrl);
    } catch (e) {
      showToast("Couldn't process that image", "err");
    }
    setBusy(false);
  };

  const confirmSave = async () => {
    await onSave(dayIndex, { url: preview, ts: new Date().toISOString() });
    setPreview(null);
    setConfirmReplace(false);
    showToast(`Day ${stats.currentDay} photo saved ✅`);
  };

  if (stats.isOver) {
    return (
      <div className="glass fadeUp" style={{ borderRadius: 18, padding: 24, marginTop: 12, textAlign: "center" }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 6 }}>Challenge finished</div>
        <div style={{ fontSize: 13, color: theme.sub }}>Uploads are locked. Check out your timelapse in the Video tab.</div>
      </div>
    );
  }

  return (
    <div className="fadeUp" style={{ marginTop: 12 }}>
      <div className="glass" style={{ borderRadius: 20, padding: 20, boxShadow: theme.cardShadow }}>
        <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 2 }}>Day {stats.currentDay} photo</div>
        <div style={{ fontSize: 12.5, color: theme.sub, marginBottom: 16 }}>{fmtDate(new Date(dayKeyFromIndex(challenge.startDate, dayIndex)))}</div>

        {preview ? (
          <div>
            <img src={preview} alt="preview" style={{ width: "100%", borderRadius: 14, maxHeight: 380, objectFit: "cover" }} />
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button onClick={() => setPreview(null)} style={secondaryBtn(theme)}>Retake</button>
              <button onClick={() => existing ? setConfirmReplace(true) : confirmSave()} style={primaryBtn(theme)}>
                {existing ? "Replace photo" : "Save photo"}
              </button>
            </div>
          </div>
        ) : existing ? (
          <div>
            <img src={existing.url} alt="today" style={{ width: "100%", borderRadius: 14, maxHeight: 380, objectFit: "cover" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 10, color: theme.accent2, fontSize: 12.5, fontWeight: 700 }}>
              <Check size={14} /> Saved at {new Date(existing.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
              <button onClick={() => fileRef.current?.click()} style={secondaryBtn(theme)}>
                <RefreshCw size={14} style={{ marginRight: 6 }} /> Replace photo
              </button>
            </div>
          </div>
        ) : (
          <div style={{
            border: `1.5px dashed ${theme.panelBorder}`, borderRadius: 16, padding: "36px 16px",
            textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 12
          }}>
            {busy ? <Loader2 className="spin" size={26} color={theme.accent} /> : <Camera size={30} color={theme.sub} />}
            <div style={{ fontSize: 13, color: theme.sub, maxWidth: 240 }}>
              Take a photo now, or pick one from your gallery. Auto-compressed before saving.
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button onClick={() => camRef.current?.click()} style={primaryBtn(theme)}>
                <Camera size={14} style={{ marginRight: 6 }} /> Camera
              </button>
              <button onClick={() => fileRef.current?.click()} style={secondaryBtn(theme)}>
                <Upload size={14} style={{ marginRight: 6 }} /> Gallery
              </button>
            </div>
          </div>
        )}

        <input ref={camRef} type="file" accept="image/*" capture="environment" hidden
          onChange={(e) => handleFile(e.target.files?.[0])} />
        <input ref={fileRef} type="file" accept="image/*" hidden
          onChange={(e) => handleFile(e.target.files?.[0])} />
      </div>

      {confirmReplace && (
        <ConfirmModal theme={theme}
          title="Replace today's photo?"
          body="This will overwrite the photo already saved for this day."
          onCancel={() => setConfirmReplace(false)}
          onConfirm={confirmSave} />
      )}
    </div>
  );
}

function primaryBtn(theme) {
  return {
    flex: 1, border: "none", borderRadius: 12, padding: "12px 0",
    background: `linear-gradient(135deg, ${theme.accent}, ${theme.accent2})`,
    color: "#08090a", fontWeight: 800, fontSize: 13.5, display: "flex", alignItems: "center", justifyContent: "center"
  };
}
function secondaryBtn(theme) {
  return {
    flex: 1, borderRadius: 12, padding: "12px 0", border: `1px solid ${theme.panelBorder}`,
    background: "transparent", color: theme.text, fontWeight: 700, fontSize: 13.5,
    display: "flex", alignItems: "center", justifyContent: "center"
  };
}

function ConfirmModal({ theme, title, body, onCancel, onConfirm, danger }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 300, display: "grid", placeItems: "center", padding: 20 }}
      onClick={onCancel}>
      <div className="glass" onClick={(e) => e.stopPropagation()} style={{ borderRadius: 18, padding: 22, maxWidth: 320, width: "100%" }}>
        <div style={{ fontWeight: 800, fontSize: 15.5, marginBottom: 6 }}>{title}</div>
        <div style={{ fontSize: 13, color: theme.sub, marginBottom: 18 }}>{body}</div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} style={secondaryBtn(theme)}>Cancel</button>
          <button onClick={onConfirm} style={{
            ...primaryBtn(theme),
            background: danger ? theme.danger : `linear-gradient(135deg, ${theme.accent}, ${theme.accent2})`
          }}>Confirm</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Calendar View ---------------- */
function CalendarView({ theme, challenge, photos, onOpenDay }) {
  const today = todayISO();
  const days = Array.from({ length: challenge.totalDays }, (_, i) => i);

  return (
    <div className="fadeUp" style={{ marginTop: 12 }}>
      <div className="glass" style={{ borderRadius: 20, padding: 18, boxShadow: theme.cardShadow }}>
        <div style={{ fontWeight: 800, fontSize: 15.5, marginBottom: 4 }}>Challenge calendar</div>
        <div style={{ fontSize: 12, color: theme.sub, marginBottom: 14 }}>Tap a day to view it. Green = uploaded, red = missed, dim = upcoming.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 7 }}>
          {days.map((i) => {
            const key = dayKeyFromIndex(challenge.startDate, i);
            const has = !!photos[i];
            const isFuture = key > today;
            const isToday = key === today;
            let bg, bd, color;
            if (has) { bg = theme.accent + "26"; bd = theme.accent; color = theme.accent; }
            else if (isFuture) { bg = "transparent"; bd = theme.panelBorder; color = theme.sub; }
            else { bg = theme.danger + "1a"; bd = theme.danger + "88"; color = theme.danger; }
            return (
              <button key={i} onClick={() => has && onOpenDay(i)} style={{
                aspectRatio: "1", borderRadius: 10, border: `1px solid ${bd}`, background: bg, color,
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                fontSize: 11, fontWeight: 700, position: "relative", cursor: has ? "pointer" : "default",
                outline: isToday ? `2px solid ${theme.accent}` : "none", outlineOffset: 1
              }}>
                {i + 1}
                {has && <Check size={10} style={{ marginTop: 1 }} />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------------- Gallery ---------------- */
function GalleryView({ theme, challenge, photos, onDelete, onOpenDay, showToast, onReplace }) {
  const entries = Object.keys(photos).map(Number).sort((a, b) => a - b);
  const [pendingDelete, setPendingDelete] = useState(null);
  const replaceRef = useRef(null);
  const [replaceTarget, setReplaceTarget] = useState(null);

  const handleReplaceFile = async (file) => {
    if (!file || replaceTarget === null) return;
    const dataUrl = await compressImage(file);
    await onReplace(replaceTarget, { url: dataUrl, ts: new Date().toISOString() });
    showToast(`Day ${replaceTarget + 1} photo replaced`);
    setReplaceTarget(null);
  };

  const download = (idx) => {
    const a = document.createElement("a");
    a.href = photos[idx].url;
    a.download = `${challenge.name.replace(/\s+/g, "_")}_day${idx + 1}.jpg`;
    a.click();
  };

  const share = async (idx) => {
    try {
      if (navigator.share) {
        const blob = await (await fetch(photos[idx].url)).blob();
        const file = new File([blob], `day${idx + 1}.jpg`, { type: blob.type });
        await navigator.share({ files: [file], title: `Day ${idx + 1} progress` });
      } else {
        showToast("Sharing isn't supported on this browser — use Download instead", "err");
      }
    } catch (e) { /* user cancelled */ }
  };

  if (entries.length === 0) {
    return (
      <div className="glass fadeUp" style={{ borderRadius: 20, padding: 30, marginTop: 12, textAlign: "center" }}>
        <ImageOff size={26} color={theme.sub} style={{ marginBottom: 8 }} />
        <div style={{ fontWeight: 700, marginBottom: 4 }}>No photos yet</div>
        <div style={{ fontSize: 12.5, color: theme.sub }}>Upload your first day to start your gallery.</div>
      </div>
    );
  }

  return (
    <div className="fadeUp" style={{ marginTop: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
        {entries.map((idx) => (
          <div key={idx} className="glass" style={{ borderRadius: 12, overflow: "hidden", position: "relative" }}>
            <img src={photos[idx].url} alt={`day ${idx + 1}`} onClick={() => onOpenDay(idx)}
              style={{ width: "100%", aspectRatio: "1", objectFit: "cover", display: "block", cursor: "pointer" }} />
            <div style={{ position: "absolute", top: 4, left: 4, background: "#08090acc", color: theme.accent, fontSize: 9.5, fontWeight: 800, padding: "2px 6px", borderRadius: 6 }}>
              D{idx + 1}
            </div>
            <div style={{ position: "absolute", bottom: 4, right: 4, display: "flex", gap: 3 }}>
              <IconBtn onClick={() => { setReplaceTarget(idx); replaceRef.current?.click(); }} title="Replace"><RefreshCw size={11} /></IconBtn>
              <IconBtn onClick={() => download(idx)} title="Download"><Download size={11} /></IconBtn>
              <IconBtn onClick={() => share(idx)} title="Share"><Share2 size={11} /></IconBtn>
              <IconBtn onClick={() => setPendingDelete(idx)} title="Delete" danger><Trash2 size={11} /></IconBtn>
            </div>
          </div>
        ))}
      </div>
      <input ref={replaceRef} type="file" accept="image/*" hidden onChange={(e) => handleReplaceFile(e.target.files?.[0])} />
      {pendingDelete !== null && (
        <ConfirmModal theme={theme} danger
          title={`Delete Day ${pendingDelete + 1} photo?`}
          body="This can't be undone."
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { onDelete(pendingDelete); setPendingDelete(null); showToast("Photo deleted"); }} />
      )}
    </div>
  );
}

function IconBtn({ children, onClick, title, danger }) {
  return (
    <button onClick={(e) => { e.stopPropagation(); onClick(); }} title={title} style={{
      width: 22, height: 22, borderRadius: 6, border: "none", display: "grid", placeItems: "center",
      background: danger ? "#ff6b6bdd" : "#08090ac0", color: "#fff"
    }}>{children}</button>
  );
}

/* ---------------- Lightbox ---------------- */
function Lightbox({ theme, dayIndex, entry, challenge, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#000000ee", zIndex: 400, display: "flex", flexDirection: "column" }} onClick={onClose}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: 16 }}>
        <div style={{ color: "#fff" }}>
          <div style={{ fontWeight: 800 }}>Day {dayIndex + 1}</div>
          <div style={{ fontSize: 12, color: "#aaa" }}>{fmtDate(new Date(dayKeyFromIndex(challenge.startDate, dayIndex)))}</div>
        </div>
        <button onClick={onClose} style={{ border: "none", background: "transparent", color: "#fff" }}><X size={22} /></button>
      </div>
      <div style={{ flex: 1, display: "grid", placeItems: "center", padding: 12 }} onClick={(e) => e.stopPropagation()}>
        <img src={entry.url} alt={`Day ${dayIndex + 1}`} style={{ maxWidth: "100%", maxHeight: "100%", borderRadius: 12, objectFit: "contain" }} />
      </div>
    </div>
  );
}

/* ---------------- Compare Panel ---------------- */
function ComparePanel({ theme, challenge, photos }) {
  const entries = Object.keys(photos).map(Number).sort((a, b) => a - b);
  const [beforeIdx, setBeforeIdx] = useState(entries[0] ?? null);
  const [afterIdx, setAfterIdx] = useState(entries[entries.length - 1] ?? null);
  const [slider, setSlider] = useState(50);
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => {
    if (beforeIdx === null && entries.length) setBeforeIdx(entries[0]);
    if (afterIdx === null && entries.length) setAfterIdx(entries[entries.length - 1]);
  }, [entries]); // eslint-disable-line

  if (entries.length < 2) {
    return (
      <div className="glass fadeUp" style={{ borderRadius: 20, padding: 30, marginTop: 12, textAlign: "center" }}>
        <SlidersHorizontal size={24} color={theme.sub} style={{ marginBottom: 8 }} />
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Need at least 2 photos</div>
        <div style={{ fontSize: 12.5, color: theme.sub }}>Upload more days to unlock the before/after slider.</div>
      </div>
    );
  }

  const before = photos[beforeIdx];
  const after = photos[afterIdx];

  const Viewer = (
    <div style={{ position: "relative", width: "100%", aspectRatio: "3/4", borderRadius: fullscreen ? 0 : 16, overflow: "hidden", background: "#000" }}>
      {after && <img src={after.url} alt="after" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />}
      {before && (
        <div style={{ position: "absolute", inset: 0, width: `${slider}%`, overflow: "hidden" }}>
          <img src={before.url} alt="before" style={{ width: `${100 / (slider / 100)}%`, maxWidth: "none", height: "100%", objectFit: "cover" }} />
        </div>
      )}
      <div style={{ position: "absolute", top: 0, bottom: 0, left: `${slider}%`, width: 2, background: theme.accent, boxShadow: `0 0 10px ${theme.accent}` }} />
      <div style={{ position: "absolute", top: "50%", left: `${slider}%`, transform: "translate(-50%,-50%)", width: 34, height: 34, borderRadius: "50%", background: theme.accent, display: "grid", placeItems: "center", boxShadow: `0 0 12px ${theme.accent}aa` }}>
        <SlidersHorizontal size={15} color="#08090a" />
      </div>
      <div style={{ position: "absolute", top: 8, left: 8, background: "#08090acc", color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}>Day {beforeIdx + 1}</div>
      <div style={{ position: "absolute", top: 8, right: 8, background: "#08090acc", color: "#fff", fontSize: 10.5, fontWeight: 700, padding: "3px 8px", borderRadius: 6 }}>Day {afterIdx + 1}</div>
      <input type="range" min={0} max={100} value={slider} onChange={(e) => setSlider(+e.target.value)}
        style={{ position: "absolute", bottom: 12, left: "5%", width: "90%" }} />
    </div>
  );

  if (fullscreen) {
    return (
      <div style={{ position: "fixed", inset: 0, background: "#000", zIndex: 400 }}>
        <button onClick={() => setFullscreen(false)} style={{ position: "absolute", top: 14, right: 14, zIndex: 10, border: "none", background: "#08090ac0", color: "#fff", borderRadius: "50%", width: 34, height: 34, display: "grid", placeItems: "center" }}>
          <X size={18} />
        </button>
        {Viewer}
      </div>
    );
  }

  return (
    <div className="fadeUp" style={{ marginTop: 12 }}>
      <div className="glass" style={{ borderRadius: 20, padding: 16, boxShadow: theme.cardShadow }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div style={{ fontWeight: 800, fontSize: 15.5 }}>Before &amp; after</div>
          <button onClick={() => setFullscreen(true)} style={{ border: "none", background: "transparent", color: theme.accent, display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, fontWeight: 700 }}>
            <Maximize2 size={13} /> Fullscreen
          </button>
        </div>
        {Viewer}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 14 }}>
          <DaySelect theme={theme} label="Before" value={beforeIdx} entries={entries} onChange={setBeforeIdx} />
          <DaySelect theme={theme} label="After" value={afterIdx} entries={entries} onChange={setAfterIdx} />
        </div>
      </div>
    </div>
  );
}

function DaySelect({ theme, label, value, entries, onChange }) {
  return (
    <div>
      <label style={{ fontSize: 11.5, color: theme.sub, fontWeight: 600 }}>{label}</label>
      <select value={value ?? ""} onChange={(e) => onChange(Number(e.target.value))} style={{ ...inputStyle(theme), marginTop: 4 }}>
        {entries.map((i) => <option key={i} value={i}>Day {i + 1}</option>)}
      </select>
    </div>
  );
}

/* ---------------- Timelapse Panel ---------------- */
function TimelapsePanel({ theme, challenge, photos, isDark, showToast }) {
  const entries = Object.keys(photos).map(Number).sort((a, b) => a - b);
  const canvasRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [progress, setProgress] = useState(0);
  const [videoUrl, setVideoUrl] = useState(null);
  const [music, setMusic] = useState(false);
  const chunksRef = useRef([]);
  const rafRef = useRef(null);

  const W = 720, H = 960;
  const perPhotoMs = 900;

  const drawFrame = useCallback((ctx, idx, t) => {
    // t in [0,1] progress within this photo's slot (fade+zoom)
    const entry = photos[entries[idx]];
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    if (!entry) return;
    const img = drawFrame._imgs?.[entries[idx]];
    if (!img) return;

    const zoom = 1.05 - 0.05 * Math.min(t * 2, 1);
    const alpha = t < 0.15 ? t / 0.15 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;
    const scale = Math.max(W / img.width, H / img.height) * zoom;
    const iw = img.width * scale, ih = img.height * scale;
    ctx.drawImage(img, (W - iw) / 2, (H - ih) / 2, iw, ih);
    ctx.restore();

    // overlay
    const grad = ctx.createLinearGradient(0, H - 140, 0, H);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(1, "rgba(0,0,0,0.72)");
    ctx.fillStyle = grad;
    ctx.fillRect(0, H - 140, W, 140);

    ctx.fillStyle = "#a6ff3d";
    ctx.font = "800 34px 'Space Grotesk', sans-serif";
    ctx.fillText(`Day ${entries[idx] + 1}`, 24, H - 66);
    ctx.fillStyle = "#e8ffe0";
    ctx.font = "500 16px 'Inter', sans-serif";
    ctx.fillText(fmtDate(new Date(dayKeyFromIndex(challenge.startDate, entries[idx]))), 24, H - 38);

    // progress bar
    const barW = W - 48;
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(24, 20, barW, 4);
    ctx.fillStyle = "#a6ff3d";
    ctx.fillRect(24, 20, barW * ((idx + t) / entries.length), 4);
  }, [photos, entries, challenge]);

  const preloadImages = useCallback(async () => {
    const imgs = {};
    await Promise.all(entries.map((idx) => new Promise((res) => {
      const img = new Image();
      img.onload = () => { imgs[idx] = img; res(); };
      img.src = photos[idx].url;
    })));
    drawFrame._imgs = imgs;
  }, [entries, photos, drawFrame]);

  const runAnimation = useCallback((onDone, capture) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let start = null;
    let idx = 0;

    const step = (ts) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const slot = Math.floor(elapsed / perPhotoMs);
      const t = (elapsed % perPhotoMs) / perPhotoMs;
      if (slot >= entries.length) {
        drawFrame(ctx, entries.length - 1, 1);
        setProgress(100);
        onDone?.();
        return;
      }
      drawFrame(ctx, slot, t);
      setProgress(Math.round(((slot + t) / entries.length) * 100));
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [drawFrame, entries.length]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const handlePreview = async () => {
    if (entries.length === 0) return;
    setPlaying(true);
    setProgress(0);
    await preloadImages();
    runAnimation(() => setPlaying(false));
  };

  const handleRecord = async () => {
    if (entries.length === 0) return;
    const canvas = canvasRef.current;
    await preloadImages();
    setRecording(true);
    setProgress(0);
    setVideoUrl(null);

    const stream = canvas.captureStream(30);
    let recorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp9" });
    } catch (e) {
      recorder = new MediaRecorder(stream);
    }
    chunksRef.current = [];
    recorder.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      setVideoUrl(URL.createObjectURL(blob));
      setRecording(false);
      showToast("Timelapse ready to download 🎬");
    };
    recorder.start();
    runAnimation(() => recorder.stop());
  };

  const downloadVideo = () => {
    const a = document.createElement("a");
    a.href = videoUrl;
    a.download = `${challenge.name.replace(/\s+/g, "_")}_timelapse.webm`;
    a.click();
  };

  return (
    <div className="fadeUp" style={{ marginTop: 12 }}>
      <div className="glass" style={{ borderRadius: 20, padding: 16, boxShadow: theme.cardShadow }}>
        <div style={{ fontWeight: 800, fontSize: 15.5, marginBottom: 2 }}>Timelapse generator</div>
        <div style={{ fontSize: 12, color: theme.sub, marginBottom: 14 }}>
          {entries.length} photo{entries.length !== 1 ? "s" : ""} in date order · fade + zoom transitions · day &amp; date overlay
        </div>

        <div style={{ position: "relative", borderRadius: 14, overflow: "hidden", background: "#000" }}>
          <canvas ref={canvasRef} width={W} height={H} style={{ width: "100%", display: "block", aspectRatio: `${W}/${H}` }} />
          {(playing || recording) && (
            <div style={{ position: "absolute", bottom: 10, left: 10, right: 10, height: 3, background: "#ffffff33", borderRadius: 3 }}>
              <div style={{ width: `${progress}%`, height: "100%", background: theme.accent, borderRadius: 3, transition: "width .1s linear" }} />
            </div>
          )}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: theme.sub, margin: "12px 2px" }}>
          <input type="checkbox" checked={music} onChange={(e) => setMusic(e.target.checked)} />
          Add background music track (client-side demo — mixes silently, bring your own royalty-free track for a real deploy)
        </label>

        <div style={{ display: "flex", gap: 10 }}>
          <button disabled={entries.length === 0 || playing || recording} onClick={handlePreview} style={{ ...secondaryBtn(theme), opacity: entries.length === 0 ? 0.5 : 1 }}>
            {playing ? <Loader2 className="spin" size={14} style={{ marginRight: 6 }} /> : <Play size={14} style={{ marginRight: 6 }} />}
            Preview
          </button>
          <button disabled={entries.length === 0 || playing || recording} onClick={handleRecord} style={{ ...primaryBtn(theme), opacity: entries.length === 0 ? 0.5 : 1 }}>
            {recording ? <Loader2 className="spin" size={14} style={{ marginRight: 6 }} /> : <Film size={14} style={{ marginRight: 6 }} />}
            {recording ? "Rendering…" : "Generate video"}
          </button>
        </div>

        {videoUrl && (
          <button onClick={downloadVideo} style={{ ...primaryBtn(theme), width: "100%", marginTop: 10 }}>
            <Download size={14} style={{ marginRight: 6 }} /> Download timelapse (.webm)
          </button>
        )}

        <div style={{ fontSize: 11, color: theme.sub, marginTop: 10, lineHeight: 1.5 }}>
          Exports as WebM (VP9) directly in-browser via the Canvas + MediaRecorder APIs — no upload required.
          True MP4 encoding needs either server-side FFmpeg or the FFmpeg-WASM bundle (~30MB); wire that in for
          production if MP4 is a hard requirement.
        </div>
      </div>
    </div>
  );
}

/* ---------------- Settings ---------------- */
function SettingsPanel({ theme, challenge, onReset }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <div className="fadeUp" style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="glass" style={{ borderRadius: 20, padding: 18, boxShadow: theme.cardShadow }}>
        <div style={{ fontWeight: 800, fontSize: 15.5, marginBottom: 10 }}>Challenge</div>
        <SettingsRow theme={theme} label="Name" value={challenge.name} />
        <SettingsRow theme={theme} label="Start date" value={fmtDate(new Date(challenge.startDate))} />
        <SettingsRow theme={theme} label="Duration" value={`${challenge.totalDays} days`} />
      </div>

      <div className="glass" style={{ borderRadius: 20, padding: 18, boxShadow: theme.cardShadow }}>
        <div style={{ fontWeight: 800, fontSize: 15.5, marginBottom: 6 }}>Not wired up in this demo</div>
        <ul style={{ fontSize: 12.5, color: theme.sub, lineHeight: 1.7, paddingLeft: 18, margin: 0 }}>
          <li>Account login / signup / Google sign-in — needs a real auth provider (Firebase Auth or Supabase Auth)</li>
          <li>Scheduled 8am / 10am / 2pm / 8pm push reminders — needs a service worker + FCM, only fires while a device is online and the PWA is installed</li>
          <li>Cross-device cloud sync — needs Cloud Storage + a database (this demo persists locally to your account only)</li>
          <li>MP4 export — needs FFmpeg (server-side or WASM); this demo exports WebM</li>
        </ul>
      </div>

      <button onClick={() => setConfirmOpen(true)} style={{
        border: `1px solid ${theme.danger}55`, background: "transparent", color: theme.danger,
        borderRadius: 14, padding: "13px 0", fontWeight: 700, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8
      }}>
        <Trash2 size={15} /> Delete challenge &amp; all photos
      </button>

      {confirmOpen && (
        <ConfirmModal theme={theme} danger
          title="Delete this challenge?"
          body="All saved photos and progress will be permanently removed."
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => { onReset(); setConfirmOpen(false); }} />
      )}
    </div>
  );
}

function SettingsRow({ theme, label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${theme.panelBorder}` }}>
      <span style={{ fontSize: 13, color: theme.sub }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 700 }}>{value}</span>
    </div>
  );
}
