const svc = require('./diseasePages.service');

function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

function sendResult(res, result) {
  const status = result?._statusCode;
  const body = Object.prototype.hasOwnProperty.call(result || {}, 'body') ? result.body : result;
  if (status) return res.status(status).json(body);
  return res.json(body);
}

async function createDiseasePage(req, res, next) {
  try {
    return sendResult(res, await svc.createDiseasePage(req.user, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getDiseasePages(req, res, next) {
  try {
    return sendResult(res, await svc.getDiseasePages(req.user, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getDiseasePageBySlug(req, res, next) {
  try {
    return sendResult(res, await svc.getDiseasePageBySlug(req.user, req.params.slug));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function followDiseasePage(req, res, next) {
  try {
    return sendResult(res, await svc.followDiseasePage(req.user, req.params.slug));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function unfollowDiseasePage(req, res, next) {
  try {
    return sendResult(res, await svc.unfollowDiseasePage(req.user, req.params.slug));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function featurePost(req, res, next) {
  try {
    return sendResult(res, await svc.featurePost(req.user, req.params.slug, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function unfeaturePost(req, res, next) {
  try {
    return sendResult(res, await svc.unfeaturePost(req.user, req.params.slug, req.params.postId));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function addResource(req, res, next) {
  try {
    return sendResult(res, await svc.addResource(req.user, req.params.slug, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function removeResource(req, res, next) {
  try {
    return sendResult(res, await svc.removeResource(req.user, req.params.slug, req.params.resourceId));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function updateDiseasePage(req, res, next) {
  try {
    return sendResult(res, await svc.updateDiseasePage(req.user, req.params.slug, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function deleteDiseasePage(req, res, next) {
  try {
    return sendResult(res, await svc.deleteDiseasePage(req.user, req.params.slug));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function createEvent(req, res, next) {
  try {
    return sendResult(res, await svc.createEvent(req.user, req.params.slug, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getDiseasePagePosts(req, res, next) {
  try {
    return sendResult(res, await svc.getDiseasePagePosts(req.user, req.params.slug, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function getAllDiseasePagePosts(req, res, next) {
  try {
    return sendResult(res, await svc.getAllDiseasePagePosts(req.user, req.params.slug, req.query));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function createDiseasePagePost(req, res, next) {
  try {
    return sendResult(res, await svc.createDiseasePagePost(req.user, req.params.slug, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function removeDiseasePagePost(req, res, next) {
  try {
    return sendResult(res, await svc.removeDiseasePagePost(req.user, req.params.slug, req.params.postId));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function reviewDiseasePagePost(req, res, next) {
  try {
    return sendResult(res, await svc.reviewDiseasePagePost(req.user, req.params.slug, req.params.postId, req.body));
  } catch (e) {
    return sendErr(res, e, next);
  }
}
async function likeDiseasePagePost(req, res, next) {
  try {
    return sendResult(res, await svc.likeDiseasePagePost(req.user, req.params.id));
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  createDiseasePage,
  getDiseasePages,
  getDiseasePageBySlug,
  followDiseasePage,
  unfollowDiseasePage,
  featurePost,
  unfeaturePost,
  addResource,
  removeResource,
  updateDiseasePage,
  deleteDiseasePage,
  createEvent,
  getDiseasePagePosts,
  getAllDiseasePagePosts,
  createDiseasePagePost,
  removeDiseasePagePost,
  reviewDiseasePagePost,
  likeDiseasePagePost,
};
