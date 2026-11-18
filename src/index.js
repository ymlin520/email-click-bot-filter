// 電子報點擊、開信的機器人過濾：分出「信箱安全掃描」和「真人點擊」
// 不綁資料庫、不綁寄信平台，傳入事件與最近紀錄就回傳判斷結果。Node 18+、瀏覽器、Cloudflare Workers 都能用。
export const VERSION = "1.0.0";

// 掃描器與自動化工具常見的 User-Agent 關鍵字
export const BOT_UA = /bot|crawl|spider|scan|preview|proxy|python|curl|wget|headless|phantom|httpclient|okhttp|java\/|go-http|libwww|safelinks|barracuda|proofpoint|mimecast|fireeye|trendmicro|symantec|sophos|forcepoint|ironport|zscaler|appriver|cisco/i;

export const DEFAULTS = {
  clickMinAgeSec: 60,   // 寄出後 N 秒內的點擊視為掃描（真人幾乎不可能這麼快）
  openMinAgeSec: 20,    // 寄出後 N 秒內的開信視為掃描
  burstWindowMs: 3000,  // 同一位收件人在這段時間內……
  burstMin: 3,          // ……點了 N 次以上，整批算掃描（掃描器會同時點遍所有連結）
  liveBurstMin: 2,      // 即時判斷：前 burstWindowMs 內已經有 N 次點擊，這次就算掃描
};

const age = (ts, sentAt) => (sentAt == null ? Infinity : (ts - sentAt) / 1000);

/**
 * 即時判斷一次點擊（收到請求當下呼叫）
 * @param {{ts:number, ua?:string, method?:string, url?:string}} click 這次點擊
 * @param {{sentAt?:number, recent?:Array<{ts:number}>, honeypot?:string|RegExp}} ctx 寄出時間、同一收件人最近的點擊、隱形陷阱連結
 * @returns {{bot:boolean, reasons:string[]}}
 */
export function checkClick(click, ctx = {}, opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const reasons = [];
  const ua = click.ua || "";
  if (!ua.trim()) reasons.push("沒有 User-Agent");
  else if (BOT_UA.test(ua)) reasons.push(`User-Agent 是掃描器或程式（${(ua.match(BOT_UA) || [])[0]}）`);
  if (click.method && click.method.toUpperCase() === "HEAD") reasons.push("HEAD 請求（只檢查連結、沒有真的打開）");
  const a = age(click.ts, ctx.sentAt);
  if (a < o.clickMinAgeSec) reasons.push(`寄出後 ${Math.max(0, Math.round(a))} 秒就點擊`);
  const n = (ctx.recent || []).filter(c => c.ts <= click.ts && click.ts - c.ts <= o.burstWindowMs).length;
  if (n >= o.liveBurstMin) reasons.push(`${o.burstWindowMs / 1000} 秒內已有 ${n} 次點擊`);
  if (ctx.honeypot && click.url && (ctx.honeypot instanceof RegExp ? ctx.honeypot.test(click.url) : click.url.includes(ctx.honeypot)))
    reasons.push("點了真人看不到的陷阱連結");
  return { bot: reasons.length > 0, reasons };
}

/** 即時判斷一次開信（追蹤像素被讀取時呼叫） */
export function checkOpen(open, ctx = {}, opt = {}) {
  const o = { ...DEFAULTS, ...opt };
  const reasons = [];
  const ua = open.ua || "";
  if (BOT_UA.test(ua)) reasons.push(`User-Agent 是掃描器或程式（${(ua.match(BOT_UA) || [])[0]}）`);
  const a = age(open.ts, ctx.sentAt);
  if (a < o.openMinAgeSec) reasons.push(`寄出後 ${Math.max(0, Math.round(a))} 秒就開信`);
  return { bot: reasons.length > 0, reasons };
}

/**
 * 事後整批重算：掃描器常「同時」點遍所有連結，請求併發時即時判斷會漏掉，
 * 存檔後再對同一位收件人的紀錄跑一次，把密集點擊整批標成掃描。
 * 只要同一位收件人點了陷阱連結，前後 burstWindowMs 內的點擊也一併標成掃描。
 * @param {Array<{ts:number, bot?:boolean, url?:string}>} clicks 同一位收件人的點擊（任意順序）
 * @returns 新陣列，每筆加上 bot 與 reasons；不改動傳入的資料
 */
export function markBursts(clicks, opt = {}, honeypot) {
  const o = { ...DEFAULTS, ...opt };
  const list = clicks.map(c => ({ ...c, reasons: [...(c.reasons || [])] })).sort((a, b) => a.ts - b.ts);
  const hit = c => honeypot && c.url && (honeypot instanceof RegExp ? honeypot.test(c.url) : c.url.includes(honeypot));
  for (let i = 0; i < list.length; i++) {
    let j = i;
    while (j + 1 < list.length && list[j + 1].ts - list[i].ts <= o.burstWindowMs) j++;
    const group = list.slice(i, j + 1);
    if (group.length >= o.burstMin) group.forEach(c => { if (!c.bot) { c.bot = true; c.reasons.push(`${o.burstWindowMs / 1000} 秒內連續 ${group.length} 次點擊`); } });
  }
  for (const h of list.filter(hit)) list.forEach(c => {
    if (Math.abs(c.ts - h.ts) <= o.burstWindowMs && !c.bot) { c.bot = true; c.reasons.push("和陷阱連結同時被點"); }
    if (c === h && !c.reasons.includes("點了真人看不到的陷阱連結")) { c.bot = true; c.reasons.push("點了真人看不到的陷阱連結"); }
  });
  return list;
}

/**
 * 統計一位收件人「真人」的行為：開信次數、點擊次數、最早點擊
 * @returns {{opens:number, clicks:number, firstClick:number|null, botClicks:number}}
 */
export function summarize({ opens = [], clicks = [] }) {
  const human = clicks.filter(c => !c.bot);
  return {
    opens: opens.filter(x => !x.bot).length,
    clicks: human.length,
    botClicks: clicks.length - human.length,
    firstClick: human.length ? Math.min(...human.map(c => c.ts)) : null,
  };
}

/** 產生信裡的隱形陷阱連結（真人看不到、掃描器會點） */
export function honeypotLink(href) {
  const e = s => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<a href="${e(href)}" style="display:none;font-size:0;line-height:0;max-height:0;overflow:hidden;mso-hide:all" aria-hidden="true" tabindex="-1">&nbsp;</a>`;
}
