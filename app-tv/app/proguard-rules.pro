# kotlinx.serialization : les règles sont fournies par la bibliothèque.
# Garder les noms de lignes pour des traces lisibles.
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# QuickJS (extraction sur la télé) : le code natif de quickjs-kt lit des
# champs et appelle des méthodes par leur nom (JNI). Sa règle fournie garde la
# classe UByteArray mais pas son champ « storage » : sans cette règle, la
# première extraction tuait l'appli (GetObjectField sur un champ supprimé).
-keep class kotlin.UByteArray { *; }
-keep class com.dokar.quickjs.** { *; }

# Bloqueur du lecteur web (crate app-tv/adblock) : les fonctions natives
# sont liées par leur nom complet (Java_com_movix_tv_adblock_AdblockNative_*).
-keep class com.movix.tv.adblock.AdblockNative { native <methods>; }
