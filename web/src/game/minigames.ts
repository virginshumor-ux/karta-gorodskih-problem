// Four short mini-games about the city (20–45 s each). Pure DOM/canvas, keyboard + touch.
import { DEFAULT_CATS } from "../domain/constants";
import { esc, ico } from "../domain/format";
import { $ } from "../ui/dom";
import { buzz, confetti, sfx } from "./fx";
import { game } from "./game";

export interface MiniGame {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  rules: string;
  /** Reward hint for the card: how score turns into шишки. */
  rate: string;
}

export const MINIGAMES: MiniGame[] = [
  { id: "yamoboy", name: "Ямобой", icon: "construction", tagline: "Залатай ямы быстрее ДРСУ", rules: "25 секунд. Тапай по ямам 🕳️, пока они не исчезли. Котика 🐈 не трогай — минус 2.", rate: "2 очка = 1 🌰" },
  { id: "icicles", name: "Сосулькопад", icon: "ac_unit", tagline: "Пройди под крышами живым", rules: "Двигай пешехода пальцем или стрелками. Уворачивайся от сосулек, лови мешки с песком 🧂 (+5). Три жизни.", rate: "5 очков = 1 🌰" },
  { id: "plow", name: "Снегоуборщик", icon: "agriculture", tagline: "Змейка, но это трактор", rules: "Собирай сугробы ❄️, трактор растёт. Не врезайся в край и в свой хвост. Стрелки, WASD или свайпы.", rate: "1 сугроб = 1 🌰" },
  { id: "quiz", name: "Кто виноват?", icon: "quiz", tagline: "Угадай, кому писать", rules: "7 ситуаций — выбери ответственную организацию. Пригодится в жизни, честно.", rate: "1 ответ = 3 🌰" },
];

type End = (gameId: string, score: number) => { coins: number; best: boolean; capped: boolean };

let cleanup: (() => void) | null = null;
export const gameOpen = (): boolean => !!$("#game-root")?.innerHTML;

export function closeGame(): void {
  cleanup?.();
  cleanup = null;
  const r = $("#game-root");
  if (r) r.innerHTML = "";
}

/** Opens the intro card of a game; the round starts on "Погнали". */
export function openGame(id: string, onEnd: End): void {
  const g = MINIGAMES.find((x) => x.id === id);
  const root = $("#game-root");
  if (!g || !root) return;
  closeGame();
  root.innerHTML = `<div class="game-scrim"><div class="game-box" role="dialog" aria-modal="true" aria-label="Мини-игра ${esc(g.name)}">
    <div class="game-head"><span class="game-ico">${ico(g.icon, "fill")}</span><b class="grow">${esc(g.name)}</b><span class="game-chip" id="g-score" aria-label="Очки">0</span><span class="game-chip" id="g-aux"></span><button class="icon-btn" data-g="close" aria-label="Закрыть игру">${ico("close")}</button></div>
    <div class="game-stage" id="g-stage"></div>
  </div></div>`;
  root.querySelector<HTMLElement>("[data-g=close]")?.addEventListener("click", closeGame);
  root.querySelector(".game-scrim")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).classList.contains("game-scrim")) closeGame();
  });
  intro(g, onEnd);
}

const stage = (): HTMLElement => $("#g-stage") as HTMLElement;
const setScore = (n: number) => {
  const el = $("#g-score");
  if (el) el.textContent = String(n);
};
const setAux = (t: string) => {
  const el = $("#g-aux");
  if (el) el.textContent = t;
};

function intro(g: MiniGame, onEnd: End): void {
  const best = game().best[g.id] ?? 0;
  stage().innerHTML = `<div class="game-card"><div class="game-big">${ico(g.icon, "fill")}</div><h3>${esc(g.tagline)}</h3><p>${esc(g.rules)}</p>
    <p class="small muted">Рекорд: <b class="num">${best}</b> · награда: ${esc(g.rate)}, до 30 🌰 в день</p>
    <button class="btn primary block" data-g="start">${ico("sports_esports")}Погнали</button></div>`;
  stage().querySelector("[data-g=start]")?.addEventListener("click", () => run(g, onEnd));
  setScore(0);
  setAux("");
}

