// backend/config/allowedOrigins.js
const allowedOrigins = [
  "http://localhost:3000",
  ...(process.env.PRODUCTION_ORIGINS
    ? process.env.PRODUCTION_ORIGINS.split(",")
    : []),
];

export default allowedOrigins;
