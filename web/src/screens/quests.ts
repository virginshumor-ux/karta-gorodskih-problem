import { esc, ico, plural } from "../domain/format";
import { achievements } from "../domain/smart";
import { count, dailyQuests, EGGS, earnedToday, game, GAME_DAILY_CAP, levelOf, owns, questStatus, SHOP, STORY_REWARD, xpOf, type ItemKind } from "../game/game";
import { MINIGAMES } from "../game/minigames";
import { S, user } from "../state/store";
import { bellBtn, topbar } from "./common";

const KIND_TITLES: [ItemKind, string][] = [
  ["skin", "Темы оформления"],
  ["pins", "Метки на карте"],
  ["frame", "Рамки аватара"],
  ["title", "Титулы"],
  ["fx", "Салюты"],
];

export function currentLevel() {
  return levelOf(xpOf(user(), S.complaints));
}

export function viewQuests(): string {
  const g = game();
  const u = user();
  const lv = currentLevel();
  const quests = dailyQuests();
  const ach = u ? achievements(u, S.complaints) : [];
  const hour = new Date().getHours();
  const greet = hour < 5 ? "Ночной дозор 🦉" : hour < 12 ? "Доброе утро, район ☀️" : hour < 18 ? "Погнали чинить город 🛠️" : "Вечерний обход 🌆";
  return `<div class="screen">${topbar("Квесты", { backBtn: false, right: bellBtn() })}
    <div class="lvl-card">
      <button class="lvl-big" data-act="lvltap" aria-label="Уровень ${lv.level}"><small>LVL</small><b class="num">${lv.level}</b></button>
      <div class="grow">
        <span class="tiny lvl-greet">${greet}</span>
        <b class="lvl-title">${esc(lv.title)}</b>
        <div class="xp-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${lv.pct}" aria-label="Опыт до следующего уровня"><i style="width:${lv.pct}%"></i></div>
        <span class="tiny">${lv.next == null ? `${lv.xp} XP · максимальный уровень` : `${lv.xp} / ${lv.next} XP`}</span>
      </div>
    </div>
    <div class="wallet">
      <div class="coin-box"><span class="coin">🌰</span><b class="num" id="coins">${g.coins}</b><span>${plural(g.coins, "шишка", "шишки", "шишек")}</span></div>
      <div class="coin-box streak"><span class="coin">🔥</span><b class="num">${g.streak.days}</b><span>${plural(g.streak.days, "день", "дня", "дней")} подряд</span></div>
      <button class="coin-box snd" data-act="sound" aria-pressed="${g.sound}" aria-label="Звуки в играх">${ico(g.sound ? "volume_up" : "volume_off")}<span>${g.sound ? "звук" : "тихо"}</span></button>
    </div>
    ${u ? "" : `<div class="mode-banner">${ico("info")}<span>Опыт за обращения, поддержки и комментарии начисляется после входа. Мини-игры и пасхалки работают и так.</span><button class="btn text" data-act="login">Войти</button></div>`}

    <div class="section-title">Задания дня <span class="count num">${quests.filter((q) => questStatus(q) === "claimed").length}/3</span></div>
    <div class="quests">${quests
      .map((q) => {
        const st = questStatus(q);
        const n = Math.min(count(q.event), q.goal);
        return `<div class="quest ${st}">
          <span class="q-ico">${ico(q.icon, "fill")}</span>
          <div class="grow"><b>${esc(q.title)}</b><span class="small muted">${esc(q.desc)}</span>
            <div class="q-progress"><i style="width:${(n / q.goal) * 100}%"></i></div></div>
          ${st === "claimed" ? `<span class="q-done">${ico("check")}</span>` : st === "ready" ? `<button class="btn tonal q-btn" data-act="claim" data-id="${q.id}">+${q.coins} 🌰</button>` : `<span class="q-reward num">${n}/${q.goal}<small>+${q.coins} 🌰</small></span>`}
        </div>`;
      })
      .join("")}</div>
    <p class="pad hint">Новые задания — каждый день в полночь. Награда — шишки 🌰 и немного опыта.</p>

    <div class="section-title">Мини-игры</div>
    <div class="games">${MINIGAMES.map(
      (m, i) => `<button class="game-tile t${i}" data-act="play" data-id="${m.id}">
        <span class="gt-ico">${ico(m.icon, "fill")}</span><b>${esc(m.name)}</b><span class="small">${esc(m.tagline)}</span>
        <span class="gt-meta"><span>🏆 <span class="num">${g.best[m.id] ?? 0}</span></span><span>🌰 <span class="num">${earnedToday(m.id)}/${GAME_DAILY_CAP}</span></span></span>
      </button>`,
    ).join("")}</div>

    ${
      u
        ? `<div class="section-title">Сюжет <span class="count num">${ach.filter((a) => g.claimed["a-" + a.id]).length}/${ach.length}</span></div>
    <div class="quests">${ach
      .map((a) => {
        const claimed = !!g.claimed["a-" + a.id];
        return `<div class="quest ${claimed ? "claimed" : a.done ? "ready" : "todo"}">
          <span class="q-ico">${ico(a.icon, "fill")}</span>
          <div class="grow"><b>${esc(a.title)}</b><span class="small muted">${esc(a.desc)}</span><div class="q-progress"><i style="width:${(a.progress / a.goal) * 100}%"></i></div></div>
          ${claimed ? `<span class="q-done">${ico("check")}</span>` : a.done ? `<button class="btn tonal q-btn" data-act="claimstory" data-id="${a.id}">+${STORY_REWARD} 🌰</button>` : `<span class="q-reward num">${a.progress}/${a.goal}</span>`}
        </div>`;
      })
      .join("")}</div>`
        : ""
    }

    <div class="section-title">Шишкомаркет</div>
    <p class="pad small muted" style="margin:-4px 0 10px">Только косметика: на обращения и модерацию шишки не влияют.</p>
    ${KIND_TITLES.map(
      ([kind, title]) => `<div class="shop-kind">${esc(title)}</div>
      <div class="shop">${SHOP.filter((it) => it.kind === kind)
        .map((it) => {
          const own = owns(it.id);
          const on = (g.equipped as Record<string, string>)[it.kind] === it.value;
          const locked = !!it.egg && !own;
          return `<div class="shop-item ${on ? "on" : ""} ${locked ? "locked" : ""}">
            <span class="si-ico">${ico(locked ? "lock" : it.icon, "fill")}</span>
            <b>${esc(locked ? "???" : it.name)}</b><span class="tiny muted">${esc(locked ? "Откроется пасхалкой" : it.desc)}</span>
            ${on ? `<span class="si-tag">надето</span>` : own ? `<button class="btn outline si-btn" data-act="equip" data-id="${it.id}">Надеть</button>` : locked ? `<span class="si-tag lock">секрет</span>` : `<button class="btn tonal si-btn" data-act="buy" data-id="${it.id}" ${g.coins < it.price ? "disabled" : ""}>${it.price} 🌰</button>`}
          </div>`;
        })
        .join("")}</div>`,
    ).join("")}

    <div class="section-title">Пасхалки <span class="count num">${g.eggs.length}/${EGGS.length}</span></div>
    <div class="eggs">${EGGS.map((e) => {
      const found = g.eggs.includes(e.id);
      return `<div class="egg ${found ? "found" : ""}"><span>${found ? "🥚" : "❔"}</span><b>${esc(found ? e.name : "???")}</b><span class="tiny muted">${esc(e.hint)}</span></div>`;
    }).join("")}</div>
    <p class="pad hint" style="margin-top:12px">Прогресс игры хранится на этом устройстве. Опыт за обращения считается по данным сервера.</p>
  </div>`;
}
