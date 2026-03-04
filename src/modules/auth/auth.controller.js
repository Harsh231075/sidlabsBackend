const svc = require('./auth.service');

function sendErr(res, err, next) {
  if (err.responseBody) return res.status(err.status).json(err.responseBody);
  if (err.status) return res.sendStatus(err.status);
  return next(err);
}

function applyCookieOps(res, result) {
  const cookiesToSet = result?.cookiesToSet || [];
  for (const c of cookiesToSet) {
    res.cookie(c.name, c.value, c.options);
  }

  const cookiesToClear = result?.cookiesToClear || [];
  for (const c of cookiesToClear) {
    res.clearCookie(c.name, c.options);
  }
}

function sendServiceResult(res, result) {
  const statusCode = result?._statusCode;

  applyCookieOps(res, result);

  if (result?._end) {
    if (statusCode) return res.status(statusCode).end();
    return res.end();
  }

  const body = Object.prototype.hasOwnProperty.call(result || {}, 'body') ? result.body : result;
  if (statusCode) return res.status(statusCode).json(body);
  return res.json(body);
}

async function registerUser(req, res, next) {
  try {
    const result = await svc.registerUser(req.body);
    return sendServiceResult(res, result);
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function cognitoLogin(req, res, next) {
  try {
    const result = await svc.cognitoLogin(req.body);
    return sendServiceResult(res, result);
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function respondToAuthChallenge(req, res, next) {
  try {
    const result = await svc.respondToAuthChallenge(req.body);
    return sendServiceResult(res, result);
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function forgotPassword(req, res, next) {
  try {
    const result = await svc.forgotPassword(req.body);
    return sendServiceResult(res, result);
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function resetPassword(req, res, next) {
  try {
    const result = await svc.resetPassword(req.body);
    return sendServiceResult(res, result);
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getMe(req, res, next) {
  try {
    const result = await svc.getMe(req.user.id);
    return sendServiceResult(res, result);
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function getUser(req, res, next) {
  try {
    const result = await svc.getUser(req.cookies);
    return sendServiceResult(res, result);
  } catch (e) {
    return sendErr(res, e, next);
  }
}

async function logout(req, res, next) {
  try {
    const result = await svc.logout();
    return sendServiceResult(res, result);
  } catch (e) {
    return sendErr(res, e, next);
  }
}

module.exports = {
  registerUser,
  cognitoLogin,
  respondToAuthChallenge,
  forgotPassword,
  resetPassword,
  getMe,
  getUser,
  logout,
};
