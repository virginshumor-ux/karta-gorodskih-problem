import type { Category, Status } from "./types";

export const CITY = { name: "Красноярск", lat: 56.0153, lng: 92.8932 };
export const CAMPUS = { lat: 56.0005, lng: 92.782, zoom: 15 };
export const KRSK_BOX = { s: 55.9, n: 56.14, w: 92.6, e: 93.2 };

/** Built-in copy of the categories table; the server list replaces it after loading. */
export const DEFAULT_CATS: Category[] = [
  { id: "road", name: "Дороги и ямы", icon: "add_road", color: "#5b5f97", org: "МКУ «Управление дорог, инфраструктуры и благоустройства»" },
  { id: "light", name: "Освещение", icon: "lightbulb", color: "#c08a00", org: "Эксплуатирующая организация сетей наружного освещения" },
  { id: "trash", name: "Мусор и свалки", icon: "delete", color: "#6b7b2a", org: "Региональный оператор по обращению с ТКО" },
  { id: "snow", name: "Снег и наледь", icon: "ac_unit", color: "#2f7fb5", org: "Администрация района / управляющая компания" },
  { id: "ice", name: "Сосульки и опасные кровли", icon: "warning", color: "#b3471d", org: "Управляющая компания / собственник здания" },
  { id: "yard", name: "Двор и придомовая территория", icon: "holiday_village", color: "#8a4f8f", org: "Управляющая компания / ТСЖ" },
  { id: "green", name: "Благоустройство и озеленение", icon: "park", color: "#2e7d4f", org: "Администрация района" },
  { id: "transit", name: "Транспорт и остановки", icon: "directions_bus", color: "#0b6c78", org: "Департамент транспорта администрации города" },
  { id: "other", name: "Прочее", icon: "more_horiz", color: "#6a6f73", org: "Администрация района" },
];

export const STATUSES: Record<Status, { name: string }> = {
  moderation: { name: "На модерации" },
  published: { name: "Опубликовано" },
  sent: { name: "Передано в организацию" },
  work: { name: "В работе" },
  resolved_wait: { name: "Решено — ждёт подтверждения" },
  resolved: { name: "Решено" },
  rejected: { name: "Отклонено" },
  duplicate: { name: "Дубликат" },
};

export const STATUS_COLOR: Record<Status, string> = {
  moderation: "#7a8a89",
  published: "#2f5fa8",
  sent: "#0b5d66",
  work: "#c27c00",
  resolved_wait: "#3d9a63",
  resolved: "#2e7d4f",
  rejected: "#b3261e",
  duplicate: "#8a9393",
};

export const OPEN_STATUSES: Status[] = ["published", "sent", "work", "resolved_wait"];
export const CONFIRM_NEED = 3;
export const DUP_RADIUS_M = 30;
export const MAX_PER_HOUR = 5;
export const DAY = 864e5;

export const DISTRICTS = [
  "Железнодорожный район",
  "Кировский район",
  "Ленинский район",
  "Октябрьский район",
  "Свердловский район",
  "Советский район",
  "Центральный район",
];

export const REPORT_REASONS = [
  "Недостоверная информация",
  "На фото узнаваемые люди или номера машин",
  "Оскорбления или реклама",
  "Проблема уже решена",
  "Дубликат другого обращения",
];
