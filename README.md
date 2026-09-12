# CineMode

IINA plugin: a fullscreen pause overlay and a **Skip intro** button that only appears when the timing is actually known.

Built for IINA as an external player (including Stremio + Real-Debrid / TorBox). CineMode is not affiliated with IINA, Stremio, TMDB, Letterboxd, AniList, AniSkip, or TheIntroDB.

**Français** plus bas.

## Install

**IINA 1.4+.** You need a free [TMDB API key](https://www.themoviedb.org/settings/api).

### From GitHub (recommended)

1. IINA → Settings → Plugins → **Install from GitHub…**
2. Enter `D0CA/iina-cinemode`
3. Open CineMode preferences and paste your TMDB key
4. Fully quit IINA (**Cmd+Q**) and reopen

### From a package

Download `CineMode.iinaplgz` from [Releases](https://github.com/D0CA/iina-cinemode/releases) and open it, or: Settings → Plugins → install from file.

## Features

- Pause overlay: backdrop, poster, logo, SxxExx, air date, studio, runtime, rating, cast, synopsis, progress
- **Search title**: show → season → episode if the filename is not recognized
- Skip intro / recap / credits only from known sources: [TheIntroDB](https://theintrodb.org), [AniSkip](https://github.com/aniskip) (anime OP/ED), named chapters, or a manual mark per season
- Anime: AniList score + studio; AniSkip when TheIntroDB / chapters have nothing
- Movies: Letterboxd rating when it works, otherwise TMDB
- Audio / subtitle tracks follow the plugin language
- **Up next** (optional): opens the next episode page in Stremio — it does **not** start the next torrent. Turn it off in preferences if you do not use Stremio
- Shortcut: **Shift+S**. Auto-skip is optional (never guesses)

## Preferences

Hide cast, synopsis, progress bar, or Up next. Toggle TheIntroDB, AniSkip, AniList, Letterboxd, and language (fr / en / es / de / it / pt). After a language change, relaunch IINA for menus.

## Limits

- Debrid URLs often have no title. Identification uses the filename, URL, sometimes `Content-Disposition`, or an IMDb `tt…` id
- Up next cannot pick your Stremio stream for you
- AniSkip uses the MAL episode number (same as TMDB `E478` on long-running shows; seasonal `S02E05` may miss)
- After plugin JS changes in dev: **Cmd+Q** IINA, then reopen

## Development

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link /path/to/iina-cinemode
./scripts/pack.sh   # → dist/CineMode.iinaplgz
```

To ship an update: bump `version` and increment `ghVersion` in `Info.json`, tag, attach the `.iinaplgz`.

## License

[MIT](LICENSE)

---

## Français

Plugin [IINA](https://iina.io) : overlay pause plein écran et bouton **Passer l’intro** uniquement quand le timing est vraiment connu.

Pensé pour IINA en lecteur externe (Stremio + Real-Debrid / TorBox). CineMode n’est affilié à aucune de ces apps.

### Installer

IINA 1.4+. Clé API TMDB gratuite : [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api).

1. IINA → Réglages → Plugins → **Installer depuis GitHub…**
2. `D0CA/iina-cinemode`
3. Préférences CineMode → colle la clé TMDB
4. **Cmd+Q** IINA, puis relance

Ou ouvre le `CineMode.iinaplgz` des [Releases](https://github.com/D0CA/iina-cinemode/releases).

### Ce que ça fait

Overlay pause (backdrop, poster, logo, date, studio, durée, note, casting, synopsis). Recherche en 3 étapes si le fichier n’est pas reconnu. Skip via TheIntroDB, AniSkip (anime), chapitres nommés, ou marque manuelle. **À suivre** (désactivable) ouvre la fiche du prochain épisode dans Stremio, pas le torrent.

### Dev

```sh
/Applications/IINA.app/Contents/MacOS/iina-plugin link /chemin/vers/iina-cinemode
./scripts/pack.sh
```

Après un changement JS : **Cmd+Q**.
