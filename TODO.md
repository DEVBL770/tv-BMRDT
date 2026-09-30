# TODO — V1 écran Beth Menahem

Légende : [x] fait · [~] en cours · [ ] à faire · [!] bloqué (accès/décision)

## Étape 1 — Audit
- [x] Lecture des 3 documents
- [x] Vérification Supabase, Cloudflare Pages, Hebcal, MET Norway, Chabad.org, CalJ, Vercel
- [x] Budget simulé (SOURCES_AND_RIGHTS.md §3)
- [x] Fichiers de suivi
- [!] Passer le dépôt GitHub en privé (propriétaire)

## Étape 2 — Fondations et design
- [ ] Vite/React/TS, lint/format/typecheck/test, CI GitHub Actions
- [ ] Domaine partagé (types, schéma de paquet zod, moteur minyanim, état religieux, filtrage)
- [ ] TV `/display` mode fixe + playlist, thèmes semaine/Chabbat/Yom Tov, captures 1080p/4K
- [ ] Admin iPhone (squelette navigation) + aperçu
- [ ] Validation visuelle par l'utilisateur

## Étape 3 — Données
- [ ] Providers Hebcal (calendrier, zmanim, étude) + provenance + validation
- [ ] 400 jours, comparaison 12 dates de référence (@hebcal/core + CalJ/Chabad manuel)
- [ ] Feuille de validation religieuse

## Étape 4 — Backend
- [ ] Migrations, RLS (anon/admin/device), Storage privé
- [ ] Edge Functions : player, publish/restore, refresh-data, devices, media, weather
- [ ] Tests d'autorisation

## Étape 5 — Admin
## Étape 6 — Player offline
## Étape 7 — Tests panne/temps/E2E
## Étape 8 — Déploiement
- [!] Compte Cloudflare + projet Supabase (accès à fournir au moment du raccordement)
- [!] Logo, validation religieuse, accès PC/TV
