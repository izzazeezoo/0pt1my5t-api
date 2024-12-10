const jwt = require('jsonwebtoken');

const authorization = (req, res, next) => {
    const token = req.cookies.jwtToken;
    if (!token) {
      return res.status(401).send("AUTHORIZATION ERROR!!!");
    }
    try {
      let payload = jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } 
    catch {
      return res.status(401).send("AUTHORIZATION FAILED!!!");
    }
  };

module.exports = authorization;