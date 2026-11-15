const ALPHABET =
  "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
const SITE_NAME = "Movix";
const TMDB_API_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

const PROVIDER_NAMES = {
  8: "Netflix",
  119: "Prime Video",
  337: "Disney+",
  350: "Apple TV+",
  355: "Warner Bros",
  356: "DC Comics",
  384: "HBO Max",
  531: "Paramount+",
};

const GENRE_NAMES = {
  fr: {
    12: "Aventure",
    14: "Fantastique",
    16: "Animation",
    18: "Drame",
    27: "Horreur",
    28: "Action",
    35: "Comédie",
    36: "Histoire",
    37: "Western",
    53: "Thriller",
    80: "Crime",
    99: "Documentaire",
    878: "Science-fiction",
    9648: "Mystère",
    10402: "Musique",
    10749: "Romance",
    10751: "Famille",
    10752: "Guerre",
    10759: "Action & aventure",
    10762: "Enfants",
    10763: "Actualites",
    10764: "Télé-réalité",
    10765: "Science-fiction & fantastique",
    10766: "Feuilleton",
    10767: "Talk-show",
    10768: "Guerre & politique",
    10770: "Téléfilm",
  },
  en: {
    12: "Adventure",
    14: "Fantasy",
    16: "Animation",
    18: "Drama",
    27: "Horror",
    28: "Action",
    35: "Comedy",
    36: "History",
    37: "Western",
    53: "Thriller",
    80: "Crime",
    99: "Documentary",
    878: "Science Fiction",
    9648: "Mystery",
    10402: "Music",
    10749: "Romance",
    10751: "Family",
    10752: "War",
    10759: "Action & Adventure",
    10762: "Kids",
    10763: "News",
    10764: "Reality",
    10765: "Sci-Fi & Fantasy",
    10766: "Soap",
    10767: "Talk",
    10768: "War & Politics",
    10770: "TV Movie",
  },
};

