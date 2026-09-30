# Architecture — Écran Beth Menahem V1

Référence fonctionnelle : cahier des charges original + « Architecture V1 » + prompt maître. Ce document décrit l'implémentation.

## 1. Vue d'ensemble

```
GitHub (tv-BMRDT) ──CI──► Hébergement statique : /display  /admin
                                   │ shell PWA ; admin minimal et player connecté
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
  player/          # appairage, sync, IndexedDB, activation atomique, PWA et heartbeat
  fixtures/        # paquet de démonstration (mode démo sans backend)
supabase/
  migrations/      # SQL versionné
  functions/       # pair, player, weather, admin (+ _shared -> src/domain)
  tests/           # Vitest d’intégration contre Supabase local + mock Hebcal enregistré
e2e/               # Playwright (1080p, 4K, iPhone)
scripts/           # export, création du premier admin, comparaison de référence
```

## 3. Modèle de données (Postgres)

Toutes les tables ont RLS activé. `is_admin()` est `SECURITY DEFINER STABLE` avec
`search_path=''` et vérifie que `auth.uid()` est le seul UUID présent dans `app_admin`.

| Table | Rôle | Lecture | Écriture |
| --- | --- | --- | --- |
| settings (singleton) | Paris `48.8885, 2.3821`, `b=18`, `M=on`, alot `16.1°`, misheyakir `11.5°`, Rambam `dr3`, jour hébraïque `sunset`, approbation de méthode pending/approved, marges `30/0`, masquage Hol Hamoed false, rétention `60/365 jours`, budget média `500 MB` | admin | admin |
| minyan_rules | office, heure locale `HH:MM`, `valid_from/valid_to` (null = sans limite), `weekdays int[]`, `day_kinds text[]`, priorité, actif, `status` (to_confirm/confirmed) | admin | admin |
| minyan_exceptions | date locale, office, heure ou `cancelled`, commentaire | admin | admin |
| source_records | provider, kind, date locale, instant UTC, valeur brute, méthode, paramètres, fetched_at, valid_until, statut ; override (valeur, auteur, expiration) | admin | service (refresh) ; admin peut modifier uniquement les colonnes d’override |
| jewish_days | date civile, date hébraïque (fr/he), paracha, fêtes et types, Roch Hodech, Omer, étude, zmanim et provenance, horizon | admin | service |
| content_items | type, titre/corps (fr/he), média(s), QR, `starts_at/ends_at`, jours, créneaux, `shabbat_visibility` (show/hide), `is_commercial`, priorité, durée, statut draft/ready/archived | admin | admin |
| media_assets | bucket/path opaque, kind (image/pdf/pdf_page), mime, taille, dimensions, pages, sha256, variantes, parent, état | admin | admin (via fonction `media`) |
| layout_draft (singleton) | mode fixe/playlist, zones, slides (ordre, durée), options, thème | admin | admin |
| published_versions | numéro, `package jsonb` immuable, `package_hash`, manifeste médias, snapshot du brouillon, auteur, source (admin/refresh/restore), `restored_from`, created_at | admin | RPC `publish_package` uniquement (pas d'UPDATE/DELETE) |
| public_state (singleton) | `current_version_id`, `current_version_number`, `published_at` | admin | RPC |
| audit_events | auteur, action, objet, avant/après, version, ts ; rétention configurable | admin | triggers / RPC |
| devices | nom, `token_hash`, `revoked_at`, last_seen, version affichée, build, heure client, écart d'horloge, statut cache, dernière erreur | admin | admin uniquement sur le nom et la révocation ; service pour l’appairage et le heartbeat |
| device_pairings | `code_hash`, nom, expiration, usage, créateur | service (par Edge Function) | service (par Edge Function) |
| source_health | source, dernier succès/échec, erreur normalisée, âge, repli disponible | admin | service |
| daily_study_entries | date hébraïque/civile, kind (hayom_yom/tanya/rambam), référence, texte fr rédigé/autorisé, lien, validé | admin | admin |
| weather_cache | réponse MET normalisée, expires, `last_modified`, attribution | service | service |
| rate_limits | clé d’IP/appareil, fenêtre, compteur | service | service |
| app_admin (singleton) | UUID de l’unique administrateur Auth | service | script de création admin |
| refresh_locks | verrou TTL d’opérations de rafraîchissement | service | service |

Anon n’a ni policy ni grant métier. Authenticated non-admin est bloqué par RLS. Les appareils
n’ont aucun accès PostgREST : ils passent par `player`, qui vérifie `sha256(token)` et
`revoked_at is null`. Les Edge Functions utilisent `service_role` seulement depuis leur
environnement serveur. L’audit des changements de `devices` n’enregistre jamais `token_hash`.

Storage : bucket privé `media`, limite 12 MiB, MIME JPEG/PNG/WEBP/PDF ; policies admin seulement.
Les appareils reçoivent via `player` des URLs signées d’une heure, vérifient les octets par SHA-256
et stockent les blobs en IndexedDB.

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
  hideCommercialOnCholHamoed: boolean;             // false par défaut
}
Day { date, weekday, hebrew:{fr,he,day,month,year}, parasha?, holidays[], roshHodesh?, omer?, study:{dafYomi?, rambam?, hayomYom?, tanya?},
      zmanim:{ alot, misheyakir, sunrise, chatzot, sunset, tzeit, candleLighting?, havdalah? } (instants ISO + sourceId + overridden) }
