import { build as viteBuild, defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import legacy from '@vitejs/plugin-legacy'
import { resolve } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { visualizer } from 'rollup-plugin-visualizer'
import { sentryVitePlugin } from '@sentry/vite-plugin'

const buildId = process.env.VITE_APP_BUILD_ID || process.env.CF_PAGES_COMMIT_SHA || process.env.COMMIT_REF || new Date().toISOString()
process.env.VITE_APP_BUILD_ID = buildId

// Chromium 68 = navigateur des TV LG sous webOS 5 (gamme 2020, ex. OLED CX) :
// sans `?.`/`??` abaissés, le bundle y lève un SyntaxError et l'app reste noire.
// Cible du service worker compilé séparément ; concerne la syntaxe, pas les API.
const serviceWorkerBuildTarget = ['es2020', 'chrome68']

type InMemoryBuildOutput = {
  output: Array<{ type: string; fileName: string; code?: string }>
}

async function bundleServiceWorker(minify: boolean): Promise<string> {
  const result = await viteBuild({
    configFile: false,
    publicDir: false,
    logLevel: 'silent',
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      },
    },
    build: {
      target: serviceWorkerBuildTarget,
      minify,
      write: false,
      lib: {
        entry: resolve(__dirname, 'public', 'sw.js'),
        formats: ['iife'],
        name: 'MovixServiceWorker',
        fileName: () => 'sw.js',
      },
    },
  }) as InMemoryBuildOutput | InMemoryBuildOutput[]

  const outputs = Array.isArray(result) ? result : [result]
  const chunk = outputs
    .flatMap((output) => output.output)
    .find((item) => item.type === 'chunk' && item.fileName === 'sw.js')
  if (!chunk?.code) throw new Error('Le bundle du service worker est introuvable')
  return chunk.code
}

const normalizeSiteUrl = (value?: string): string => {
  const candidate = value?.trim()
  if (!candidate) {
    throw new Error('VITE_SITE_URL is required')
  }

  try {
    const url = new URL(candidate.includes('://') ? candidate : `https://${candidate}`)
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error()
    return url.origin
  } catch {
    throw new Error('VITE_SITE_URL must contain a valid public URL')
  }
}

function injectPublicConfig(): Plugin {
  let siteUrl: string | undefined
  let devServiceWorker: Promise<string> | undefined

  const replacePlaceholders = (source: string): string => {
    const mirrors = (process.env.VITE_DEFAULT_MIRRORS || 'movix.health')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const configUrl =
      process.env.VITE_MIRRORS_CONFIG_URL || 'https://rentry.co/movix'
    return source
      .replace(/__MOVIX_DEFAULT_MIRRORS__/g, JSON.stringify(mirrors))
      .replace(/__MOVIX_CONFIG_URL__/g, JSON.stringify(configUrl))
      .replace(/__MOVIX_SITE_URL__/g, () => {
        if (!siteUrl) throw new Error('VITE_SITE_URL was not resolved')
        return siteUrl
      })
  }
  return {
    name: 'movix-public-config-inject',
    configResolved(config) {
      siteUrl = normalizeSiteUrl(config.env.VITE_SITE_URL)
    },
    transformIndexHtml(html) {
      return replacePlaceholders(html)
    },
    // Mode build : injecte la configuration dans les fichiers publics copiés par Vite.
    async closeBundle() {
      const bundledServiceWorker = replacePlaceholders(await bundleServiceWorker(true))
      writeFileSync(resolve(__dirname, 'dist', 'sw.js'), bundledServiceWorker, 'utf-8')

      for (const fileName of ['sitemap.xml', 'robots.txt', 'llms.txt']) {
        const outputPath = resolve(__dirname, 'dist', fileName)
        if (!existsSync(outputPath)) continue
        const contents = readFileSync(outputPath, 'utf-8')
        writeFileSync(outputPath, replacePlaceholders(contents), 'utf-8')
      }
    },
    // Mode dev : intercepte GET /sw.js et sert une version transformée
    configureServer(server) {
      const serviceWorkerSources = [
        resolve(__dirname, 'public', 'sw.js'),
        resolve(__dirname, 'src', 'workers', 'mediaColor.serviceWorker.ts'),
        resolve(__dirname, 'src', 'utils', 'mediaColors.ts'),
      ]
      server.watcher.on('change', (changedPath) => {
        if (serviceWorkerSources.includes(resolve(changedPath))) devServiceWorker = undefined
      })

      server.middlewares.use(async (req, res, next) => {
        const pathOnly = (req.url || '').split('?')[0]
        const publicFiles: Record<string, { fileName: string; contentType: string }> = {
          '/sw.js': {
            fileName: 'sw.js',
            contentType: 'application/javascript; charset=utf-8',
          },
          '/sitemap.xml': {
            fileName: 'sitemap.xml',
            contentType: 'application/xml; charset=utf-8',
          },
          '/robots.txt': {
            fileName: 'robots.txt',
            contentType: 'text/plain; charset=utf-8',
          },
          '/llms.txt': {
            fileName: 'llms.txt',
            contentType: 'text/plain; charset=utf-8',
          },
        }
        const publicFile = publicFiles[pathOnly]
        if (!publicFile) return next()

        const publicPath = resolve(__dirname, 'public', publicFile.fileName)
        if (!existsSync(publicPath)) return next()
        try {
          const contents = pathOnly === '/sw.js'
            ? await (devServiceWorker ??= bundleServiceWorker(false))
            : readFileSync(publicPath, 'utf-8')
          res.setHeader('Content-Type', publicFile.contentType)
          res.setHeader('Cache-Control', 'no-store')
          res.end(replacePlaceholders(contents))
        } catch (error) {
          devServiceWorker = undefined
          next(error as Error)
        }
      })
    },
  }
}

