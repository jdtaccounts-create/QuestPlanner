# QuestPlanner

QuestPlanner est une application Windows pour préparer les items de quêtes Dofus et construire un plan de craft à partir des données DofusDB.

## Installer l'application

Télécharge la dernière version depuis l'onglet **Releases** du dépôt GitHub, puis lance :

- `QuestPlanner_0.1.0_x64-setup.exe` pour l'installation classique Windows
- ou `QuestPlanner_0.1.0_x64_en-US.msi` si tu préfères le format MSI

## Fonctionnalités

- Recherche et sélection de quêtes.
- Parsing d'une liste de quêtes depuis le presse-papier.
- Agrégation des items nécessaires.
- Séparation par équipements, consommables et ressources.
- Plan de craft en trois colonnes : base à craft, sous-crafts, ingrédients.
- Synchronisation locale avec DofusDB.
- Mode clair et mode sombre.

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
