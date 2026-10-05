# État du projet

_Dernière mise à jour : 2026-09-30_

- **Étape courante** : étapes 3–6, dont l’administration Supabase de l’étape 5, sont implémentées et validées localement ; le lot est prêt à être poussé sur la branche existante pour le cycle CI.
- **Environnements** : Node.js 22, pnpm 10, Vite et Supabase CLI 2.117.0. Supabase local, les fonctions et le mock Hebcal sont utilisés pour l'intégration ; aucun environnement de production n'est déployé.
- **Données de référence** : provider Hebcal et fixture enregistrée de 401 jours (2026-09-01 → 2027-10-06) ; comparaison `@hebcal/core`/`kosher-zmanim` sur 12 dates dans `docs/VALIDATION_RELIGIEUSE.md`. Les relevés CalJ/Chabad et l'approbation de méthode restent manuels.
- **Backend** : migrations, seed local, RLS, Storage privé, audit, versions publiées immuables et Edge Functions `pair`, `player`, `admin`, `weather`. Le partage Deno du domaine est généré par `pnpm sync:shared`.
- **Administration** : console mobile-first en français reliée à Supabase pour horaires, contenus, médias, aperçu/publication, versions, appareils, sources et réglages. `DemoRepository` reste disponible sans backend ; les actions incompatibles sont désactivées.
- **Médias admin** : orientation EXIF corrigée, redimensionnement navigateur et métadonnées retirées ; PDF.js est dynamique avec worker local, rendu limité à six pages, parent PDF conservé, pages prêtes et upload signé.
- **Player** : `/display` conserve le mode démo sans variables Supabase ; le mode réel utilise appairage, IndexedDB, SW Workbox, activation sans reload, météo et synchronisation appareil. Les pages médias multiples s’affichent ensemble dans une diapositive Contenus.
- **Intégration** : 35 cas distincts couvrant auth, privilèges, calendrier, publication, média, appairage, player et météo dans `supabase/tests/backend.integration.test.ts`.
- **E2E admin** : 9 tests contre Supabase local, Edge Functions et `preview` ; 8 flux fonctionnels distincts, plus les captures de neuf sections mobiles et deux vues bureau. Les 13 E2E (admin, affichage et player) passent.
- **Vérification locale** : après `supabase db reset`, lint, format, typecheck, 67 tests unitaires, build, 13 E2E et 35 tests d’intégration réussis.
- **Chunks de build** : Player 22,49 kB ; Admin 76,09 kB ; index 222,06 kB ; Supabase 326,58 kB ; fixture démo 417,37 kB ; PDF.js 495,66 kB ; worker PDF 1 317,03 kB ; CSS 65,46 kB. L’admin et PDF.js restent séparés du chunk Player.
- **Captures E2E** : `artifacts/screenshots/` (ignoré par Git) ; les captures sont générées par Playwright et ne remplacent pas une inspection visuelle manuelle.
- **Décisions en attente** : voir `DECISIONS.md` ; les méthodes religieuses sont toujours `pending`.
- **Blocages de raccordement** : dépôt GitHub public à passer en privé par son propriétaire ; accès Cloudflare/Supabase, logo et validation religieuse à fournir avant la production.
- **Prochaine étape** : pousser l’étape 5 sur la branche existante, puis reprendre le cycle CI avec la prochaine consigne ; aucune nouvelle fonctionnalité n’est prévue.
