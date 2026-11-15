import { createHash, randomUUID } from 'node:crypto';
import { constants, promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const HEARTBEAT_MS = 60_000;
const RELEASE_COUNT = 4; // Current build and at least three predecessors.
const RELEASE_ID = /^[a-f0-9]{64}$/;

// Only Vite's content-addressed public files belong in the shared archive.
// Exclude source maps, HTML, dotfiles and traversal, including on Windows.
export function isVersionedAsset(name) {
  return typeof name === 'string'
    && !/[\\\x00-\x1f:]/.test(name)
    && name.split('/').every((part) => part && !part.startsWith('.'))
    && /-[A-Za-z0-9_-]{8,}\.(?:m?js|css|json|wasm|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|mp4|webm|m4v|mp3|ogg|wav|flac)$/i.test(name);
}

async function listAssets(directory, prefix = '') {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.isSymbolicLink()) continue;
    const name = prefix + entry.name;
    if (entry.isDirectory()) files.push(...await listAssets(join(directory, entry.name), `${name}/`));
    else if (entry.isFile() && isVersionedAsset(name)) files.push(name);
  }
  return files.sort();
}

async function exists(path) {
  try { await fs.access(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function writeJson(path, data) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await fs.writeFile(temporary, JSON.stringify(data));
  await fs.rename(temporary, path);
}

// Serialize publication and pruning across overlapping containers. A crashed
// owner leaves an expired lease; a live owner refreshes it during large copies.
async function withArchiveLock(root, work) {
  const lock = join(root, '.lock');
  const owner = randomUUID();
  const lease = join(lock, owner);
  const deadline = Date.now() + 15_000;
  while (true) {
    try { await fs.mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      try {
        if (Date.now() - (await fs.stat(lock)).mtimeMs > 120_000) {
          const expired = join(root, `.expired-lock-${owner}`);
          await fs.rename(lock, expired);
          await fs.rm(expired, { recursive: true, force: true });
          continue;
        }
      } catch (statError) { if (statError.code !== 'ENOENT') throw statError; }
      if (Date.now() >= deadline) throw new Error('Asset history is locked by another container; retry after its startup completes.');
      await delay(100);
    }
  }
  await fs.writeFile(lease, '');
  const timer = setInterval(() => {
    const now = new Date();
    void fs.utimes(lock, now, now).catch(() => {});
  }, 30_000);
  timer.unref();
  try { return await work(); }
  finally {
    clearInterval(timer);
    // Never remove a different owner's lock after an expired lease was moved.
    if (await exists(lease)) await fs.rm(lock, { recursive: true, force: true });
  }
}

/** Store immutable assets separately from the replaceable Docker image. */
export async function startAssetHistory(dist, configuredRoot = process.env.ASSET_HISTORY_DIR) {
  if (!configuredRoot) return null; // Local use without a persistent mount.
  if (!isAbsolute(configuredRoot)) throw new Error('ASSET_HISTORY_DIR must be an absolute path.');
  const root = resolve(configuredRoot);
  const publicRoot = resolve(dist);
  if (dirname(root) === root || root === publicRoot || root.startsWith(`${publicRoot}${sep}`)) {
    throw new Error('ASSET_HISTORY_DIR must be a dedicated directory outside the public build.');
  }
  const assets = join(root, 'assets');
  const releases = join(root, 'releases');
  const usage = join(root, 'usage');
  await fs.mkdir(assets, { recursive: true });
  await fs.mkdir(releases, { recursive: true });
  await fs.mkdir(usage, { recursive: true });

  async function publish(source) {
    const html = await fs.readFile(join(source, 'index.html'));
    const id = createHash('sha256').update(html).digest('hex');
    const sourceAssets = join(source, 'assets');
    if (!(await fs.lstat(sourceAssets)).isDirectory()) throw new Error('Expected a real assets directory.');
    const files = await listAssets(sourceAssets);
    if (!files.length) throw new Error('No versioned assets found; refusing to publish an empty archive.');
    for (const name of files) {
      const destination = join(assets, name);
      if (await exists(destination)) continue;
      await fs.mkdir(dirname(destination), { recursive: true });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      await fs.copyFile(join(sourceAssets, name), temporary, constants.COPYFILE_EXCL);
      await fs.rename(temporary, destination);
    }
    await writeJson(join(releases, `${id}.json`), { version: 1, activatedAt: Date.now(), files });
    await fs.writeFile(join(usage, id), '');
    return id;
  }

  async function prune(currentId) {
    const records = [];
    for (const name of await fs.readdir(releases)) {
      const id = name.replace(/\.json$/, '');
      if (!name.endsWith('.json') || !RELEASE_ID.test(id)) continue;
      const record = JSON.parse(await fs.readFile(join(releases, name), 'utf8'));
      if (record.version !== 1 || !Number.isFinite(record.activatedAt)
        || !Array.isArray(record.files) || !record.files.length || !record.files.every(isVersionedAsset)) {
        throw new Error(`Invalid asset history manifest: ${id}`);
      }
      // Missing/corrupt usage markers abort pruning, never shorten retention.
      const lastActive = (await fs.stat(join(usage, id))).mtimeMs;
      records.push({ ...record, id, lastActive });
    }
    records.sort((a, b) => b.activatedAt - a.activatedAt);
    const keep = [];
    const remove = [];
    for (const [index, record] of records.entries()) {
      // The extra heartbeat interval rounds retention up after a process exits.
      const recent = Date.now() - record.lastActive <= RETENTION_MS + 2 * HEARTBEAT_MS;
      (record.id === currentId || index < RELEASE_COUNT || recent ? keep : remove).push(record);
    }
    const referenced = new Set(keep.flatMap((record) => record.files));
    for (const record of remove) {
      for (const name of record.files) {
        if (!referenced.has(name)) await fs.rm(join(assets, name), { force: true });
      }
      await fs.rm(join(releases, `${record.id}.json`));
      await fs.rm(join(usage, record.id));
    }
  }

  const currentId = await withArchiveLock(root, async () => {
    // The one-time seed is copied from the old container before its replacement.
    // A ready marker prevents importing an unfinished docker cp.
    const seed = join(root, 'seed');
    if (await exists(join(seed, 'ready'))) {
      await publish(seed);
      await fs.rm(seed, { recursive: true });
    }
    return publish(dist);
  });
  // Pruning failure must not take a healthy frontend down. Publication errors,
  // including an unwritable mount, do fail startup so deployment can roll back.
  const clean = () => withArchiveLock(root, () => prune(currentId))
    .catch((error) => console.error('[asset-history] Cleanup skipped:', error.message));
  await clean();
  const heartbeat = setInterval(() => {
    const now = new Date();
    void fs.utimes(join(usage, currentId), now, now)
      .catch((error) => console.error('[asset-history] Cannot refresh active build:', error.message));
  }, HEARTBEAT_MS);
  heartbeat.unref();
  const cleanup = setInterval(() => { void clean(); }, 60 * 60 * 1000);
  cleanup.unref();
  console.log(`[asset-history] Build ${currentId.slice(0, 12)} archived; keeping four builds and seven days.`);
  return assets;
}
