# Télévision Windows en mode kiosque

## Préparer le poste

- Utilisez un compte Windows dédié au kiosque, les mises à jour de sécurité activées et une
  connexion Ethernet ou Wi-Fi stable.
- Installez Microsoft Edge à jour. Gardez la mise en veille et l’extinction d’écran désactivées
  pour l’alimentation secteur ; le redémarrage après une coupure de courant doit ramener au compte
  kiosque.
- Déployez le frontend en HTTPS et configurez `VITE_SUPABASE_URL` et
  `VITE_SUPABASE_ANON_KEY` au moment du build.

## Premier appairage

1. Ouvrez `https://<origine>/display` dans Edge. Au premier démarrage, l’écran présente le nom
   **TV salle principale** et un champ de code.
2. Depuis l’admin, créez un code d’appairage à usage unique et saisissez les huit caractères sur
   la TV. Le code expire après 10 minutes ; il n’est affiché qu’une fois.
3. Attendez l’arrivée de la version publiée et vérifiez que les informations restent visibles après
   une actualisation de la page.
4. Configurez Edge en mode kiosque plein écran sur `/display`. Ne stockez aucun jeton appareil
   dans un raccourci, un script ou un profil partagé.

Si le cache existe mais que le jeton a été supprimé/révoqué, l’écran continue de présenter le
dernier paquet local. Appuyez sur **Ctrl+Shift+P** pour ouvrir l’appairage sans effacer ce cache.
Une révocation affiche « Appareil non autorisé » et interrompt les synchronisations jusqu’au nouvel
appairage.

## Fonctionnement et dépannage

- La synchronisation serveur a lieu toutes les 15 secondes (±2 s) ; météo toutes les 30 minutes.
  Après cinq minutes sans synchronisation réussie, un point discret apparaît. Une coupure Internet
  ne vide ni le paquet ni les médias IndexedDB.
- Le service worker garde le shell et les polices disponibles hors ligne. Les appels Supabase ne
  sont pas mis en cache ; la mise à jour nécessite une connexion.
- La page est rechargée chaque jour vers **04:00 heure locale**. Si cet instant tombe pendant
  Chabbat ou Yom Tov, le reload attend la sortie puis 30 minutes. Le watchdog redémarre la page si
  l’horloge n’avance plus pendant 60 secondes.
- Si le backend a été en pause après plus de sept jours d’inactivité, suivez **DEPLOYMENT.md →
  Rafraîchissement, méthodes et reprise**. Le cache local reste affiché pendant la reprise.
- Si le player indique un appareil non autorisé, vérifiez/révoquez son entrée depuis l’admin puis
  générez un nouveau code. Si l’écran reste en attente, contrôlez la connexion, l’origine CORS et
  l’état des Edge Functions avant de republier.

Le raccourci clavier nécessite un clavier relié au poste ; conservez un accès de maintenance
physique au compte kiosque et à Edge.
