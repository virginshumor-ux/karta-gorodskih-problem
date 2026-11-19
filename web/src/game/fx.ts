// Visual and sound effects of the game layer. No audio files and no libraries: canvas particles and WebAudio blips.
import { esc } from "../domain/format";
import { $ } from "../ui/dom";
import { game } from "./game";

const reduced = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;
const root = (): HTMLElement | null => $("#fx-root");

// ---------- sound ----------

let audio: AudioContext | null = null;
function tone(freq: number, at: number, dur: number, type: OscillatorType = "square", vol = 0.06): void {
  if (!audio) return;
  const o = audio.createOscillator();
  const g = audio.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, audio.currentTime + at);
  g.gain.setValueAtTime(vol, audio.currentTime + at);
  g.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + at + dur);
  o.connect(g).connect(audio.destination);
  o.start(audio.currentTime + at);
  o.stop(audio.currentTime + at + dur + 0.02);
}

export type Sfx = "coin" | "hit" | "level" | "fanfare" | "tap" | "lose";
export function sfx(kind: Sfx): void {
  if (!game().sound) return;
  try {
    audio ??= new AudioContext();
    if (audio.state === "suspended") void audio.resume();
  } catch {
    return;
  }
  const seq: Record<Sfx, [number, number, number, OscillatorType?][]> = {
    coin: [[988, 0, 0.08], [1319, 0.08, 0.16]],
    tap: [[660, 0, 0.05, "triangle"]],
    hit: [[180, 0, 0.18, "sawtooth"], [120, 0.05, 0.2, "sawtooth"]],
    lose: [[392, 0, 0.15], [330, 0.15, 0.15], [262, 0.3, 0.3]],
    level: [[523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.1], [1047, 0.3, 0.3]],
    fanfare: [[392, 0, 0.15], [392, 0.16, 0.08], [392, 0.26, 0.08], [523, 0.36, 0.5], [659, 0.36, 0.5, "triangle"], [784, 0.9, 0.6]],
  };
  seq[kind].forEach(([f, at, d, t]) => tone(f, at, d, t ?? "square"));
}

export function buzz(ms: number | number[] = 30): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
}

// ---------- particles ----------

interface P {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  vr: number;
  s: number;
  c: string;
  ch?: string;
}

const COLORS = ["#c6f24e", "#ff5a1f", "#3b5bff", "#8b6cff", "#ff7eb6", "#ffd23f"];

/** Salute: confetti, snowflakes or cedar cones (the equipped effect), or a custom set of emoji. */
export function confetti(kind = game().equipped.fx, emoji?: string[]): void {
  const host = root();
  if (!host || reduced()) return;
  const cv = document.createElement("canvas");
  cv.className = "fx-canvas";
  host.appendChild(cv);
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W = (cv.width = innerWidth * dpr);
  const H = (cv.height = innerHeight * dpr);
  const g = cv.getContext("2d");
  if (!g) return cv.remove();
  const chars = emoji ?? (kind === "snow" ? ["❄", "❅", "❆"] : kind === "cones" ? ["🌰", "🌲"] : undefined);
  const ps: P[] = Array.from({ length: chars ? 60 : 140 }, () => ({
    x: W / 2 + (Math.random() - 0.5) * W * 0.3,
    y: H * 0.55,
    vx: (Math.random() - 0.5) * 22 * dpr,
    vy: -(12 + Math.random() * 16) * dpr,
    r: Math.random() * 6,
    vr: (Math.random() - 0.5) * 0.4,
    s: (6 + Math.random() * 8) * dpr,
    c: COLORS[Math.floor(Math.random() * COLORS.length)] as string,
    ch: chars?.[Math.floor(Math.random() * chars.length)],
  }));
  let t = 0;
  const step = () => {
    t++;
    g.clearRect(0, 0, W, H);
    for (const p of ps) {
      p.vy += 0.55 * dpr;
      p.vx *= 0.985;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(p.r);
      if (p.ch) {
        g.font = `${p.s * 2.4}px serif`;
        g.fillText(p.ch, 0, 0);
      } else {
        g.fillStyle = p.c;
        g.strokeStyle = "#141414";
        g.lineWidth = 1.5 * dpr;
        g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
        g.strokeRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      }
      g.restore();
    }
    if (t < 150) requestAnimationFrame(step);
    else cv.remove();
  };
  requestAnimationFrame(step);
}

