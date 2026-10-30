cmake_minimum_required(VERSION 3.22.1)
project(movixcurl C)

# Préparé par la tâche Gradle prepareCurlImpersonate (app/build.gradle) :
# en-têtes et libcurl-impersonate.so d'une release vérifiée par SHA-256.
set(CURL_IMPERSONATE_ABI_DIR "${CURL_IMPERSONATE_ROOT}/${ANDROID_ABI}")

add_library(curl-impersonate SHARED IMPORTED)
set_target_properties(curl-impersonate PROPERTIES
    IMPORTED_LOCATION "${CURL_IMPERSONATE_ABI_DIR}/libcurl-impersonate.so")

add_library(movixcurl SHARED movix_curl.c)
target_include_directories(movixcurl PRIVATE "${CURL_IMPERSONATE_ABI_DIR}/include")
target_link_libraries(movixcurl curl-impersonate android)