function finish(g: MiniGame, score: number, onEnd: End): void {
  cleanup?.();
  cleanup = null;
  const r = onEnd(g.id, score);
  sfx(r.best && score > 0 ? "level" : "lose");
  if (r.best && score > 0) confetti();
  const verdict = score === 0 ? "Бывает. Ямы победили 🫠" : r.best ? "НОВЫЙ РЕКОРД 🔥" : score >= 10 ? "Мощно. Это база 💪" : "Норм, но можешь лучше 😏";
  stage().innerHTML = `<div class="game-card"><div class="game-score-big num">${score}</div><h3>${verdict}</h3>
    <p>${r.coins ? `+${r.coins} 🌰 шишек` : r.capped ? "Лимит шишек за эту игру на сегодня собран — играй ради рекорда" : "Шишек не набралось"}</p>
    <div class="row"><button class="btn outline grow" data-g="exit">Выйти</button><button class="btn primary grow" data-g="again">${ico("replay")}Ещё раз</button></div></div>`;
  stage().querySelector("[data-g=exit]")?.addEventListener("click", closeGame);
  stage().querySelector("[data-g=again]")?.addEventListener("click", () => run(g, onEnd));
}

function run(g: MiniGame, onEnd: End): void {
  setScore(0);
  const done = (score: number) => finish(g, score, onEnd);
  if (g.id === "yamoboy") yamoboy(done);
  else if (g.id === "icicles") icicles(done);
  else if (g.id === "plow") plow(done);
  else quiz(done);
}

// ---------- Ямобой ----------

function yamoboy(done: (score: number) => void): void {
  let score = 0;
  let left = 25;
  stage().innerHTML = `<div class="holes">${Array.from({ length: 9 }, (_, i) => `<button class="hole" data-i="${i}" aria-label="Участок ${i + 1}"></button>`).join("")}</div>`;
  const cells = [...stage().querySelectorAll<HTMLButtonElement>(".hole")];
  const state: ("" | "hole" | "cat")[] = Array(9).fill("");
  const timers: ReturnType<typeof setTimeout>[] = [];
  const paint = (i: number) => {
    const c = cells[i] as HTMLButtonElement;
    c.dataset.s = state[i] || "";
    c.textContent = state[i] === "hole" ? "🕳️" : state[i] === "cat" ? "🐈" : "";
  };
  const spawn = () => {
    const free = state.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
    const i = free[Math.floor(Math.random() * free.length)];
    if (i == null) return;
    state[i] = Math.random() < 0.13 ? "cat" : "hole";
    paint(i);
    timers.push(setTimeout(() => {
      state[i] = "";
      paint(i);
    }, Math.max(620, 1100 - (25 - left) * 20)));
  };
  cells.forEach((c, i) =>
    c.addEventListener("pointerdown", () => {
      if (state[i] === "hole") {
        score++;
        sfx("tap");
        c.classList.add("patched");
        setTimeout(() => c.classList.remove("patched"), 260);
      } else if (state[i] === "cat") {
        score = Math.max(0, score - 2);
        sfx("hit");
        buzz(60);
      } else return;
      state[i] = "";
      paint(i);
      setScore(score);
    }),
  );
  const sp = setInterval(spawn, 520);
  const tick = setInterval(() => {
    left--;
    setAux(`⏱ ${left}`);
    if (left <= 0) done(score);
  }, 1000);
  setAux(`⏱ ${left}`);
  cleanup = () => {
    clearInterval(sp);
    clearInterval(tick);
    timers.forEach(clearTimeout);
  };
}

// ---------- Сосулькопад ----------

