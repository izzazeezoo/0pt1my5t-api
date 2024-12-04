const mysql = require('mysql2');

//TO DO: Replace it with your current database
/*const db = mysql.createConnection({
    socketPath: process.env.INSTANCE_UNIX_SOCKET,
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    connectTimeout: 30000, // Set the connection timeout value (in milliseconds)
    acquireTimeout: 30000, // Set the timeout value for acquiring a connection (in milliseconds)
    timeout: 60000
  });*/

const db = mysql.createConnection({
  host: process.env.DB_HOST,       // Hostname (XAMPP's MySQL runs on localhost)
  user: process.env.DB_USER,            // Default MySQL username
  password: process.env.DB_PASSWORD,            // Default MySQL password (empty in XAMPP by default)
  database: process.env.DB_NAME    // Your database name
});

/*db.connect((err) => {
    if (err) {
      console.error('Error connecting to the database:', err);
      return;
    }
    console.log('Successfully connected to the database');
  });
  */

module.exports = db;