const COPY = {
  fr: {
    tmdbLanguage: "fr-FR",
    ogLocale: "fr_FR",
    alternateOgLocale: "en_US",
    defaultTitle: "Movix - Films et séries en streaming",
    defaultImageAlt:
      "Logo Movix devant un mur d'affiches de films, séries et animés",
    defaultDescription:
      "Des milliers de films, séries et animés en streaming gratuit, en VF et VOSTFR. À regarder seul ou entre amis en Watch Party.",
    movieWord: "films",
    tvWord: "séries",
    providerFallback: "Plateforme",
    genresLabel: "Genres",
    releaseLabel: "Sortie",
    firstAirLabel: "Première diffusion",
    ratingLabel: "Note",
    seasonsLabel: "Saisons",
    episodesLabel: "Épisodes",
    yearLabel: "Année",
    moviesLabel: "Films",
    knownForLabel: "Connu pour",
    bornLabel: "Naissance",
    movieFallback:
      "Découvrez {{title}} sur Movix, avec synopsis, note et lecture en ligne.",
    tvFallback:
      "Découvrez {{title}} sur Movix, avec synopsis, note, saisons et lecture en ligne.",
    collectionFallback:
      "Retrouvez tous les films de la collection {{title}} sur Movix.",
    personFallback:
      "Consultez la biographie et la filmographie de {{title}} sur Movix.",
    watchMovieLabel: "Regarder le film",
    watchSeriesLabel: "Regarder la série",
    watchAnimeLabel: "Regarder l’anime",
    watchPartyRoomLabel: "Watch Party",
    watchPartyJoinLabel: "Rejoindre la Watch Party",
    downloadMovieLabel: "Télécharger le film",
    downloadSeriesLabel: "Télécharger la série",
    participantsLabel: "Participants",
    visibilityLabel: "Visibilité",
    codeLabel: "Code",
    syncLabel: "Sync",
    mediaTypeLabel: "Type",
    publicLabel: "Publique",
    privateLabel: "Privée",
    classicLabel: "Classic",
    syncProLabel: "Sync Pro",
    movieLabel: "Film",
    tvLabel: "Serie",
    sharedListTitle: "Liste partagée - Movix",
    sharedListDescription:
      "Consultez une liste partagée par la communauté Movix.",
    watchPartyTitle: "Watch Party - Movix",
    watchPartyDescription:
      "Créez, rejoignez et partagez une watch party synchronisée sur Movix.",
    homeTitle: "Movix — Films, séries et animés en streaming gratuit",
    homeDescription:
      "Des milliers de films, séries et animés en streaming gratuit, en VF et VOSTFR. À regarder seul ou entre amis en Watch Party.",
    searchTitle: "Recherche - Movix",
    searchDescription:
      "Cherchez un film, une série, une collection ou une personne sur Movix.",
    moviesTitle: "Films - Movix",
    moviesDescription:
      "Parcourez les films populaires, récents et recommandés sur Movix.",
    tvTitle: "Séries TV - Movix",
    tvDescription:
      "Parcourez les séries TV populaires, récentes et recommandées sur Movix.",
    collectionsTitle: "Collections - Movix",
    collectionsDescription:
      "Retrouvez les sagas et franchises de films disponibles sur Movix.",
    alertsTitle: "Mes alertes - Movix",
    alertsDescription: "Gérez vos alertes de sorties et de nouveaux épisodes.",
    rouletteTitle: "Roulette - Movix",
    rouletteDescription:
      "Laissez Movix choisir un film ou une série pour votre prochaine session.",
    suggestionTitle: "Suggestion - Movix",
    suggestionDescription:
      "Lancez une recommandation surprise selon vos critères.",
    providerBrowseTitle: "Où regarder - Movix",
    providerBrowseDescription:
      "Explorez les catalogues par plateforme de streaming sur Movix.",
    liveTvTitle: "Live TV - Movix",
    liveTvDescription:
      "Accédez aux chaînes en direct et au direct TV sur Movix.",
    extensionTitle: "Extension - Movix",
    extensionDescription:
      "Installez l’extension navigateur Movix et ses intégrations.",
    top10Title: "Top 10 - Movix",
    top10Description:
      "Consultez le Top 10 films et séries de la communauté Movix.",
    settingsTitle: "Paramètres - Movix",
    settingsDescription:
      "Réglez la langue, les préférences et les options de votre expérience Movix.",
    aboutTitle: "À propos de Movix",
    aboutDescription:
      "Découvrez ce qu’est Movix et les fonctionnalités de la plateforme.",
    privacyTitle: "Confidentialité - Movix",
    privacyDescription:
      "Consultez la politique de confidentialité et les pratiques de Movix.",
    cinegraphTitle: "CineGraph - Movix",
    cinegraphDescription:
      "Explorez les liens entre films, séries, genres et talents avec CineGraph.",
    wishboardTitle: "Wishboard - Movix",
    wishboardDescription:
      "Demandez un ajout de contenu et suivez les requêtes communautaires.",
    wrappedTitle: "Wrapped - Movix",
    wrappedDescription: "Retrouvez vos statistiques et votre récap Movix.",
    profileTitle: "Profil - Movix",
    profileDescription:
      "Retrouvez vos listes, favoris, alertes et historique sur Movix.",
    authTitle: "Connexion - Movix",
    authDescription: "Connectez-vous à votre compte Movix.",
    vipTitle: "VIP - Movix",
    vipDescription: "Découvrez les avantages VIP et les options premium Movix.",
    genericPageTitle: "Page Movix",
    genericPageDescription: "Découvrez cette page sur Movix.",
  },
  en: {
    tmdbLanguage: "en-US",
    ogLocale: "en_US",
    alternateOgLocale: "fr_FR",
    defaultTitle: "Movix - Movies and TV streaming",
    defaultImageAlt:
      "Movix logo in front of a wall of movie, TV and anime posters",
    defaultDescription:
      "Thousands of movies, TV shows and anime streaming for free, dubbed or subtitled. Watch alone or with friends in a Watch Party.",
    movieWord: "movies",
    tvWord: "TV shows",
    providerFallback: "Platform",
    genresLabel: "Genres",
    releaseLabel: "Release",
    firstAirLabel: "First air",
    ratingLabel: "Rating",
    seasonsLabel: "Seasons",
    episodesLabel: "Episodes",
    yearLabel: "Year",
    moviesLabel: "Movies",
    knownForLabel: "Known for",
    bornLabel: "Born",
    movieFallback:
      "Discover {{title}} on Movix with synopsis, rating and online playback.",
    tvFallback:
      "Discover {{title}} on Movix with synopsis, rating, seasons and online playback.",
    collectionFallback:
      "Browse every movie in the {{title}} collection on Movix.",
    personFallback: "See the biography and filmography of {{title}} on Movix.",
    watchMovieLabel: "Watch movie",
    watchSeriesLabel: "Watch series",
    watchAnimeLabel: "Watch anime",
    watchPartyRoomLabel: "Watch Party",
    watchPartyJoinLabel: "Join Watch Party",
    downloadMovieLabel: "Download movie",
    downloadSeriesLabel: "Download series",
    participantsLabel: "Participants",
    visibilityLabel: "Visibility",
    codeLabel: "Code",
    syncLabel: "Sync",
    mediaTypeLabel: "Type",
    publicLabel: "Public",
    privateLabel: "Private",
    classicLabel: "Classic",
    syncProLabel: "Sync Pro",
    movieLabel: "Movie",
    tvLabel: "TV Show",
    sharedListTitle: "Shared List - Movix",
    sharedListDescription: "Browse a list shared by the Movix community.",
    watchPartyTitle: "Watch Party - Movix",
    watchPartyDescription:
      "Create, join and share synchronized watch parties on Movix.",
    homeTitle: "Movix — Free movies, TV shows and anime streaming",
    homeDescription:
      "Thousands of movies, TV shows and anime streaming for free, dubbed or subtitled. Watch alone or with friends in a Watch Party.",
    searchTitle: "Search - Movix",
    searchDescription:
      "Search for a movie, TV show, collection or person on Movix.",
    moviesTitle: "Movies - Movix",
    moviesDescription:
      "Browse popular, recent and recommended movies on Movix.",
    tvTitle: "TV Shows - Movix",
    tvDescription: "Browse popular, recent and recommended TV shows on Movix.",
    collectionsTitle: "Collections - Movix",
    collectionsDescription:
      "Browse movie sagas and franchises available on Movix.",
    alertsTitle: "My Alerts - Movix",
    alertsDescription: "Manage your release and new episode alerts.",
    rouletteTitle: "Roulette - Movix",
    rouletteDescription:
      "Let Movix pick a movie or TV show for your next session.",
    suggestionTitle: "Suggestion - Movix",
    suggestionDescription:
      "Get a surprise recommendation based on your filters.",
    providerBrowseTitle: "Where to Watch - Movix",
    providerBrowseDescription:
      "Explore streaming catalogs by platform on Movix.",
    liveTvTitle: "Live TV - Movix",
    liveTvDescription: "Access live channels and TV streams on Movix.",
    extensionTitle: "Extension - Movix",
    extensionDescription:
      "Install the Movix browser extension and integrations.",
    top10Title: "Top 10 - Movix",
    top10Description: "See the Movix community Top 10 movies and TV shows.",
    settingsTitle: "Settings - Movix",
    settingsDescription:
      "Adjust language, preferences and experience options on Movix.",
    aboutTitle: "About Movix",
    aboutDescription: "Learn what Movix is and what the platform offers.",
    privacyTitle: "Privacy - Movix",
    privacyDescription: "Read the Movix privacy policy and data practices.",
    cinegraphTitle: "CineGraph - Movix",
    cinegraphDescription:
      "Explore links between movies, shows, genres and talent with CineGraph.",
    wishboardTitle: "Wishboard - Movix",
    wishboardDescription:
      "Request content additions and track community requests.",
    wrappedTitle: "Wrapped - Movix",
    wrappedDescription: "See your Movix stats and recap.",
    profileTitle: "Profile - Movix",
    profileDescription:
      "Find your lists, favorites, alerts and history on Movix.",
    authTitle: "Login - Movix",
    authDescription: "Sign in to your Movix account.",
    vipTitle: "VIP - Movix",
    vipDescription: "Discover Movix VIP benefits and premium options.",
    genericPageTitle: "Movix Page",
    genericPageDescription: "Discover this page on Movix.",
  },
};

