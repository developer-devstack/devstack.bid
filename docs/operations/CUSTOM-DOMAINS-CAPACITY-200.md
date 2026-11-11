# แผนทรัพยากร: Custom domain + server bindings (100–200 ผู้ใช้ / โดเมน)

สถานะ: **พัฒนาเสร็จในโค้ด — ปิดให้ผู้ใช้ทั่วไป** (`CUSTOM_DOMAINS_ENABLED=false`, `SERVER_BINDINGS_ENABLED=false` ใน `wrangler.jsonc`) จนกว่า owner จะ pilot ภายในและเปิด flag

อ้างอิงการประเมินผลิตภัณฑ์ (deep idea #10: custom domain เป็น blocker สำหรับ production จริง) — เป้าหมายรอบแรก **100–200 โดเมนที่ active** บนบัญชี Cloudflare เดียวกับ DevStack

## สรุปทรัพยากรที่ใช้

| ชั้น | สิ่งที่ต้องมี | สเกล ~200 โดเมน | หมายเหตุ |
|------|----------------|-----------------|----------|
| **Cloudflare Workers** | Router `devstack-sites` + WfP namespace `devstack-sites` | ไม่เพิ่ม Worker ต่อโดเมน | แต่ละโดเมน = Workers Custom Domain → service เดียว |
| **Workers Custom Domains** | `PUT …/workers/domains` ต่อ hostname | ≤200 records | SSL ออกโดย Cloudflare ต่อ hostname (โซนต้องอยู่ในบัญชี `SITES_CF_ACCOUNT_ID`) |
| **Cloudflare API** | Token `SITES_CF_API_TOKEN` (Scripts: Edit + zone) | ~1,200 req / 5 min (account) | Verify เรียก API 1 ครั้ง/โดเมน; จำกัด D1 + `NVX_DOMAINS_LIMITER` |
| **R2 `devstack-sites`** | `custom-hosts/<hostname>.json` | ~200 ไฟล์ JSON เล็ก | sync คู่ promote/rollback (parallel put) |
| **D1** | `project_custom_domains`, `usage_counters` | ~200–600 แถว | migration `0024` + `0024` ไม่ต้องแยก bucket |
| **D1 writes** | register/verify/audit | ต่ำ | อยู่ใต้ budget ที่ `DEVSTACK_EXPECTED_DAILY_USERS` ครอบอยู่แล้ว |
| **Platform Worker** | `nvx-stack-builder` | คงที่ | APIs `/api/projects/.../domains`, `/api/admin/hosting-capacity` |
| **SSR (optional)** | Workers AI binding ต่อ user script | ตามจำนวน OpenNext โปรเจกต์ที่เปิด `ai` | ค่า inference อยู่ที่บัญชีแพลตฟอร์ม — เปิดทีละขั้นหลังอนุมัติ |

## ตัวแปรควบคุม (defaults ใน `wrangler.jsonc`)

| ตัวแปร | ค่าเริ่มต้น | ความหมาย |
|--------|------------|----------|
| `CUSTOM_DOMAINS_ENABLED` | `false` | ปิด API/UI — เปิดเป็น `true` เมื่อ pilot พร้อม |
| `SERVER_BINDINGS_ENABLED` | `false` | ปิด binding AI จนกว่าจะพร้อม |
| `DEVSTACK_CUSTOM_DOMAINS_MAX_ACTIVE` | `200` | เพดานโดเมน `active` ทั้งแพลตฟอร์ม |
| `DEVSTACK_CUSTOM_DOMAINS_MAX_USERS` | `200` | เพดานผู้ใช้ที่มี ≥1 โดเมน active |
| `DEVSTACK_CUSTOM_DOMAINS_PER_PROJECT` | `3` | ต่อโปรเจกต์ |
| `DEVSTACK_CUSTOM_DOMAINS_REGISTER_PER_USER_DAY` | `5` | D1 quota เพิ่มโดเมนต่อวัน |
| `DEVSTACK_CUSTOM_DOMAINS_VERIFY_PER_USER_DAY` | `20` | D1 quota verify ต่อวัน (แต่ละครั้งยิง CF API) |
| `DOMAINS_BURST_PER_MIN` | `8` | สำรอง in-memory คู่ `NVX_DOMAINS_LIMITER` |

## Rate limiting

- Binding **`NVX_DOMAINS_LIMITER`** (namespace `4716`): 8 req/min/IP บน POST add + verify
- เขียน domain API ยังผ่าน `gate()` burst ทั่วไป

## วิธีเปิด pilot (ต้องอนุมัติ owner)

1. รัน D1 migration **`0024_project_domains_bindings.sql`** บน production D1
2. ยืนยัน `SITES_CF_API_TOKEN`, wildcard `*.devstack.bid`, WfP namespace พร้อม (GO เดิม)
3. ตั้ง `CUSTOM_DOMAINS_ENABLED=true` (staging ก่อน prod)
4. ตรวจ `GET /api/admin/hosting-capacity` (admin) — `headroom.domains` / `headroom.users`
5. Pilot กับผู้ใช้ 100–200 คน; เมื่อ stable ค่อย `SERVER_BINDINGS_ENABLED=true` สำหรับ SSR ที่ต้องการ AI
6. อัปเดต FAQ / ประกาศเปิดใช้

## การติดตาม

| สัญญาณ | ที่ดู |
|--------|------|
| โควต้าโดเมน | `GET /api/admin/hosting-capacity` |
| Audit | D1 `audit_events`: `domain.pending`, `domain.active`, `domain.removed`, `domain.error` |
| ข้อผิดพลาด CF | verify API `code: cf_api`, log `domain.error` |
| Traffic | Wrangler tail `devstack-sites` + `nvx-stack-builder` |

## สิ่งที่ยังไม่รวมในรอบนี้

- โซน DNS นอกบัญชี Cloudflare (SSL for SaaS / CNAME-only ลูกค้า)
- MCP tools สำหรับโดเมน
- Cron reconcile อัตโนมัติทั้งแพลตฟอร์ม (sync R2 ด้วยมือผ่าน promote/redeploy หรือ admin tool ภายหลัง)
- แยก registrable domain สำหรับ user sites (แผน long-term ใน `AI-CHAT-BUILDER.md`)

## ค่าใช้จ่ายโดยประมาณ

- **ไม่มี SKU แยกในแอป** รอบ pilot
- ค่า registrar เป็นของลูกค้า
- Workers/R2/D1/API บนแพลตฟอร์ม — **ต้องอนุมัติ owner** ก่อนเปิด flag; 200 Custom Domains ยังอยู่ในโควตา Workers Paid ทั่วไป แต่ควร monitor CF dashboard billing

---

English summary: ship-dark feature flags, hard caps at 200 active domains / 200 users, per-project limit 3, D1 daily quotas, dedicated burst limiter, admin capacity endpoint, audit events. Flip `CUSTOM_DOMAINS_ENABLED` only after migration + owner approval.
