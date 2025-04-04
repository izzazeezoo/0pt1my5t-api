const db = require("../var/dbConfig");

const verifyUserGID = (req, res, next) => {
    const gidUser = req.headers["x-google-id"];

    // Check for missing parameter
    if (!gidUser) {
        return res.status(400).send({ message: "Parameter missing (GID)." });
    }

    // Fetch user data from the database
    db.query(
        `SELECT id, role_id, display_name FROM users WHERE google_id = ?`,
        [gidUser],
        (err, results) => {
            if (err) {
                console.error(err);
                return res.status(500).json({ error: true, message: "Database error" });
            }

            if (results.length === 0) {
                return res.status(404).json({ error: true, message: "User not found" });
            }

            // Attach user data to the request object
            req.user = results[0];
            next();
        }
    );
};

const verifyPMRole = (userId) => {
    return new Promise((resolve, reject) => {
        db.query(
            `SELECT role_id FROM users WHERE id = ?`,
            [userId],
            (err, results) => {
                if (err) {
                    console.error(err);
                    return reject(new Error("Database error while verifying role"));
                }

                if (results.length === 0 || results[0].role_id !== 3) {
                    return resolve(false); // User is not authorized
                }

                resolve(true); // User is authorized
            }
        );
    });
};

const verifyPrimaryPM = (req, res, next) => {
    const { id: userId } = req.user;
    const projectId = parseInt(req.params.projectId);
  
    db.query(
      `SELECT pm_id FROM projects WHERE id = ?`,
      [projectId],
      (err, results) => {
        if (err) {
          console.error(err);
          return res.status(500).json({ error: true, message: "Database error" });
        }
  
        if (results.length === 0) {
          return res.status(404).json({ error: true, message: "Project not found" });
        }
  
        const { pm_id } = results[0];
        if (pm_id !== userId) {
          return res.status(403).json({ error: true, message: "Forbidden: not the primary PM for this project." });
        }
  
        next();
      }
    );
  };
  

module.exports = {
    verifyUserGID,
    verifyPMRole,
    verifyPrimaryPM
};