function decodeBase62ToBytes(value) {
  const base = BigInt(ALPHABET.length);
  let current = BigInt(0);

  for (const character of value) {
    const index = ALPHABET.indexOf(character);

    if (index === -1) {
      throw new Error(`Invalid character in base62 string: ${character}`);
    }

    current = current * base + BigInt(index);
  }

  const bytes = [];

  while (current > 0) {
    bytes.unshift(Number(current & BigInt(0xff)));
    current >>= BigInt(8);
  }

  return new Uint8Array(bytes);
}

function isLegacyBase64Id(value) {
  return value.includes("=");
}

function decodeId(encodedId) {
  try {
    if (isLegacyBase64Id(encodedId)) {
      const base64Part = encodedId.slice(0, -7);
      const originalId = atob(base64Part);
      return /^\d+$/.test(originalId) ? originalId : null;
    }

    const maxSuffix = 30;
    const start = Math.max(1, encodedId.length - maxSuffix);

    for (let index = start; index >= 1; index -= 1) {
      try {
        const base62Part = encodedId.slice(0, index);
        const bytes = decodeBase62ToBytes(base62Part);
        const originalId = new TextDecoder().decode(bytes);

        if (/^\d+$/.test(originalId)) {
          return originalId;
        }
      } catch (_error) {
        continue;
      }
    }

    return null;
  } catch (_error) {
    return null;
  }
}

function getTmdbId(rawId) {
  if (!rawId) return null;
  if (/^\d+$/.test(rawId)) return rawId;
  return decodeId(rawId);
}

function getTmdbApiKey(env) {
  return env.TMDB_API_KEY || env.VITE_TMDB_API_KEY || "";
}

function resolvePreviewLanguage(requestUrl) {
  const langParam = (requestUrl.searchParams.get("lang") || "").toLowerCase();
  return langParam === "en" ? "en" : "fr";
}

function collapseWhitespace(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeMultilineText(value) {
  return String(value || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => collapseWhitespace(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\n+|\n+$/g, "");
}

function truncateText(value, maxLength) {
  const normalized = normalizeMultilineText(value);
  return normalized.length <= maxLength
    ? normalized
    : `${normalized.slice(0, maxLength - 1).trimEnd()}...`;
}

function interpolate(template, values) {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key) => values[key] ?? "");
}

function normalizePathname(pathname) {
  if (!pathname || pathname === "/") return "/";
  return pathname.replace(/\/+$/, "") || "/";
}

function extractYear(dateValue) {
  if (!dateValue) return null;
  const parsedDate = new Date(dateValue);
  return Number.isNaN(parsedDate.getTime())
    ? null
    : String(parsedDate.getFullYear());
}

function formatRating(value) {
  const numberValue = Number(value || 0);
  if (!numberValue) return null;
  return Number.isInteger(numberValue)
    ? String(numberValue)
    : numberValue.toFixed(1);
}

// Bannière 1200 × 630 (logo devant un mur d'affiches) : image par défaut
// quand une page n'a ni affiche ni fond TMDB.
const DEFAULT_SHARE_IMAGE = {
  path: "/og-image.jpg",
  width: 1200,
  height: 630,
  type: "image/jpeg",
};

function buildImageUrl(origin, payload, fallbackPath = DEFAULT_SHARE_IMAGE.path) {
  const imagePath =
    payload.backdrop_path || payload.poster_path || payload.profile_path;
  if (!imagePath) return new URL(fallbackPath, origin).toString();
  const size = payload.backdrop_path ? "w1280" : "w780";
  return `${TMDB_IMAGE_BASE}/${size}${imagePath}`;
}

function resolveExternalImageUrl(origin, value, fallbackPath = DEFAULT_SHARE_IMAGE.path) {
  const normalized = String(value || "").trim();

  if (!normalized) {
    return new URL(fallbackPath, origin).toString();
  }

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  if (normalized.startsWith("//")) {
    return `https:${normalized}`;
  }

  return new URL(normalized, origin).toString();
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "&#10;");
}

function buildLabeledFact(label, value) {
  return value ? `• ${label} : ${value}` : "";
}

function buildStructuredDescription(facts, body) {
  const factLines = facts.filter(Boolean);
  const normalizedBody = collapseWhitespace(body);

  if (!normalizedBody) {
    return factLines.join("\n");
  }

  return [...factLines, "", normalizedBody].join("\n");
}

