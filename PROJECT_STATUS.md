# État du Projet au 12 Janvier 2026

## Statut Actuel
Le projet est fonctionnel pour la lecture normale (RSVP). Le mode "Headlines" (Ticker tape / Défilement continu) est en cours de stabilisation.

## Problèmes Non Résolus (Headlines Mode)

1. **Visibilité du Texte**
   - **Symptôme** : Le texte peut disparaître ou ne pas s'afficher du tout au lancement du mode Headlines sur certains appareils/simulateurs.
   - **Diagnostic actuel** : Conflit possible entre le thread JS (calcul des fenêtres de texte) et le thread UI (Reanimated). Le fallback `content.slice(0,50)` a été ajouté pour atténuer cela, mais la solution n'est pas garantie à 100%.
   - **Action requise** : Vérifier si `SharedValue<number[]>` pour les offsets globaux est trop lourd pour le bridge sur les anciens appareils.

2. **Synchronisation Audio/Scroll**
   - **Symptôme** : Possible dérive entre la position du curseur et le mot lu si la vitesse varie.
   - **État** : Le code actuel assume une vitesse constante (WPM linearisé).

3. **Performance de Rendu**
   - **Technique** : Nous utilisons une `View` géante (`width: 500000`) avec un seul composant `Text` contenant ~1000 mots.
   - **Risque** : Sur Android, les textures géantes peuvent causer des crashs ou des écrans noirs si elles dépassent la limite OpenGL (souvent 4096px ou 8192px).
   - **Future Fix** : Migrer vers un rendu Canvas (Skia) ou une `FlatList` virtualisée horizontale stricte si le problème persiste.

## Timestamp
**Date** : 12 Janvier 2026
**Commit** : "Backup state with robust rendering logic for Headlines"
