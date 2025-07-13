// backend/config/allowedOrigins.js
const allowedOrigins = [
  ...(process.env.PRODUCTION_ORIGINS
    ? process.env.PRODUCTION_ORIGINS.split(",")
    : []),
];

export default allowedOrigins;
