import { readFile, readdir, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import process from "node:process";
import { createHash } from "node:crypto";
const { Miniflare } = await import(
  "../node_modules/.pnpm/miniflare@5.20260730.0-alpha/node_modules/miniflare/dist/src/index.js"
);
const { default: sharp } = await import(
  "../node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js"
);

const REPO_ROOT = resolve(import.meta.dirname, "..");
const PERSIST_ROOT = resolve(REPO_ROOT, ".wrangler/state/v3");
const SUPERADMIN_ID = "00000000-0000-4000-8000-000000000001";
const IMPORT_LOCAL = process.argv.includes("--import-local");
const VERIFY_LOCAL = process.argv.includes("--verify-local");
const WRITE_MANIFEST = process.argv.includes("--write-manifest");

const sources = [
  { directory: "照片整理1", prefix: "lz", group: "photo1" },
  { directory: "照片整理2", prefix: "vs", group: "photo2" },
];

function contentType(format) {
  if (format === "jpeg") return "image/jpeg";
  if (format === "png") return "image/png";
  if (format === "webp") return "image/webp";
  throw new Error(`不支持的图片格式：${format || "unknown"}`);
}

function historicalTime(record, prefix) {
  if (prefix === "vs") return String(record.date ?? "").trim();
  const tags = Array.isArray(record.tags) ? record.tags.map(String) : [];
  return tags.find((tag) => /(?:年代|世纪|年|民国|清末)/.test(tag)) ?? "";
}

function projectTitle(record, prefix, index) {
  const value = prefix === "vs"
    ? record.title_zh || record.building_name_zh
    : record.text;
  return String(value || `${prefix.toUpperCase()} ${String(index).padStart(3, "0")}`).trim();
}

function projectLocation(record, prefix) {
  if (prefix === "vs") {
    return ["上海", record.building_name_zh, record.street_zh || record.address]
      .filter(Boolean).map(String).filter((value, index, all) => all.indexOf(value) === index).join(" · ");
  }
  const tags = Array.isArray(record.tags) ? record.tags.map(String) : [];
  const places = tags.filter((tag) => !/(?:年代|世纪|年)/.test(tag));
  return ["上海", ...places].filter((value, index, all) => all.indexOf(value) === index).join(" · ");
}

function projectNotes(record, prefix) {
  if (prefix === "vs") {
    return [record.note_zh, record.address && `地址：${record.address}`, "来源：Virtual Shanghai"]
      .filter(Boolean).join("\n");
  }
  return [record.text, record.source && `来源：${record.source}`, Array.isArray(record.tags) && `标签：${record.tags.join("、")}`]
    .filter(Boolean).join("\n");
}

function sourceUrl(record, prefix) {
  return String(prefix === "vs" ? record.building_url || record.image_url || "" : record.image_url || "");
}

async function inventorySource(source) {
  const root = resolve(REPO_ROOT, source.directory);
  const records = JSON.parse(await readFile(join(root, "data.json"), "utf8"));
  const originals = (await readdir(join(root, "原图"), { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const panoramas = (await readdir(join(root, "全景图", "无问题"), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && extname(entry.name).toLowerCase() === ".png")
    .map((entry) => entry.name)
    .sort();

  const items = [];
  const errors = [];
  for (const panoramaName of panoramas) {
    const match = panoramaName.match(new RegExp(`^${source.prefix}_(\\d{3})_pano\\.png$`, "i"));
    if (!match) {
      errors.push(`${source.directory}: 无法解析全景图编号 ${panoramaName}`);
      continue;
    }
    const index = Number(match[1]);
    const record = records.find((candidate) => Number(candidate.id) === index);
    if (!record) {
      errors.push(`${source.directory}: data.json 缺少 id=${index}`);
      continue;
    }
    const expectedOriginal = basename(String(record.image_path ?? ""));
    const indexedOriginals = originals.filter((name) => name.toLowerCase().startsWith(`${source.prefix}_${match[1]}_`));
    const originalName = originals.includes(expectedOriginal) ? expectedOriginal : indexedOriginals[0];
    if (!originalName) {
      errors.push(`${source.directory}: ${panoramaName} 缺少编号 ${match[1]} 的原图`);
      continue;
    }
    if (expectedOriginal && originalName !== expectedOriginal) {
      errors.push(`${source.directory}: id=${index} 的 data.json image_path 与原图文件名不一致`);
      continue;
    }
    if (indexedOriginals.length !== 1) {
      errors.push(`${source.directory}: id=${index} 匹配到 ${indexedOriginals.length} 张原图`);
      continue;
    }

    const originalPath = join(root, "原图", originalName);
    const panoramaPath = join(root, "全景图", "无问题", panoramaName);
    try {
      const [originalStat, panoramaStat] = await Promise.all([
        sharp(originalPath).metadata(),
        sharp(panoramaPath).metadata(),
      ]);
      const originalType = contentType(originalStat.format);
      const panoramaType = contentType(panoramaStat.format);
      if (!originalStat.width || !originalStat.height || !panoramaStat.width || !panoramaStat.height) {
        throw new Error("无法读取图片尺寸");
      }
      items.push({
        ...source,
        index,
        indexText: match[1],
        record,
        originalName,
        panoramaName,
        originalPath,
        panoramaPath,
        original: { type: originalType, width: originalStat.width, height: originalStat.height },
        panorama: { type: panoramaType, width: panoramaStat.width, height: panoramaStat.height },
      });
    } catch (error) {
      errors.push(`${source.directory}: id=${index} 图片不可解析（${error instanceof Error ? error.message : error}）`);
    }
  }
  return { items, errors, records: records.length, panoramas: panoramas.length };
}

function objectKeys(item) {
  const base = `curated-${item.group}-${item.prefix}-${item.indexText}`;
  return {
    original: `${base}-original${extname(item.originalName).toLowerCase() || ".jpg"}`,
    originalThumbnail: `${base}-original-thumb.webp`,
    panorama: `${base}-panorama.png`,
    panoramaThumbnail: `${base}-panorama-thumb.webp`,
  };
}

function assetUrl(key) {
  return `/api/assets/${encodeURIComponent(key)}`;
}

async function fileDigest(path) {
  const bytes = await readFile(path);
  return {
    bytes: bytes.byteLength,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function projectFor(item, order) {
  const keys = objectKeys(item);
  const id = `curated-${item.group}-${item.prefix}-${item.indexText}`;
  const title = projectTitle(item.record, item.prefix, item.index);
  const originalUrl = assetUrl(keys.original);
  const panoramaUrl = assetUrl(keys.panorama);
  const originalThumbnailUrl = assetUrl(keys.originalThumbnail);
  const panoramaThumbnailUrl = assetUrl(keys.panoramaThumbnail);
  const timestamp = new Date(Date.now() - order * 1000).toISOString();
  const scene = {
    id,
    title,
    subtitle: projectLocation(item.record, item.prefix),
    source: panoramaUrl,
    thumbnail: panoramaThumbnailUrl,
    mode: "sphere360",
    view: {
      yaw: 0, pitch: 0, hfov: 100,
      minYaw: -180, maxYaw: 180,
      minPitch: -85, maxPitch: 85,
      minHfov: 30, maxHfov: 120,
    },
    metadata: {
      sourceYear: historicalTime(item.record, item.prefix),
      sourceLabel: item.prefix === "vs" ? "Virtual Shanghai" : `老照片 / ${item.record.source || "未知来源"}`,
      sourceUrl: sourceUrl(item.record, item.prefix),
      originalImageUrl: originalUrl,
      sourceRecord: structuredClone(item.record),
      aiExpanded: true,
      disclaimer: "扩展区域由 AI 辅助生成；本轮仅导入人工分类为“无问题”的全景图。",
    },
  };
  return {
    id,
    title,
    captureTime: historicalTime(item.record, item.prefix),
    location: projectLocation(item.record, item.prefix),
    notes: projectNotes(item.record, item.prefix),
    originalUrl,
    originalThumbnailUrl,
    panoramaUrl,
    panoramaThumbnailUrl,
    scene,
    timestamp,
    keys,
  };
}

async function openLocalStorage() {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2026-07-21",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { DB: "00000000-0000-4000-8000-000000000000" },
    r2Buckets: { MEDIA: "site-creator-r2" },
    resourcePersistencePath: PERSIST_ROOT,
  });
  return {
    miniflare,
    db: await miniflare.getD1Database("DB"),
    media: await miniflare.getR2Bucket("MEDIA"),
  };
}

async function putImages(media, item, project) {
  const originalBytes = await readFile(item.originalPath);
  const panoramaBytes = await readFile(item.panoramaPath);
  const [originalThumbnail, panoramaThumbnail] = await Promise.all([
    sharp(originalBytes).rotate().resize({ width: 640, height: 640, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer(),
    sharp(panoramaBytes).resize({ width: 960, height: 480, fit: "cover", position: "centre" }).webp({ quality: 78 }).toBuffer(),
  ]);
  await Promise.all([
    media.put(project.keys.original, originalBytes, { httpMetadata: { contentType: item.original.type } }),
    media.put(project.keys.originalThumbnail, originalThumbnail, { httpMetadata: { contentType: "image/webp" } }),
    media.put(project.keys.panorama, panoramaBytes, { httpMetadata: { contentType: item.panorama.type } }),
    media.put(project.keys.panoramaThumbnail, panoramaThumbnail, { httpMetadata: { contentType: "image/webp" } }),
  ]);
}

async function main() {
  const inventories = await Promise.all(sources.map(inventorySource));
  const errors = inventories.flatMap((inventory) => inventory.errors);
  const items = inventories.flatMap((inventory) => inventory.items);
  console.log(JSON.stringify({
    mode: IMPORT_LOCAL ? "import-local" : VERIFY_LOCAL ? "verify-local" : "audit",
    sources: inventories.map((inventory, index) => ({
      directory: sources[index].directory,
      metadataRecords: inventory.records,
      whitelistedPanoramas: inventory.panoramas,
      validProjects: inventory.items.length,
      errors: inventory.errors.length,
    })),
    totalValidProjects: items.length,
    errors,
  }, null, 2));
  if (errors.length > 0) throw new Error(`完整性审计发现 ${errors.length} 个问题，未导入。`);
  if (WRITE_MANIFEST) {
    const manifestItems = [];
    for (const [order, item] of items.entries()) {
      const project = projectFor(item, order);
      const [originalFile, panoramaFile] = await Promise.all([
        fileDigest(item.originalPath),
        fileDigest(item.panoramaPath),
      ]);
      manifestItems.push({
        projectId: project.id,
        sourceDirectory: item.directory,
        dataJsonId: item.index,
        title: project.title,
        captureTime: project.captureTime,
        location: project.location,
        originalFile: { name: item.originalName, ...originalFile },
        panoramaFile: { name: item.panoramaName, ...panoramaFile },
        localObjectKeys: project.keys,
        publicationStatus: "draft",
        workflowStep: 3,
      });
    }
    const manifest = {
      generatedAt: new Date().toISOString(),
      owner: { environment: "local", userId: SUPERADMIN_ID, username: "superadmin" },
      selection: "全景图/无问题",
      totalProjects: manifestItems.length,
      sourceCounts: Object.fromEntries(sources.map((source) => [
        source.directory,
        manifestItems.filter((item) => item.sourceDirectory === source.directory).length,
      ])),
      items: manifestItems,
    };
    const manifestPath = resolve(REPO_ROOT, ".codex-tmp/curated-photo-import-manifest.json");
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`导入清单：${manifestPath}`);
  }
  if (!IMPORT_LOCAL && !VERIFY_LOCAL) return;

  const { miniflare, db, media } = await openLocalStorage();
  try {
    const owner = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'superadmin' AND status = 'active'")
      .bind(SUPERADMIN_ID).first();
    if (!owner) throw new Error("本地数据库没有可用的 superadmin。请先启动一次本地 MemoScape。 ");
    const ids = items.map((item) => `curated-${item.group}-${item.prefix}-${item.indexText}`);
    if (VERIFY_LOCAL) {
      const rows = await db.prepare(`
        SELECT id, owner_user_id, publication_status, workflow_step, scene_json,
               original_image_url, original_thumbnail_url, panorama_image_url, panorama_thumbnail_url
        FROM projects WHERE id IN (${ids.map(() => "?").join(",")})
      `).bind(...ids).all();
      const rowById = new Map(rows.results.map((row) => [row.id, row]));
      const verificationErrors = [];
      let objectCount = 0;
      for (const item of items) {
        const id = `curated-${item.group}-${item.prefix}-${item.indexText}`;
        const row = rowById.get(id);
        if (!row) {
          verificationErrors.push(`${id}: 缺少项目行`);
          continue;
        }
        if (row.owner_user_id !== SUPERADMIN_ID || row.publication_status !== "draft" || row.workflow_step !== 3) {
          verificationErrors.push(`${id}: 归属、草稿状态或工作流步骤错误`);
        }
        const scene = JSON.parse(row.scene_json);
        if (Number(scene?.metadata?.sourceRecord?.id) !== item.index) {
          verificationErrors.push(`${id}: sourceRecord 与 data.json 不对应`);
        }
        for (const url of [row.original_image_url, row.original_thumbnail_url, row.panorama_image_url, row.panorama_thumbnail_url]) {
          const key = decodeURIComponent(String(url).replace(/^\/api\/assets\//, ""));
          const object = await media.head(key);
          if (!object || object.size <= 0) verificationErrors.push(`${id}: 素材不可读取 ${key}`);
          else objectCount += 1;
        }
      }
      console.log(JSON.stringify({
        projects: rows.results.length,
        objects: objectCount,
        groupCounts: rows.results.reduce((counts, row) => {
          const group = String(row.id).startsWith("curated-photo1-") ? "照片整理1" : "照片整理2";
          counts[group] = (counts[group] ?? 0) + 1;
          return counts;
        }, {}),
        errors: verificationErrors,
      }, null, 2));
      if (verificationErrors.length > 0) throw new Error(`本地验收发现 ${verificationErrors.length} 个问题。`);
      return;
    }
    const existing = await db.prepare(`SELECT id FROM projects WHERE id IN (${ids.map(() => "?").join(",")})`)
      .bind(...ids).all();
    if (existing.results.length > 0) {
      throw new Error(`检测到 ${existing.results.length} 个同批次项目，已停止以避免覆盖人工修改。`);
    }

    const projects = items.map(projectFor);
    let completed = 0;
    for (let index = 0; index < items.length; index += 1) {
      await putImages(media, items[index], projects[index]);
      completed += 1;
      if (completed % 10 === 0 || completed === items.length) {
        console.log(`本地素材写入：${completed}/${items.length}`);
      }
    }

    await db.batch(projects.map((project) => db.prepare(`
      INSERT INTO projects (
        id, title, capture_time, location, notes, mode,
        original_image_url, original_thumbnail_url,
        panorama_image_url, panorama_thumbnail_url, scene_json,
        workflow_step, publication_status, owner_user_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'sphere360', ?, ?, ?, ?, ?, 3, 'draft', ?, ?, ?)
    `).bind(
      project.id, project.title, project.captureTime, project.location, project.notes,
      project.originalUrl, project.originalThumbnailUrl,
      project.panoramaUrl, project.panoramaThumbnailUrl, JSON.stringify(project.scene),
      SUPERADMIN_ID, project.timestamp, project.timestamp,
    )));
    console.log(`本地项目写入完成：${projects.length} 个草稿项目。`);
  } finally {
    await miniflare.dispose();
  }
}

await main();
