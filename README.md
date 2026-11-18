# 電子報點擊率不準？過濾信箱安全掃描造成的假點擊、假開信

**email-click-bot-filter** 是一個開源的 JavaScript 函式庫，用來分辨電子報的點擊和開信，哪些是**真人**，哪些是**信箱安全掃描**造成的假紀錄。

很多公司的企業信箱都有安全防護，例如 Microsoft Defender 的 Safe Links、Barracuda、Proofpoint、Mimecast。信一寄到，系統會先自動打開信、點遍裡面所有連結，檢查有沒有惡意網站。結果就是：

- 剛寄出幾秒，後台就顯示「已開信」「已點擊」。
- 同一位收件人在同一秒點了信裡**每一個**連結。
- 點擊率高得不合理，業務照著名單打電話，對方根本沒看過信。

這個函式庫把這些假紀錄挑出來，讓開信率、點擊率回到真實數字，後續的自動跟進信、業務名單也不會被誤導。

## 目錄

- [判斷規則](#判斷規則)
- [安裝與使用](#安裝與使用)
- [API](#api)
- [限制](#限制)
- [常見問題](#常見問題)
- [延伸閱讀](#延伸閱讀)

## 判斷規則

| 規則 | 預設值 | 原因 |
|---|---|---|
| User-Agent 是掃描器或程式 | 內建關鍵字清單 | safelinks、barracuda、proofpoint、python、curl、headless… |
| 沒有 User-Agent、HEAD 請求 | — | 只檢查連結、沒有真的打開網頁 |
| 寄出後太快點擊 | 60 秒內 | 真人幾乎不可能信一到就點 |
| 寄出後太快開信 | 20 秒內 | 掃描器收信後立刻讀取追蹤像素 |
| 同一位收件人密集點擊 | 3 秒內 3 次以上 | 掃描器會同時點遍所有連結 |
| 點了隱形陷阱連結 | 自訂 | 真人看不到這條連結，會點的只有掃描器 |

所有數字都可以調整。

## 安裝與使用

不需要任何套件，Node.js 18 以上、瀏覽器、Cloudflare Workers 都能用。

```bash
git clone https://github.com/ymlin520/email-click-bot-filter.git
```

### 1. 收到點擊時即時判斷

```js
import { checkClick } from "./src/index.js";

const r = checkClick(
  { ts: Date.now(), ua: req.headers.get("user-agent"), method: req.method, url: req.url },
  { sentAt: 寄出時間的毫秒數, recent: 這位收件人最近的點擊紀錄, honeypot: "hp=1" }
);
// r = { bot: true, reasons: ["寄出後 8 秒就點擊"] }
```

### 2. 存檔後整批重算

掃描器的請求常常**同時**送達，即時判斷時資料庫還沒寫進前一筆，就會漏掉。存完之後把同一位收件人附近的點擊再跑一次：

```js
import { markBursts, summarize } from "./src/index.js";

const marked = markBursts(這位收件人的點擊紀錄, {}, "hp=1");
summarize({ clicks: marked }); // { clicks: 1, botClicks: 4, firstClick: ... }
```

### 3. 在信裡放一條隱形陷阱連結

```js
import { honeypotLink } from "./src/index.js";
html += honeypotLink("https://你的網域/c/收件人代碼?u=https://example.com&hp=1");
```

完整的 Cloudflare Workers＋D1 轉址範例見 [`examples/cloudflare-worker.js`](examples/cloudflare-worker.js)。


### 4. WordPress 外掛版

想直接放在自己的 WordPress 網站上，可以用「澄熠 LUCEVO・AI 工具箱」外掛：上傳、啟用就會自動建立 `/email-click-checker/` 工具頁（電子報點擊檢查），頁面可在 Elementor 逐區塊改字，並內建 Rank Math SEO 與 schema。同一支外掛也包含 AI 自動化檢測、電子報範本產生器、電子報點擊檢查三個工具，在「設定 → LUCEVO 工具箱」分三個分頁各自開關與設定。

線上版：[電子報點擊檢查](https://ai.hostswp.com/email-click-checker/)

## API

| 函式 | 用途 |
|---|---|
| `checkClick(click, ctx, opt)` | 即時判斷一次點擊，回傳 `{ bot, reasons }` |
| `checkOpen(open, ctx, opt)` | 即時判斷一次開信（追蹤像素） |
| `markBursts(clicks, opt, honeypot)` | 事後整批標記密集點擊與陷阱連結附近的點擊，不改動原資料 |
| `summarize({ opens, clicks })` | 統計真人開信數、點擊數、最早點擊時間 |
| `honeypotLink(href)` | 產生真人看不到的陷阱連結 HTML |
| `DEFAULTS`、`BOT_UA` | 預設門檻與掃描器關鍵字，可以自行覆寫 |

`reasons` 是中文說明，可以直接顯示在後台，方便業務知道為什麼這筆被排除。

## 限制

- **Apple Mail 隱私保護**會在收信時預先載入圖片，開信紀錄看起來像真人，這個函式庫無法分辨，建議以「點擊」而不是「開信」當作意願指標。
- 部分防護會在**真人點擊當下**才掃描連結（time-of-click），常見的樣子是先出現一筆 Linux 的請求，幾十秒後才是真人的瀏覽器。目前這種情況仍算真人點擊。
- 規則是經驗值，不同產業、不同收件人的信箱防護差很多，建議先觀察一陣子再調整門檻。

## 常見問題

**為什麼電子報剛寄出就有人點擊？**
大多是收件人公司的信箱安全掃描。它們會在信送到收件匣前，先把所有連結打開檢查一遍。

**會不會把真人誤判成掃描？**
有可能，例如收件人剛好在寄出後一分鐘內點擊。`reasons` 會寫清楚每筆被排除的原因，門檻也都可以調整。

**可以用在 Mailchimp、Brevo 嗎？**
這些平台的點擊是在它們的伺服器上記錄的，拿不到每次請求的資料。這個函式庫適合自己架點擊追蹤轉址的情況，例如 Cloudflare Workers、自己的網站後端或 n8n。

## 延伸閱讀

電子報的點擊資料準確之後，才能做後面的自動化：依點擊內容分級、自動寄跟進信、通知業務。這類流程可以參考：

- [AI導入懶人包：費用、補助、流程重點一次看懂](https://ai.hostswp.com/ai-adoption/)
- [AI導入案例：客服、行銷、營運 5 個部門的實際做法](https://ai.hostswp.com/ai-adoption/cases/)
- [自動化維修與維護：流程為什麼會突然停下來](https://ai.hostswp.com/automation-maintenance/)
- 同系列工具：[AI 自動化潛力檢測](https://github.com/ymlin520/ai-automation-checker)、[繁體中文電子報範本](https://github.com/ymlin520/tw-newsletter-template)

想把電子報、點擊追蹤、跟進信串成一條自動流程，可以 [預約 AI 導入諮詢](https://ai.hostswp.com/ai-consulting-2/)。

---

## English

**email-click-bot-filter** separates real human clicks and opens from email security scanners (Microsoft Safe Links, Barracuda, Proofpoint, Mimecast…) that pre-click every link in a message. Rules: scanner User-Agents, HEAD requests, clicks within N seconds of sending, bursts of clicks from one recipient, and hidden honeypot links. Zero dependencies; works in Node.js 18+, browsers and Cloudflare Workers. Run `npm test` for the test suite.

## 授權

MIT License。由 [澄熠 LUCEVO｜AI 自動化工作流規劃](https://ai.hostswp.com/) 製作與維護。
