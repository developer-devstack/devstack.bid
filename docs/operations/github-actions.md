# GitHub Actions — ตรวจ repo และ deploy แพลตฟอร์ม DevStack

Workflow นี้สำหรับ **โค้ดแพลตฟอร์ม** (`developer-devstack/devstack.bid`) เท่านั้น — deploy Worker **`nvx-stack-builder`** ไป **devstack.bid** ผ่าน `npm run deploy` (OpenNext + Wrangler)

**ไม่ใช่** ระบบโฮสต์โปรเจกต์ลูกค้า (`*.devstack.bid`) ซึ่ง build ผ่าน container / webhook แยกต่างหาก

## Workflows

| ไฟล์ | เมื่อไหร่ | ทำอะไร |
|------|-----------|--------|
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | ทุก **PR** และ **push** ที่ `main` | `lint`, `typecheck`, `test`, `docs:check`, `npm run build`, **`npm run cf:build`** (ไม่ใช้ secret) |
| [`.github/workflows/platform-deploy.yml`](../../.github/workflows/platform-deploy.yml) | หลัง **CI ผ่าน** บน `main` หรือ **Run workflow** มือ | `npm run deploy` + smoke test บน https://devstack.bid |

Flow บน `main`: push → CI → (ถ้าเขียว) Platform deploy → Worker version ใหม่

## ตั้งค่า GitHub (ครั้งเดียว)

Repository → **Settings** → **Secrets and variables** → **Actions**:

| Secret | ค่า (ไม่ commit) |
|--------|------------------|
| `CLOUDFLARE_API_TOKEN` | API token บัญชี production ที่มีสิทธิ์ **Workers Scripts: Edit** (และ custom domains ตามที่ deploy ใช้อยู่) |
| `CLOUDFLARE_ACCOUNT_ID` | `2d92bd5b25768fa9093d6adc0a8887fc` (devstack.bid) |

แนะนำสร้าง **Environment** ชื่อ `production` (Settings → Environments) แล้วใส่ secrets ที่ environment นั้น และเปิด **Required reviewers** ถ้าต้องการอนุมัติมนุษย์ก่อน deploy แม้ CI ผ่านแล้ว

Worker secrets อื่น (`OPENAI_API_KEY`, `CURSOR_APP_ID`, ฯลฯ) **ไม่** ตั้งใน GitHub — ยังอยู่บน Cloudflare ตาม [deploy-cloudflare.md](./deploy-cloudflare.md) ; deploy job อัปโหลดโค้ดเท่านั้น ไม่ล้าง secrets เดิม

## D1 / migration

ถ้า PR มี migration D1 ใหม่ ต้องรัน `npm run db:migrate:remote` **ก่อน** merge หรือหลัง deploy **ก่อน** traffic ใช้โค้ดใหม่ (ต้องอนุมัติแยก — ไม่รวมใน workflow นี้)

## แยกจาก Cloudflare “Workers Builds”

ถ้า repo ผูก Git integration บน Cloudflare Dashboard อาจมี check ชื่อ Workers Builds ซ้ำกับ GHA — เลือกใช้ทางใดทางหนึ่งหรือให้ทั้งคู่ build เดียวกัน ดู [deploy-cloudflare.md](./deploy-cloudflare.md)

## Rollback

บันทึก version id จาก job summary (หรือ `wrangler deployments list`) แล้วทำตาม [rollback.md](./rollback.md)