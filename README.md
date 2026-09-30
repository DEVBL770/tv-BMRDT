# Écran Beth Menahem

Écran d'information permanent de la synagogue Beth Menahem (Paris 19e, Habad) :
affichage TV 16:9 sur `/display` et console d'administration mobile-first sur
`/admin`.

Documentation de référence : [ARCHITECTURE](ARCHITECTURE.md) ·
[DECISIONS](DECISIONS.md) · [SOURCES_AND_RIGHTS](SOURCES_AND_RIGHTS.md) ·
[TODO](TODO.md) · [PROJECT_STATE](PROJECT_STATE.md).

Guides d'exploitation : [DEPLOYMENT](DEPLOYMENT.md) ·
[WINDOWS_KIOSK](WINDOWS_KIOSK.md) · [ADMIN_GUIDE](ADMIN_GUIDE.md) ·
[EXPORT_RESTORE](EXPORT_RESTORE.md).

## Démarrer en développement

Prérequis : Node.js 22 et pnpm 10 via Corepack.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm dev --host 0.0.0.0
```

Vite affiche l'adresse locale (par défaut `http://localhost:5173`). Ouvrir
`/display` pour l'écran ou `/admin` pour la console. Sans configuration
Supabase, l'administration reste en mode démo et conserve son brouillon dans le
navigateur ; avec les variables Supabase locales, elle utilise Auth, les Edge
Functions et le dépôt Supabase.

La fixture locale couvre du 1er septembre 2026 au 6 octobre 2027. Pour simuler
un instant, ouvrir `/display?demo=1&at=2026-10-02T21:00`. Le paramètre
`?mode=playlist` affiche la playlist. Pour activer le mode démo global, définir
`VITE_DEMO_MODE=true` dans un fichier `.env.local` local, puis redémarrer Vite.
La régénération de la fixture appelle Hebcal et nécessite une connexion :

```sh
pnpm fixture:demo
```

## Vérifications locales

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install --with-deps chromium
pnpm e2e
pnpm test:integration
```

Les tests E2E/integration nécessitent Supabase local, les Edge Functions et le
mock Hebcal. Les captures Playwright sont écrites sous
`artifacts/screenshots/` (répertoire ignoré par Git). Pour les étapes
d'administration, voir [ADMIN_GUIDE](ADMIN_GUIDE.md). Les commandes disponibles
incluent aussi `pnpm format` et `pnpm preview`.

Les spécifications fonctionnelles et décisions d'architecture détaillées sont
dans les documents de référence ci-dessus.