function stripExistingHeadTags(html) {
  const patterns = [
    /<title\b[^>]*>[\s\S]*?<\/title>/i,
    /<meta\s+name=["']description["'][^>]*>\s*/gi,
    /<meta\s+name=["']robots["'][^>]*>\s*/gi,
    /<meta\s+name=["']language["'][^>]*>\s*/gi,
    /<meta\s+(?:property|name)=["']og:[^"']+["'][^>]*>\s*/gi,
    /<meta\s+name=["']twitter:[^"']+["'][^>]*>\s*/gi,
    /<link\s+rel=["']canonical["'][^>]*>\s*/gi,
  ];

  return patterns.reduce(
    (currentHtml, pattern) => currentHtml.replace(pattern, ""),
    html,
  );
}

function renderHeadTags(metadata) {
  return [
    `<title>${escapeHtml(metadata.title)}</title>`,
    `<meta name="description" content="${escapeHtml(metadata.description)}" />`,
    `<meta name="robots" content="index, follow" />`,
    `<meta name="language" content="${escapeHtml(metadata.language)}" />`,
    `<link rel="canonical" href="${escapeHtml(metadata.canonicalUrl)}" />`,
    `<meta property="og:title" content="${escapeHtml(metadata.title)}" />`,
    `<meta property="og:description" content="${escapeHtml(metadata.description)}" />`,
    `<meta property="og:type" content="${escapeHtml(metadata.ogType)}" />`,
    `<meta property="og:url" content="${escapeHtml(metadata.canonicalUrl)}" />`,
    `<meta property="og:image" content="${escapeHtml(metadata.imageUrl)}" />`,
    `<meta property="og:image:secure_url" content="${escapeHtml(metadata.imageUrl)}" />`,
    `<meta property="og:image:alt" content="${escapeHtml(metadata.imageAlt)}" />`,
    // Taille connue seulement pour la bannière par défaut ; Facebook s'en
    // sert pour afficher l'image dès le premier partage.
    ...(metadata.imageWidth
      ? [
          `<meta property="og:image:type" content="${escapeHtml(metadata.imageType)}" />`,
          `<meta property="og:image:width" content="${metadata.imageWidth}" />`,
          `<meta property="og:image:height" content="${metadata.imageHeight}" />`,
        ]
      : []),
    `<meta property="og:site_name" content="${escapeHtml(SITE_NAME)}" />`,
    `<meta property="og:locale" content="${escapeHtml(metadata.ogLocale)}" />`,
    `<meta property="og:locale:alternate" content="${escapeHtml(metadata.alternateOgLocale)}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${escapeHtml(metadata.title)}" />`,
    `<meta name="twitter:description" content="${escapeHtml(metadata.description)}" />`,
    `<meta name="twitter:image" content="${escapeHtml(metadata.imageUrl)}" />`,
    `<meta name="twitter:image:alt" content="${escapeHtml(metadata.imageAlt)}" />`,
  ].join("\n    ");
}

function injectMetadata(html, metadata) {
  const cleanedHtml = stripExistingHeadTags(html);
  const headTags = renderHeadTags(metadata);

  if (cleanedHtml.includes("</head>")) {
    return cleanedHtml.replace("</head>", `    ${headTags}\n</head>`);
  }

  return `${headTags}\n${cleanedHtml}`;
}

function buildBaseMetadata(requestUrl, previewLanguage, payload) {
  const copy = COPY[previewLanguage];
  const defaultImage = new URL(DEFAULT_SHARE_IMAGE.path, requestUrl.origin).toString();
  const imageUrl = payload.imageUrl || defaultImage;
  const isDefaultImage = imageUrl === defaultImage;

  return {
    title: payload.title || copy.defaultTitle,
    description: truncateText(
      payload.description || copy.defaultDescription,
      260,
    ),
    canonicalUrl: requestUrl.toString(),
    imageUrl,
    imageWidth: isDefaultImage ? DEFAULT_SHARE_IMAGE.width : null,
    imageHeight: isDefaultImage ? DEFAULT_SHARE_IMAGE.height : null,
    imageType: isDefaultImage ? DEFAULT_SHARE_IMAGE.type : null,
    imageAlt: payload.imageAlt || (isDefaultImage ? copy.defaultImageAlt : SITE_NAME),
    ogType: payload.ogType || "website",
    ogLocale: copy.ogLocale,
    alternateOgLocale: copy.alternateOgLocale,
    language: previewLanguage,
  };
}

async function getSpaResponse(context) {
  if (typeof context.next === "function") {
    return context.next();
  }

  if (context.env?.ASSETS?.fetch) {
    return context.env.ASSETS.fetch(context.request);
  }

  return new Response("ASSETS binding unavailable.", { status: 500 });
}

async function fetchTmdbPayload(pathname, apiKey, language) {
  const url = new URL(`${TMDB_API_BASE}${pathname}`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("language", language);

  const response = await fetch(url.toString(), {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`TMDB returned ${response.status} for ${pathname}`);
  }

  return response.json();
}

function getWatchPartyApiBase(env) {
  return String(env.WATCHPARTY_API || env.VITE_WATCHPARTY_API || "")
    .trim()
    .replace(/\/+$/, "");
}

async function fetchWatchPartyPayload(apiBase, pathname) {
  if (!apiBase) {
    throw new Error("WATCHPARTY_API binding unavailable");
  }

  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(
      `WatchParty API returned ${response.status} for ${pathname}`,
    );
  }

  return response.json();
}

function shouldBypassPreview(pathname) {
  return (
    /^\/(?:assets|wasm)(?:\/|$)/.test(pathname) ||
    /^\/api(?:\/|$)/.test(pathname) ||
    /\.(?:css|js|mjs|json|map|ico|png|jpe?g|webp|gif|svg|txt|xml|webmanifest|woff2?|ttf|otf)$/i.test(
      pathname,
    )
  );
}

function buildMovieOrTvMetadata(
  requestUrl,
  payload,
  mediaType,
  previewLanguage,
) {
  const copy = COPY[previewLanguage];
  const titleText =
    collapseWhitespace(mediaType === "movie" ? payload.title : payload.name) ||
    SITE_NAME;
  const year = extractYear(
    mediaType === "movie" ? payload.release_date : payload.first_air_date,
  );
  const genres = (payload.genres || [])
    .slice(0, 3)
    .map((genre) => genre.name)
    .filter(Boolean)
    .join(", ");
  const facts = [
    buildLabeledFact(
      mediaType === "movie" ? copy.releaseLabel : copy.firstAirLabel,
      year,
    ),
    buildLabeledFact(
      copy.ratingLabel,
      formatRating(payload.vote_average)
        ? `${formatRating(payload.vote_average)}/10`
        : "",
    ),
    buildLabeledFact(copy.genresLabel, genres),
    buildLabeledFact(
      copy.seasonsLabel,
      mediaType === "tv" && payload.number_of_seasons
        ? payload.number_of_seasons
        : "",
    ),
    buildLabeledFact(
      copy.episodesLabel,
      mediaType === "tv" && payload.number_of_episodes
        ? payload.number_of_episodes
        : "",
    ),
  ];
  const fallback = interpolate(
    mediaType === "movie" ? copy.movieFallback : copy.tvFallback,
    { title: titleText },
  );
  const descriptionBody = collapseWhitespace(payload.overview || fallback);
  const description = buildStructuredDescription(facts, descriptionBody);
  const title = year
    ? `${titleText} (${year}) - ${SITE_NAME}`
    : `${titleText} - ${SITE_NAME}`;

  return buildBaseMetadata(requestUrl, previewLanguage, {
    title,
    description,
    imageUrl: buildImageUrl(requestUrl.origin, payload),
    imageAlt: `${titleText} - ${SITE_NAME}`,
    ogType: mediaType === "movie" ? "video.movie" : "video.tv_show",
  });
}

function buildCollectionMetadata(requestUrl, payload, previewLanguage) {
  const copy = COPY[previewLanguage];
  const titleText = collapseWhitespace(payload.name) || SITE_NAME;
  const moviesCount = payload.parts?.length || 0;
  const firstYear = extractYear(payload.parts?.[0]?.release_date);
  const lastYear = extractYear(payload.parts?.[moviesCount - 1]?.release_date);
  const yearRange =
    firstYear && lastYear && firstYear !== lastYear
      ? `${firstYear}-${lastYear}`
      : firstYear;
  const facts = [
    buildLabeledFact(copy.moviesLabel, moviesCount || ""),
    buildLabeledFact(copy.yearLabel, yearRange),
  ];
  const fallback = interpolate(copy.collectionFallback, { title: titleText });
  const descriptionBody = collapseWhitespace(payload.overview || fallback);

  return buildBaseMetadata(requestUrl, previewLanguage, {
    title: `${titleText} - ${SITE_NAME}`,
    description: buildStructuredDescription(facts, descriptionBody),
    imageUrl: buildImageUrl(requestUrl.origin, payload),
    imageAlt: `${titleText} - ${SITE_NAME}`,
  });
}

function buildPersonMetadata(requestUrl, payload, previewLanguage) {
  const copy = COPY[previewLanguage];
  const titleText = collapseWhitespace(payload.name) || SITE_NAME;
  const facts = [
    buildLabeledFact(
      copy.knownForLabel,
      collapseWhitespace(payload.known_for_department || ""),
    ),
    buildLabeledFact(copy.bornLabel, extractYear(payload.birthday)),
  ];
  const fallback = interpolate(copy.personFallback, { title: titleText });
  const descriptionBody = collapseWhitespace(payload.biography || fallback);

  return buildBaseMetadata(requestUrl, previewLanguage, {
    title: `${titleText} - ${SITE_NAME}`,
    description: buildStructuredDescription(facts, descriptionBody),
    imageUrl: buildImageUrl(requestUrl.origin, payload),
    imageAlt: `${titleText} - ${SITE_NAME}`,
  });
}

function buildWatchMovieMetadata(requestUrl, payload, previewLanguage) {
  const copy = COPY[previewLanguage];
  const metadata = buildMovieOrTvMetadata(
    requestUrl,
    payload,
    "movie",
    previewLanguage,
  );
  metadata.title = `${copy.watchMovieLabel}: ${metadata.title}`;
  return metadata;
}

function buildWatchAnimeMetadata(requestUrl, payload, previewLanguage) {
  const copy = COPY[previewLanguage];
  const metadata = buildMovieOrTvMetadata(
    requestUrl,
    payload,
    "tv",
    previewLanguage,
  );
  metadata.title = `${copy.watchAnimeLabel}: ${metadata.title}`;
  return metadata;
}

function buildWatchEpisodeMetadata(
  requestUrl,
  payload,
  watchType,
  previewLanguage,
  seasonNumber,
  episodeNumber,
  episodePayload = null,
) {
  const copy = COPY[previewLanguage];
  const titleText = collapseWhitespace(payload.name) || SITE_NAME;
  const year = extractYear(payload.first_air_date);
  const genres = (payload.genres || [])
    .slice(0, 3)
    .map((genre) => genre.name)
    .filter(Boolean)
    .join(", ");
  const episodeName = collapseWhitespace(episodePayload?.name || "");
  const episodeCode = `S${seasonNumber}E${episodeNumber}`;
  const facts = [
    `• ${episodeCode}`,
    buildLabeledFact(copy.firstAirLabel, year),
    buildLabeledFact(
      copy.ratingLabel,
      formatRating(payload.vote_average)
        ? `${formatRating(payload.vote_average)}/10`
        : "",
    ),
    buildLabeledFact(copy.genresLabel, genres),
  ];
  const fallback = interpolate(copy.tvFallback, { title: titleText });
  const descriptionBody = collapseWhitespace(
    episodePayload?.overview || payload.overview || fallback,
  );
  const label =
    watchType === "anime" ? copy.watchAnimeLabel : copy.watchSeriesLabel;

  return buildBaseMetadata(requestUrl, previewLanguage, {
    title: `${label}: ${titleText} - ${episodeCode}${episodeName ? ` - ${episodeName}` : ""} - ${SITE_NAME}`,
    description: buildStructuredDescription(facts, descriptionBody),
    imageUrl: buildImageUrl(requestUrl.origin, {
      backdrop_path: episodePayload?.still_path || payload.backdrop_path,
      poster_path: payload.poster_path,
    }),
    imageAlt: `${titleText} - ${episodeCode}`,
    ogType: "video.episode",
  });
}

function getWatchPartyMediaTypeLabel(mediaType, copy) {
  return mediaType === "movie" ? copy.movieLabel : copy.tvLabel;
}

function getWatchPartySyncLabel(syncMode, copy) {
  return syncMode === "pro" ? copy.syncProLabel : copy.classicLabel;
}

function buildWatchPartyMetadata(requestUrl, roomData, previewLanguage, mode) {
  const copy = COPY[previewLanguage];
  const media = roomData.media || {};
  const titleText = collapseWhitespace(media.title || roomData.title || "");
  const seasonNumber = media.seasonNumber;
  const episodeNumber = media.episodeNumber;
  const episodePart =
    seasonNumber && episodeNumber ? ` - S${seasonNumber}E${episodeNumber}` : "";
  const participantCount = Array.isArray(roomData.participants)
    ? roomData.participants.length
    : Number(roomData.participantCount || 0);
  const maxParticipants = Number(roomData.maxParticipants || 0);
  const prefix =
    mode === "join" ? copy.watchPartyJoinLabel : copy.watchPartyRoomLabel;
  const title = titleText
    ? `${prefix}: ${titleText}${episodePart} - ${SITE_NAME}`
    : copy.watchPartyTitle;
  const facts = [
    buildLabeledFact(
      copy.mediaTypeLabel,
      getWatchPartyMediaTypeLabel(
        media.mediaType || roomData.mediaType || "movie",
        copy,
      ),
    ),
    buildLabeledFact(
      copy.participantsLabel,
      maxParticipants
        ? `${participantCount}/${maxParticipants}`
        : participantCount || "",
    ),
    buildLabeledFact(
      copy.syncLabel,
      getWatchPartySyncLabel(roomData.syncMode, copy),
    ),
    buildLabeledFact(
      copy.visibilityLabel,
      roomData.isPublic ? copy.publicLabel : copy.privateLabel,
    ),
    buildLabeledFact(copy.codeLabel, roomData.code || ""),
  ];
  const descriptionBody = titleText
    ? previewLanguage === "fr"
      ? `Rejoignez cette Watch Party Movix pour regarder ${titleText}${episodePart} en synchronisation.`
      : `Join this Movix Watch Party to watch ${titleText}${episodePart} in sync.`
    : copy.watchPartyDescription;

  return buildBaseMetadata(requestUrl, previewLanguage, {
    title,
    description: buildStructuredDescription(facts, descriptionBody),
    imageUrl: resolveExternalImageUrl(
      requestUrl.origin,
      media.poster || roomData.poster,
    ),
    imageAlt: titleText ? `${titleText} - Watch Party` : "Watch Party - Movix",
    ogType: "website",
  });
}

function buildGenreMetadata(requestUrl, mediaType, genreId, previewLanguage) {
  const copy = COPY[previewLanguage];
  const genreName =
    GENRE_NAMES[previewLanguage]?.[Number(genreId)] ||
    `${copy.genresLabel} ${genreId}`;
  const contentType = mediaType === "movie" ? copy.movieWord : copy.tvWord;
  const description =
    previewLanguage === "fr"
      ? `Retrouvez les ${contentType} du genre ${genreName} sur Movix.`
      : `Browse ${contentType} in the ${genreName} genre on Movix.`;
  const title =
    previewLanguage === "fr"
      ? `${genreName} - ${contentType} - ${SITE_NAME}`
      : `${genreName} - ${contentType} - ${SITE_NAME}`;

  return buildBaseMetadata(requestUrl, previewLanguage, {
    title,
    description,
  });
}

function buildProviderMetadata(
  requestUrl,
  providerId,
  type,
  genreId,
  previewLanguage,
) {
  const copy = COPY[previewLanguage];
  const providerName =
    PROVIDER_NAMES[Number(providerId)] ||
    `${copy.providerFallback} ${providerId}`;
  const genreName = genreId
    ? GENRE_NAMES[previewLanguage]?.[Number(genreId)] ||
      `${copy.genresLabel} ${genreId}`
    : "";
  const contentType =
    type === "movies"
      ? copy.movieWord
      : type === "tv"
        ? copy.tvWord
        : previewLanguage === "fr"
          ? "films et séries"
          : "movies and TV shows";
  const description = type
    ? previewLanguage === "fr"
      ? `Retrouvez les ${contentType} de ${providerName}${genreName ? ` dans ${genreName}` : ""} sur Movix.`
      : `Browse ${contentType} on ${providerName}${genreName ? ` in ${genreName}` : ""} on Movix.`
    : previewLanguage === "fr"
      ? `Explorez le catalogue ${providerName} sur Movix.`
      : `Explore the ${providerName} catalog on Movix.`;

  return buildBaseMetadata(requestUrl, previewLanguage, {
    title: type
      ? `${providerName} - ${contentType} - ${SITE_NAME}`
      : `${providerName} - ${SITE_NAME}`,
    description,
  });
}

function buildWrappedMetadata(requestUrl, year, previewLanguage) {
  const copy = COPY[previewLanguage];
  const description = year
    ? previewLanguage === "fr"
      ? `Retrouvez votre récap Movix ${year} et partagez vos stats.`
      : `See your Movix ${year} recap and share your stats.`
    : copy.wrappedDescription;

  return buildBaseMetadata(requestUrl, previewLanguage, {
    title: year ? `Movix Wrapped ${year}` : copy.wrappedTitle,
    description,
  });
}

function buildStaticMetadata(requestUrl, previewLanguage) {
  const copy = COPY[previewLanguage];
  const pathname = normalizePathname(requestUrl.pathname);

  switch (pathname) {
    case "/":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.homeTitle,
        description: copy.homeDescription,
      });
    case "/search":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.searchTitle,
        description: copy.searchDescription,
      });
    case "/movies":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.moviesTitle,
        description: copy.moviesDescription,
      });
    case "/tv-shows":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.tvTitle,
        description: copy.tvDescription,
      });
    case "/collections":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.collectionsTitle,
        description: copy.collectionsDescription,
      });
    case "/alerts":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.alertsTitle,
        description: copy.alertsDescription,
      });
    case "/roulette":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.rouletteTitle,
        description: copy.rouletteDescription,
      });
    case "/suggestion":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.suggestionTitle,
        description: copy.suggestionDescription,
      });
    case "/live-tv":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.liveTvTitle,
        description: copy.liveTvDescription,
      });
    case "/extension":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.extensionTitle,
        description: copy.extensionDescription,
      });
    case "/top10":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.top10Title,
        description: copy.top10Description,
      });
    case "/settings":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.settingsTitle,
        description: copy.settingsDescription,
      });
    case "/about":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.aboutTitle,
        description: copy.aboutDescription,
      });
    case "/privacy":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.privacyTitle,
        description: copy.privacyDescription,
      });
    case "/cinegraph":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.cinegraphTitle,
        description: copy.cinegraphDescription,
      });
    case "/wishboard":
    case "/wishboard/new":
    case "/wishboard/my-requests":
    case "/wishboard/submit-link":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.wishboardTitle,
        description: copy.wishboardDescription,
      });
    case "/wrapped":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.wrappedTitle,
        description: copy.wrappedDescription,
      });
    case "/profile":
    case "/profile-selection":
    case "/profile-management":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.profileTitle,
        description: copy.profileDescription,
      });
    case "/auth":
    case "/auth/google":
    case "/create-account":
    case "/login-bip39":
    case "/link-bip39":
    case "/link-bip39/create":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.authTitle,
        description: copy.authDescription,
      });
    case "/vip":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.vipTitle,
        description: copy.vipDescription,
      });
    case "/watchparty/create":
    case "/watchparty/join":
    case "/watchparty/list":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.watchPartyTitle,
        description: copy.watchPartyDescription,
      });
    case "/list-catalog":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.sharedListTitle,
        description: copy.sharedListDescription,
      });
    case "/debrid":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: "Debrid - Movix",
        description:
          previewLanguage === "fr"
            ? "Débridez et gérez vos liens premium sur Movix."
            : "Debrid and manage your premium links on Movix.",
      });
    case "/dmca":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: "DMCA - Movix",
        description:
          previewLanguage === "fr"
            ? "Informations DMCA et demandes legales pour Movix."
            : "DMCA information and legal requests for Movix.",
      });
    case "/admin":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: "Admin - Movix",
        description: "Movix administration.",
      });
    case "/ftv":
      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: "France TV - Movix",
        description:
          previewLanguage === "fr"
            ? "Accédez au catalogue et au live France TV via Movix."
            : "Access the France TV catalog and live streams via Movix.",
      });
    default:
      if (/^\/watchparty\/(?:join|room)\//.test(pathname)) {
        return buildBaseMetadata(requestUrl, previewLanguage, {
          title: copy.watchPartyTitle,
          description: copy.watchPartyDescription,
        });
      }

      if (/^\/list\//.test(pathname)) {
        return buildBaseMetadata(requestUrl, previewLanguage, {
          title: copy.sharedListTitle,
          description: copy.sharedListDescription,
        });
      }

      if (/^\/wrapped\/\d{4}$/.test(pathname)) {
        return buildWrappedMetadata(
          requestUrl,
          pathname.split("/")[2],
          previewLanguage,
        );
      }

      if (/^\/ftv\/(?:info|watch)\//.test(pathname)) {
        return buildBaseMetadata(requestUrl, previewLanguage, {
          title: "France TV - Movix",
          description:
            previewLanguage === "fr"
              ? "Accédez au catalogue et au live France TV via Movix."
              : "Access the France TV catalog and live streams via Movix.",
        });
      }

      return buildBaseMetadata(requestUrl, previewLanguage, {
        title: copy.genericPageTitle,
        description: copy.genericPageDescription,
      });
  }
}

