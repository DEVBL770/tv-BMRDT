# État du projet

_Dernière mise à jour : 2026-09-30_

- **Étape courante** : étapes 3–4 et 6 (player connecté/offline) sont implémentées et vérifiées localement. L'interface admin complète de l'étape 5 reste différée.
- **Environnements** : Node.js 22, pnpm 10, Vite et Supabase CLI 2.117.0. Supabase local, les fonctions et le mock Hebcal sont utilisés pour l'intégration ; aucun environnement de production n'est déployé.
- **Données de référence** : provider Hebcal et fixture enregistrée de 401 jours (2026-09-01 → 2027-10-06) ; comparaison `@hebcal/core`/`kosher-zmanim` sur 12 dates dans `docs/VALIDATION_RELIGIEUSE.md`. Les relevés CalJ/Chabad et l'approbation de méthode restent manuels.
- **Backend** : migrations, seed local, RLS, Storage privé, audit, versions publiées immuables et Edge Functions `pair`, `player`, `admin`, `weather`. Le partage Deno du domaine est généré par `pnpm sync:shared`.
- **Administration** : connexion minimale par e-mail/mot de passe et repositories démo/Supabase ; l'inscription publique reste fermée. La configuration de production est décrite dans `DEPLOYMENT.md`.
- **Player** : `/display` conserve le mode démo sans variables Supabase ; le mode réel utilise appairage, IndexedDB, SW Workbox, activation sans reload, météo et synchronisation appareil. Les fonctions de gestion admin complètes restent hors périmètre.
- **Intégration** : 34 cas distincts réussis dans `supabase/tests/backend.integration.test.ts` après un `supabase db reset` complet.
- **Vérification locale** : reset des migrations réussi ; lint, format, typecheck, 59 tests unitaires, build, 4 E2E et 34 tests d'intégration réussis. Le test player couvre l'appairage, le reload hors ligne, l'activation v2, le média corrompu et la révocation.
- **Captures E2E** : les captures de l'affichage, de l'admin mobile, de l'appairage et de l'écran player en ligne sont sous `artifacts/screenshots/` (ignoré par Git) ; elles ne sont pas relues manuellement.
- **Décisions en attente** : voir `DECISIONS.md` ; les méthodes religieuses sont toujours `pending`.
- **Blocages de raccordement** : dépôt GitHub public à passer en privé par son propriétaire ; accès Cloudflare/Supabase, logo et validation religieuse à fournir avant la production.
- **Prochaine étape** : l'interface admin complète de l'étape 5 viendra dans une handoff ultérieure ; elle n'a pas été commencée.
