# TODO — V1 écran Beth Menahem

Légende : [x] fait · [~] en cours · [ ] à faire · [!] bloqué (accès/décision)

## Étape 1 — Audit

- [x] Lecture des 3 documents
- [x] Vérification Supabase, Cloudflare Pages, Hebcal, MET Norway, Chabad.org, CalJ, Vercel
- [x] Budget simulé (SOURCES_AND_RIGHTS.md §3)
- [x] Fichiers de suivi
- [!] Passer le dépôt GitHub en privé (propriétaire)

## Étape 2 — Fondations et design

- [x] Vite/React/TS, lint/format/typecheck/test, CI GitHub Actions
- [x] Domaine partagé (types, schéma de paquet zod, moteur minyanim, état religieux, filtrage)
- [x] TV `/display` mode fixe + playlist, typographie grand écran, thème semaine/Chabbat/Yom Tov
- [x] Fixture Hebcal chargée dynamiquement en démo/aperçu ; dates, fêtes, paracha, périodes et références d'étude normalisées
- [x] Admin iPhone (squelette navigation) + aperçu et stockage local de démonstration
- [x] Tests fixture sur Adar I/II, classifications, périodes, paracha, études et visibilité des sponsors
- [x] E2E : instants fixes 1080p/4K, trois scénarios playlist par résolution, admin iPhone et seuil typographique TV
- [x] Vérifications locales consolidées : lint, format, typecheck, 59 tests, build, 4 E2E et 34 tests d'intégration
- [ ] Validation visuelle par l'utilisateur

## Étape 3 — Données

- [x] Providers Hebcal (calendrier, zmanim, étude) + provenance + validation sur réponses enregistrées
- [x] Fixture réelle Hebcal de 401 jours (2026-09-01 → 2027-10-06)
- [x] Comparaison indépendante `@hebcal/core` + `kosher-zmanim` sur 12 dates, sans réseau en CI
- [x] `docs/VALIDATION_RELIGIEUSE.md` avec colonnes CalJ/Chabad et validation manuelle à compléter
- [!] Approbation des méthodes et relevés manuels CalJ/Chabad (responsable religieux)

## Étape 4 — Backend

- [x] Supabase CLI local, migrations reproductibles, seed et bucket Storage privé
- [x] RLS/grants, audit, publication immuable, rétention et verrous
- [x] Edge Functions pair/player/admin/weather, refresh, publication, restauration, médias et export
- [x] Suite locale de 35 tests d'intégration distincts : 35/35 réussis après `supabase db reset`
- [x] Job CI séparé pour réinitialiser Supabase et exécuter l'intégration

## Étape 5 — Admin

- [x] Repository démo/Supabase et connexion minimale par e-mail/mot de passe
- [x] Navigation mobile-first et sections Tableau de bord, Horaires, Contenus, Médias, Écran, Historique, Appareils, Sources et Réglages
- [x] Règles et exceptions, aperçus compilés côté serveur, publication avec résumé et restauration versionnée
- [x] Flux médias sécurisé : normalisation image, PDF jusqu'à six pages, upload signé, finalisation, budget et suppression protégée
- [x] Appairage/révocation TV, état des sources, overrides, export et approbation religieuse explicite
- [x] Démo fonctionnelle sans backend avec actions Supabase désactivées et expliquées
- [x] Tests unitaires repository/mapping/résumé publication et normalisation des médias
- [x] E2E admin : 8 flux fonctionnels distincts et 1 scénario de captures (9 vues mobiles, 2 bureau)
- [x] Le job CI `integration` exécute `pnpm e2e` après les tests backend
- [x] Vérification après reset Supabase : lint, format, typecheck, 67 tests unitaires, build, 13 E2E et 35 tests d’intégration
- [ ] Validation visuelle finale par l'utilisateur

## Étape 6 — Player offline

- [x] IndexedDB, persistance demandée, validation paquet/hash et activation atomique avec rétention à deux versions
- [x] Appairage TV, synchronisation, backoff, offset d'horloge, météo en cache et URLs blob révoquées au changement de version
- [x] Service worker Workbox : shell/polices en précache, fallback `/display` et `/admin`, sans cache runtime Supabase
- [x] Reload quotidien à 04:00 différé pendant Chabbat/Yom Tov ; watchdog et timers nettoyables
- [x] Vérifications locales consolidées et captures E2E appairage/écran en ligne en 1080p/4K

## Étape 7 — Tests panne/temps/E2E

- [x] Unitaires fake IndexedDB/fake timers : activation, erreurs, quota, restauration, rétention, sync, 401, horloge, reload et longue durée
- [x] E2E appairage, hors ligne, activation v2, média corrompu, révocation et captures 1080p/4K
- [x] Job CI `integration` incluant `pnpm e2e`

## Étape 8 — Déploiement

- [!] Compte Cloudflare + projet Supabase (accès à fournir au moment du raccordement)
- [!] Logo, validation religieuse, accès PC/TV
