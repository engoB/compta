# Compta — comptabilité automatisée

Tu déposes tes relevés, tickets et factures. Une tâche automatique les analyse chaque jour
(et à chaque dépôt), construit un tableau global de toutes tes opérations, contrôle les
calculs et rapproche les tickets des lignes bancaires. Toi, tu **vérifies** et tu **exportes**,
depuis ton PC ou ton téléphone (PWA installable, utilisable hors-ligne).

```
 Téléphone / PC                    Dépôt GitHub PRIVÉ (engoB/compta)                 Claude (API)
┌──────────────┐  photo, PDF,  ┌───────────┐  push / 7 h chaque jour  ┌──────────────────────┐
│  PWA Compta  │──────────────▶│  inbox/   │─────────────────────────▶│ GitHub Actions       │
│  (React)     │   CSV, OFX    └───────────┘                          │ pipeline/run.ts      │
│              │                ┌────────────────┐  ◀── commit ───────│ 1. CSV/OFX → parseur │
│  tableau de  │◀── lecture ────│ data/ledger    │                    │ 2. PDF/photo → IA ───┼──▶ extraction
│  bord, édit. │                │ archive/AAAA/MM│                    │ 3. contrôles soldes  │    structurée
│  exports     │── corrections ▶│ data/overrides │                    │ 4. catégorisation    │
└──────────────┘                └────────────────┘                    │ 5. dédoublonnage +   │
      ▲  (option) Google Drive : dossier « Compta/Inbox » ───────────▶│    rapprochement     │
                                                                      └──────────────────────┘
```

## Pourquoi cette architecture

