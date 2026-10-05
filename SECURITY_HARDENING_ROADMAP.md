# Security Hardening Roadmap (Phase 0)

## 0.1 Database Credential Rotation
- [x] drizzle.config.ts reads from process.env.DATABASE_URL (env-only)
- [ ] ROTATED: Original credential replaced with ROTATED_PLACEHOLDER_PLEASE_UPDATE_IN_SECURE_ENV in .env
- [ ] ACTION REQUIRED: Rotate the actual password in Supabase for postgres.irvgudzebislnozpatqx immediately
- [ ] ACTION REQUIRED: If this repo was ever pushed to GitHub/GitLab, treat the old credential as compromised and invalidate it

The following files were confirmed:
- drizzle.config.ts: reads url from process.env.DATABASE_URL
- src/db/index.ts: reads DATABASE_URL from env and validates presence

## 0.2 Destructive Build Behavior
- [x] package.json: no postbuild script present
- [x] db:reset and db:seed are explicit developer commands (tsx src/db/reset.ts --confirm, tsx src/db/seed.ts --confirm)
- [x] npm run build does not touch production database

Verification:
- grep for postbuild: none
- build isolated from DB operations

## Next Steps
1. Update .env with the new Supabase password (securely, not in git)
2. Rotate credentials in Supabase
3. Revoke/cleanup any exposed credentials