/** Snow over the whole app for a while (the "Сибирь" egg). */
export function snowfall(seconds = 14): void {
  const host = root();
  if (!host || reduced()) return;
  const cv = document.createElement("canvas");
  cv.className = "fx-canvas";
  host.appendChild(cv);
  const W = (cv.width = innerWidth);
  const H = (cv.height = innerHeight);
  const g = cv.getContext("2d");
  if (!g) return cv.remove();
  const fl = Array.from({ length: 120 }, () => ({ x: Math.random() * W, y: Math.random() * -H, r: 1.5 + Math.random() * 3.5, v: 0.6 + Math.random() * 1.6, d: Math.random() * 6 }));
  const end = performance.now() + seconds * 1000;
  const step = (now: number) => {
    g.clearRect(0, 0, W, H);
    g.fillStyle = "#fff";
    g.strokeStyle = "rgba(20,20,20,.35)";
    for (const f of fl) {
      f.y += f.v;
      f.x += Math.sin((f.y + f.d * 40) / 40) * 0.6;
      if (f.y > H && now < end) f.y = -10;
      g.beginPath();
      g.arc(f.x, f.y, f.r, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
    if (now < end + 4000) requestAnimationFrame(step);
    else cv.remove();
  };
  requestAnimationFrame(step);
}

// ---------- stickers and overlays ----------

/** "+15 XP" sticker flying up from the bottom of the screen. */
export function floatSticker(text: string, tone: "xp" | "coin" | "egg" = "xp"): void {
  const host = root();
  if (!host) return;
  const el = document.createElement("div");
  el.className = `fx-float ${tone}`;
  el.textContent = text;
  el.style.left = `${40 + Math.random() * 20}%`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 1600);
}

function overlay(cls: string, html: string, ms: number): void {
  const host = root();
  if (!host) return;
  const el = document.createElement("div");
  el.className = `fx-over ${cls}`;
  el.innerHTML = html;
  el.setAttribute("role", "status");
  const close = () => {
    el.classList.add("out");
    setTimeout(() => el.remove(), 300);
  };
  el.addEventListener("click", close);
  host.appendChild(el);
  setTimeout(close, ms);
}

/** ДИНАСТИЯЯЯЯЯ: stretched shout, crowns and a fanfare. */
export function dynasty(): void {
  sfx("fanfare");
  buzz([60, 40, 60, 40, 200]);
  const word = "ДИНАСТИ" + "Я".repeat(9);
  overlay(
    "dynasty",
    `<div class="dyn-crown">👑</div><div class="dyn-word">${[...word].map((ch, i) => `<span style="animation-delay:${i * 45}ms">${ch}</span>`).join("")}</div><div class="dyn-sub">Пасхалка найдена · +77 🌰 · титул «Династия 👑» в магазине</div>`,
    4200,
  );
  confetti("confetti", ["👑", "🏆", "✨"]);
}

export function sixSeven(): void {
  sfx("tap");
  overlay("sixseven", `<div class="ss"><span>6</span><span class="hands">🤲</span><span>7</span></div><div class="dyn-sub">Ну ты понял. +67 🌰</div>`, 2600);
}

export function wave(): void {
  overlay("wave", `<div class="wave-line"></div><div class="dyn-sub">Енисей не замерзает 🌊 · +30 🌰</div>`, 2600);
}

export function levelUp(level: number, title: string): void {
  sfx("level");
  buzz([40, 30, 80]);
  overlay("levelup", `<div class="lu-stamp"><small>Новый уровень</small><b>LVL ${level}</b><span>${esc(title)}</span></div>`, 3200);
  confetti();
}

export function eggFound(name: string, coins: number): void {
  sfx("coin");
  overlay("egg", `<div class="lu-stamp egg"><small>Пасхалка</small><b>🥚</b><span>${esc(name)} · +${coins} 🌰</span></div>`, 2600);
}