| Besoin | Choix | Pourquoi (et alternatives écartées) |
|---|---|---|
| Stockage privé, historisé | **Dépôt GitHub privé** | Gratuit, chaque modification est versionnée (retour arrière possible), sert aussi de « base de données ». Drive reste possible comme *boîte de dépôt* (scans faits avec l'app Drive). |
| Tâche quotidienne | **GitHub Actions** (cron + déclenchement à chaque dépôt) | Gratuit (2 000 min/mois en privé, une passe ≈ 1 min), aucun serveur à maintenir. Un serveur Paperless-ngx/Firefly III auto-hébergé demanderait un VPS (≈ 5 €/mois) et de l'administration. |
| Analyse « la plus pointue » | **Claude** en sortie structurée (schéma JSON strict) | Lit nativement PDF et photos (pas d'OCR séparé type Tesseract), comprend les mises en page de chaque banque, catégorise. Les OCR spécialisés (Mindee, Veryfi, Dext) coûtent 0,05–0,10 €/page et ne lisent pas les relevés multi-pages aussi bien. |
| Fiabilité | **Contrôles comptables automatiques** | Solde initial + opérations = solde final ; somme = total du ticket ; dates dans la période. En cas d'échec : 2ᵉ analyse plus approfondie, puis statut « À vérifier ». |
| Coût minimal | **Parseurs déterministes d'abord** | Les exports CSV/OFX de ta banque sont lus sans IA (gratuit et exact). L'IA ne sert qu'aux PDF et photos. |
| Catégorisation | Règles → apprentissage → IA | Comme les « payee rules » d'Actual Budget et le moteur de règles de Firefly III : tes règles priment, tes corrections manuelles sont apprises, l'IA complète. |
| Rapprochement | Ticket ↔ ligne bancaire | Comme Pennylane/Firefly : même montant, débit 2 j avant à 10 j après le ticket, marchand ressemblant → le ticket devient le justificatif de la ligne, sans doublon. |
| Corrections à la main | `data/overrides.json` séparé | Le pipeline n'écrit **jamais** tes corrections : un seul écrivain par fichier, donc aucun conflit. Tes corrections restent prioritaires à vie. |
| App PC + mobile | **PWA** Vite + React + TypeScript + Tailwind | Une seule base de code, installable sur l'écran d'accueil, cache hors-ligne (IndexedDB), file d'attente de synchronisation. |
| Exports | Excel, PDF, CSV, OFX, JSON | Excel/PDF pour lire et transmettre, CSV universel (format FR), OFX pour réimporter dans Actual/Firefly/GnuCash, JSON = sauvegarde complète. |

**Ce qui n'a pas été retenu, et pourquoi :**
- *Agrégation bancaire automatique (GoCardless/Nordigen, Bridge, Powens)* : supprimerait même le dépôt des relevés, mais les offres gratuites sont devenues rares ou réservées aux professionnels (à vérifier au moment voulu). On peut l'ajouter plus tard comme nouvelle source dans `pipeline/`.
- *Paperless-ngx / Firefly III / Actual Budget* : excellents, ils ont inspiré ce projet, mais imposent un serveur 24 h/24 et ne font pas d'extraction intelligente des relevés PDF.
- *Google Sheets + Apps Script* : simple, mais pas de vraie app mobile, quotas, analyse limitée.

## Coût

| Poste | Coût |
|---|---|
| GitHub (dépôt privé + Actions) | 0 € |
| Hébergement de l'app (Cloudflare Pages) | 0 € |
| CSV / OFX bancaires | 0 € (sans IA, à part une catégorisation groupée de quelques centimes) |
| IA, modèle par défaut `claude-opus-5-5` | ordre de grandeur : ~0,04 $ par ticket photo, ~0,15 $ par relevé PDF de 4 pages, soit **~1,50 $/mois** pour 2 relevés + 30 tickets |
| IA, option `claude-haiku-5-5` | environ 40 fois moins cher (quelques centimes par mois), un peu moins précis sur les documents difficiles |

Le coût réel de chaque document est affiché dans l'app (onglet Justificatifs) et dans le
résumé de chaque passe GitHub Actions. Ce sont des estimations : mesure sur tes propres
documents avant de changer de modèle.

## Mise en place (≈ 15 min, une seule fois)

1. **Fusionner** cette branche dans `main` (les tâches planifiées ne tournent que sur la branche par défaut).
2. **Clé API** : crée une clé sur <https://console.anthropic.com>, puis dans le dépôt
   *Settings → Secrets and variables → Actions → New repository secret* : `ANTHROPIC_API_KEY`.
   Facultatif, onglet *Variables* : `COMPTA_MODEL` (`claude-opus-5-5` par défaut, ou `claude-haiku-5-5`), `COMPTA_EFFORT` (`medium` par défaut).
3. **Héberger l'app** sur [Cloudflare Pages](https://pages.cloudflare.com) (gratuit, compatible dépôt privé) :
   *Create → Pages → Connect to Git → engoB/compta*, commande de build `npm run build`, dossier `dist`.
   Dans *Settings → Builds → Build watch paths*, exclure `data/*`, `archive/*`, `inbox/*` pour ne pas reconstruire à chaque passe.
   L'app publiée ne contient **aucune donnée** : elle les lit dans ton dépôt privé avec ton jeton.
   (Vercel ou Netlify marchent pareil. GitHub Pages exige un compte payant pour un dépôt privé.)
4. **Jeton d'accès** : <https://github.com/settings/personal-access-tokens/new> → *Only select repositories : compta* →
   permissions **Contents : Read and write** et **Actions : Read and write**. Colle-le dans l'app, onglet *Réglages*.
5. **Installer l'app** : ouvre l'URL sur ton téléphone → *Partager → Sur l'écran d'accueil* (iPhone) ou *Installer l'application* (Android/Chrome).

Sans jeton, l'app s'ouvre en **mode démo** avec des données fictives.

### Option : boîte de dépôt Google Drive

Pour déposer tes scans depuis l'app Drive (fonction « Numériser ») :
1. Google Cloud Console → crée un projet → active l'API Google Drive → crée un *compte de service* → clé JSON.
2. Dans Drive, crée `Compta/Inbox` et `Compta/Traités`, partage-les (éditeur) avec l'adresse du compte de service.
3. Secrets/variables GitHub : `GDRIVE_SERVICE_ACCOUNT_JSON` (contenu du JSON), `GDRIVE_INBOX_FOLDER_ID`, `GDRIVE_DONE_FOLDER_ID` (identifiants à la fin de l'URL des dossiers).

## Au quotidien

- **Déposer** : onglet *Justificatifs* → « Photographier un ticket » ou « Importer des fichiers » (PDF, photos, CSV, OFX). Hors-ligne, l'envoi part au retour du réseau. Tu peux aussi déposer dans `inbox/` via GitHub ou Drive.
- **L'analyse démarre seule** (quelques minutes), et une passe complète a lieu chaque matin.
- **Vérifier** : le compteur « À vérifier » liste ce que les contrôles ont signalé. Corrige dans la fiche, puis « Valider ». « Tout valider » valide d'un coup ce qui est affiché.
- **Ajuster** : ajoute des catégories et des règles (`sncf|ouigo` → Transport) dans *Réglages* ; elles s'appliquent aussi rétroactivement.
- **Exporter** : onglet *Exports*, selon la période et les filtres choisis.

## Organisation du dépôt

```
src/                  PWA (React, Tailwind) — tableau de bord, opérations, justificatifs, exports, réglages
shared/               schémas de données (zod) partagés app ↔ pipeline, vue consolidée
pipeline/             passe d'automatisation (Node/TypeScript) + tests
  run.ts              orchestration : inbox → analyse → contrôles → ledger → archive
  parsers.ts          CSV et OFX bancaires (sans IA)
  extract.ts          extraction structurée par Claude (PDF, images, texte)
  checks.ts           contrôles comptables
  categorize.ts       règles + apprentissage des corrections
  reconcile.ts        dédoublonnage entre relevés, rapprochement ticket ↔ banque
  drive.ts            source Google Drive (optionnelle)
data/
  ledger.json         tableau global — écrit par le pipeline uniquement
  overrides.json      tes corrections, ajouts, suppressions — écrit par l'app uniquement
  rules.json          catégories et règles — écrit par l'app (Réglages)
  last-run.json       résumé de la dernière passe
inbox/                boîte de dépôt
archive/AAAA/MM/      justificatifs traités (nommés par empreinte SHA-256 → pas de double traitement)
.github/workflows/    process.yml (passe quotidienne + à chaque dépôt), ci.yml (tests + build)
```

## Développement

```bash
npm install
npm run dev            # app en local (mode démo sans jeton)
npm test               # tests du pipeline
npm run build          # typecheck + build de la PWA
ANTHROPIC_API_KEY=… npm run pipeline        # passe d'analyse en local sur inbox/
npm run pipeline:dry   # simulation : n'écrit rien, ne déplace rien
```

## Confidentialité

- Le dépôt doit rester **privé** (l'app affiche un avertissement sinon).
- Le jeton GitHub est stocké seulement sur tes appareils (localStorage) et limité à ce dépôt.
- Les documents ne sont envoyés qu'à l'API Anthropic pour l'analyse ; selon ses conditions commerciales, les données de l'API ne servent pas à l'entraînement par défaut.

## Pistes d'évolution

- Partage direct depuis l'app bancaire vers la PWA (Web Share Target).
- Connexion bancaire automatique (agrégateur) comme nouvelle source.
- Export FEC / livre des recettes si tu as une activité micro-entreprise.
- Mode lot (Batch API, −50 %) pour les gros imports d'historique.
