# Export et restauration

## Export opérationnel

`scripts/export.ts` se connecte en administrateur puis appelle l’action `export` de l’Edge Function
`admin`. L’export comprend les tables métier, l’historique publié conservé, les snapshots de
brouillon et la liste des objets Storage. Il exclut les empreintes des jetons appareils et les
secrets. Les octets des médias sont téléchargés dans le même dossier daté :

```sh
SUPABASE_URL="https://<project-ref>.supabase.co" \
SUPABASE_ANON_KEY="<clé-anon-publique>" \
ADMIN_EMAIL="<adresse-admin>" \
ADMIN_PASSWORD="<mot-de-passe>" \
pnpm exec tsx scripts/export.ts
```

Le résultat est écrit sous `exports/<date-heure>/` (`export.json` et `media/`). Les exports
peuvent contenir des annonces, événements et données communautaires : conservez-les sur un support
de confiance, limitez les accès et définissez une politique de rétention hors du dépôt. Ne
committez jamais `exports/`, identifiants, mots de passe ou clés.

## Restaurer une version publiée

Chaque version immuable contient `package`, `media_manifest` et `draft_snapshot` (règles,
exceptions, contenus, layout et paramètres publics utilisés à la compilation). La restauration
est une action administrateur `restore` sur l’identifiant d’une version conservée ; elle :

1. charge le snapshot original sans modifier l’ancienne version ;
2. vérifie que chaque média du snapshot est toujours `ready` et présent dans le bucket privé ;
3. recompîle le snapshot avec le calendrier courant et les validations actuelles ;
4. publie une nouvelle version `source: "restore"` avec `restored_from` ;
5. remplace le brouillon courant par le snapshot restauré et écrit l’audit.

Si un objet média manque, la fonction répond `restore_media_missing` et fournit ses identifiants ;
la version publiée courante n’est pas remplacée. Récupérez l’objet depuis une sauvegarde de médias
fiable avant de relancer la restauration.

La restauration actuelle porte sur un snapshot déjà présent dans `published_versions`. La
réimportation d’un export JSON externe dans une nouvelle instance n’est pas automatisée : après
création/migration du projet cible, les médias et enregistrements doivent être réimportés par une
procédure contrôlée, puis validés et publiés depuis l’admin. Ne restaurez pas directement les tables
immuables ni ne modifiez manuellement `public_state`.

## Rétention et audit

`purge_old_versions()` est le seul mécanisme autorisé à supprimer les anciennes versions ; il
conserve la version courante et les dernières `settings.version_retention` versions (60 par défaut).
Les versions et événements d’audit sont des sauvegardes applicatives, pas un remplacement des
sauvegardes de base gérées par Supabase. La purge des audits selon `audit_retention_days` doit être
planifiée séparément avant mise en production.
