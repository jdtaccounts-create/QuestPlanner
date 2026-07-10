# QuestPlanner

QuestPlanner est une application Windows communautaire, gratuite et non officielle pour préparer les items nécessaires aux quêtes et succès DOFUS.

## Présentation

QuestPlanner permet de sélectionner des quêtes, des succès ou des suites de quêtes, puis d'agréger automatiquement les items demandés. Les besoins sont répartis en équipements, consommables et ressources, avec un plan de craft récursif pour distinguer les crafts principaux, les sous-crafts et les ingrédients directement nécessaires.

L'application utilise une base locale commune pour les données DofusDB et conserve séparément ses corrections de quêtes curatées. Les données de quêtes corrigées manuellement ne sont pas écrasées par une synchronisation automatique.

## Fonctionnalités

- Recherche et sélection de quêtes, succès et suites de quêtes.
- Choix guidés pour les embranchements de quêtes connus.
- Parsing d'une liste de quêtes depuis le presse-papier.
- Agrégation exacte des besoins et des doublons.
- Séparation par équipements, consommables et ressources.
- Quantités possédées ajustables au clavier ou à la molette au survol.
- Cases à cocher synchronisées avec les quantités.
- Plan de craft récursif avec base à craft, sous-crafts et ingrédients.
- Gestion cohérente des ressources partagées entre plusieurs crafts.
- Tri enrichi des ressources par récoltables, origines de monstres, familles, types et ordre alphabétique.
- Liens directs vers les fiches DofusDB.
- Modes clair et sombre.
- Synchronisation automatique des données, recettes, panoplies et images utiles.
- Mises à jour automatiques signées.

## Données hors ligne

La base locale commune est stockée dans :

```text
%LOCALAPPDATA%\DofusCompanionData
```

Elle contient le catalogue DofusDB synchronisé, les recettes, les panoplies, les images utiles et les échecs d'images déjà connus. Les images inutiles ou devenues obsolètes sont nettoyées après une synchronisation réussie.

Les données de quêtes propres à l'application restent dans l'application et dans son stockage local. Elles sont volontairement séparées de la base DofusDB synchronisable.

## Télécharger

La dernière version Windows est disponible dans les [releases GitHub](https://github.com/jdtaccounts-create/QuestPlanner/releases/latest).

Fichier recommandé :

- `QuestPlanner_x.x.x_x64-setup.exe` pour l'installation classique Windows.

## Désinstallation

La désinstallation Windows retire l'application installée. Le dossier `%LOCALAPPDATA%\DofusCompanionData` n'est pas supprimé automatiquement, car il peut être partagé par plusieurs outils locaux utilisant les mêmes données DOFUS.

Pour tout supprimer après avoir désinstallé les outils concernés, supprimer manuellement :

```text
%LOCALAPPDATA%\DofusCompanionData
```

## Développement local

```powershell
npm install
npm run smoke
npm run build
npm run dev
```

Ouvrir ensuite `http://127.0.0.1:5174`.

## Publication

La procédure de build signé et de release est décrite dans [RELEASE.md](RELEASE.md). La clé privée de signature ne doit jamais être affichée ni commitée.

## Crédits et droits

QuestPlanner n'est affilié ni à Ankama ni à DofusDB. Les crédits détaillés, conditions d'utilisation des données et mentions de droits figurent dans [NOTICE.md](NOTICE.md).
