# QuestPlanner

QuestPlanner est une application Windows pour préparer les items de quêtes Dofus et construire un plan de craft à partir des données DofusDB.

Projet communautaire non officiel, non commercial, non affilié à Ankama ni à DofusDB.

DOFUS et Ankama sont des marques ou propriétés de leurs ayants droit respectifs.

Données issues de DofusDB. Utilisation soumise à la LPNC-IA 1.0.

Voir aussi [NOTICE.md](NOTICE.md) pour les crédits et notes de droits.

## Installer l'application

Télécharge l'application depuis la dernière release :

[Télécharger QuestPlanner v0.1.0](https://github.com/jdtaccounts-create/QuestPlanner/releases/tag/v0.1.0)

Fichier recommandé :

- `QuestPlanner_0.1.0_x64-setup.exe` pour l'installation classique Windows.

Autre fichier disponible :

- `QuestPlanner_0.1.0_x64_en-US.msi` pour le format MSI.

## Fonctionnalités

- Recherche et sélection de quêtes.
- Parsing d'une liste de quêtes depuis le presse-papier.
- Agrégation des items nécessaires.
- Séparation par équipements, consommables et ressources.
- Plan de craft en trois colonnes : base à craft, sous-crafts, ingrédients.
- Synchronisation locale avec DofusDB.
- Mode clair et mode sombre.

## Données et droits

Cette application utilise des données publiques issues de DofusDB pour les quêtes, items, recettes et images d'items.

Le projet est publié à titre non commercial. Il ne doit pas être vendu, monétisé par publicité, abonnement ou intégré dans un service commercial.

Si un ayant droit souhaite une modification, une attribution différente ou le retrait de certains contenus, le dépôt pourra être ajusté en conséquence.

## Développement

Prérequis :

- Node.js
- Rust/Cargo
- GitHub CLI uniquement si tu veux publier une release

Commandes utiles :

```powershell
npm install
npm run dev
npm run build
npm run tauri -- build
```

L'exécutable généré se trouve dans :

```text
src-tauri/target/release/app.exe
```
