# Journal des décisions

Format : date — décision — alternatives — raison — limites.

## 2026-09-30 — D1. Architecture retenue conforme au document « Architecture V1 »
React + TypeScript + Vite + PWA statique sur Cloudflare Pages (`*.pages.dev`) ; Supabase Free (Auth, Postgres/RLS, Storage privé, Edge Functions). Alternatives : Vercel Hobby (écarté : usage non commercial uniquement), Next.js serveur (inutile). Quotas revalidés ce jour (voir SOURCES_AND_RIGHTS.md).

## 2026-09-30 — D2. Dépôt `DEVBL770/tv-BMRDT`
Seul dépôt accessible ; vide. L'intégration GitHub ne permet pas de créer un nouveau dépôt privé. **Le dépôt est public** : le propriétaire doit le passer en privé (Settings → General → Danger Zone → Change visibility). Aucun secret n'est committé en attendant.

## 2026-09-30 — D3. Hebcal REST côté serveur uniquement ; @hebcal/core en outillage de test
Les données calendaires sont récupérées par l'Edge Function `refresh-data` et incluses dans le paquet publié (400 jours). Le player n'appelle jamais Hebcal. `@hebcal/core` (GPL-2.0) n'est utilisé qu'en devDependency pour la comparaison indépendante, jamais dans le bundle.

## 2026-09-30 — D4. Paquet publié unique et immuable, rafraîchissement calendaire automatique
Un paquet = contenus + écran + planning des minyanim pré-calculé + 400 jours de calendrier + périodes religieuses + manifeste médias. Quand l'horizon restant passe sous 330 jours ou que les données sources changent (même méthode), `refresh-data` crée une **nouvelle version** « rafraîchissement calendrier » à partir du dernier contenu publié (jamais du brouillon), auditée comme action système.

## 2026-09-30 — D5. Filtrage sponsors fail-safe
Les sponsors commerciaux sont masqués (serveur et player) pendant tout intervalle Chabbat/Yom Tov, avec une marge configurable (proposition : 30 min avant l'allumage, 0 après la havdala — **à valider**). Si l'état religieux est inconnu (horizon dépassé, données absentes), les sponsors commerciaux sont **masqués** par défaut.

## 2026-09-30 — D6. Horaires de minyan fixes
Heures saisies par la communauté, jamais dérivées de la shkia en V1. Priorité : exception datée > règle de période (plage la plus courte, puis priorité) > règle hebdomadaire > règle de base. Une règle peut aussi cibler un type de jour (semaine, veille de Chabbat, Chabbat, veille de Yom Tov, Yom Tov, Hol Hamoed). Collisions signalées.

## 2026-09-30 — D7. Médias normalisés côté navigateur admin
Images redimensionnées (≤ 3840 px) et converties en WebP/JPEG dans le navigateur ; PDF rasterisés page par page avec pdf.js dans l'admin ; l'Edge Function `media` revérifie octets magiques, taille, dimensions, empreinte SHA-256 avant enregistrement. Aucune transformation d'image payante.

## 2026-09-30 — D8. Appairage par code et jeton d'appareil
Code à usage unique (8 caractères, 10 min) généré dans l'admin ; le PC reçoit un jeton aléatoire 256 bits stocké localement ; seule l'empreinte SHA-256 est en base. Le jeton ne permet que `player` (lecture du paquet publié + heartbeat) et `weather`.

## 2026-09-30 — D9. Un seul appel périodique `player`
Poll toutes les 15 s renvoyant la version courante (réponse minimale) ; le heartbeat est écrit en base au plus toutes les 30 s par ce même appel. ≈ 173 000 invocations/mois.

## En attente d'approbation (réservé)
- Méthodes religieuses et paramètres (SOURCES_AND_RIGHTS.md §1) — responsable religieux.
- Horaires communautaires 08:30 / 19:00 / 20:00 — « à confirmer ».
- Marge de masquage des sponsors (D5).
- Logo officiel (logo textuel provisoire).
- Autorisation écrite Chabad.org / CalJ si ingestion souhaitée (non prévue).