/**
 * Source maps → GlitchTip (serveur compatible Sentry), seulement si un jeton
 * est fourni. Le plugin injecte un debug ID dans chaque chunk, envoie les .map
 * puis les supprime de dist/ : le code source n'est jamais publié. Voir
 * docs/error-tracking-glitchtip.md.
 */
function glitchtipSourcemaps(buildEnv: Record<string, string>, authToken: string) {
  const read = (key: string, fallback: string): string => (buildEnv[key] || '').trim() || fallback
  return sentryVitePlugin({
    url: read('GLITCHTIP_URL', 'https://app.glitchtip.com'),
    org: read('GLITCHTIP_ORG', 'movix-frontend'),
    project: read('GLITCHTIP_PROJECT', 'frontend'),
    authToken,
    telemetry: false,
    release: {
      // Même nom que le `release` du SDK (VITE_APP_BUILD_ID) : le SHA du commit
      // sur Cloudflare Pages, la date du build sinon.
      name: buildId,
      // Le SDK reçoit déjà ce nom via VITE_APP_BUILD_ID : inutile d'injecter un
      // snippet supplémentaire dans les bundles.
      inject: false,
    },
    sourcemaps: {
      filesToDeleteAfterUpload: ['./dist/**/*.map'],
    },
    // Un GlitchTip injoignable ne doit pas faire échouer le déploiement : on
    // perd les source maps de ce build, pas le site.
    errorHandler(err) {
      console.warn(`[glitchtip] envoi des source maps échoué : ${err.message}`)
    },
  })
}

