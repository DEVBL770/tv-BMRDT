# Déploiement

## Prérequis

- Node.js 22 et pnpm 10.17.1.
- Supabase CLI `2.117.0` (dépendance de développement verrouillée).
- Un projet Supabase et son accès administrateur au moment du raccordement.
- Un site statique HTTPS pour l’interface. L’origine publique doit être inscrite dans `ALLOWED_ORIGINS`.

## Développement local

```sh
pnpm install --frozen-lockfile
pnpm exec supabase start
pnpm exec supabase db reset
pnpm sync:shared
pnpm exec supabase gen types typescript --local > src/lib/database.types.ts
```

Le reset rejoue les migrations et le seed local. Pour les tests d’intégration, créez le fichier
local ignoré par Git `supabase/.env.integration` à partir de
`supabase/.env.integration.example`, démarrez le mock enregistré Hebcal et servez les fonctions :

```sh
pnpm exec tsx supabase/tests/mock-hebcal.ts
pnpm exec supabase functions serve --env-file supabase/.env.integration
```

En production, `HEBCAL_BASE_URL` peut rester absent (défaut `https://www.hebcal.com`). Le
mock et les clés de test sont réservés au développement/CI.

## Création et configuration du projet hébergé

1. Créez un projet Supabase dans la région choisie et conservez son `project-ref`.
2. Dans **Authentication → Providers**, gardez **Email** activé pour permettre la connexion
   administrateur par e-mail et mot de passe, mais désactivez **Allow new users to sign up**.
   Dans la configuration locale, `[auth].enable_signup = false` bloque les inscriptions publiques ;
   `[auth.email].enable_signup = true` active le fournisseur e-mail de la CLI sans rouvrir ces
   inscriptions. Le compte administrateur est créé par script, pas par inscription publique.
3. Connectez le dépôt au projet :

   ```sh
   pnpm exec supabase login
   pnpm exec supabase link --project-ref <project-ref>
   pnpm exec supabase db push
   ```

4. Publiez les fonctions :

   ```sh
   pnpm exec supabase functions deploy pair
   pnpm exec supabase functions deploy player
   pnpm exec supabase functions deploy weather
   pnpm exec supabase functions deploy admin
   ```

5. Définissez les secrets serveur. Remplacez les exemples par l’origine réelle du site et un
   `User-Agent` MET descriptif contenant un contact maintenu par le projet :

   ```sh
   pnpm exec supabase secrets set \
     ALLOWED_ORIGINS=https://<origine-du-site> \
     MET_USER_AGENT="BethMenahem/1.0 contact:<adresse-de-contact>"
   ```

   `SUPABASE_SERVICE_ROLE_KEY` est fourni par l’environnement Edge Functions de Supabase ; ne le
   placez jamais dans le bundle Vite, un fichier suivi ou une variable `VITE_*`. Configurez
   `HEBCAL_BASE_URL` seulement pour un endpoint compatible explicitement approuvé.

6. Créez le premier compte administrateur depuis un environnement de confiance. Les valeurs ne
   doivent pas être enregistrées dans Git :

   ```sh
   SUPABASE_URL="https://<project-ref>.supabase.co" \
   SUPABASE_SERVICE_ROLE_KEY="<clé-service-role>" \
   ADMIN_EMAIL="<adresse-admin>" \
   ADMIN_PASSWORD="<mot-de-passe-temporaire>" \
   pnpm exec tsx scripts/create-admin.ts
   ```

   Le script refuse de créer un deuxième administrateur. Après connexion, la récupération du
   mot de passe suit la procédure console indiquée dans `ADMIN_GUIDE`.

7. Configurez les variables publiques de build `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
   La clé anon est publique et protégée par les grants/RLS ; aucune opération appareil ne doit
   utiliser PostgREST. En l’absence de ces variables, l’administration reste en mode démo local.

## Rafraîchissement, méthodes et reprise

- `admin.refreshData` actualise Hebcal sur J−7 à J+400. En cas d’échec, les jours et la version
  publiés existants sont préservés ; aucun paquet de remplacement n’est publié.
- L’appel `player.sync` déclenche le rafraîchissement en arrière-plan si la dernière réussite date
  de plus de 24 h ou si l’horizon du paquet est inférieur à 330 jours.
- Le player interroge `player.sync` toutes les 15 secondes ; ces appels consultent la base et
  entretiennent l’activité du projet Supabase Free tant que la TV reste allumée et connectée.
  Après plus de 7 jours TV éteinte/inactive, le projet Free peut être mis en pause. Le paquet
  IndexedDB reste affiché sur la TV, mais les nouvelles publications et la météo attendent le retour
  du backend.
- Les paramètres religieux restent `pending` jusqu’à validation explicite du responsable religieux.
  Vérifiez les relevés de `docs/VALIDATION_RELIGIEUSE.md` et les sources avant approbation.
- Après une pause de plus de 7 jours : réactivez le projet depuis le tableau de bord Supabase et
  attendez que Postgres, Auth, Storage et les Edge Functions soient disponibles. Vérifiez la
  connexion avec l’origine configurée, lancez un `admin.refreshData` contrôlé puis contrôlez le
  dernier `source_health` et la version publiée. Une TV connectée reprend le polling et le
  téléchargement à sa prochaine synchronisation ; si elle ne dispose plus d’un jeton valide,
  révoquez/réappairez-la. Ne republiez pas un brouillon simplement pour reprendre le service.
- Les appareils sont appairés par un code à usage unique depuis l’action admin ; révoquez tout
  appareil perdu depuis l’action admin. Le jeton brut n’est montré qu’une seule fois.

Les déploiements de production, la création des comptes et la configuration des secrets nécessitent
les accès du propriétaire. Aucune clé ou adresse de contact réelle n’est conservée dans ce dépôt.
