# Sources, droits et quotas — Beth Menahem

Audit réalisé le 2026-09-30 (sources officielles consultées ce jour). À revalider avant création des comptes et avant chaque déploiement.

## 1. Sources de données religieuses et calendaires

| Source | Usage V1 | Accès | Licence / conditions | Statut |
| --- | --- | --- | --- | --- |
| **Hebcal REST** (`/hebcal`, `/zmanim`, apprentissage quotidien) | Calendrier hébraïque, fêtes, Roch Hodech, paracha, Omer, allumage/havdala, zmanim, Daf Yomi, Rambam | HTTPS sans clé, appelé **uniquement côté serveur** (Edge Function `refresh-data`) | CC BY 4.0 — attribution « Hebcal.com » obligatoire (affichée en petit sur la TV et dans l'admin). Limite annoncée : 90 requêtes / 10 s (sinon HTTP 429). Zmanim : plage max 180 jours par requête. | **Retenu** (provider actif) |
| **@hebcal/core** (npm) | Uniquement comme **référence indépendante en tests/scripts de comparaison** (devDependency), jamais dans le bundle distribué | npm | GPL-2.0 — incompatible avec une distribution fermée du bundle ; acceptable en outillage de dev | Outil de test |
| **Chabad.org** | Orientation Habad, liens/QR vers Hayom Yom, Tanya, Rambam du jour ; comparaison manuelle | Web | Les flux RSS sont « solely for personal, non-commercial use … Should you wish to build an application incorporating these feeds, please contact us ». Aucune ingestion automatique. | **Adaptateur désactivé** jusqu'à autorisation écrite |
| **CalJ** (calj.net) | Comparaison manuelle des horaires Paris | Web | Aucune API publique officielle identifiée ; pas de scraping | **Adaptateur désactivé** |
| **MET Norway Locationforecast 2.0** | Mini météo Paris | HTTPS via Edge Function `weather` (proxy + cache) | CC BY 4.0 (attribution « MET Norway »). CGU : User-Agent identifiant l'application **et un contact**, respect `Expires`/`If-Modified-Since`, coordonnées ≤ 4 décimales, proxy recommandé pour navigateurs, 429 si abus. | **Retenu** |
| Open-Meteo | — | — | Offre gratuite réservée à l'usage non commercial | Non retenu |

### Paramètres Hebcal proposés (À VALIDER par le responsable religieux)

| Paramètre | Valeur proposée | Remarque |
| --- | --- | --- |
| Coordonnées | 48.8885 N, 2.3821 E (géocodage OpenStreetMap du 14 rue de Thionville — à confirmer) | 4 décimales max |
| Altitude | non prise en compte (niveau de la mer) | option Hebcal disponible |
| Diaspora | `i=off` | 2 jours de Yom Tov |
| Allumage Chabbat/Yom Tov | `b=18` (18 min avant le coucher) | valeur par défaut Hebcal, à confirmer |
| Sortie Chabbat/Yom Tov | `M=on` (tzeit 8,5°) | alternative : `m=N` minutes fixes |
| Alot Hashahar | `alotHaShachar` 16,1° | usage courant, à confirmer Habad |
| Début téfilin / Misheyakir | `misheyakir` 11,5° | alternative `misheyakirMachmir` |
| Shkia | `sunset` | |
| Changement de jour hébreu | au coucher du soleil (shkia) | règle d'affichage, à confirmer |
| Rambam | 3 chapitres/jour (`dr3`) ; 1 chapitre configurable (`dr1`) | cycle à confirmer |
| Daf Yomi | `F=on` | |

Tant que ces paramètres ne sont pas approuvés, l'admin et la TV affichent « horaires à confirmer » et `settings.religious_method_status = 'pending'`.

## 2. Hébergement et backend — quotas gratuits vérifiés

| Service | Offre | Limites pertinentes (2026-09-30) | Impact |
| --- | --- | --- | --- |
| Supabase Free | 0 € | 500 MB base, 1 GB Storage, 5 GB egress + 5 GB cached egress, 500 000 invocations Edge Functions/mois, 50 000 MAU. Pause après ~7 jours de faible activité base (« a few user requests to the database each day » suffit). | Le heartbeat du player (écriture base toutes les 30 s) maintient l'activité ; si le PC est éteint une semaine, reprise manuelle possible depuis le dashboard (voir DEPLOYMENT.md). |
| Cloudflare Pages Free | 0 € | 500 builds/mois, 20 000 fichiers, 25 MiB/fichier, build ≤ 20 min, sites statiques illimités en requêtes | Site statique SPA + PWA ; aucun Pages Functions nécessaire. |
| GitHub | 0 € | Dépôt `DEVBL770/tv-BMRDT` ; Actions : illimité si public, 2 000 min/mois si privé | Le dépôt est **actuellement public** alors que le prompt maître exige un dépôt privé → à basculer en privé par le propriétaire (aucun secret n'est committé). |
| Vercel Hobby | — | Réservé à l'usage « non-commercial, personal use only » | Non retenu (sponsors commerciaux). |

## 3. Budget mensuel simulé (1 TV + 1 admin)

| Poste | Calcul | Volume/mois | Quota | Marge |
| --- | --- | --- | --- | --- |
| Edge `player` (poll version 15 s, heartbeat écrit 1 fois sur 2) | 4/min × 60 × 24 × 30 | 172 800 | 500 000 | 35 % utilisés |
| Edge `weather` (cache 30 min côté player, 60 min côté serveur) | 2/h × 24 × 30 | 1 440 | | |
| Edge `refresh-data` (≤ 1/jour déclenché par player ou admin) | 30 | 30 | | |
| Edge admin (publish, media, devices…) | ~50/jour estimé | 1 500 | | |
| **Total Edge** | | **≈ 176 000** | 500 000 | ~35 % |
| Egress poll | 172 800 × ~0,4 KB | ≈ 70 MB | 5 GB | |
| Egress paquet (≈ 150 KB gzip, ~2 publications/jour + 1 refresh) | 90 × 150 KB | ≈ 14 MB | | |
| Egress médias (plafond actif 500 MB, renouvellement estimé 200 MB/mois ×1 TV + aperçus admin ×2) | | ≈ 600 MB | 5 GB | |
| Storage | originaux + variantes TV, plafond actif 500 MB | ≤ 700 MB | 1 GB | surveillé dans le tableau de bord |
| Base | 400 jours × quelques lignes + versions (rétention 60 versions) + audit borné | < 50 MB | 500 MB | |
| Hebcal | ~5 requêtes/refresh | ~150 | 90/10 s | |
| MET Norway | ≤ 1/h | ≤ 720 | | |

Conclusion : l'objectif 0 €/mois est tenable. Aucun obstacle bloquant ; points de vigilance : pause Supabase si inactivité prolongée, dépôt à passer en privé, SMTP Supabase par défaut non fiable pour la récupération de mot de passe.

## 4. Polices et ressources graphiques

Polices sous licence SIL OFL auto-hébergées (précache offline) : Frank Ruhl Libre (hébreu), Cormorant Garamond (titres), Inter / Assistant (texte). Aucune ressource tierce chargée à l'exécution.

## 5. Contenus d'étude (Hayom Yom, Tanya, Rambam)

- Références du jour : Rambam et Daf Yomi via Hebcal (CC BY). Hayom Yom / Tanya : aucune source structurée libre identifiée → saisie par l'admin (`daily_study_entries`) : titre, référence, court texte français **rédigé ou autorisé**, lien/QR vers Chabad.org.
- La table statique de translittération française des sections du Michné Torah (`src/domain/providers/rambamNames.ts`) est dérivée des titres Hebcal et reste **à relire**.
- Aucun texte complet ni traduction de provenance incertaine n'est intégré.

## 6. Données personnelles

Noms (Mazal Tov, Azkarot, dédicaces) visibles publiquement : l'admin affiche un rappel sur l'accord des personnes concernées. Pas d'analytics, pas de cookies tiers.
