# État du projet

_Dernière mise à jour : 2026-09-30_

- **Étape courante** : étapes 3–4 implémentées et vérifiées localement. L'interface admin complète et le player connecté/offline restent à faire.
- **Environnements** : Node.js 22, pnpm 10, Vite et Supabase CLI 2.117.0. Supabase local, les fonctions et le mock Hebcal sont utilisés pour l'intégration ; aucun environnement de production n'est déployé.
- **Données de référence** : provider Hebcal et fixture enregistrée de 401 jours (2026-09-01 → 2027-10-06) ; comparaison `@hebcal/core`/`kosher-zmanim` sur 12 dates dans `docs/VALIDATION_RELIGIEUSE.md`. Les relevés CalJ/Chabad et l'approbation de méthode restent manuels.
- **Backend** : migrations, seed local, RLS, Storage privé, audit, versions publiées immuables et Edge Functions `pair`, `player`, `admin`, `weather`. Le partage Deno du domaine est généré par `pnpm sync:shared`.
- **Administration** : connexion minimale par e-mail/mot de passe et repositories démo/Supabase ; l'inscription publique reste fermée. La configuration de production est décrite dans `DEPLOYMENT.md`.
- **Intégration** : 30 cas distincts réussis dans `supabase/tests/backend.integration.test.ts` après un `supabase db reset` complet.
- **Vérification locale** : `supabase db reset` réussi ; `pnpm sync:shared` sans dérive ; lint, format, typecheck, 38 tests unitaires, build, 3 E2E et 30 tests d'intégration réussis. Le bundle JavaScript principal fait 342,48 kB (108,05 kB gzip) ; la fixture est isolée dans un chunk de 417,40 kB (41,46 kB gzip).
- **Captures E2E** : les captures générées restent sous `artifacts/screenshots/` (ignoré par Git) ; elles ne sont pas relues manuellement.
- **Décisions en attente** : voir `DECISIONS.md` ; les méthodes religieuses sont toujours `pending`.
- **Blocages de raccordement** : dépôt GitHub public à passer en privé par son propriétaire ; accès Cloudflare/Supabase, logo et validation religieuse à fournir avant la production.
- **Prochaine étape** : construire l'interface d'administration complète puis le player connecté/offline.