export default defineConfig(({ mode, command }) => {
  // Variables de build sans préfixe VITE_ (jamais exposées au client) : .env
  // pour les builds locaux, variables du projet Cloudflare Pages en production.
  // Le plugin GlitchTip n'a de sens qu'au build (`npm run dev` n'envoie rien).
  const buildEnv = loadEnv(mode, process.cwd(), '')
  const glitchtipAuthToken = command === 'build' ? (buildEnv.GLITCHTIP_AUTH_TOKEN || '').trim() : ''

  return {
    logLevel: 'warn',
    plugins: [
      react(),
      injectPublicConfig(),
      // Deux sorties issues du même code : modules natifs pour les navigateurs
      // modernes, SystemJS + polyfills pour les anciens, jusqu'à Chrome 53
      // (TV LG webOS 4). Le plugin conserve sa cible et sa détection modernes
      // par défaut pour que les moteurs intermédiaires choisissent le bon bundle.
      legacy({
        targets: ['chrome >= 53', 'edge >= 79', 'firefox >= 67', 'safari >= 15', 'ios >= 15'],
        renderLegacyChunks: true,
        // Liste relevée avec la détection automatique : évite une passe Babel
        // par chunk moderne. Recalcul : voir « Bundles moderne et legacy » dans src/README.md.
        modernPolyfills: [
          'es.array.includes',
          'es.array.push',
          'es.array-buffer.detached',
          'es.array-buffer.transfer',
          'es.array-buffer.transfer-to-fixed-length',
          'es.iterator.constructor',
          'es.iterator.every',
          'es.iterator.filter',
          'es.iterator.find',
          'es.iterator.flat-map',
          'es.iterator.for-each',
          'es.iterator.map',
          'es.iterator.reduce',
          'es.iterator.some',
          'es.json.parse',
          'es.json.stringify',
          'es.map.get-or-insert',
          'es.map.get-or-insert-computed',
          'es.regexp.flags',
          'es.set.difference.v2',
          'es.set.intersection.v2',
          'es.set.is-disjoint-from.v2',
          'es.set.is-subset-of.v2',
          'es.set.is-superset-of.v2',
          'es.set.symmetric-difference.v2',
          'es.set.union.v2',
          'es.typed-array.to-reversed',
          'es.typed-array.to-sorted',
          'es.typed-array.with',
          'es.uint8-array.set-from-base64',
          'es.uint8-array.set-from-hex',
          'es.uint8-array.to-base64',
          'es.uint8-array.to-hex',
          'es.weak-map.get-or-insert',
          'es.weak-map.get-or-insert-computed',
          'web.dom-exception.stack',
          'web.url-search-params.delete',
          'web.url-search-params.has',
          'web.url-search-params.size',
          'es.uint8-array.from-base64',
          'esnext.array.group',
          'es.promise.with-resolvers',
          'es.uint8-array.from-hex',
          'es.iterator.drop',
          'web.immediate',
          'web.structured-clone',
          'es.iterator.to-array',
        ],
        additionalLegacyPolyfills: [resolve(__dirname, 'src/compat/legacy-dom-polyfills.js')],
      }),
      ...(process.env.ANALYZE === 'true'
        ? [
            visualizer({
              filename: 'dist/stats.html',
              gzipSize: true,
              brotliSize: true,
              template: 'treemap',
              open: false,
            }),
          ]
        : []),
      ...(glitchtipAuthToken ? [glitchtipSourcemaps(buildEnv, glitchtipAuthToken)] : []),
    ],
    server: {
      host: true,
      // 3000 par défaut. `PORT` permet d'ouvrir un second serveur de dev en
      // parallèle du premier (deux sessions d'agent, deux branches) sans se
      // disputer le port.
      port: Number(process.env.PORT) || 3000,
      hmr: true,
      watch: {
        // Polling utile sur WSL/Docker/FS réseau où inotify/FSEvents ne remontent
        // pas les changements. Sur Windows natif ou macOS, il faut le couper :
        // chokidar scanne TOUS les fichiers à `interval` ms → démarrage Vite
        // qui prend plusieurs minutes + CPU saturé. Override possible avec
        // VITE_USE_POLLING=1 pour ceux qui codent en WSL2 vers un dossier
        // monté sur le FS Windows (cas où linux+polling ne suffit pas).
        usePolling: process.env.VITE_USE_POLLING === '1' || process.platform === 'linux',
        interval: 100,
        // Exclut tout ce qui n'est PAS source Vite. Sans ça, chokidar passe
        // le démarrage à indexer 150MB d'avatars + le dist + les API Node +
        // l'app mobile + les extensions — autant de fichiers qui sont soit
        // servis tels quels (public/), soit n'ont rien à voir avec le bundle
        // frontend (API/, app/, extension/, etc.).
        ignored: [
          '**/node_modules/**',
          '**/.git/**',
          '**/dist/**',
          '**/public/avatars/**',
          '**/public/WatchpartyTutorial/**',
          '**/public/help/**',
          '**/public/live/**',
          '**/public/wasm/**',
          '**/API/**',
          '**/app/**',
          '**/extension/**',
          '**/PreMid/**',
          '**/cloudflareproxy/**',
          '**/functions/**',
          '**/docs/**',
          '**/wasm/**',
          '**/userscript/**',
          '**/others/**',
        ],
      },
    },
    preview: {
      host: true,
      port: 3000,
    },
    worker: {
      format: 'iife',
      // Les workers ne reçoivent ni les plugins ni les polyfills de la page.
      // Préserver la syntaxe Chrome 68 même si le bundle moderne cible plus haut.
      rolldownOptions: {
        transform: { target: serviceWorkerBuildTarget },
        // La compression Oxc a sa propre cible ; sans elle, elle peut recréer
        // une syntaxe moderne après l'abaissement effectué par le transform.
        output: {
          minify: { compress: { target: serviceWorkerBuildTarget } },
        },
      },
    },
    build: {
      // Le plugin gère les cibles JS ; le CSS est commun aux deux bundles.
      cssTarget: ['chrome53', 'safari15'],
      // Cartes sources uniquement quand elles partent vers GlitchTip. 'hidden' :
      // générées sans commentaire sourceMappingURL dans les chunks, puis
      // supprimées de dist/ par le plugin une fois envoyées.
      sourcemap: glitchtipAuthToken ? 'hidden' : false,
      chunkSizeWarningLimit: 600, // uncompressed kB; warning only, doesn't fail
      reportCompressedSize: false, // skip per-chunk gzip/brotli computation (slow + verbose)
      commonjsOptions: {
        include: [/node_modules/],
        sourceMap: false,
        transformMixedEsModules: true
      },
      rollupOptions: {
        input: './index.html',
        // Silence per-occurrence noise from minified CJS-in-ESM bundles (dashjs floods 2 MiB+)
        onLog(level, log, defaultHandler) {
          if (log.code === 'COMMONJS_VARIABLE_IN_ESM') return
          defaultHandler(level, log)
        },
        output: {
          codeSplitting: {
            groups: [
              {
                name: 'react-vendor',
                test: /[\\/]node_modules[\\/](react|react-dom|react-router-dom|react-helmet-async|scheduler|uuid)[\\/]/,
              },
              {
                name: 'radix',
                test: /[\\/]node_modules[\\/](@radix-ui|@headlessui|class-variance-authority|tailwind-merge|clsx|tailwindcss-animate)[\\/]/,
              },
              {
                name: 'motion',
                test: /[\\/]node_modules[\\/](framer-motion|lenis|sonner)[\\/]/,
              },
              {
                name: 'i18n',
                test: /[\\/]node_modules[\\/](i18next|i18next-browser-languagedetector|react-i18next)[\\/]/,
              },
              {
                name: 'markdown',
                test: /[\\/]node_modules[\\/](react-markdown|remark-emoji)[\\/]/,
              },
              // remark-gfm + its mdast-util-gfm-* / micromark-extension-gfm-* deps are
              // kept in their own chunk so they only load on engines that support regex
              // lookbehinds. Bundling them with react-markdown would force-evaluate
              // mdast-util-gfm-autolink-literal's lookbehind regex on Safari < 16.4 and
              // crash with "Invalid regular expression: invalid group specifier name".
              // Shared deps (ccount, mdast-util-find-and-replace, unified, etc.) are left
              // out of this rule so Rollup can keep them in the static markdown chunk
              // and avoid making the static chunk depend on this dynamic one.
              {
                name: 'remark-gfm',
                test: /[\\/]node_modules[\\/](remark-gfm|mdast-util-gfm[^\\/]*|micromark-extension-gfm[^\\/]*)[\\/]/,
              },
            ],
          },
        },
      }
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
      }
    }
  }
})
