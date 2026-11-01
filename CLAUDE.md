# WORKVERSE repository guidance

WORKVERSE is a local Node.js / vanilla JavaScript game based on Business Tycoon. See README.md for the current product and launch instructions; README.business-tycoon.md preserves the upstream description.

- Main application: workverse/index.html, workverse/client/, workverse/server/.
- Install: npm ci --prefix workverse/server. Test: npm test --prefix workverse/server.
- Tests use mocked providers and isolated temporary stores; do not call real model APIs without user authorization.
- Preserve secrets, saves and backups. Local private data belongs in ignored .workverse/; legacy development workspaces may use external storage.
- Preserve upstream MIT attribution. Do not enable upstream domains, analytics, deployment or external company-management integrations.
- Keep simulation results separate from actual model replies and real financial transactions.
- Use atomic persistence, explicit failure feedback and bounded model retries. Preserve existing projects when changing schemas.
