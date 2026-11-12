# Sandbox Movix

Prototypes **isolés** du monorepo. Rien ici n’est branché au site, à l’app ou aux APIs de prod tant qu’une intégration n’est pas validée explicitement.

| Dossier | Intention |
| --- | --- |
| [`download-ux/`](download-ux/) | Télécharger via le pipeline de **lecture** (resolve → fichier), pas via `/download` DDL |

Règles :

- Pas de secrets commités (`.env` local seulement).
- Pas d’import depuis `src/` / `API/` vers le sandbox (le sandbox appelle l’API HTTP comme un client).
- Une proposition = preuve de concept documentée + commandes reproductibles ; l’UI produit vient après.
