# Architecture — Écran Beth Menahem V1

Référence fonctionnelle : cahier des charges original + « Architecture V1 » + prompt maître. Ce document décrit l'implémentation.

## 1. Vue d'ensemble

```
GitHub (tv-BMRDT) ──CI──► Cloudflare Pages (statique) : /display  /admin  /pair  + service worker
                                   │ HTTPS (clé anon publique + RLS / jeton appareil)
                                   ▼
Supabase Free : Auth (1 admin) · Postgres + RLS · Storage privé `media` · Edge Functions
                                   │ serveur uniquement
                                   ▼
             Hebcal REST (calendrier, zmanim, étude) · MET Norway (météo)
             [ChabadProvider, CalJProvider : présents mais désactivés]
```

## 2. Arborescence

```
src/
  domain/          # TypeScript pur, partagé app + Edge Functions (aucune dépendance DOM/Deno)
    package.ts     # schéma zod du paquet publié (PublishedPackage, schemaVersion)
    minyan.ts      # résolution des horaires de minyan (priorités, collisions)
    religious.ts   # périodes Chabbat/Yom Tov, état à un instant, thème
    filtering.ts   # visibilité des contenus (dates, jours, Chabbat/YT, sponsors fail-safe)
    playlist.ts    # sélection de slide courant à un instant
    time.ts        # Europe/Paris <-> UTC, DST (Intl, sans lib lourde)
    compile.ts     # compilation du paquet (brouillon + calendrier -> paquet)
    providers/     # CalendarProvider, ZmanimProvider, StudyProvider, WeatherProvider (+ Hebcal, MET, Chabad/CalJ désactivés)
  display/         # player TV (mode fixe, playlist, thèmes)
  admin/           # admin mobile-first
  player/          # sync, IndexedDB, activation atomique, heartbeat
  fixtures/        # paquet de démonstration (mode démo sans backend)
supabase/
  migrations/      # SQL versionné
  functions/       # player, publish, refresh-data, devices, media, weather (+ _shared -> src/domain)
  tests/           # tests RLS (pgTAP ou vitest contre supabase local)
e2e/               # Playwright (1080p, 4K, iPhone, offline)
scripts/           # export/restore, comparaison de référence
```

## 3. Modèle de données (Postgres)

Toutes les tables ont RLS activé. `is_admin()` = `auth.uid()` présent dans `app_admin` (singleton, 1 UUID).