async function resolveRouteMetadata(
  requestUrl,
  env,
  previewLanguage,
  forcedMediaType,
) {
  const copy = COPY[previewLanguage];
  const apiKey = getTmdbApiKey(env || {});
  const pathname = normalizePathname(requestUrl.pathname);
  const segments = pathname.split("/").filter(Boolean);

  if (forcedMediaType && segments[1]) {
    const tmdbId = getTmdbId(segments[1]);
    if (!tmdbId || !apiKey) return null;
    const payload = await fetchTmdbPayload(
      `/${forcedMediaType}/${tmdbId}`,
      apiKey,
      copy.tmdbLanguage,
    );
    return buildMovieOrTvMetadata(
      requestUrl,
      payload,
      forcedMediaType,
      previewLanguage,
    );
  }

  if (!segments.length) {
    return buildStaticMetadata(requestUrl, previewLanguage);
  }

  if (
    (segments[0] === "movie" || segments[0] === "tv") &&
    segments[1] &&
    apiKey
  ) {
    const tmdbId = getTmdbId(segments[1]);
    if (!tmdbId) return buildStaticMetadata(requestUrl, previewLanguage);
    const payload = await fetchTmdbPayload(
      `/${segments[0]}/${tmdbId}`,
      apiKey,
      copy.tmdbLanguage,
    );
    return buildMovieOrTvMetadata(
      requestUrl,
      payload,
      segments[0],
      previewLanguage,
    );
  }

  if (segments[0] === "download" && segments[1] && segments[2] && apiKey) {
    const mediaType = segments[1] === "tv" ? "tv" : "movie";
    const tmdbId = getTmdbId(segments[2]);
    if (!tmdbId) return buildStaticMetadata(requestUrl, previewLanguage);
    const payload = await fetchTmdbPayload(
      `/${mediaType}/${tmdbId}`,
      apiKey,
      copy.tmdbLanguage,
    );
    const metadata = buildMovieOrTvMetadata(
      requestUrl,
      payload,
      mediaType,
      previewLanguage,
    );
    metadata.title = `${mediaType === "movie" ? copy.downloadMovieLabel : copy.downloadSeriesLabel}: ${metadata.title}`;
    return metadata;
  }

  if (segments[0] === "watch" && segments[1] && segments[2] && apiKey) {
    if (segments[1] === "movie") {
      const tmdbId = getTmdbId(segments[2]);
      if (!tmdbId) return buildStaticMetadata(requestUrl, previewLanguage);
      const payload = await fetchTmdbPayload(
        "/movie/" + tmdbId,
        apiKey,
        copy.tmdbLanguage,
      );
      return buildWatchMovieMetadata(requestUrl, payload, previewLanguage);
    }

    if (
      segments[1] === "anime" &&
      segments[3] === "season" &&
      segments[5] === "episode" &&
      segments[6]
    ) {
      const tmdbId = getTmdbId(segments[2]);
      if (!tmdbId) return buildStaticMetadata(requestUrl, previewLanguage);
      const payload = await fetchTmdbPayload(
        "/tv/" + tmdbId,
        apiKey,
        copy.tmdbLanguage,
      );
      return buildWatchAnimeMetadata(requestUrl, payload, previewLanguage);
    }

    if (
      segments[1] === "tv" &&
      segments[3] === "s" &&
      segments[5] === "e" &&
      segments[6]
    ) {
      const tmdbId = getTmdbId(segments[2]);
      if (!tmdbId) return buildStaticMetadata(requestUrl, previewLanguage);
      const seasonNumber = Number(segments[4]);
      const episodeNumber = Number(segments[6]);
      const payload = await fetchTmdbPayload(
        "/tv/" + tmdbId,
        apiKey,
        copy.tmdbLanguage,
      );
      let episodePayload = null;

      if (Number.isFinite(seasonNumber) && Number.isFinite(episodeNumber)) {
        try {
          episodePayload = await fetchTmdbPayload(
            `/tv/${tmdbId}/season/${seasonNumber}/episode/${episodeNumber}`,
            apiKey,
            copy.tmdbLanguage,
          );
        } catch (_error) {
          episodePayload = null;
        }
      }

      return buildWatchEpisodeMetadata(
        requestUrl,
        payload,
        segments[1] === "anime" ? "anime" : "tv",
        previewLanguage,
        seasonNumber,
        episodeNumber,
        episodePayload,
      );
    }
  }

  if (segments[0] === "collection" && segments[1] && apiKey) {
    const payload = await fetchTmdbPayload(
      `/collection/${segments[1]}`,
      apiKey,
      copy.tmdbLanguage,
    );
    return buildCollectionMetadata(requestUrl, payload, previewLanguage);
  }

  if (segments[0] === "person" && segments[1] && apiKey) {
    const payload = await fetchTmdbPayload(
      `/person/${segments[1]}`,
      apiKey,
      copy.tmdbLanguage,
    );
    return buildPersonMetadata(requestUrl, payload, previewLanguage);
  }

  if (segments[0] === "genre" && segments[1] && segments[2]) {
    return buildGenreMetadata(
      requestUrl,
      segments[1],
      segments[2],
      previewLanguage,
    );
  }

  if (segments[0] === "provider" && segments[1]) {
    return buildProviderMetadata(
      requestUrl,
      segments[1],
      segments[2],
      segments[3],
      previewLanguage,
    );
  }

  if (segments[0] === "wrapped") {
    return buildWrappedMetadata(requestUrl, segments[1], previewLanguage);
  }

  if (segments[0] === "watchparty") {
    const watchPartyApiBase = getWatchPartyApiBase(env || {});

    if (segments[1] === "room" && segments[2] && watchPartyApiBase) {
      try {
        const payload = await fetchWatchPartyPayload(
          watchPartyApiBase,
          `/api/watchparty/room/${segments[2]}`,
        );
        if (payload?.room) {
          return buildWatchPartyMetadata(
            requestUrl,
            payload.room,
            previewLanguage,
            "room",
          );
        }
      } catch (_error) {
        return buildStaticMetadata(requestUrl, previewLanguage);
      }
    }

    if (segments[1] === "join" && segments[2] && watchPartyApiBase) {
      try {
        const payload = await fetchWatchPartyPayload(
          watchPartyApiBase,
          `/api/watchparty/info/${segments[2]}`,
        );
        if (payload?.room) {
          return buildWatchPartyMetadata(
            requestUrl,
            {
              ...payload.room,
              code: segments[2].toUpperCase(),
            },
            previewLanguage,
            "join",
          );
        }
      } catch (_error) {
        return buildStaticMetadata(requestUrl, previewLanguage);
      }
    }
  }

  return buildStaticMetadata(requestUrl, previewLanguage);
}

export async function buildSocialPreviewResponse(
  context,
  forcedMediaType = null,
) {
  const requestUrl = new URL(context.request.url);
  const pathname = normalizePathname(requestUrl.pathname);

  if (
    !["GET", "HEAD"].includes(context.request.method) ||
    shouldBypassPreview(pathname)
  ) {
    return getSpaResponse(context);
  }

  const spaResponse = await getSpaResponse(context);

  if (!spaResponse.ok) {
    return spaResponse;
  }

  try {
    const previewLanguage = resolvePreviewLanguage(requestUrl);
    const metadata = await resolveRouteMetadata(
      requestUrl,
      context.env || {},
      previewLanguage,
      forcedMediaType,
    );

    if (!metadata) {
      return spaResponse;
    }

    const html = await spaResponse.text();
    const headers = new Headers(spaResponse.headers);
    headers.set("content-type", "text/html; charset=UTF-8");
    headers.delete("content-length");

    return new Response(injectMetadata(html, metadata), {
      status: spaResponse.status,
      statusText: spaResponse.statusText,
      headers,
    });
  } catch (error) {
    console.error("[SOCIAL PREVIEW] metadata injection failed:", error);
    return spaResponse;
  }
}
