const { SimpleTtlCache } = require('../../utils/simpleTtlCache');

// Best-effort per-process caches to reduce repeated DB work under load.
const diseaseFollowerIdsCache = new SimpleTtlCache({ defaultTtlMs: 30000, maxEntries: 5000 });

async function getDiseaseFollowerIdsCached(diseasePageSlug) {
  const key = String(diseasePageSlug || '');
  if (!key) return [];

  const cached = diseaseFollowerIdsCache.get(key);
  if (cached) return cached;

  const DiseaseFollower = require('../../models/DiseaseFollower');
  const followers = await DiseaseFollower.find({ diseasePageSlug: key }).select('userId').lean();
  const followerIds = followers.map((f) => f.userId);

  diseaseFollowerIdsCache.set(key, followerIds);
  return followerIds;
}

module.exports = {
  getDiseaseFollowerIdsCached,
};
