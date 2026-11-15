# Décodeurs audio FFmpeg

Module `decoder_ffmpeg` de [Media3](https://github.com/androidx/media)
(tag 1.11.1, sans le rendu vidéo expérimental), que Google ne publie pas sur
Maven. Le lecteur s'en sert quand la télé ne sait ni décoder une piste ni
l'envoyer telle quelle à l'ampli ou à la barre de son : le son est alors
décodé dans l'appli et sort en PCM.

| Format | Décodeur FFmpeg |
|---|---|
| Dolby Digital (AC-3) | `ac3` |
| Dolby Digital Plus (E-AC-3, Atmos JOC) | `eac3` |
| Dolby TrueHD | `truehd`, `mlp` |
| DTS, DTS-HD | `dca` |

Les bibliothèques `src/main/jniLibs/<abi>/libffmpegJNI.so` sont précompilées
et **commitées** : le build Gradle n'a pas besoin du NDK.

## Régénérer

Prérequis : NDK Android (`ANDROID_NDK_HOME`), curl, tar et make.

```bash
cd app-tv/ffmpeg
./build.sh
```

La version de FFmpeg et son SHA-256 sont épinglés dans `build.sh`. Après une
mise à jour de Media3, reprendre les fichiers Java et `jni/ffmpeg_jni.cc` du
tag correspondant, puis régénérer.

## Licences

- Code Java et `jni/ffmpeg_jni.cc` : Media3, Apache 2.0.
- [FFmpeg](https://ffmpeg.org/) : LGPL 2.1 ou ultérieure, compilé sans les
  options GPL ni non libres. Les sources sont celles de la version épinglée
  dans `build.sh`, et `build.sh` permet de reconstruire et de remplacer
  `libffmpegJNI.so`.
