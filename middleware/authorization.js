const jwt = require('jsonwebtoken');

const authorization = (req, res, next) => {
    const token = req.cookies.jwtToken;
    console.log("token di cookies: ", token);
    if (!token) {
      return res.status(401).send("Please provide your authentication token!");
    }
    try {
      let payload = jwt.verify(token, process.env.JWT_SECRET);
      console.log("payload : ", payload);
      return next();
    } 
    catch {
      return res.status(401).send("AUTHORIZATION FAILED!!!");
    }
  };

module.exports = authorization;