| Table | Rôle | Lecture | Écriture |
| --- | --- | --- | --- |
| settings (singleton) | identité, fuseau, coordonnées, paramètres de méthode + `religious_method_status` (pending/approved, approuvé par/le), marge sponsors, cycle Rambam, règle de changement de jour | admin | admin |
| minyan_rules | office, heure locale `HH:MM`, `valid_from/valid_to` (null = sans limite), `weekdays int[]`, `day_kinds text[]`, priorité, actif, `status` (to_confirm/confirmed) | admin | admin |
| minyan_exceptions | date locale, office, heure ou `cancelled`, commentaire | admin | admin |
| source_records | provider, kind, date locale, instant UTC, valeur, méthode, paramètres, fetched_at, valid_until, statut ; override (valeur, auteur, expiration) | admin | service (refresh) ; override : admin |
| jewish_days | date civile, date hébraïque (fr/he), paracha, fêtes, Roch Hodech, Omer, étude, zmanim (instants + ids source), horizon | admin | service |
| content_items | type, titre/corps (fr/he), média(s), QR, `starts_at/ends_at`, jours, créneaux, `shabbat_visibility` (show/hide), `is_commercial`, priorité, durée, statut draft/ready/archived | admin | admin |
| media_assets | bucket/path opaque, kind (image/pdf/pdf_page), mime, taille, dimensions, pages, sha256, variantes, parent, état | admin | admin (via fonction `media`) |
| layout_draft (singleton) | mode fixe/playlist, zones, slides (ordre, durée), options, thème | admin | admin |
| published_versions | numéro, `package jsonb` immuable, `package_hash`, manifeste médias, auteur, source (admin/refresh/restore), created_at | admin | RPC `publish_package` uniquement (pas d'UPDATE/DELETE) |
| public_state (singleton) | `current_version_id`, `current_version_number`, `published_at` | admin | RPC |
| audit_events | auteur, action, objet, avant/après, version, ts ; rétention configurable | admin | triggers / RPC |
| devices | nom, `token_hash`, `pairing_code_hash`, expiration du code, `revoked_at`, last_seen, version affichée, build, heure client, écart d'horloge, statut cache, dernière erreur | admin | admin (révocation) ; service (heartbeat) |
| source_health | source, dernier succès/échec, erreur normalisée, âge, repli disponible | admin | service |
| daily_study_entries | date hébraïque/civile, kind (hayom_yom/tanya/rambam), référence, texte fr rédigé/autorisé, lien, validé | admin | admin |
| weather_cache | réponse normalisée, expires, last_modified | service | service |

Anon : aucun accès aux tables. Appareil : aucun accès direct PostgREST ; passe uniquement par l'Edge Function `player` (service_role côté serveur) qui vérifie `sha256(token)` et `revoked_at is null`.

Storage : bucket privé `media` ; admin lecture/écriture ; appareils via URL signées courtes émises par `player`, octets copiés en IndexedDB.

## 4. Paquet publié (`schemaVersion: 1`)

```ts
PublishedPackage {
  schemaVersion: 1; versionNumber; publishedAt; packageHash;
  site: { name, address, timezone:'Europe/Paris', attribution[] , logoMediaId? };
  methods: { status:'pending'|'approved', params, approvedBy?, approvedAt? };
  horizon: { firstDate, lastDate };                // 400 jours
  days: Day[];                                     // par date civile
  religiousPeriods: { kind:'shabbat'|'yomtov', start:ISO, end:ISO, label, labelHe }[]; // fusionnées si contiguës
  minyanim: { date, office, time|null, cancelled, status }[];                         // pré-calculés
  content: ContentItem[];   layout: Layout;   media: MediaManifestEntry[];            // sha256, bytes, mime
  sponsorMargin: { beforeMinutes, afterMinutes };
}
Day { date, weekday, hebrew:{fr,he,day,month,year}, parasha?, holidays[], roshHodesh?, omer?, study:{dafYomi?, rambam?, hayomYom?, tanya?},
      zmanim:{ alot, misheyakir, sunrise, chatzot, sunset, tzeit, candleLighting?, havdalah? } (instants ISO + sourceId + overridden) }
```

## 5. Moteur horaire

- **Minyanim** (`resolveMinyan(date, office)`) : exception > règle de période (plage la plus courte, puis priorité décroissante) > règle hebdomadaire > règle de base ; `day_kinds` filtre ; conflit à spécificité égale => signalé.
- **État religieux** (`religiousStateAt(instant, pkg)`) : `weekday | erev_shabbat | shabbat | erev_yomtov | yomtov | chol_hamoed` + `unknown` hors horizon. Intervalles : début = allumage (ou tzeit pour le 2e jour/entrée consécutive), fin = havdala ; fusion des intervalles contigus (YT→Chabbat).
- **Sponsors** : `is_commercial` masqué si `now ∈ [start - marginBefore, end + marginAfter]` d'une période, ou si état `unknown`. Filtre évalué à chaque slide et à chaque minute côté player, et à la compilation côté serveur.
- **Date hébraïque affichée** : bascule au coucher du soleil (règle configurable, en attente).
- **Hors horizon** : horloge, date civile, annonces valides ; zmanim/minyanim masqués ; alerte admin.

## 6. Synchronisation et offline

- `player` : POST `{token, knownVersion, clientTime, build, cacheStatus, lastError}` toutes les 15 s → `{version, packageHash}` (+ `serverTime`) ; si version différente : GET paquet + URLs signées médias.
- Activation atomique : télécharger paquet → valider zod + hash → télécharger tous les médias → vérifier sha256 → écrire en IndexedDB (`versions`, `media`) → basculer le pointeur `activeVersion` → garder la précédente, purger les plus anciennes.
- Service worker (vite-plugin-pwa / Workbox) : précache shell + polices + icônes ; navigation fallback vers `/display` ; aucune mise en cache de `/admin` ni des appels API ; mise à jour du SW différée hors Chabbat/Yom Tov.
- `navigator.storage.persist()` demandé ; quota vérifié, statut remonté au heartbeat.
- Backoff exponentiel (15 s → 5 min) en cas d'échec.

## 7. Sécurité

Inscription publique désactivée ; 1 UUID admin ; RLS partout ; `service_role` uniquement dans les Edge Functions ; jeton appareil haché ; limitation de fréquence (appairage : 5 essais/10 min/IP) ; aucune erreur technique affichée sur la TV ; CSP stricte dans `_headers` Cloudflare.

## 8. Coûts et quotas

Voir SOURCES_AND_RIGHTS.md §2–3 (≈ 176 000 invocations Edge/mois sur 500 000 ; egress < 1 GB).
