// 範例：Cloudflare Workers ＋ D1 的點擊追蹤轉址
// 信裡的連結寫成 https://你的網域/c/<收件人代碼>?u=<目標網址>
// 資料表：
//   CREATE TABLE clicks (id INTEGER PRIMARY KEY, rid TEXT, url TEXT, ts INTEGER, ua TEXT, bot INTEGER, reasons TEXT);
//   CREATE TABLE sends  (rid TEXT PRIMARY KEY, sent_at INTEGER);
import { checkClick, markBursts } from "../src/index.js";

const HONEYPOT = "hp=1"; // 信裡用 honeypotLink(".../c/<rid>?u=...&hp=1") 放一條隱形連結

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/c\/([\w-]+)$/);
    const target = url.searchParams.get("u");
    // 正式使用請在連結加簽章（例如 HMAC(rid+u)）並驗證，否則這支轉址會變成任何人都能利用的開放轉址
    if (!m || !target || !/^https?:\/\//.test(target)) return new Response("Not found", { status: 404 });
    const rid = m[1], ts = Date.now();

    ctx.waitUntil((async () => {
      const db = env.DB;
      const sent = await db.prepare("SELECT sent_at FROM sends WHERE rid=?").bind(rid).first();
      const recent = (await db.prepare("SELECT ts FROM clicks WHERE rid=? AND ts>?").bind(rid, ts - 3000).all()).results;
      // 1) 即時判斷
      const r = checkClick({ ts, ua: req.headers.get("user-agent") || "", method: req.method, url: req.url },
        { sentAt: sent?.sent_at, recent, honeypot: HONEYPOT });
      await db.prepare("INSERT INTO clicks(rid,url,ts,ua,bot,reasons) VALUES(?,?,?,?,?,?)")
        .bind(rid, target, ts, (req.headers.get("user-agent") || "").slice(0, 200), r.bot ? 1 : 0, r.reasons.join("；")).run();
      // 2) 事後整批：併發請求時即時判斷可能漏掉，存完再把同一位收件人附近的點擊重算一次
      const near = (await db.prepare("SELECT id, ts, url, bot FROM clicks WHERE rid=? AND ts BETWEEN ? AND ?").bind(rid, ts - 10000, ts + 2000).all()).results;
      const marked = markBursts(near.map(c => ({ ...c, bot: !!c.bot })), {}, HONEYPOT);
      const fix = marked.filter(c => c.bot && !near.find(n => n.id === c.id).bot);
      if (fix.length) await db.batch(fix.map(c => db.prepare("UPDATE clicks SET bot=1, reasons=? WHERE id=?").bind(c.reasons.join("；"), c.id)));
    })());

    // HEAD 請求不轉址也沒關係，GET 一律照常轉到目標網址，不讓掃描器影響真人
    return Response.redirect(target, 302);
  },
};
