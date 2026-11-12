# Custom domain + server bindings — rollout runbook

สถานะรวม: **Phase 0–3 เสร็จ** (deploy 2026-11-12) · Worker version **`3faa0b9e-e07c-42a8-ba6d-7b46a8393f50`** · D1 0024 ✅ · `CUSTOM_DOMAINS_ENABLED=false` (ship-dark) · Phase 4 pilot รอ smoke ภายใน

อ้างอิงทรัพยากร: [CUSTOM-DOMAINS-CAPACITY-200.md](./CUSTOM-DOMAINS-CAPACITY-200.md) · ฟีเจอร์: [../platform/CUSTOM-DOMAINS-HOSTING.md](../platform/CUSTOM-DOMAINS-HOSTING.md)

## Phase 0 — โค้ดบน main

| Step | สถานะ | หมายเหตุ |
|------|--------|----------|
| Merge `cursor/custom-domains-server-bindings-c310` → `main` | ✅ | Fast-forward `cf7536f` |
| ลบสาขา feature | ✅ | `cursor/custom-domains-server-bindings-c310` |
| `CUSTOM_DOMAINS_ENABLED` / `SERVER_BINDINGS_ENABLED` = `false` | ✅ | Ship-dark |

## Phase 1 — ทดสอบบนเครื่อง

| Step | คำสั่ง | สถานะ |
|------|--------|--------|
| D1 local รวม `0024_project_domains_bindings.sql` | `npm run db:migrate:local` | ✅ |
| Lint / typecheck / tests / docs | `npm run lint && npm run typecheck && npm test && npm run docs:check` | รันก่อน deploy |
| cf build | `npm run cf:build` | รันก่อน deploy |

## Phase 2 — D1 production (ต้อง token บัญชี production)

**ลำดับ:** migrate remote **ก่อน** deploy Worker ที่เรียก table ใหม่

```bash
export CLOUDFLARE_ACCOUNT_ID=2d92bd5b25768fa9093d6adc0a8887fc
# ใช้ token ที่มี D1 migrate บนบัญชีนี้ (เช่น EXAMPLESSDK) — ไม่ commit token
printenv CLOUDFLARE_API_TOKEN | npx wrangler d1 migrations apply nvx-db --remote
npm run db:migrations:list   # ต้องเห็น 0024 ✅
```

| สถานะ | หมายเหตุ |
|--------|----------|
| ⏳ รอ owner | Cloud agent VM ได้ API 7403 (account ไม่ authorized) — ต้องรันจากเครื่อง owner |

## Phase 3 — Deploy Worker (ต้องอนุมัติ deploy)

ตาม [deploy-cloudflare.md](./deploy-cloudflare.md):

```bash
npm run lint && npm run typecheck && npm test && npm run docs:check && npm run cf:build
npm run deploy   # หรือ pipeline ที่ owner ใช้
```

บันทึก **version id** หลัง deploy ใน CHANGELOG / บันทึก ops

## Phase 4 — Pilot ภายใน (ยังไม่ประกาศสาธารณะ)

1. ยังคง `CUSTOM_DOMAINS_ENABLED=false` บน prod จนกว่าจะทดสอบครบ
2. **ตัวเลือก A — preview workers.dev:** deploy ด้วย vars override ใน preview (ถ้ามี pipeline)
3. **ตัวเลือก B — prod flag เฉพาะ admin:** ตั้ง `CUSTOM_DOMAINS_ENABLED=true` ใน `wrangler.jsonc` แล้ว deploy อีกครั้งเมื่อพร้อม pilot 100–200 คน
4. Smoke:
   - `GET https://devstack.bid/api/hosting/capabilities` → `customDomains: true` (หลังเปิด flag)
   - Admin: `GET https://devstack.bid/api/admin/hosting-capacity` → `headroom.domains` = 200
   - โปรเจกต์ที่ production deploy แล้ว: เพิ่มโดเมน → TXT → verify (โซนบน CF account เดียวกับ `SITES_CF_*`)

## Phase 5 — SSR bindings (หลังโดเมนนิ่ง)

1. `SERVER_BINDINGS_ENABLED=true` + deploy
2. เปิด AI binding บนโปรเจกต์ OpenNext → production deploy ครั้งถัดไป
3. ตรวจ Workers AI usage / cost บน dashboard

## Phase 6 — เปิดสาธารณะ

1. อัปเดต FAQ (`home.faq2.a3`) จาก “internal pilot” เป็นคำอธิบายที่เปิดใช้จริง
2. ประกาดช่องทางที่ owner เลือก
3. เปิดรับจนถึงเพดาน `DEVSTACK_CUSTOM_DOMAINS_MAX_ACTIVE` / `MAX_USERS`

## Checklist หลัง pilot

| สัญญาณ | ที่ดู |
|--------|------|
| โควต้า | `/api/admin/hosting-capacity` |
| Audit | `audit_events` (`domain.*`) |
| CF API errors | verify → `cf_api` |
| Rollback plan | `wrangler rollback <version>` ไม่ถอด custom domains ของผู้ใช้ |

## ค่าใช้จ่าย

ไม่มี SKU แยกในแอปรอบนี้ — ค่า Workers Custom Domain + SSL บนบัญชีแพลตฟอร์ม; owner อนุมัติ spend ก่อน Phase 4
