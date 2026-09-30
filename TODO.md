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
- [x] Vérifications locales consolidées : lint, format, typecheck, 38 tests, build, 3 E2E et 30 tests d'intégration
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
- [x] Suite locale de 30 tests d'intégration distincts : 30/30 réussis après `supabase db reset`
- [x] Job CI séparé pour réinitialiser Supabase et exécuter l'intégration

## Étape 5 — Admin

- [x] Repository démo/Supabase et connexion minimale par e-mail/mot de passe
- [ ] Interface complète d'administration des contenus et horaires

## Étape 6 — Player offline

## Étape 7 — Tests panne/temps/E2E

## Étape 8 — Déploiement

- [!] Compte Cloudflare + projet Supabase (accès à fournir au moment du raccordement)
- [!] Logo, validation religieuse, accès PC/TV
