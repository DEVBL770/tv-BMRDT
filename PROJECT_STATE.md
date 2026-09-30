# État du projet

_Dernière mise à jour : 2026-09-30_

- **Étape courante** : corrections des fondations de l'étape 2 implémentées et vérifiées localement ; validation visuelle par l'utilisateur à venir.
- **Environnements** : Node.js 22, pnpm 10, Vite. Aucun environnement déployé ; production prévue sur Cloudflare Pages (`*.pages.dev`) avec Supabase Free.
- **Fonctions terminées** : domaine partagé (temps Paris, minyanim, états religieux, filtrage et playlist), normalisation Hebcal (dates hébraïques, fêtes, périodes, paracha et études), fixture de 401 jours, écran TV fixe/playlist remanié et admin de démonstration mobile.
- **Vérification** : lint, format, typecheck, 36 tests unitaires, build et 3 tests E2E réussis localement ; seuil de texte TV 22 px et débordements contrôlés.
- **Captures E2E** : 27 captures créées sous `artifacts/screenshots/` (ignoré par Git) : 9 instants fixes en 1080p/4K, 3 playlists par résolution, 3 vues admin iPhone. Non relues manuellement.
- **Build** : bundle principal `340.91 kB` (107.59 kB gzip) ; fixture de démonstration chargée dans un chunk séparé de `417.51 kB` (41.48 kB gzip).
- **Décisions en attente** : voir DECISIONS.md « En attente d'approbation » ; méthodes religieuses encore `pending`.
- **Blocages** : dépôt public (à passer en privé) ; comptes Cloudflare/Supabase à fournir au raccordement.
- **Limites de l'étape** : l'administration utilise `localStorage`, la publication est désactivée et le player n'a pas encore de cache offline.
- **Prochaine étape immédiate** : validation visuelle des captures ; la comparaison indépendante de 12 dates et la feuille de validation religieuse restent à faire.
