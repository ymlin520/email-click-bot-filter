import { test } from "node:test";
import assert from "node:assert/strict";
import { checkClick, checkOpen, markBursts, summarize, honeypotLink } from "../src/index.js";

const sent = Date.parse("2026-11-18T09:00:00+08:00");
const min = 60_000;
const chrome = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36";

test("真人：寄出 2 小時後用 Chrome 點擊", () => {
  const r = checkClick({ ts: sent + 120 * min, ua: chrome }, { sentAt: sent });
  assert.equal(r.bot, false);
});

test("掃描器 User-Agent", () => {
  const r = checkClick({ ts: sent + 120 * min, ua: "Mozilla/5.0 (compatible; Barracuda Sentinel)" }, { sentAt: sent });
  assert.equal(r.bot, true);
});

test("寄出 10 秒內就點擊", () => {
  const r = checkClick({ ts: sent + 10_000, ua: chrome }, { sentAt: sent });
  assert.equal(r.bot, true);
  assert.match(r.reasons[0], /10 秒/);
});

test("HEAD 請求與空 User-Agent", () => {
  assert.equal(checkClick({ ts: sent + 5 * min, ua: chrome, method: "HEAD" }, { sentAt: sent }).bot, true);
  assert.equal(checkClick({ ts: sent + 5 * min, ua: "" }, { sentAt: sent }).bot, true);
});

test("即時連點：3 秒內已有 2 次", () => {
  const t = sent + 30 * min;
  const r = checkClick({ ts: t, ua: chrome }, { sentAt: sent, recent: [{ ts: t - 800 }, { ts: t - 1500 }] });
  assert.equal(r.bot, true);
});

test("陷阱連結", () => {
  const r = checkClick({ ts: sent + 30 * min, ua: chrome, url: "https://x.test/c/abc?hp=1" }, { sentAt: sent, honeypot: "hp=1" });
  assert.equal(r.bot, true);
});

test("事後整批：併發的 4 次點擊全部標成掃描，隔 10 分鐘的真人點擊保留", () => {
  const t = sent + 5 * min;
  const out = markBursts([
    { ts: t, url: "a" }, { ts: t + 200, url: "b" }, { ts: t + 210, url: "c" }, { ts: t + 900, url: "d" },
    { ts: t + 10 * min, url: "a" },
  ]);
  assert.deepEqual(out.map(c => !!c.bot), [true, true, true, true, false]);
  assert.equal(summarize({ clicks: out }).clicks, 1);
});

test("事後整批：陷阱連結附近的點擊一起標掉", () => {
  const t = sent + 5 * min;
  const out = markBursts([{ ts: t, url: "a" }, { ts: t + 500, url: "hp" }, { ts: t + 20 * min, url: "a" }], {}, "hp");
  assert.deepEqual(out.map(c => !!c.bot), [true, true, false]);
});

test("開信：寄出 5 秒內是掃描、1 小時後是真人", () => {
  assert.equal(checkOpen({ ts: sent + 5000, ua: chrome }, { sentAt: sent }).bot, true);
  assert.equal(checkOpen({ ts: sent + 60 * min, ua: chrome }, { sentAt: sent }).bot, false);
});

test("陷阱連結 HTML 不顯示", () => {
  assert.match(honeypotLink("https://x.test/?hp=1"), /display:none/);
});