```

## 5. Moteur horaire

- **Minyanim** (`resolveMinyan(date, office)`) : exception > règle de période (plage la plus courte, puis priorité décroissante) > règle hebdomadaire > règle de base ; `day_kinds` filtre ; conflit à spécificité égale => signalé.
- **État religieux** (`religiousStateAt(instant, pkg)`) : `weekday | erev_shabbat | shabbat | erev_yomtov | yomtov | chol_hamoed` + `unknown` hors horizon. Intervalles : début = allumage (ou tzeit pour le 2e jour/entrée consécutive), fin = havdala ; fusion des intervalles contigus (YT→Chabbat).
- **Sponsors** : `is_commercial` masqué si `now ∈ [start - marginBefore, end + marginAfter]` d'une période Chabbat/Yom Tov ; Hol Hamoed peut être masqué par `hideCommercialOnCholHamoed` (false par défaut) ; état `unknown` reste fail-safe (masqué). Filtre évalué à chaque slide et à chaque minute côté player, et à la compilation côté serveur.
- **Date hébraïque affichée** : bascule au coucher du soleil (règle configurable, en attente).
- **Hors horizon** : horloge, date civile, annonces valides ; zmanim/minyanim masqués ; alerte admin.

## 6. Synchronisation et offline

- `pair` reçoit un code et le nom d’appareil ; limitation 5 essais/10 min/IP et 30 essais globaux,
  consommation atomique,
  expiration à 10 min et code à usage unique. Le jeton 256 bits est révélé une fois, seul son SHA-256
  est conservé.
- `player.sync` reçoit `knownVersion`, `displayedVersion`, heure/build/diagnostic et répond avec
  `{serverTime, clockSkewSeconds, current:{number,hash}|null}`. Il applique 12 appels/minute/appareil
  et ne met à jour le heartbeat qu’après 25 secondes. Un rafraîchissement calendrier est lancé en
  arrière-plan si la dernière réussite a plus de 24 h ou si l’horizon est inférieur à 330 jours.
- `player.package` reçoit le numéro d’une version publiée et ne lit jamais le brouillon ; il renvoie
  le paquet et les URLs Storage signées valables une heure, réécrites vers l’origine API publique
  afin de ne pas exposer l’hôte interne utilisé par la clé de service.
- `admin` exige un JWT valide et vérifie `is_admin()` avec le JWT de l’appelant. Ses actions
  comprennent l’appairage/révocation, `refreshData`, `publish`, `previewPackage`, `restore`,
  `createUpload`, `finalizeUpload`, `deleteMedia` et `export`. Le refresh en échec conserve les
  données et la publication existantes ; un refresh réussi republie seulement si les données ont
  changé ou si l’horizon est court, depuis le snapshot courant et non depuis le brouillon.
- `weather` accepte un jeton appareil ou un JWT admin ; il renvoie le cache normalisé et, après
  expiration, interroge MET Locationforecast compact avec `MET_USER_AGENT` et `If-Modified-Since`.
- Le player `/display` utilise la même interface de paquet en démo et en production. Sans URL
  Supabase, la fixture est chargée dynamiquement ; en mode réel, l’appairage conserve le jeton
  appareil dans IndexedDB et le paquet actif continue de s’afficher sans connexion.
- Base IndexedDB `beth-menahem-player` : `versions` (active + précédente), `media` (blob par
  SHA-256), `meta` (appareil, synchronisation, météo, état de persistance et erreur). Une activation
  valide le schéma et le hash canonique partagé avec `compile.ts`, télécharge/vérifie tous les
  médias avant de basculer `activeVersion` et `previousVersion` dans une transaction unique, puis
  purge les versions et blobs orphelins. En cas d’échec, la version affichée ne change pas ;
  `QuotaExceededError` entraîne une purge puis un seul nouvel essai.
- Le heartbeat part toutes les 15 s avec ±2 s de jitter et inclut versions connue/affichée,
  horloge, hash du build, cache et dernière erreur. Le backoff réseau croît de 15 s à 5 min et
  revient à 15 s après un succès. Une réponse 401 efface le jeton, conserve l’affichage mis en cache
  et suspend la synchronisation jusqu’au réappairage. L’horloge reste locale, sauf dérive supérieure
  à 60 s avec une synchronisation réussie datant de moins de 24 h.
- Le rafraîchissement calendrier déclenché par `player.sync` appelle directement
  `refreshCalendar()` en tâche de fond sous le verrou `calendar-refresh` ; il ne passe pas par un
  appel HTTP `admin` ni par une clé service transmise en requête.
- `vite-plugin-pwa` précache le shell et les polices, et fournit un fallback de navigation pour
  `/display` et `/admin`. Il n’y a aucun cache runtime des fonctions ou API Supabase. Les mises à
  jour et le reload quotidien à 04:00 locale attendent la fin de Chabbat/Yom Tov plus 30 min. Tous
  les temporisateurs applicatifs passent par `PlayerScheduler`; un watchdog recharge la page si
  l’horloge n’avance plus pendant 60 s.
- `navigator.storage.persist()` est demandé au démarrage ; le résultat apparaît dans
  `cacheStatus`. La météo est actualisée toutes les 30 min avec le jeton appareil, conservée dans
  IndexedDB et masquée au-delà de 6 h (l’attribution MET n’apparaît qu’avec la météo).
- Un point discret indique plus de 5 min sans synchronisation réussie. `Ctrl+Shift+P` ouvre
  l’appairage sans effacer un paquet mis en cache.

## 7. Sécurité

Inscription publique désactivée ; 1 UUID admin ; RLS/grants minimaux ; `service_role` uniquement
dans les Edge Functions et scripts opérationnels côté serveur ; jeton appareil haché ; limitation
de fréquence ; aucune erreur technique affichée sur la TV ; CORS limité aux origines explicites
`ALLOWED_ORIGINS` ; erreurs Edge sous forme `{error:"code"}` sans pile ; CSP stricte dans
`_headers` Cloudflare. Les versions publiées sont immuables ; `purge_old_versions()` ne peut
supprimer que les versions hors rétention et jamais la courante.

Le frontend comprend la connexion admin minimale et le player PWA connecté/offline. L’UI de
gestion complète reste hors périmètre de l’étape 6.

## 8. Coûts et quotas

Voir SOURCES_AND_RIGHTS.md §2–3 (≈ 176 000 invocations Edge/mois sur 500 000 ; egress < 1 GB).