function icicles(done: (score: number) => void): void {
  const w = Math.min(360, innerWidth - 48);
  const h = Math.min(440, innerHeight - 220);
  stage().innerHTML = `<canvas class="game-canvas" width="${w * 2}" height="${h * 2}" style="width:${w}px;height:${h}px" aria-label="Игровое поле: улица с крышами"></canvas><p class="hint" style="text-align:center;margin:8px 0 0">Веди пальцем по полю или жми ← →</p>`;
  const cv = stage().querySelector("canvas") as HTMLCanvasElement;
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  g.scale(2, 2);
  let px = w / 2;
  let lives = 3;
  let score = 0;
  let t = 0;
  let last = performance.now();
  let raf = 0;
  const drops: { x: number; y: number; v: number; bag: boolean }[] = [];
  const keys = new Set<string>();
  const kd = (e: KeyboardEvent) => keys.add(e.key);
  const ku = (e: KeyboardEvent) => keys.delete(e.key);
  addEventListener("keydown", kd);
  addEventListener("keyup", ku);
  const move = (e: PointerEvent) => {
    const r = cv.getBoundingClientRect();
    px = Math.max(14, Math.min(w - 14, e.clientX - r.left));
  };
  cv.addEventListener("pointermove", move);
  cv.addEventListener("pointerdown", move);
  const frame = (now: number) => {
    const dt = Math.min(50, now - last) / 16.7;
    last = now;
    t += dt;
    if (keys.has("ArrowLeft") || keys.has("a")) px = Math.max(14, px - 5 * dt);
    if (keys.has("ArrowRight") || keys.has("d")) px = Math.min(w - 14, px + 5 * dt);
    if (Math.random() < 0.03 + t / 9000) drops.push({ x: 10 + Math.random() * (w - 20), y: 22, v: 2 + Math.random() * 1.5 + t / 900, bag: Math.random() < 0.12 });
    // street
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#dfe9ff";
    g.fillRect(0, 0, w, h);
    g.fillStyle = "#141414";
    for (let x = 0; x < w; x += 40) g.fillRect(x, 0, 36, 18);
    g.fillStyle = "#f3eee3";
    g.fillRect(0, h - 24, w, 24);
    g.strokeStyle = "#141414";
    g.lineWidth = 2;
    g.strokeRect(1, h - 24, w - 2, 23);
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i] as (typeof drops)[number];
      d.y += d.v * dt;
      if (d.bag) {
        g.font = "20px serif";
        g.fillText("🧂", d.x - 10, d.y + 8);
      } else {
        g.beginPath();
        g.moveTo(d.x - 7, d.y - 14);
        g.lineTo(d.x + 7, d.y - 14);
        g.lineTo(d.x, d.y + 12);
        g.closePath();
        g.fillStyle = "#a9e4ff";
        g.fill();
        g.stroke();
      }
      const hit = d.y > h - 54 && d.y < h - 18 && Math.abs(d.x - px) < 16;
      if (hit) {
        drops.splice(i, 1);
        if (d.bag) {
          score += 5;
          sfx("coin");
        } else {
          lives--;
          sfx("hit");
          buzz(80);
        }
      } else if (d.y > h) drops.splice(i, 1);
    }
    g.font = "30px serif";
    g.fillText("🧍", px - 15, h - 22);
    score += dt / 30;
    setScore(Math.floor(score));
    setAux("❤️".repeat(Math.max(0, lives)));
    if (lives <= 0 || t > 45 * 60) done(Math.floor(score));
    else raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  cleanup = () => {
    cancelAnimationFrame(raf);
    removeEventListener("keydown", kd);
    removeEventListener("keyup", ku);
  };
}

// ---------- Снегоуборщик ----------

function plow(done: (score: number) => void): void {
  const N = 12;
  const size = Math.min(336, innerWidth - 48);
  const c = size / N;
  stage().innerHTML = `<canvas class="game-canvas" width="${size * 2}" height="${size * 2}" style="width:${size}px;height:${size}px" aria-label="Игровое поле: двор в снегу"></canvas>
    <div class="dpad"><button data-d="up" aria-label="Вверх">${ico("keyboard_arrow_up")}</button><button data-d="left" aria-label="Влево">${ico("keyboard_arrow_left")}</button><button data-d="down" aria-label="Вниз">${ico("keyboard_arrow_down")}</button><button data-d="right" aria-label="Вправо">${ico("keyboard_arrow_right")}</button></div>`;
  const cv = stage().querySelector("canvas") as HTMLCanvasElement;
  const g = cv.getContext("2d") as CanvasRenderingContext2D;
  g.scale(2, 2);
  let body = [{ x: 5, y: 6 }, { x: 4, y: 6 }, { x: 3, y: 6 }];
  let dir = { x: 1, y: 0 };
  let next = dir;
  let score = 0;
  const place = () => {
    for (;;) {
      const p = { x: Math.floor(Math.random() * N), y: Math.floor(Math.random() * N) };
      if (!body.some((b) => b.x === p.x && b.y === p.y)) return p;
    }
  };
  let snow = place();
  const turn = (d: string) => {
    const m: Record<string, { x: number; y: number }> = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    const nd = m[d];
    if (nd && !(nd.x === -dir.x && nd.y === -dir.y)) next = nd;
  };
  const kd = (e: KeyboardEvent) => {
    const k: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", w: "up", s: "down", a: "left", d: "right", ц: "up", ы: "down", ф: "left", в: "right" };
    if (k[e.key]) {
      e.preventDefault();
      turn(k[e.key] as string);
    }
  };
  addEventListener("keydown", kd);
  stage().querySelectorAll<HTMLElement>("[data-d]").forEach((b) => b.addEventListener("pointerdown", () => turn(b.dataset.d as string)));
  let sx = 0;
  let sy = 0;
  cv.addEventListener("pointerdown", (e) => ((sx = e.clientX), (sy = e.clientY)));
  cv.addEventListener("pointerup", (e) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) > 24) turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
  });
  const draw = () => {
    g.fillStyle = "#eef6ff";
    g.fillRect(0, 0, size, size);
    g.strokeStyle = "rgba(20,20,20,.08)";
    for (let i = 0; i <= N; i++) {
      g.beginPath();
      g.moveTo(i * c, 0);
      g.lineTo(i * c, size);
      g.moveTo(0, i * c);
      g.lineTo(size, i * c);
      g.stroke();
    }
    g.font = `${c * 0.8}px serif`;
    g.fillText("❄️", snow.x * c + c * 0.08, snow.y * c + c * 0.8);
    body.forEach((b, i) => {
      g.fillStyle = i === 0 ? "#ff5a1f" : "#c6f24e";
      g.strokeStyle = "#141414";
      g.lineWidth = 2;
      g.fillRect(b.x * c + 2, b.y * c + 2, c - 4, c - 4);
      g.strokeRect(b.x * c + 2, b.y * c + 2, c - 4, c - 4);
    });
    const h = body[0] as { x: number; y: number };
    g.font = `${c * 0.7}px serif`;
    g.fillText("🚜", h.x * c + c * 0.12, h.y * c + c * 0.78);
  };
  draw();
  const tm = setInterval(() => {
    dir = next;
    const h = body[0] as { x: number; y: number };
    const n = { x: h.x + dir.x, y: h.y + dir.y };
    if (n.x < 0 || n.y < 0 || n.x >= N || n.y >= N || body.some((b) => b.x === n.x && b.y === n.y)) {
      buzz(120);
      done(score);
      return;
    }
    body = [n, ...body];
    if (n.x === snow.x && n.y === snow.y) {
      score++;
      sfx("coin");
      setScore(score);
      snow = place();
    } else body.pop();
    draw();
  }, Math.max(95, 170 - score * 3));
  setAux("🚜");
  cleanup = () => {
    clearInterval(tm);
    removeEventListener("keydown", kd);
  };
}

