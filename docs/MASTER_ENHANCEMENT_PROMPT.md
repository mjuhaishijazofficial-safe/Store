# Master Enhancement Prompt — Dukaan ERP (Kiryana ERP)

Paste this whole block at the start of any new session when you want Claude to keep pushing the app toward production-grade, "most advanced" quality — module by module, without you having to re-explain the project each time.

---

## Prompt to paste

```
Ye Dukaan ERP (kiryana-erp) — Pakistani kiryana store management app — hai:
Next.js 16 + Supabase (Postgres/Auth/RLS) + Stripe, repo: D:\Store\kiryana-erp.
Master Handoff Spec ke against bana hai, ab tak Khata (ledger + reversal +
invoice numbers), Stock Ledger Pattern, Multi-Branch, Voice Assistant
("Eagle" — Whisper/GPT se khata/inventory/expenses commands), aur core
modules (Billing/POS, Inventory, Suppliers, Purchase Orders, Reports,
Staff, Settings, Admin) implement ho chuke hain.

MERA GOAL: poori app ko, ek ek module karke, sabse advanced/production-grade
level tak le jao — jaisa ek real paid SaaS product hota hai. Har module mein
dekho: correctness bugs, missing edge cases, security/RLS gaps, data-
integrity issues, UX rough edges, aur jahan genuinely value-add ho wahan
naye features (lekin scope-creep nahi, sirf jo module ke maqsad ko behtar
kare).

ZAROORI RULES (mera Claude usage limited hai, isko follow karo):

1. Ek waqt mein EK chhota, well-scoped kaam karo — poori app ek saath mat
   chhero. Kaam khatam karo, verify karo, commit/push karo, phir agla.
2. Har change ke baad: tsc --noEmit, vitest, next build — teeno clean hone
   chahiye phir hi commit karo. Fail ho to fix karo ya bata do, chhupao mat.
3. Files dobara mat dikhao jo already dekh chuke ho isi session mein.
   Chhoti, targeted edits do — poori file re-paste mat karo jab tak
   genuinely nayi file na ho.
4. Sirf GENUINELY ambiguous product-decisions par pucho (jahan do
   reasonable raaste hain aur ghalat choice mehnga hoga). Baaki har jagah
   reasonable default khud choose karo aur bata do kyun.
5. Har module ke baad EK-LINE status do — poora essay nahi. Sirf: kya
   fix/add hua, tsc/test/build ka result, commit hash.
6. Agar koi cheez already sahi/robust hai, usay chhero — bataao "ye theek
   hai, change nahi kiya" aur agle par chalo. Wajah-bina refactor mat karo.
7. Live/production data ko chhoone se pehle socho — read-only diagnostics
   (curl/service-role queries) theek hain, lekin destructive/schema
   changes se pehle ek line mein bata do kya karne wale ho.
8. Budget khatam hone ke qareeb ho (session ke shuru mein bata dena agar
   pata ho) — is soorat mein sabse HIGH-IMPACT, LOW-RISK fix pehle karo,
   phir ruk kar poochho ke aage badhna hai ya nahi.

PRIORITY ORDER (upar se neeche, jab tak main na kahoon):

P0 — Correctness & Security (hamesha pehle)
  - RLS policies: har naya table check karo ke RLS enabled hai + sahi
    scoped policy hai (shop_id = my_shop_id() pattern)
  - Data races: koi bhi jagah jahan client "read current value, compute,
    write back" karta hai (server-side RPC/transaction se replace karo)
  - Double-submit guards: har save/insert button pe busy-state check hai?
  - Money/stock-affecting actions: sab kuch stock_movements ledger se
    consistent hai? Koi direct items.stock update to nahi ho raha kahin?

P1 — Missing/Broken User Flows
  - Har module ka apna CRUD (create/read/update/delete jahan applicable)
    complete hai? Koi silent-fail wala button hai (jaisa purana
    create_purchase_order wala masla tha)?
  - Error messages generic hain ya asal wajah dikhate hain?
  - Mobile/RTL (Urdu) mein sab theek render hota hai?

P2 — Depth/Polish
  - Reports/Analytics: kya sahi numbers aa rahe hain, koi discrepancy?
  - Voice (Eagle): naye commands add karne layak modules (jo abhi cover
    nahi hain), accuracy/latency improvements
  - Performance: N+1 queries, missing indexes, unnecessary re-fetches
  - i18n: koi hardcoded English string reh gayi Urdu mein?

Ek dafa ek module choose karo (jaisa: "Suppliers module" ya "Reports
page"), us par is process se kaam karo, phir agle module ka naam batao
aur poochho ke wahi continue karna hai ya kuch aur.

Shuru karne se pehle: batao ke abhi tumhare pass kya context hai is app
ka (kya files already dekh chuke ho is session mein), aur pehla module
suggest karo jahan se shuru karna best rahega.
```

---

## Usage tips

- **Weekly usage 85%+ ho to**: pehle sirf ek chhota P0 fix karwao (jaisa
  ek RLS gap ya double-submit guard), phir dekho kitna usage bacha —
  us hisaab se decide karo aage kitna karwana hai.
- **Naya session shuru karte waqt**: agar pichla session kisi module ke
  beech mein ruka tha, pehli line mein wo bata do: "pichli baar Reports
  module adha ho gaya tha, wahi se continue karo."
- Ye file khud repo mein hai (`docs/MASTER_ENHANCEMENT_PROMPT.md`) —
  update karte raho jaise app grow kare, taake har naya session usi se
  shuru ho.
