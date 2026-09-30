# État du projet

_Dernière mise à jour : 2026-09-30_

- **Étape courante** : fondations de l'étape 2 implémentées et vérifiées localement ; validation visuelle par l'utilisateur à venir.
- **Environnements** : Node.js 22, pnpm 10, Vite. Aucun environnement déployé ; production prévue sur Cloudflare Pages (`*.pages.dev`) avec Supabase Free.
- **Fonctions terminées** : domaine partagé (temps Paris, minyanim, états religieux, filtrage et playlist), génération/validation du paquet, provider Hebcal, fixture sur 401 jours, écran TV fixe/playlist et admin de démonstration mobile.
- **Tests** : `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, `pnpm test` (31 tests), `pnpm build` et `pnpm e2e` (3 scénarios) réussis localement.
- **Captures E2E** : 7 captures sous `artifacts/screenshots/` (répertoire local ignoré par Git), générées et non relues manuellement.
- **Build** : réussi ; Vite signale un chunk JavaScript minifié supérieur à 500 kB (128 kB gzip).
- **Décisions en attente** : voir DECISIONS.md « En attente d'approbation » ; méthodes religieuses encore `pending`.
- **Blocages** : dépôt public (à passer en privé) ; comptes Cloudflare/Supabase à fournir au raccordement.
- **Limites de l'étape** : l'administration utilise `localStorage`, la publication est désactivée et le player n'a pas encore de cache offline.
- **Prochaine étape immédiate** : commit/push des fondations, puis suivi CI et validation visuelle ; la comparaison indépendante de 12 dates et la feuille de validation religieuse restent à faire.