// ---------- Кто виноват? ----------

const SCENES: [string, string][] = [
  ["road", "Огромная яма на дороге у остановки"],
  ["road", "Провалился асфальт на проезжей части"],
  ["light", "Не горит фонарь у пешеходного перехода"],
  ["light", "Тёмная аллея: не работают три фонаря"],
  ["trash", "Мусорные контейнеры не вывозят неделю"],
  ["trash", "У гаражей выросла свалка покрышек"],
  ["snow", "Тротуар не почищен после снегопада"],
  ["ice", "Сосульки над входом в магазин"],
  ["yard", "Сломана качель на детской площадке во дворе"],
  ["yard", "Открытый люк во дворе дома"],
  ["green", "Сломана скамейка в сквере"],
  ["transit", "Разбито стекло остановочного павильона"],
];

function quiz(done: (score: number) => void): void {
  const rounds = [...SCENES].sort(() => Math.random() - 0.5).slice(0, 7);
  let i = 0;
  let score = 0;
  const first = (s: string) => s.split(/[\s/«]/)[0];
  const show = () => {
    const [catId, text] = rounds[i] as [string, string];
    const cat = DEFAULT_CATS.find((c) => c.id === catId);
    if (!cat) return;
    const wrong = DEFAULT_CATS.filter((c) => c.id !== "other" && c.org !== cat.org && first(c.org) !== first(cat.org))
      .sort(() => Math.random() - 0.5)
      .slice(0, 2)
      .map((c) => c.org);
    const opts = [...new Set([cat.org, ...wrong])].sort(() => Math.random() - 0.5);
    setAux(`${i + 1} / ${rounds.length}`);
    stage().innerHTML = `<div class="game-card quiz"><span class="quiz-tag">${ico(cat.icon, "fill")}Ситуация</span><h3>${esc(text)}</h3><p class="small muted">Кому писать?</p>
      <div class="stack">${opts.map((o) => `<button class="btn outline block quiz-opt" data-ok="${o === cat.org}">${esc(o)}</button>`).join("")}</div></div>`;
    stage().querySelectorAll<HTMLButtonElement>(".quiz-opt").forEach((b) =>
      b.addEventListener("click", () => {
        const ok = b.dataset.ok === "true";
        if (ok) score++;
        setScore(score);
        sfx(ok ? "coin" : "hit");
        b.classList.add(ok ? "right" : "wrong");
        stage().querySelector<HTMLElement>('[data-ok="true"]')?.classList.add("right");
        stage().querySelectorAll<HTMLButtonElement>(".quiz-opt").forEach((x) => (x.disabled = true));
        setTimeout(() => {
          i++;
          if (i >= rounds.length) done(score);
          else show();
        }, 850);
      }),
    );
  };
  show();
  cleanup = () => undefined;
}
